# Kanya Raasi - AI Health Coach

A production-grade AI health coach that provides personalized weight loss, nutrition, and fitness advice using Retrieval-Augmented Generation (RAG) with live web search.

## 🌟 Features

- **Domain-Specific RAG**: Retrieves from PDFs, HuggingFace datasets, and live web search
- **Expert System Prompt**: Tuned for weight loss coaching (ages 24-45, calorie/macro advice)
- **Streaming Responses**: Real-time token streaming for instant feedback
- **Conversation Memory**: Last 6 turns sent to the LLM for contextual follow-ups
- **Application Metrics**: `/metrics` endpoint with p50/p95/p99 latency, request counts, error rates
- **Deep Health Checks**: `/health` verifies vector store and LLM API key status
- **Security Hardened**: Rate limiting, CORS lockdown, security headers, input validation
- **Startup Warm-up**: Embeddings model and vector store cached at boot (no cold-start lag)
- **Dark/Light Theme**: Modern chat UI with export and history
- **Responsive Design**: Desktop and mobile ready

## 🛠 Tech Stack

### Backend
- **Python 3.8+**
- **FastAPI**: Modern, fast web framework for building APIs
- **LangChain**: Framework for building LLM applications
- **ChromaDB**: Local vector database for embeddings
- **HuggingFace Transformers**: Sentence embeddings (all-MiniLM-L6-v2)
- **OpenRouter API**: Access to multiple LLM models (default: Google Gemini 2.0 Flash)
- **DuckDuckGo Search**: Web search integration
- **SlowAPI**: Rate limiting middleware

### Frontend
- **Vanilla JavaScript**: No framework dependencies
- **Modern CSS**: Responsive design with CSS Grid and Flexbox
- **LocalStorage**: Client-side persistence
- **Streaming API**: Real-time response streaming

## 📋 Prerequisites

- Python 3.8 or higher
- pip (Python package manager)
- OpenRouter API key ([Get free API key](https://openrouter.ai/))

## 🚀 Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd weight-agent
```

### 2. Backend Setup

```bash
cd backend

# Create virtual environment (recommended)
python -m venv venv

# Activate virtual environment
# On macOS/Linux:
source venv/bin/activate
# On Windows:
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### 3. Configure Environment Variables

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env and add your OpenRouter API key
# Required: OPENROUTER_API_KEY=your_api_key_here
```

See [Configuration](#configuration) for all available options.

### 4. Run Data Ingestion (First Time Only)

```bash
python ingestion.py
```

This will:
- Load PDF documents from the `data/` folder
- Fetch datasets from HuggingFace
- Generate embeddings using HuggingFace transformers
- Store vectors in ChromaDB

**Note**: This may take several minutes on first run as it downloads the embedding model.

## ⚙️ Configuration

Create a `.env` file in the `backend/` directory with the following variables:

### Required Variables

```bash
OPENROUTER_API_KEY=your_openrouter_api_key_here
```

### Optional Variables

```bash
# LLM Configuration
LLM_MODEL=google/gemini-2.0-flash-001  # Model to use

# Server Configuration
HOST=0.0.0.0
PORT=8000

# CORS Configuration (comma-separated)
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

# Rate Limiting
RATE_LIMIT_PER_MINUTE=30

# Search Configuration
DEFAULT_SEARCH_RESULTS=5
MAX_SEARCH_RESULTS=10

# Web Search
ENABLE_WEB_SEARCH=true
WEB_SEARCH_MAX_RESULTS=5
```

## 🎯 Running the Application

### Start the Backend Server

```bash
cd backend
source venv/bin/activate  # Activate virtual environment (recommended)
python3 main.py
```

The API will be available at `http://localhost:8000`

### Access the Frontend

The frontend is served directly from the backend at:

```
http://localhost:8000/app/
```

No separate frontend server is needed — this eliminates CORS issues in development.

## 📡 API Endpoints

### GET `/`
Welcome message with API information

### GET `/health`
Deep health check with dependency status

### POST `/ask`
Ask a question and get AI-generated answer (streaming)

**Request Body:**
```json
{
  "query": "What should I eat to lose weight?",
  "k": 5,
  "conversation_history": [
    {"role": "user", "content": "Previous question"},
    {"role": "ai", "content": "Previous answer"}
  ]
}
```

**Response:** Streaming text/plain with answer and sources

### POST `/search`
Search for relevant documents without AI answer

**Request Body:**
```json
{
  "query": "protein requirements",
  "k": 5
}
```

**Response:**
```json
{
  "query": "protein requirements",
  "results": [
    {
      "content": "Document content...",
      "source": "Source name",
      "page": 1
    }
  ]
}
```

## 🔧 Development

### Adding New PDF Documents

Place PDF files in the `data/` directory and re-run ingestion:

```bash
cd backend
python ingestion.py
```

### Changing the LLM Model

Edit the `.env` file:

```bash
LLM_MODEL=anthropic/claude-3-haiku
```

Available models: [OpenRouter Models](https://openrouter.ai/models)

### Adjusting Web Search Behavior

```bash
# Disable web search
ENABLE_WEB_SEARCH=false

# Increase web search results
WEB_SEARCH_MAX_RESULTS=10
```

## 🐛 Troubleshooting

### Backend won't start

- Ensure Python 3.8+ is installed: `python --version`
- Check all dependencies are installed: `pip list`
- Verify `.env` file exists and contains valid API key

### Vector store not found

- Run ingestion: `python ingestion.py`
- Check that `chroma_db/` directory exists in `backend/`

### CORS errors

- Update `ALLOWED_ORIGINS` in `.env` to include your frontend URL
- For development: `http://localhost:3000`

### Rate limit errors

- Increase `RATE_LIMIT_PER_MINUTE` in `.env`
- Wait before making additional requests

### Slow responses

- Reduce `k` (number of documents to retrieve)
- Use a faster LLM model
- Check internet connection for web search

## 🔒 Security Considerations

- **API Keys**: Never commit `.env` file to version control
- **CORS**: Restrict `ALLOWED_ORIGINS` in production
- **Rate Limiting**: Adjust based on your usage patterns
- **Input Validation**: All inputs are validated on the backend
- **HTTPS**: Use HTTPS in production environments

## � Monitoring & Metrics

### GET `/metrics`
Returns real-time application metrics:

```json
{
  "uptime_seconds": 3600.5,
  "requests_total": 142,
  "requests_by_endpoint": {"/ask": 98, "/search": 30, "/health": 14},
  "errors_total": 3,
  "errors_by_status": {"500": 2, "429": 1},
  "tokens_generated": 24500,
  "web_searches": 12,
  "active_streams": 1,
  "latency_ms": {"p50": 450.2, "p95": 1200.8, "p99": 2500.3},
  "samples": 142
}
```

### GET `/health`
Deep health check with dependency verification:

```json
{
  "status": "healthy",
  "version": "3.0.0",
  "checks": {
    "vectorstore": "ok",
    "llm_api_key": "configured"
  },
  "uptime_seconds": 3600.5
}
```

### Structured Logging
Every request is logged with a unique request ID for tracing:
```
2025-01-15T14:30:22 [INFO] kanya_raasi | req=a1b2c3d4 method=POST path=/ask status=200 latency=1234ms
```

### Key Metrics to Monitor
- **p95 latency** — should stay under 3s for good UX
- **errors_total / requests_total** — error rate (target < 1%)
- **active_streams** — concurrent streaming connections
- **tokens_generated** — LLM usage tracking for cost control

## �� Architecture

```
User Query → Frontend → API → Vector Store Search
                    ↓
              Web Search (if needed)
                    ↓
              Context Building (system prompt + conversation history)
                    ↓
              LLM (OpenRouter) → Streaming Response
                    ↓
              Frontend Display (real-time token rendering)
```
