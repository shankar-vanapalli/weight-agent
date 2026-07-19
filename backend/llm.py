import os
import logging
import time
from typing import Optional, Dict, Any
from duckduckgo_search import DDGS
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# ────────────────────────────────────────────────────────────────
# SINGLETON: OpenRouter client
# ────────────────────────────────────────────────────────────────
_openrouter_client = None


def get_llm_client():
    """Return a cached OpenRouter client (singleton)."""
    global _openrouter_client
    if _openrouter_client is None:
        _openrouter_client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=os.getenv("OPENROUTER_API_KEY")
        )
    return _openrouter_client


def check_llm_health():
    """Return True if the OpenRouter API key is configured."""
    return bool(os.getenv("OPENROUTER_API_KEY"))


# ────────────────────────────────────────────────────────────────
# WEB SEARCH - Enhanced for scientific sources
# ────────────────────────────────────────────────────────────────
def web_search_scientific(query, max_results=5):
    """Enhanced web search prioritizing scientific sources."""
    start = time.time()
    
    # Try scientific sources first
    scientific_query = f'site:.gov OR site:.edu OR site:pubmed.ncbi.nlm.nih.gov {query}'
    
    try:
        ddgs = DDGS()
        results = list(ddgs.text(scientific_query, max_results=max_results))
        
        # If no scientific results, fall back to general health search
        if not results:
            logger.info("No scientific sources found, trying general health search")
            health_query = f"health nutrition fitness: {query}"
            results = list(ddgs.text(health_query, max_results=max_results))
        
        # Format results with prominent source attribution
        web_docs = []
        for result in results:
            title = result.get('title', 'Unknown')
            url = result.get('href', 'Unknown')
            body = result.get('body', '')
            
            # Determine if it's a scientific source
            is_scientific = any(domain in url for domain in ['.gov', '.edu', 'pubmed', 'nih.gov', 'who.int'])
            source_type = "Scientific Source" if is_scientific else "Web Source"
            
            content = f"""**{source_type}:** {title}
**URL:** {url}

{body}"""
            
            web_docs.append({
                'content': content,
                'source': title,
                'url': url,
                'is_scientific': is_scientific
            })
        
        elapsed = time.time() - start
        logger.info(f"Web search returned {len(web_docs)} results in {elapsed:.2f}s")
        return web_docs
    except Exception as e:
        logger.error(f"Web search error: {e}")
        return []


# ────────────────────────────────────────────────────────────────
# SYSTEM PROMPT – Evidence-based, personalized health coaching
# ────────────────────────────────────────────────────────────────
SYSTEM_PROMPT_TEMPLATE = """You are Kanya Raasi, an evidence-based health coach who provides personalized, scientifically-grounded advice on weight loss, nutrition, and fitness.

{profile_section}

Your personality:
- Talk like a knowledgeable friend, not a textbook. Use natural, conversational language.
- Be warm, encouraging, and direct. Avoid bullet-point lecture style unless the user asks for a list.
- Show genuine interest and reference the user's profile data in every response.
- Keep it real — acknowledge that healthy habits are hard, celebrate small wins, and don't be preachy.
- Use a mix of short sentences and paragraphs — not walls of text or endless bullet points.

What you help with:
- Weight loss strategy, calorie and macro guidance, meal ideas
- Workout routines and fitness habits
- Understanding health reports and lab values in plain language
- Staying motivated and building sustainable habits

CRITICAL RULES - Evidence-Based Approach:
1. **Always cite sources** when making scientific claims
2. **Explain the reasoning** behind recommendations (the "why")
3. **Acknowledge uncertainty** when evidence is limited
4. **Prioritize peer-reviewed research** over anecdotal advice
5. **Use the user's profile data** to personalize every response
6. **Show your work** - include calculations when relevant (e.g., TDEE, calorie targets)

Response Format:
1. Direct answer with personalization based on profile
2. **Why this works:** Scientific explanation
3. **Sources:** List sources with URLs from the context
4. **Next steps for you:** Personalized action items

Principles:
- Personalize every recommendation using profile data
- Explain reasoning and mechanisms
- Prefer scientifically supported recommendations
- Avoid fads and unsupported supplements
- Encourage sustainable habits
- Never diagnose conditions or prescribe medication
- Recommend a doctor for medical concerns
- Prefer metric units; add imperial in brackets when helpful

CONVERSATION MEMORY:
- You have access to previous messages in this conversation
- Always reference what the user told you earlier
- Maintain continuity — don't act like you're meeting the user for the first time
- If the user asks something that conflicts with what they said earlier, gently acknowledge the change

GUARDRAIL — STAY ON TOPIC:
- Your ONLY domain is health, weight loss, nutrition, fitness, and related wellness topics
- If the user asks about anything outside this domain, warmly redirect them
- Example: "That's a bit outside my lane! I'm your health and fitness coach — happy to help with anything around weight loss, nutrition, or exercise. What would you like to work on?"
- Never break character or pretend to be a general-purpose AI
"""


def _has_profile_data(profile: Dict[str, Any]) -> bool:
    """Check if a profile has any meaningful user data filled in."""
    data_fields = ['age', 'gender', 'height_cm', 'current_weight_kg',
                   'target_weight_kg', 'activity_level', 'goal_type']
    return any(profile.get(f) for f in data_fields)


def build_system_prompt(user_profile: Optional[Dict[str, Any]] = None,
                        conversation_history: Optional[list] = None) -> str:
    """Build system prompt with optional user profile injection."""
    has_history = bool(conversation_history)
    has_data = user_profile and _has_profile_data(user_profile)

    if has_data:
        profile_section = f"""USER PROFILE (persistent — you remember this user):
- Age: {user_profile.get('age', 'Unknown')}
- Gender: {user_profile.get('gender', 'Unknown')}
- Current Weight: {user_profile.get('current_weight_kg', 'Unknown')} kg
- Target Weight: {user_profile.get('target_weight_kg', 'Unknown')} kg
- Height: {user_profile.get('height_cm', 'Unknown')} cm
- Activity Level: {user_profile.get('activity_level', 'Unknown')}
- Goal: {user_profile.get('goal_type', 'Unknown')}
- Dietary Restrictions: {user_profile.get('dietary_restrictions', 'None')}

Use this data to personalize every answer. Calculate BMI, TDEE, calorie targets when relevant.
If the user shares new info (e.g. a weight change), acknowledge it naturally."""

    elif has_history:
        # No structured profile yet, but we have past conversation.
        # Do NOT re-ask for details — just answer the question naturally.
        profile_section = """USER PROFILE: No structured profile saved yet, but you have previous conversation history below.
Use whatever the user has already told you. Do NOT ask for their details again — just answer their question directly.
If their question would benefit from knowing their weight/height/age, you may ask ONE specific detail, but never a list of questions."""

    else:
        # Brand-new user, no history at all — first message ever.
        profile_section = """USER PROFILE: New user, first conversation.
Answer their question directly first. At the end of your answer you may briefly ask ONE question (e.g. their goal or current weight) to help personalize future advice — but only if it is relevant to what they asked. Never bombard them with a list of questions."""

    return SYSTEM_PROMPT_TEMPLATE.format(profile_section=profile_section)


# ────────────────────────────────────────────────────────────────
# FREE LLM MODEL FALLBACK STRATEGY
# ────────────────────────────────────────────────────────────────
FREE_LLM_MODELS = [
    "openai/gpt-oss-20b:free",
    "google/gemma-2-9b-it:free",
    "meta-llama/llama-3.1-8b-instruct:free",
]


def get_available_free_model():
    """Try to find an available free model, with fallback."""
    # First, try the configured model
    configured_model = os.getenv("LLM_MODEL", FREE_LLM_MODELS[0])
    
    client = get_llm_client()
    
    # Test configured model first
    try:
        logger.info(f"Testing configured model: {configured_model}")
        response = client.chat.completions.create(
            model=configured_model,
            messages=[{"role": "user", "content": "test"}],
            max_tokens=5
        )
        logger.info(f"Using model: {configured_model}")
        return configured_model
    except Exception as e:
        logger.warning(f"Configured model {configured_model} failed: {e}")
    
    # Try fallback models
    for model in FREE_LLM_MODELS:
        if model == configured_model:
            continue  # Already tried
        try:
            logger.info(f"Testing fallback model: {model}")
            response = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": "test"}],
                max_tokens=5
            )
            logger.info(f"Using fallback model: {model}")
            return model
        except Exception as e:
            logger.warning(f"Model {model} failed: {e}")
            continue
    
    # If all free models fail, raise error
    raise Exception("No free LLM models available. Please check OpenRouter for current free models.")


# ────────────────────────────────────────────────────────────────
# MAIN STREAMING FUNCTION - Simplified (no RAG)
# ────────────────────────────────────────────────────────────────
def ask_with_stream(query: str, conversation_history=None, user_profile: Optional[Dict[str, Any]] = None):
    """Stream LLM answer using web search + LLM knowledge (no RAG/embeddings).
    
    Yields (str chunks). Caller should wrap in StreamingResponse.
    """
    if conversation_history is None:
        conversation_history = []
    
    start = time.time()
    
    # ── 1. Web search for scientific sources ──
    enable_web = os.getenv("ENABLE_WEB_SEARCH", "true").lower() == "true"
    web_docs = []
    sources = []
    
    if enable_web:
        logger.info("Performing scientific web search")
        web_docs = web_search_scientific(
            query,
            max_results=int(os.getenv("WEB_SEARCH_MAX_RESULTS", "5"))
        )
        sources = [doc['source'] for doc in web_docs]
    
    # ── 2. Build context from web results ──
    if web_docs:
        context = "\n\n---\n\n".join(doc['content'] for doc in web_docs)
    else:
        context = "No web search results available. Use your built-in health and nutrition knowledge."
    
    # ── 3. Build system prompt with user profile ──
    system_prompt = build_system_prompt(user_profile, conversation_history)
    
    messages = [{"role": "system", "content": system_prompt}]
    
    # Inject recent conversation for continuity (last 30 turns)
    for msg in (conversation_history or [])[-30:]:
        role = "user" if msg.get('role') == 'user' else "assistant"
        messages.append({"role": role, "content": msg.get('content', '')})
    
    # Add current query with context
    user_content = f"""CONTEXT (web search results):
{context}

USER QUESTION:
{query}"""
    messages.append({"role": "user", "content": user_content})
    
    # ── 4. Stream from LLM with fallback ──
    try:
        model = get_available_free_model()
    except Exception as e:
        logger.error(f"No LLM models available: {e}")
        yield f"Error: No LLM models available. {str(e)}"
        return
    
    client = get_llm_client()
    
    try:
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            stream=True,
            temperature=0.4,
            max_tokens=2048,
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
        
        # Yield metadata footer with sources
        if sources:
            unique_sources = list(dict.fromkeys(sources))
            yield f"\n\n---\n**Sources:**\n"
            for i, source in enumerate(unique_sources[:5], 1):  # Limit to top 5
                # Find the URL for this source
                url = next((doc['url'] for doc in web_docs if doc['source'] == source), None)
                if url:
                    yield f"{i}. {source} - {url}\n"
                else:
                    yield f"{i}. {source}\n"
        else:
            yield "\n\n---\n*Based on general health and nutrition knowledge*"
        
        # Log performance metrics
        logger.info(
            "ask_complete | total=%.0fms tokens=%d sources=%d model=%s",
            total_ms, token_count, len(sources), model
        )
            
    except Exception as e:
        logger.exception("LLM streaming error")
        yield f"Error generating response: {str(e)}"
