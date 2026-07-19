#!/bin/sh
set -e

# Start the server (no ingestion needed - using web search + LLM knowledge)
exec python -m uvicorn main:app --host 0.0.0.0 --port $PORT
