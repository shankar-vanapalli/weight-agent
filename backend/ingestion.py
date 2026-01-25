from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings
from langchain_community.vectorstores import Chroma
from langchain_community.embeddings import HuggingFaceEmbeddings
from datasets import load_dataset
from langchain_core.documents import Document
from dotenv import load_dotenv
import shutil
import os

# Load environment variables
load_dotenv()

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
        # Count documents by source to verify distribution
        counts = {}
        for d in all_docs:
            src = d.metadata.get("source", "Unknown")
            counts[src] = counts.get(src, 0) + 1
        
        print("\n--- Document Distribution ---")
        for src, count in counts.items():
            print(f"  {src}: {count} documents")
        
        chunks = split_documents(all_docs)
        store_in_chroma(chunks)
    else:
        print("No documents to ingest!")


def ingest_huggingface_datasets():
    """Load diet/nutrition datasets from HuggingFace."""
    
    all_docs = []
    
    print("\nLoading HuggingFace datasets...")
    
    # 1. Dietary Recommendation System (Limiting to 100 samples)
    try:
        print("Loading: issai/LLM_for_Dietary_Recommendation_System")
        dataset = load_dataset("issai/LLM_for_Dietary_Recommendation_System", split="train", streaming=True).take(100)
        for row in dataset:
            content = f"Condition: {row.get('health_conditions', 'N/A')} | Activity: {row.get('activity_level', 'N/A')} | Plan: {row.get('recommendation', row.get('diet_plan', 'N/A'))}"
            doc = Document(page_content=content, metadata={"source": "HF: Dietary Recommendations"})
            all_docs.append(doc)
    except Exception as e:
        print(f"  Error loading dietary dataset: {e}")
    
    # 2. Food nutritional values (Limiting to 200 samples)
    try:
        print("Loading: HC-85/food-nutritional-values")
        dataset = load_dataset("HC-85/food-nutritional-values", 'hidden_vector_states', split="train", streaming=True).take(200)
        for row in dataset:
            content = f"Food: {row.get('food', row.get('name', 'Unknown'))} (Cals: {row.get('calories', 'N/A')}, Protein: {row.get('protein', 'N/A')}g, Carbs: {row.get('carbohydrates', 'N/A')}g)"
            doc = Document(page_content=content, metadata={"source": "HF: Nutritional Values"})
            all_docs.append(doc)
    except Exception as e:
        print(f"  Error loading food dataset: {e}")
    
    return all_docs


def ingest_docs():
    """Load all PDF files from the data folder."""
    data_folder = os.path.join(os.path.dirname(os.getcwd()), "data")
    all_docs = []
    
    if not os.path.exists(data_folder):
        print(f"Folder not found: {data_folder}")
        return None

    print(f"Searching for PDFs in: {os.path.abspath(data_folder)}")
    for file in os.listdir(data_folder):
        if file.endswith(".pdf"):
            file_path = os.path.join(data_folder, file)
            print(f"Loading: {file}")
            loader = PyPDFLoader(file_path)
            docs = loader.load()
            all_docs.extend(docs)
    
    print(f"Loaded {len(all_docs)} PDF documents.")
    return all_docs


def split_documents(docs):
    """Split documents into smaller chunks."""
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200,
        length_function=len
    )
    chunks = text_splitter.split_documents(docs)
    print(f"Split into {len(chunks)} chunks.")
    return chunks


def store_in_chroma(chunks, reset=True):
    """Generate embeddings and store in ChromaDB.
    
    Args:
        chunks: Document chunks to store
        reset: If True, deletes existing database before storing (prevents duplicates)
    """
    
    persist_directory = os.path.join(os.getcwd(), "chroma_db")
    
    # Clear existing database to prevent duplicates
    if reset and os.path.exists(persist_directory):
        print(f"Clearing existing database at: {persist_directory}")
        shutil.rmtree(persist_directory)
    
    # Initialize embeddings
    embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

    print(f"embeddings:", embeddings)
    
    vectorstore = Chroma.from_documents(
        documents=chunks,
        embedding=embeddings,
        persist_directory=persist_directory
    )
    
    print(f"Vector Store: ", vectorstore)
    print(f"Created vector store with {len(chunks)} chunks at: {persist_directory}")
    return vectorstore


def get_retriever(k=5):
    """Load existing ChromaDB and return a retriever."""
    persist_directory = os.path.join(os.getcwd(), "chroma_db")
    
    if not os.path.exists(persist_directory):
        print(f"Vector store not found at: {persist_directory}")
        print("Please run ingestion first.")
        return None
    
    # Use same embedding model
    embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
    
    # Load existing vector store
    vectorstore = Chroma(
        persist_directory=persist_directory,
        embedding_function=embeddings
    )
    
    # Create retriever
    retriever = vectorstore.as_retriever(
        search_type="mmr",
        search_kwargs={
            "k": k,
            "fetch_k": 20,
            "lambda_mult": 0.5  
        })
    print(f"Retriever loaded with k={k}")
    return retriever


def search(query, k=5):
    """Search the vector store for relevant documents."""
    retriever = get_retriever(k)
    if retriever:
        print(f"retriever ", retriever)
        results = retriever.invoke(query)
        print(f"\nFound {len(results)} results for: '{query}'\n")
        for i, doc in enumerate(results, 1):
            print(f"--- Result {i} ---")
            print(f"Source: {doc.metadata.get('source', 'Unknown')}")
            print(f"Content: {doc.page_content[:500]}...")
            print()
        return results
    return []


def ask(query, k=5):
    """RAG: Retrieve relevant docs and generate answer using LLM."""
    from openai import OpenAI
    
    # Get relevant documents
    retriever = get_retriever(k)
    if not retriever:
        return None, "Vector store not found. Please run ingestion first.", []
    
    docs = retriever.invoke(query)
    
    # Build context from retrieved documents
    context = "\n\n---\n\n".join([doc.page_content for doc in docs])
    
    # Initialize OpenRouter client (uses OpenAI-compatible API)
    client = OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=os.getenv("OPENROUTER_API_KEY")
    )
    
    # Create prompt
    prompt = f"""You are a helpful fitness and nutrition coach. Answer the question based ONLY on the provided context. 
If the context doesn't contain relevant information, say "I don't have enough information to answer that."

Context:
{context}

Question: {query}

Answer clearly and provide actionable advice where appropriate."""

    # Call LLM
    response = client.chat.completions.create(
        model="google/gemini-2.0-flash-001",  # Free model on OpenRouter
        messages=[
            {"role": "user", "content": prompt}
        ]
    )
    
    answer = response.choices[0].message.content
    sources = list(set([doc.metadata.get('source', 'Unknown') for doc in docs]))
    
    return docs, answer, sources


# Run ingestion when this file is executed directly
if __name__ == "__main__":
    print("Running ingestion...")
    main()
    print("\nIngestion complete! You can now run the API with: python main.py")
