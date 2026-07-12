#!/bin/sh
set -e

# Run ingestion to build vector store on startup
python -c "from ingestion import main; main()"

# Start the server
exec python -m uvicorn main:app --host 0.0.0.0 --port $PORT
