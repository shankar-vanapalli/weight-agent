# Deployment Guide

## Architecture Options

### Option A — Single host on Render (simplest, free)
Deploy everything as one Docker container. The FastAPI backend serves the frontend as static files at `/`. One URL, no CORS, no config needed.

### Option B — Split hosts (more scalable)
| Part | Technology | Host |
|------|-----------|------|
| **Backend** (FastAPI + RAG) | Docker | Railway or Render |
| **Frontend** (HTML/CSS/JS) | Static files | Netlify, Vercel, or GitHub Pages |

---

## Option A — Render (free, single host) ✅ Recommended

### Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

> ⚠️ `.gitignore` already excludes `backend/.env` — your API key is never committed.

### Step 2 — Create a Render Web Service

1. Go to [render.com](https://render.com) → **New** → **Web Service**
2. Connect your GitHub repo
3. Render auto-detects Docker — confirm:
   - **Dockerfile path:** `./Dockerfile`
   - **Port:** `8000`

### Step 3 — Set environment variables in Render

In your service → **Environment** tab, add:

| Variable | Value |
|----------|-------|
| `OPENROUTER_API_KEY` | `sk-or-v1-...` ← your key |
| `ENV` | `production` |
| `WORKERS` | `1` |
| `LOG_LEVEL` | `WARNING` |
| `ALLOWED_ORIGINS` | `*` |
| `RATE_LIMIT_PER_MINUTE` | `30` |
| `ENABLE_WEB_SEARCH` | `true` |
| `LLM_MODEL` | `google/gemini-2.5-flash` |

### Step 4 — Deploy

Click **Deploy**. Once done, your app is live at:
```
https://your-service-name.onrender.com
```
Both the UI (`/`) and API (`/ask`, `/health`) are on the same URL. No CORS, no `config.js` changes needed.

> ⚠️ **Free tier caveat:** Render's free plan spins down after 15 min of inactivity. First request after sleep takes ~30s. For always-on, use the **Starter plan ($7/mo)** or Railway (which has a more generous free tier).

---

## Option B — Split hosts (advanced)

For CDN-cached frontend or independent scaling:

1. Deploy backend to Railway or Render (similar to Option A)
2. Set `BACKEND_URL` in `frontend/config.js` to the backend URL
3. Deploy frontend to Netlify, Vercel, or GitHub Pages
4. Update `ALLOWED_ORIGINS` on the backend to include the frontend domain

---

## Local Development

No changes needed locally. The frontend auto-detects `localhost:8000` when `BACKEND_URL` is empty in `config.js`.

```bash
# Terminal 1 — Backend
cd backend
source venv/bin/activate
python main.py

# Terminal 2 — Frontend (optional, or just open index.html)
cd frontend
python3 -m http.server 3000
```

---

## What to NOT commit

The `.gitignore` already excludes:
- `backend/.env` — **your API key** — never commit this
- `backend/venv/` — Python virtual environment
- `backend/chroma_db/` is **included** by default so the vector store is baked into Docker

If you want to rebuild the vector store on every deploy (slower but ensures fresh data), uncomment the `chroma_db` line in `.gitignore` and add a startup script that calls `ingest()` before starting uvicorn.

---

## Optimisations vs. typical RAG agents

This app already has several production-ready improvements over a basic RAG setup:

| Feature | Typical agent | This app |
|---------|--------------|----------|
| **LLM** | GPT-4 (expensive) | Gemini 2.5 Flash via OpenRouter (fast + cheap) |
| **Memory** | Single session, 6 turns | Per-session localStorage, 30 turns |
| **Web search** | None | DuckDuckGo augmentation on every query |
| **Streaming** | Full response wait | Token-by-token streaming |
| **Rate limiting** | None | SlowAPI per-IP limiting |
| **Session isolation** | None | Full multi-session support with sidebar |
| **Guardrail** | None | Domain-restricted (health only) |
| **Frontend hosting** | Same server | CDN via Netlify (global edge) |
| **Vector store** | Rebuilt on deploy | Baked into Docker image (instant startup) |
