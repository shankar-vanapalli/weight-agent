import os
import warnings
import sys

os.environ["TOKENIZERS_PARALLELISM"] = "false"
# Ensure HuggingFace caches write to /tmp on Render (where /home/appuser is read-only)
if not os.access(os.path.expanduser("~"), os.W_OK):
    os.environ.setdefault("HF_HOME", "/tmp/hf_cache")
    os.environ.setdefault("HF_DATASETS_CACHE", "/tmp/hf_cache/datasets")
    os.environ.setdefault("TRANSFORMERS_CACHE", "/tmp/hf_cache/transformers")
    os.environ.setdefault("XDG_CACHE_HOME", "/tmp/.cache")

from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import Chroma
from langchain_community.embeddings import HuggingFaceInferenceAPIEmbeddings
from datasets import load_dataset
from langchain_core.documents import Document
from dotenv import load_dotenv
from duckduckgo_search import DDGS
from openai import OpenAI
import logging
import shutil
import time

# Load environment variables
load_dotenv()

logger = logging.getLogger(__name__)

# ────────────────────────────────────────────────────────────────
# SINGLETON: Embeddings model + vector store (loaded once at startup)
# ────────────────────────────────────────────────────────────────
_embeddings_model = None
_vectorstore = None
_openrouter_client = None


def get_embeddings():
    """Return a cached HuggingFace Inference API embeddings client (singleton, free tier)."""
    global _embeddings_model
    if _embeddings_model is None:
        logger.info("Initialising embeddings via HuggingFace Inference API...")
        _embeddings_model = HuggingFaceInferenceAPIEmbeddings(
            api_key=os.getenv("HF_TOKEN"),
            model_name="sentence-transformers/all-MiniLM-L6-v2"
        )
        logger.info("Embeddings client ready.")
    return _embeddings_model


def get_vectorstore():
    """Return a cached ChromaDB vector store (singleton)."""
    global _vectorstore
    persist_directory = os.getenv("CHROMA_PERSIST_DIR", os.path.join(os.getcwd(), "chroma_db"))
    if _vectorstore is None and os.path.exists(persist_directory):
        logger.info("Loading vector store (first call)...")
        _vectorstore = Chroma(
            persist_directory=persist_directory,
            embedding_function=get_embeddings()
        )
        logger.info("Vector store cached.")
    return _vectorstore


def get_llm_client():
    """Return a cached OpenRouter client (singleton)."""
    global _openrouter_client
    if _openrouter_client is None:
        _openrouter_client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=os.getenv("OPENROUTER_API_KEY")
        )
    return _openrouter_client


def reset_vectorstore_cache():
    """Clear the cached vector store (call after re-ingestion)."""
    global _vectorstore
    _vectorstore = None

def main(include_huggingface=True):
    """Run the full ingestion pipeline."""
    all_docs = []
    
    # Load PDFs
    pdf_docs = ingest_docs()
    if pdf_docs:
        all_docs.extend(pdf_docs)
    
    # Load HuggingFace datasets
    if include_huggingface:
        hf_docs = ingest_huggingface_datasets()
        if hf_docs:
            all_docs.extend(hf_docs)
    
    if all_docs:
        counts = {}
        for d in all_docs:
            src = d.metadata.get("source", "Unknown")
            counts[src] = counts.get(src, 0) + 1
        
        logger.info("--- Document Distribution ---")
        for src, count in counts.items():
            logger.info(f"  {src}: {count} documents")
        
        chunks = split_documents(all_docs)
        store_in_chroma(chunks)
        reset_vectorstore_cache()
    else:
        logger.warning("No documents to ingest!")


def ingest_huggingface_datasets():
    """Load diet/nutrition datasets from HuggingFace."""
    
    all_docs = []
    
    logger.info("Loading HuggingFace datasets...")
    
    # 1. Dietary Recommendation System (Limiting to 100 samples)
    try:
        logger.info("Loading: issai/LLM_for_Dietary_Recommendation_System")
        dataset = load_dataset("issai/LLM_for_Dietary_Recommendation_System", split="train", streaming=True).take(100)
        for row in dataset:
            content = f"Condition: {row.get('health_conditions', 'N/A')} | Activity: {row.get('activity_level', 'N/A')} | Plan: {row.get('recommendation', row.get('diet_plan', 'N/A'))}"
            doc = Document(page_content=content, metadata={"source": "HF: Dietary Recommendations"})
            all_docs.append(doc)
    except Exception as e:
        logger.error(f"Error loading dietary dataset: {e}")
    
    # 2. Food nutritional values (Limiting to 200 samples)
    try:
        logger.info("Loading: HC-85/food-nutritional-values")
        dataset = load_dataset("HC-85/food-nutritional-values", 'hidden_vector_states', split="train", streaming=True).take(200)
        for row in dataset:
            content = f"Food: {row.get('food', row.get('name', 'Unknown'))} (Cals: {row.get('calories', 'N/A')}, Protein: {row.get('protein', 'N/A')}g, Carbs: {row.get('carbohydrates', 'N/A')}g)"
            doc = Document(page_content=content, metadata={"source": "HF: Nutritional Values"})
            all_docs.append(doc)
    except Exception as e:
        logger.error(f"Error loading food dataset: {e}")
    
    return all_docs


def ingest_docs():
    """Load all PDF files from the data folder."""
    data_folder = os.path.join(os.path.dirname(os.getcwd()), "data")
    all_docs = []
    
    if not os.path.exists(data_folder):
        logger.warning(f"Folder not found: {data_folder}")
        return None

    logger.info(f"Searching for PDFs in: {os.path.abspath(data_folder)}")
    for file in os.listdir(data_folder):
        if file.endswith(".pdf"):
            file_path = os.path.join(data_folder, file)
            logger.info(f"Loading: {file}")
            try:
                loader = PyPDFLoader(file_path)
                docs = loader.load()
                all_docs.extend(docs)
            except Exception as e:
                logger.error(f"Error loading {file}: {e}")
    
    logger.info(f"Loaded {len(all_docs)} PDF documents.")
    return all_docs


def split_documents(docs):
    """Split documents into smaller chunks."""
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200,
        length_function=len
    )
    chunks = text_splitter.split_documents(docs)
    logger.info(f"Split into {len(chunks)} chunks.")
    return chunks


def store_in_chroma(chunks, reset=True):
    """Generate embeddings and store in ChromaDB.
    
    Args:
        chunks: Document chunks to store
        reset: If True, deletes existing database before storing (prevents duplicates)
    """
    # Use configurable persist directory, default to /tmp for production (writable on Render.com)
    persist_directory = os.getenv("CHROMA_PERSIST_DIR", os.path.join(os.getcwd(), "chroma_db"))
    
    # Ensure directory exists and is writable
    os.makedirs(persist_directory, exist_ok=True)
    
    if reset and os.path.exists(persist_directory):
        logger.info(f"Clearing existing database at: {persist_directory}")
        shutil.rmtree(persist_directory)
    
    embeddings = get_embeddings()

    vectorstore = Chroma.from_documents(
        documents=chunks,
        embedding=embeddings,
        persist_directory=persist_directory
    )
    logger.info(f"Created vector store with {len(chunks)} chunks at: {persist_directory}")
    return vectorstore


def get_retriever(k=5):
    """Return a retriever from the cached vector store."""
    vs = get_vectorstore()
    if vs is None:
        logger.warning("Vector store not available. Run ingestion first.")
        return None
    
    retriever = vs.as_retriever(
        search_type="mmr",
        search_kwargs={"k": k, "fetch_k": 20, "lambda_mult": 0.5}
    )
    return retriever


def search(query, k=5):
    """Search the vector store for relevant documents."""
    retriever = get_retriever(k)
    if retriever:
        results = retriever.invoke(query)
        logger.info("Found %d results for: '%s'", len(results), query[:80])
        return results
    return []


def check_vectorstore_health():
    """Return True if the vector store is loaded and queryable."""
    try:
        vs = get_vectorstore()
        if vs is None:
            return False
        # Quick probe
        vs._collection.count()
        return True
    except Exception:
        return False


def check_llm_health():
    """Return True if the OpenRouter API key is configured."""
    return bool(os.getenv("OPENROUTER_API_KEY"))


def web_search(query, max_results=5):
    """Perform health-focused web search using DuckDuckGo."""
    # Prepend health context to keep results on-topic
    health_query = f"weight loss nutrition fitness health: {query}"
    start = time.time()
    try:
        ddgs = DDGS()
        results = list(ddgs.text(health_query, max_results=max_results))
        
        web_docs = []
        for result in results:
            content = f"{result.get('body', '')}\nSource: {result.get('href', 'Unknown')}"
            doc = Document(
                page_content=content,
                metadata={
                    "source": f"Web: {result.get('title', 'Unknown')}",
                    "url": result.get('href', 'Unknown')
                }
            )
            web_docs.append(doc)
        
        elapsed = time.time() - start
        logger.info(f"Web search returned {len(web_docs)} results in {elapsed:.2f}s")
        return web_docs
    except Exception as e:
        logger.error(f"Web search error: {e}")
        return []


# ────────────────────────────────────────────────────────────────
# SYSTEM PROMPT – domain-specific, keeps the AI focused
# ────────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are Kanya Raasi, a friendly and warm health coach who genuinely cares about the people you talk to. You specialise in weight loss, nutrition, and fitness for adults.

Your personality:
- Talk like a knowledgeable friend, not a textbook. Use natural, conversational language.
- Be warm, encouraging, and direct. Avoid bullet-point lecture style unless the user asks for a list.
- Show genuine interest — ask 1-2 follow-up questions to understand the person better before or after giving advice. For example, if someone asks about calories, ask about their current weight, goal, or activity level if they haven't mentioned it.
- Personalise every response. If the user mentions their age, weight, lifestyle, or goal, reference it back.
- Keep it real — acknowledge that healthy habits are hard, celebrate small wins, and don't be preachy.
- Use a mix of short sentences and paragraphs — not walls of text or endless bullet points.
- It's okay to use phrases like "honestly", "the thing is", "here's what I'd suggest" to sound human.

What you help with:
- Weight loss strategy, calorie and macro guidance, meal ideas
- Workout routines and fitness habits
- Understanding health reports and lab values in plain language
- Staying motivated and building sustainable habits

Principles:
- Personalize every recommendation.
- Explain reasoning.
- Prefer scientifically supported recommendations.
- Avoid fads and unsupported supplements.
- Encourage sustainable habits.
- Adapt advice based on user progress.
- Use retrieved medical knowledge before answering.
- If evidence is conflicting, explain both viewpoints.
- Never fabricate information.


Rules:
- Use the CONTEXT below (documents + web results) to ground your answers, but weave the info naturally into conversation — don't cite it robotically.
- Always answer the question. If context is thin, draw on nutrition science and mention it's general guidance.
- Never diagnose conditions or prescribe medication. Recommend a doctor for medical concerns.
- Prefer metric units; add imperial in brackets when helpful.
- End responses with a relevant follow-up question OR a next-step suggestion — keep the conversation going.

CONVERSATION MEMORY:
- You have access to previous messages in this conversation. Always reference what the user told you earlier.
- If the user mentioned their weight, age, goals, preferences, or any personal details in previous turns, incorporate that into your response.
- Maintain continuity — don't act like you're meeting the user for the first time each time.
- If the user asks something that conflicts with what they said earlier, gently acknowledge the change or ask for clarification.

GUARDRAIL — STAY ON TOPIC:
- Your ONLY domain is health, weight loss, nutrition, fitness, and related wellness topics.
- If the user asks about anything outside this domain (e.g. coding, finance, politics, entertainment, general knowledge, relationship advice, travel, etc.), do NOT answer it. Instead, warmly redirect them. Example: "That's a bit outside my lane! I'm your health and fitness coach — happy to help with anything around weight loss, nutrition, or exercise. What would you like to work on?"
- If a message is ambiguous, assume a health-related interpretation first.
- Never break character or pretend to be a general-purpose AI."""


def ask_with_stream(query, k=5, conversation_history=None):
    """RAG: Retrieve docs + web search, stream LLM answer.
    
    Yields (str chunks).  Caller should wrap in StreamingResponse.
    """
    if conversation_history is None:
        conversation_history = []
    
    start = time.time()
    
    # ── 1. Retrieve from vector store ──
    retriever = get_retriever(k)
    docs = []
    sources = []
    web_search_used = False
    
    if retriever:
        docs = retriever.invoke(query)
        sources = list({doc.metadata.get('source', 'Unknown') for doc in docs})
    
    retrieval_ms = (time.time() - start) * 1000
    
    # ── 2. Web search — always augment local docs with live results ──
    enable_web = os.getenv("ENABLE_WEB_SEARCH", "true").lower() == "true"
    if enable_web:
        logger.info("Augmenting %d local docs with web search", len(docs))
        web_docs = web_search(
            query,
            max_results=int(os.getenv("WEB_SEARCH_MAX_RESULTS", "5"))
        )
        if web_docs:
            docs.extend(web_docs)
            web_search_used = True
            sources.extend(doc.metadata.get('source', 'Unknown') for doc in web_docs)
    
    # ── 3. Build prompt ──
    context = "\n\n---\n\n".join(doc.page_content for doc in docs)

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    # Inject recent conversation for continuity (last 30 turns for better memory)
    for msg in (conversation_history or [])[-30:]:
        role = "user" if msg.get('role') == 'user' else "assistant"
        messages.append({"role": role, "content": msg.get('content', '')})

    user_content = f"""CONTEXT (retrieved documents & web results):
{context}

USER QUESTION:
{query}"""
    messages.append({"role": "user", "content": user_content})

    # ── 4. Stream from LLM ──
    model = os.getenv("LLM_MODEL", "google/gemini-2.5-flash")
    client = get_llm_client()

    try:
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            stream=True,
            temperature=0.4,
            max_tokens=2048,  # Increased for longer, more detailed responses
            max_completion_tokens=2048,  # Utilize the 1M context window
        )
        
        token_count = 0
        for chunk in response:
            delta = chunk.choices[0].delta
            if delta and delta.content:
                token_count += 1
                yield delta.content
        
        total_ms = (time.time() - start) * 1000

        if token_count == 0:
            logger.warning("LLM returned 0 tokens for query: %s", query[:80])
            yield "I'm sorry, I couldn't generate a response. Please try rephrasing your question."
        
        # Yield metadata footer — prettify file paths to just filenames
        def pretty_source(s):
            if not s or s == 'Unknown':
                return None
            if s.startswith('http'):
                return s  # keep web URLs as-is
            return os.path.basename(s)  # strip absolute path

        unique_sources = list(dict.fromkeys(
            ps for s in sources if (ps := pretty_source(s))
        ))
        yield f"\n\n---\nSources: {', '.join(unique_sources) if unique_sources else 'General knowledge'}"
        if web_search_used:
            yield "\n(Web search was used for additional context)"
        
        # Log performance metrics
        logger.info(
            "ask_complete | retrieval=%.0fms total=%.0fms tokens=%d docs=%d web=%s",
            retrieval_ms, total_ms, token_count, len(docs), web_search_used
        )
            
    except Exception as e:
        logger.exception("LLM streaming error")
        yield f"Error generating response: {str(e)}"


# Run ingestion when this file is executed directly
if __name__ == "__main__":
    logger.info("Running ingestion...")
    main()
    logger.info("Ingestion complete! You can now run the API with: python main.py")
