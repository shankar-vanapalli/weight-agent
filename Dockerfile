FROM python:3.11-slim

# Create a non-root user for security
RUN groupadd -r appuser && useradd -r -g appuser appuser

WORKDIR /app

# System deps for ChromaDB, sentence-transformers, and PDF processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps first (layer cache)
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY backend/ ./backend/

# Copy pre-built vector store (generated locally by running ingest)
# This avoids re-ingesting on every deploy
COPY backend/chroma_db/ ./backend/chroma_db/

# Copy PDF data (needed if re-ingestion is triggered at runtime)
COPY data/ ./data/

# Copy frontend (served as static files by FastAPI at /app)
COPY frontend/ ./frontend/

# Set correct ownership
RUN chown -R appuser:appuser /app

WORKDIR /app/backend

USER appuser

ENV PYTHONUNBUFFERED=1
ENV ENV=production

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
