import os
import warnings

# Suppress Python 3.12 multiprocess ResourceTracker bug (harmless cleanup error)
os.environ["TOKENIZERS_PARALLELISM"] = "false"

# Patch ResourceTracker to ignore the Python 3.12 bug
try:
    from multiprocess.resource_tracker import ResourceTracker
    original_del = ResourceTracker.__del__
    def patched_del(self):
        try:
            original_del(self)
        except AttributeError:
            pass  # Ignore Python 3.12 multiprocess bug
    ResourceTracker.__del__ = patched_del
except ImportError:
    pass

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
    from ingestion import get_embeddings, get_vectorstore, check_vectorstore_health
    logger.info("Warming up embeddings model...")
    get_embeddings()
    logger.info("Loading vector store...")
    get_vectorstore()
    vs_ok = check_vectorstore_health()
    logger.info("Vector store ready: %s", vs_ok)
    metrics.startup_time = time.time()
    logger.info("Kanya Raasi is ready to serve.")
    yield
    # ── Shutdown ──
    logger.info("Shutting down gracefully...")


# ────────────────────────────────────────────────────────────────
# APP INITIALISATION
# ────────────────────────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="Kanya Raasi - Weight Loss AI Agent",
    description="Production-grade RAG API for weight loss and nutrition advice",
    version="3.0.0",
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
    k: int = Field(default=5, ge=1, le=10, description="Number of documents to retrieve")
    conversation_history: list[dict] = Field(default_factory=list, description="Previous conversation context")

    @field_validator('query')
    @classmethod
    def validate_query(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError('Query cannot be empty')
        return v.strip()


class SearchResponse(BaseModel):
    query: str
    results: list[dict]


# ────────────────────────────────────────────────────────────────
# ENDPOINTS
# ────────────────────────────────────────────────────────────────

@app.get("/api")
def root(request: Request):
    return {
        "service": "Kanya Raasi - Weight Loss AI Agent",
        "version": "3.0.0",
        "docs": "/docs",
        "health": "/health",
        "metrics": "/metrics",
    }


@app.get("/health")
def health_check(request: Request):
    """Deep health check — verifies vector store and LLM API key."""
    from ingestion import check_vectorstore_health, check_llm_health

    vs_ok = check_vectorstore_health()
    llm_ok = check_llm_health()
    overall = "healthy" if (vs_ok and llm_ok) else "degraded"

    return {
        "status": overall,
        "version": "3.0.0",
        "checks": {
            "vectorstore": "ok" if vs_ok else "unavailable",
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
    from ingestion import ask_with_stream

    req_id = getattr(request.state, 'request_id', 'unknown')
    logger.info("req=%s ask query=%s", req_id, body.query[:80])

    def generate():
        metrics.active_streams += 1
        try:
            for chunk in ask_with_stream(
                body.query,
                body.k,
                body.conversation_history
            ):
                metrics.tokens_generated += 1
                yield chunk
        except Exception as e:
            logger.exception("req=%s streaming error", req_id)
            metrics.record_error(500)
            yield f"Error: {str(e)}"
        finally:
            metrics.active_streams -= 1

    return StreamingResponse(
        generate(),
        media_type="text/plain",
        headers={
            "Cache-Control": "no-cache, no-store",
            "X-Accel-Buffering": "no",
        }
    )


@app.post("/search", response_model=SearchResponse,
          responses={400: {"description": "Invalid request"}, 503: {"description": "Vector store unavailable"}, 500: {"description": "Server error"}})
@limiter.limit(f"{os.getenv('RATE_LIMIT_PER_MINUTE', '30')}/minute")
def search_documents(request: Request, body: QueryRequest):
    """Search for relevant documents without generating an AI answer."""
    from ingestion import get_retriever

    req_id = getattr(request.state, 'request_id', 'unknown')
    logger.info("req=%s search query=%s", req_id, body.query[:80])

    retriever = get_retriever(body.k)
    if not retriever:
        raise HTTPException(status_code=503, detail="Vector store not available. Run ingestion first.")

    docs = retriever.invoke(body.query)

    results = [
        {
            "content": doc.page_content[:500],
            "source": doc.metadata.get('source', 'Unknown'),
            "page": doc.metadata.get('page', 'Unknown')
        }
        for doc in docs
    ]

    logger.info("req=%s search found %d results", req_id, len(results))
    return SearchResponse(query=body.query, results=results)


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
