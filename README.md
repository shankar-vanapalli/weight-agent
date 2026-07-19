# Kanya Raasi - AI Health Coach

An evidence-based, personalized AI health coach that provides weight loss, nutrition, and fitness advice using scientific web search and LLM knowledge.

## 🌟 Features

### Personalization
- **User Profiles**: Track weight, height, age, goals, and dietary restrictions
- **Progress Tracking**: Weight history with BMI calculations and progress charts
- **Personalized Advice**: Every response tailored to your profile data
- **Session Persistence**: Your data is saved across sessions

### Evidence-Based Coaching
- **Scientific Sources**: Prioritizes .gov, .edu, and PubMed sources
- **Citations**: Every answer includes source URLs
- **Reasoning**: Explains the "why" behind recommendations
- **Calculations**: Shows TDEE, calorie targets, BMI with your data

### Technical Features
- **Streaming Responses**: Real-time token streaming for instant feedback
- **Conversation Memory**: Last 30 turns for contextual follow-ups
- **Application Metrics**: `/metrics` endpoint with latency, request counts, error rates
- **Deep Health Checks**: `/health` verifies LLM API and database status
- **Security Hardened**: Rate limiting, CORS lockdown, security headers, input validation
- **100% Free**: No paid APIs required (uses free LLM models)
- **Memory Efficient**: Runs on Render's 512MB free tier
- **Dark/Light Theme**: Modern chat UI with export and history
- **Responsive Design**: Desktop and mobile ready

## 🛠 Tech Stack

### Backend
- **Python 3.11+**
- **FastAPI**: Modern, fast web framework for building APIs
- **SQLite**: Lightweight database for user profiles and progress tracking
- **OpenRouter API**: Access to free LLM models (default: openai/gpt-oss-20b:free)
- **DuckDuckGo Search**: Scientific web search integration
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

### 4. Start the Application

No data ingestion needed! The app uses web search and LLM knowledge directly.

## ⚙️ Configuration

Create a `.env` file in the `backend/` directory with the following variables:

### Required Variables

```bash
OPENROUTER_API_KEY=your_openrouter_api_key_here
```

### Optional Variables

```bash
# LLM Configuration
LLM_MODEL=openai/gpt-oss-20b:free  # Free model

# Server Configuration
HOST=0.0.0.0
PORT=8000

# CORS Configuration (comma-separated)
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

# Rate Limiting
RATE_LIMIT_PER_MINUTE=30

# Web Search (scientific sources)
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
  "session_id": "uuid-here",
  "conversation_history": [
    {"role": "user", "content": "Previous question"},
    {"role": "ai", "content": "Previous answer"}
  ]
}
```

**Response:** Streaming text/plain with personalized answer, reasoning, and scientific sources

### POST `/profile`
Create or update user profile

**Request Body:**
```json
{
  "session_id": "uuid-here",
  "profile": {
    "age": 30,
    "gender": "female",
    "height_cm": 165,
    "current_weight_kg": 70,
    "target_weight_kg": 60,
    "dietary_restrictions": ["vegetarian"],
    "activity_level": "moderate",
    "goal_type": "weight_loss"
  }
}
```

### GET `/profile/{session_id}`
Retrieve user profile

### POST `/profile/{session_id}/weight`
Log weight entry for progress tracking

**Request Body:**
```json
{
  "weight_kg": 68.5
}
```

### GET `/profile/{session_id}/progress`
Get progress data (weight history, BMI, progress percentage)

## 🔧 Development

### Changing the LLM Model

Edit the `.env` file:

```bash
LLM_MODEL=google/gemma-2-9b-it:free
```

Available free models: [OpenRouter Models](https://openrouter.ai/models?order=pricing-low-to-high&max_output_price=0)

**Note:** Free models change frequently. The app has fallback logic to try multiple models.

### Adjusting Web Search Behavior

```bash
# Disable web search
ENABLE_WEB_SEARCH=false

# Increase web search results (more scientific sources)
WEB_SEARCH_MAX_RESULTS=10
```

### Database Management

User profiles are stored in `profiles.db` (SQLite). To reset:

```bash
rm profiles.db
# Database will be recreated on next startup
```

## 🐛 Troubleshooting

### Backend won't start

- Ensure Python 3.8+ is installed: `python --version`
- Check all dependencies are installed: `pip list`
- Verify `.env` file exists and contains valid API key

### Free LLM model not working

- Check [OpenRouter](https://openrouter.ai/models?order=pricing-low-to-high&max_output_price=0) for currently available free models
- Update `LLM_MODEL` in `.env` to a working free model
- The app will automatically try fallback models

### CORS errors

- Update `ALLOWED_ORIGINS` in `.env` to include your frontend URL
- For development: `http://localhost:3000`

### Rate limit errors

- Increase `RATE_LIMIT_PER_MINUTE` in `.env`
- Wait before making additional requests

### Slow responses

- Use a faster LLM model
- Check internet connection for web search
- Reduce `WEB_SEARCH_MAX_RESULTS` for faster searches

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
  "version": "4.0.0",
  "mode": "no-RAG (web search + LLM knowledge)",
  "checks": {
    "database": "ok",
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

## 🏗 Architecture

```
User Query → Frontend → API
                    ↓
              Load User Profile (SQLite)
                    ↓
              Scientific Web Search (.gov, .edu, PubMed)
                    ↓
              Context Building (profile + sources + conversation history)
                    ↓
              LLM (Free OpenRouter model) → Streaming Response
                    ↓
              Frontend Display (real-time token rendering + citations)
```

## 🎯 What Makes This Different?

Unlike generic health chatbots:

1. **Personalization**: Remembers your weight, goals, restrictions across sessions
2. **Evidence-Based**: Prioritizes scientific sources (.gov, .edu, PubMed)
3. **Transparency**: Shows calculations (TDEE, BMI) and cites sources
4. **Progress Tracking**: Weight history with visual charts
5. **100% Free**: No paid APIs, runs on free tier infrastructure
6. **Memory Efficient**: Optimized for 512MB RAM (no heavy ML models)
