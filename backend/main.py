from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from ingestion import get_retriever, ask
import os

app = FastAPI(
    title="Kanya Raasi - Weight Loss AI Agent",
    description="RAG-based API for weight loss and nutrition advice",
    version="1.0.0"
)

# Enable CORS for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Change this in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class QueryRequest(BaseModel):
    query: str
    k: int = 5  # Number of documents to retrieve


class QueryResponse(BaseModel):
    question: str
    answer: str
    sources: list[str]


class SearchResponse(BaseModel):
    query: str
    results: list[dict]


@app.get("/")
def root():
    return {
        "message": "Welcome to Kanya Raasi - Weight Loss AI Agent",
        "endpoints": {
            "/ask": "POST - Ask a question and get AI-generated answer",
            "/search": "POST - Search for relevant documents",
            "/health": "GET - Health check"
        }
    }


@app.get("/health")
def health_check():
    return {"status": "healthy"}


@app.post("/ask", response_model=QueryResponse)
def ask_question(request: QueryRequest):
    """Ask a question and get an AI-generated answer based on the documents."""
    try:
        # Use the ask function from ingestion.py
        docs, answer, sources = ask(request.query, request.k)
        
        if docs is None:
            raise HTTPException(status_code=500, detail=answer)
        
        return QueryResponse(
            question=request.query,
            answer=answer,
            sources=sources
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/search", response_model=SearchResponse)
def search_documents(request: QueryRequest):
    """Search for relevant documents without generating an AI answer."""
    try:
        retriever = get_retriever(request.k)
        if not retriever:
            raise HTTPException(status_code=500, detail="Vector store not found.")
        
        docs = retriever.invoke(request.query)
        
        results = [
            {
                "content": doc.page_content,
                "source": doc.metadata.get('source', 'Unknown'),
                "page": doc.metadata.get('page', 'Unknown')
            }
            for doc in docs
        ]
        
        return SearchResponse(query=request.query, results=results)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
