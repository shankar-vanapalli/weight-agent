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

# Copy startup script
COPY backend/start.sh ./backend/

# Copy PDF data for ingestion on startup
COPY data/ ./data/

# Copy frontend (served as static files by FastAPI at /app)
COPY frontend/ ./frontend/

# Set correct ownership
RUN chown -R appuser:appuser /app

WORKDIR /app/backend

# Make startup script executable
RUN chmod +x start.sh

USER appuser

ENV PYTHONUNBUFFERED=1
ENV ENV=production

EXPOSE 8000

CMD ["./start.sh"]
