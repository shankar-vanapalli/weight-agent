import os
import warnings

os.environ["TOKENIZERS_PARALLELISM"] = "false"

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
from contextlib import asynccontextmanager
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from dotenv import load_dotenv
import logging
import time
import uuid

# Load environment variables
load_dotenv()

# ────────────────────────────────────────────────────────────────
# LOGGING — structured, JSON-friendly format for prod log aggregation
# ────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format='%(asctime)s [%(levelname)s] %(name)s | %(message)s',
    datefmt='%Y-%m-%dT%H:%M:%S'
)
logger = logging.getLogger("kanya_raasi")


# ────────────────────────────────────────────────────────────────
# APPLICATION METRICS  (in-memory; plug into Prometheus/Datadog)
# ────────────────────────────────────────────────────────────────
class Metrics:
    """Simple in-process counters.  Exposed via GET /metrics."""
    def __init__(self):
        self.requests_total = 0
        self.requests_by_endpoint: dict[str, int] = {}
        self.errors_total = 0
        self.errors_by_status: dict[int, int] = {}
        self.latency_samples: list[float] = []   # last 1000 latencies in ms
        self.tokens_generated = 0
        self.web_searches = 0
        self.active_streams = 0
        self.startup_time: float | None = None

    def record_request(self, endpoint: str):
        self.requests_total += 1
        self.requests_by_endpoint[endpoint] = self.requests_by_endpoint.get(endpoint, 0) + 1

    def record_error(self, status: int):
        self.errors_total += 1
        self.errors_by_status[status] = self.errors_by_status.get(status, 0) + 1

    def record_latency(self, ms: float):
        self.latency_samples.append(ms)
        if len(self.latency_samples) > 1000:
            self.latency_samples = self.latency_samples[-1000:]

    def snapshot(self) -> dict:
        lats = self.latency_samples
        p50 = sorted(lats)[len(lats)//2] if lats else 0
        p95 = sorted(lats)[int(len(lats)*0.95)] if lats else 0
        p99 = sorted(lats)[int(len(lats)*0.99)] if lats else 0
        uptime = time.time() - self.startup_time if self.startup_time else 0
        return {
            "uptime_seconds": round(uptime, 1),
            "requests_total": self.requests_total,
            "requests_by_endpoint": self.requests_by_endpoint,
            "errors_total": self.errors_total,
            "errors_by_status": self.errors_by_status,
            "tokens_generated": self.tokens_generated,
            "web_searches": self.web_searches,
            "active_streams": self.active_streams,
            "latency_ms": {"p50": round(p50, 1), "p95": round(p95, 1), "p99": round(p99, 1)},
            "samples": len(lats),
        }

metrics = Metrics()


# ────────────────────────────────────────────────────────────────
# LIFESPAN — warm up caches on startup, clean up on shutdown
# ────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ──
    from llm import check_llm_health
    from database import get_db
    
    logger.info("Initializing database...")
    get_db()  # Initialize database
    
    llm_ok = check_llm_health()
    logger.info("LLM API key configured: %s", llm_ok)
    
    metrics.startup_time = time.time()
    logger.info("Kanya Raasi is ready to serve (no-RAG mode).")
    yield
    # ── Shutdown ──
    logger.info("Shutting down gracefully...")


# ────────────────────────────────────────────────────────────────
# APP INITIALISATION
# ────────────────────────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="Kanya Raasi - AI Health Coach",
    description="Evidence-based, personalized health coaching with web search",
    version="4.0.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS
allowed_origins = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000"
).split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Accept", "Authorization"],
    max_age=600,
)


# ────────────────────────────────────────────────────────────────
# MIDDLEWARE — request tracing, security headers, metrics
# ────────────────────────────────────────────────────────────────
@app.middleware("http")
async def request_middleware(request: Request, call_next):
    request_id = str(uuid.uuid4())[:8]
    start = time.time()
    endpoint = request.url.path

    # Attach request_id for downstream logging
    request.state.request_id = request_id
    metrics.record_request(endpoint)

    try:
        response: Response = await call_next(request)
    except Exception:
        metrics.record_error(500)
        raise

    elapsed_ms = (time.time() - start) * 1000
    metrics.record_latency(elapsed_ms)

    if response.status_code >= 400:
        metrics.record_error(response.status_code)

    # Security headers
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

    logger.info(
        "req=%s method=%s path=%s status=%d latency=%.0fms",
        request_id, request.method, endpoint, response.status_code, elapsed_ms
    )
    return response


# ────────────────────────────────────────────────────────────────
# REQUEST / RESPONSE MODELS
# ────────────────────────────────────────────────────────────────
class QueryRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000, description="User query")
    conversation_history: list[dict] = Field(default_factory=list, description="Previous conversation context")
    session_id: str | None = Field(default=None, description="User session ID for personalization")

    @field_validator('query')
    @classmethod
    def validate_query(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError('Query cannot be empty')
        return v.strip()


class ProfileData(BaseModel):
    age: int | None = Field(default=None, ge=10, le=120)
    gender: str | None = None
    height_cm: float | None = Field(default=None, ge=50, le=300)
    current_weight_kg: float | None = Field(default=None, ge=20, le=500)
    target_weight_kg: float | None = Field(default=None, ge=20, le=500)
    dietary_restrictions: list[str] = Field(default_factory=list)
    activity_level: str | None = None
    goal_type: str | None = None
    notes: str | None = None


class WeightEntry(BaseModel):
    weight_kg: float = Field(..., ge=20, le=500)


class SearchResponse(BaseModel):
    query: str
    results: list[dict]


# ────────────────────────────────────────────────────────────────
# ENDPOINTS
# ────────────────────────────────────────────────────────────────

@app.get("/api")
def root(request: Request):
    return {
        "service": "Kanya Raasi - AI Health Coach",
        "version": "4.0.0",
        "mode": "no-RAG (web search + LLM knowledge)",
        "docs": "/docs",
        "health": "/health",
        "metrics": "/metrics",
    }


@app.get("/health")
def health_check(request: Request):
    """Deep health check — verifies LLM API key and database."""
    from llm import check_llm_health
    from database import get_db

    llm_ok = check_llm_health()
    
    # Check database
    db_ok = False
    try:
        db = get_db()
        db_ok = True
    except:
        pass
    
    overall = "healthy" if (llm_ok and db_ok) else "degraded"

    return {
        "status": overall,
        "version": "4.0.0",
        "mode": "no-RAG (web search + LLM knowledge)",
        "checks": {
            "database": "ok" if db_ok else "unavailable",
            "llm_api_key": "configured" if llm_ok else "missing",
        },
        "uptime_seconds": round(time.time() - metrics.startup_time, 1) if metrics.startup_time else 0,
    }


@app.get("/metrics")
def get_metrics(request: Request):
    """Application metrics for monitoring dashboards."""
    return JSONResponse(content=metrics.snapshot())


@app.post("/ask",
          responses={400: {"description": "Invalid request"}, 500: {"description": "Server error"}})
@limiter.limit(f"{os.getenv('RATE_LIMIT_PER_MINUTE', '30')}/minute")
def ask_question(request: Request, body: QueryRequest):
    """Ask a question and get an AI-generated answer with streaming response."""
    from llm import ask_with_stream
    from database import get_db

    req_id = getattr(request.state, 'request_id', 'unknown')
    logger.info("req=%s ask query=%s session=%s", req_id, body.query[:80], body.session_id)

    # Get user profile and conversation history from database
    user_profile = None
    db_history = []
    db = None
    
    if body.session_id:
        try:
            db = get_db()
            # Ensure this session exists in the database (auto-create if new)
            db.ensure_session_exists(body.session_id)
            
            user_profile = db.get_profile(body.session_id)
            
            # Load conversation history from database (last 30 messages)
            db_history = db.get_conversation_history(body.session_id, limit=30)
            logger.info("req=%s profile=%s db_history=%d msgs",
                        req_id,
                        "found" if user_profile else "empty",
                        len(db_history))
        except Exception as e:
            logger.warning("Failed to load profile/history: %s", e)

    # Use database history; fall back to frontend history only if DB is empty
    conversation_history = db_history if db_history else body.conversation_history

    # Store the full answer for saving to database later
    full_answer = ""
    
    def generate():
        nonlocal full_answer
        metrics.active_streams += 1
        try:
            for chunk in ask_with_stream(
                body.query,
                conversation_history,
                user_profile
            ):
                metrics.tokens_generated += 1
                full_answer += chunk
                yield chunk
        except Exception as e:
            logger.exception("req=%s streaming error", req_id)
            metrics.record_error(500)
            yield f"Error: {str(e)}"
        finally:
            metrics.active_streams -= 1
            
            # Save conversation to database after streaming completes
            if body.session_id and db and full_answer:
                try:
                    db.add_conversation_message(body.session_id, 'user', body.query)
                    db.add_conversation_message(body.session_id, 'ai', full_answer)
                    logger.info("req=%s saved conversation to DB", req_id)
                except Exception as e:
                    logger.warning("Failed to save conversation: %s", e)

    return StreamingResponse(
        generate(),
        media_type="text/plain",
        headers={
            "Cache-Control": "no-cache, no-store",
            "X-Accel-Buffering": "no",
        }
    )


@app.post("/profile")
@limiter.limit(f"{os.getenv('RATE_LIMIT_PER_MINUTE', '30')}/minute")
def create_or_update_profile(request: Request, session_id: str, profile: ProfileData):
    """Create or update a user profile."""
    from database import get_db
    
    req_id = getattr(request.state, 'request_id', 'unknown')
    logger.info("req=%s profile update session=%s", req_id, session_id)
    
    try:
        db = get_db()
        updated_profile = db.create_or_update_profile(session_id, profile.model_dump())
        return {"status": "success", "profile": updated_profile}
    except Exception as e:
        logger.exception("req=%s profile update error", req_id)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/profile/{session_id}")
@limiter.limit(f"{os.getenv('RATE_LIMIT_PER_MINUTE', '30')}/minute")
def get_profile(request: Request, session_id: str):
    """Retrieve a user profile."""
    from database import get_db
    
    req_id = getattr(request.state, 'request_id', 'unknown')
    logger.info("req=%s profile get session=%s", req_id, session_id)
    
    try:
        db = get_db()
        profile = db.get_profile(session_id)
        if not profile:
            raise HTTPException(status_code=404, detail="Profile not found")
        return {"status": "success", "profile": profile}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("req=%s profile get error", req_id)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/profile/{session_id}/weight")
@limiter.limit(f"{os.getenv('RATE_LIMIT_PER_MINUTE', '30')}/minute")
def log_weight(request: Request, session_id: str, weight: WeightEntry):
    """Log a weight entry for progress tracking."""
    from database import get_db
    
    req_id = getattr(request.state, 'request_id', 'unknown')
    logger.info("req=%s weight log session=%s weight=%s", req_id, session_id, weight.weight_kg)
    
    try:
        db = get_db()
        success = db.log_weight(session_id, weight.weight_kg)
        if not success:
            raise HTTPException(status_code=404, detail="Profile not found")
        return {"status": "success", "weight_kg": weight.weight_kg}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("req=%s weight log error", req_id)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/profile/{session_id}/progress")
@limiter.limit(f"{os.getenv('RATE_LIMIT_PER_MINUTE', '30')}/minute")
def get_progress(request: Request, session_id: str):
    """Get progress data for charts and analytics."""
    from database import get_db
    
    req_id = getattr(request.state, 'request_id', 'unknown')
    logger.info("req=%s progress get session=%s", req_id, session_id)
    
    try:
        db = get_db()
        progress = db.get_progress(session_id)
        if 'error' in progress:
            raise HTTPException(status_code=404, detail=progress['error'])
        return {"status": "success", "progress": progress}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("req=%s progress get error", req_id)
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/profile/{session_id}/conversations")
@limiter.limit(f"{os.getenv('RATE_LIMIT_PER_MINUTE', '30')}/minute")
def clear_conversations(request: Request, session_id: str):
    """Clear conversation history (keep profile)."""
    from database import get_db
    
    req_id = getattr(request.state, 'request_id', 'unknown')
    logger.info("req=%s clear conversations session=%s", req_id, session_id)
    
    try:
        db = get_db()
        db.clear_conversation_history(session_id)
        return {"status": "success", "message": "Conversation history cleared"}
    except Exception as e:
        logger.exception("req=%s clear conversations error", req_id)
        raise HTTPException(status_code=500, detail=str(e))


# ────────────────────────────────────────────────────────────────
# ENTRYPOINT
# ────────────────────────────────────────────────────────────────
# Serve frontend static files so CORS is not needed in dev
# (frontend and API share the same origin http://localhost:8000)
frontend_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
if os.path.isdir(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
    logger.info("Frontend served at / from %s", frontend_dir)


if __name__ == "__main__":
    import uvicorn
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    env = os.getenv("ENV", "development").strip()
    is_dev = env == "development"
    workers = 1 if is_dev else int(os.getenv("WORKERS", "2"))
    logger.info("Starting server on %s:%d (env=%s, workers=%d, reload=%s)", host, port, env, workers, is_dev)
    uvicorn.run("main:app", host=host, port=port, reload=is_dev, workers=workers)
