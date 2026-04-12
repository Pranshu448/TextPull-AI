import asyncio
import json
import ssl
import urllib.error
import urllib.request
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from langchain_ollama import ChatOllama, OllamaEmbeddings
from langchain_core.prompts import PromptTemplate, ChatPromptTemplate, MessagesPlaceholder
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document
from langchain_core.vectorstores import InMemoryVectorStore
from langchain_core.messages import HumanMessage, AIMessage
from langchain_core.output_parsers import StrOutputParser
import certifi

app = FastAPI(title="TextPull AI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class AnalyzeRequest(BaseModel):
    session_id: str
    content: str
    mode: str = "tldr"
    instruction: str = ""
    provider: Optional[str] = None
    api_key: Optional[str] = None

class ChatRequest(BaseModel):
    session_id: str
    message: str
    provider: Optional[str] = None
    api_key: Optional[str] = None

# IMPROVED: Lower temperature for more factual responses
llm = ChatOllama(model="qwen2.5-coder:3b", temperature=0.0)
embeddings = OllamaEmbeddings(model="qwen2.5-coder:3b")

sessions = {}

# --- IMPROVED MAP PROMPT ---
# More explicit instructions to prevent hallucination
map_template = """You are a factual information extractor. Your ONLY job is to extract verbatim facts from the text below.

STRICT RULES:
1. Extract ONLY information that is explicitly stated in the text
2. Quote key numbers, dates, names, and statistics exactly as written
3. Do NOT add interpretation, context, or external knowledge
4. Do NOT make assumptions or inferences
5. If a chunk has no valuable information, return "No significant facts found."
6. Use bullet points with direct quotes or paraphrases

Text chunk:
{text}

Extracted Facts (bullet points):"""

map_prompt = PromptTemplate.from_template(map_template)
map_chain = map_prompt | llm | StrOutputParser()

# --- IMPROVED REDUCE PROMPT ---
# Stronger guardrails with explicit output format guidance
reduce_template_base = """You are synthesizing information from a webpage analysis.

ABSOLUTE RULES - VIOLATION WILL RESULT IN FAILURE:
1. Use ONLY the facts listed below - they were extracted from the actual webpage
2. NEVER add information from your training data or general knowledge
3. If information is missing or unclear, state "Not mentioned in the source"
4. Do NOT make logical leaps or assumptions
5. Be precise and concise
6. Cite specific facts when possible

EXTRACTED FACTS FROM WEBPAGE:
{text}

YOUR TASK:
{instruction}

OUTPUT FORMAT:
- Use clear headings with ### if needed
- Use bullet points for lists
- Keep responses grounded in the extracted facts above
- If facts are insufficient, acknowledge the limitation

Your Response:"""

fallback_template = """You are analyzing webpage content directly.

STRICT RULES:
1. Use ONLY the webpage text below
2. Do NOT add outside knowledge or assumptions
3. If details are missing, say they are not clearly stated in the page
4. Keep the response concise and factual

WEBPAGE TEXT:
{text}

TASK:
{instruction}

Your Response:"""

fallback_prompt = PromptTemplate.from_template(fallback_template)
fallback_chain = fallback_prompt | llm | StrOutputParser()

GEMINI_MODEL = "gemini-2.5-flash"
SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())


def build_context_snippets(content: str, query: str, max_chunks: int = 5):
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=1800,
        chunk_overlap=200,
        separators=["\n\n", "\n", ". ", " ", ""]
    )
    chunks = splitter.split_text(content)

    if not query.strip():
        return chunks[:max_chunks]

    query_terms = {term for term in query.lower().split() if len(term) > 2}

    def score(chunk: str):
        chunk_lower = chunk.lower()
        return sum(1 for term in query_terms if term in chunk_lower)

    ranked = sorted(chunks, key=score, reverse=True)
    useful = [chunk for chunk in ranked if score(chunk) > 0]
    return (useful or chunks)[:max_chunks]


def extract_gemini_text(data):
    candidates = data.get("candidates", [])
    parts = []

    for candidate in candidates:
        content = candidate.get("content", {})
        for part in content.get("parts", []):
            text = part.get("text")
            if text:
                parts.append(text)

    return "\n".join(parts).strip()


def call_gemini(api_key: str, user_parts, system_instruction: str):
    body = {
        "system_instruction": {
            "parts": [{"text": system_instruction}]
        },
        "contents": user_parts
    }

    request = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(request, timeout=60, context=SSL_CONTEXT) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise ValueError(f"Gemini request failed: {details}") from error
    except urllib.error.URLError as error:
        raise ValueError(f"Gemini connection failed: {error.reason}") from error

    text = extract_gemini_text(data)
    if not text:
      raise ValueError("Gemini returned an empty response.")

    return text


def analyze_with_gemini(req: AnalyzeRequest):
    system_instruction = """You summarize webpage content with strict grounding.

Rules:
1. Use only the webpage text provided by the user
2. Do not add external facts or assumptions
3. If information is unclear, say it is not clearly stated
4. Keep the response concise, accurate, and directly useful
"""

    user_parts = [{
        "role": "user",
        "parts": [{
            "text": f"Task:\n{req.instruction}\n\nWebpage content:\n{req.content[:50000]}"
        }]
    }]

    result = call_gemini(req.api_key, user_parts, system_instruction)

    sessions[req.session_id] = {
        "provider": "gemini",
        "memory": [],
        "original_content": req.content
    }

    return {"result": result}


def chat_with_gemini(req: ChatRequest, session):
    context_chunks = build_context_snippets(session["original_content"], req.message)
    context = "\n\n---\n\n".join(context_chunks)

    history = session.get("memory", [])
    conversation_parts = []

    for item in history:
        conversation_parts.append({
            "role": item["role"],
            "parts": [{"text": item["text"]}]
        })

    conversation_parts.append({
        "role": "user",
        "parts": [{
            "text": f"Page context:\n{context}\n\nQuestion: {req.message}"
        }]
    })

    system_instruction = """You answer questions about a webpage.

Rules:
1. Answer only from the supplied page context
2. If the answer is not present, say: "I cannot find this information on the page."
3. Do not use outside knowledge
4. Be direct and concise
"""

    response = call_gemini(req.api_key, conversation_parts, system_instruction)

    history.append({"role": "user", "text": req.message})
    history.append({"role": "model", "text": response})
    session["memory"] = history[-8:]

    return {"result": response}

@app.post("/analyze")
async def analyze_content(req: AnalyzeRequest):
    try:
        if req.provider == "gemini":
            if not req.api_key:
                return {"error": "Gemini API key is required."}
            return analyze_with_gemini(req)

        # IMPROVED: Better chunking for context preservation
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=3000, 
            chunk_overlap=500,
            separators=["\n\n", "\n", ". ", " ", ""]
        )
        texts = text_splitter.split_text(req.content)
        docs = [Document(page_content=t) for t in texts]
        vectorstore = InMemoryVectorStore.from_documents(docs, embeddings)
        
        # 1. Map: Extract facts from all chunks concurrently
        map_tasks = [map_chain.ainvoke({"text": t}) for t in texts]
        chunk_summaries = await asyncio.gather(*map_tasks)
        
        # Filter out empty results
        chunk_summaries = [s for s in chunk_summaries if s and s.strip() and "No significant facts" not in s]
        
        if not chunk_summaries:
            fallback_source = req.content[:12000]
            fallback_result = await fallback_chain.ainvoke({
                "text": fallback_source,
                "instruction": req.instruction
            })
            sessions[req.session_id] = {
                "vectorstore": vectorstore,
                "memory": [],
                "original_findings": fallback_source
            }
            return {"result": fallback_result}
        
        # Combine all chunk summaries
        combined_findings = "\n\n".join(chunk_summaries)
        
        # 2. Reduce: Generate final report with strict grounding
        dynamic_prompt = PromptTemplate.from_template(reduce_template_base)
        dynamic_chain = dynamic_prompt | llm | StrOutputParser()
        final_report = await dynamic_chain.ainvoke({
            "text": combined_findings, 
            "instruction": req.instruction
        })
        
        sessions[req.session_id] = {
            "vectorstore": vectorstore,
            "memory": [],
            "original_findings": combined_findings  # Store for reference
        }
        
        return {"result": final_report}
    except Exception as e:
        return {"error": str(e)}

@app.post("/chat")
async def chat_with_document(req: ChatRequest):
    if req.session_id not in sessions:
        raise HTTPException(status_code=400, detail="Initialize a session by analyzing the page first.")
        
    session = sessions[req.session_id]

    if session.get("provider") == "gemini":
        if not req.api_key:
            raise HTTPException(status_code=400, detail="Gemini API key is required for premium chat.")
        return chat_with_gemini(req, session)

    vectorstore = session["vectorstore"]
    memory = session["memory"]
    
    # IMPROVED: Retrieve more context for better answers
    retriever = vectorstore.as_retriever(search_kwargs={"k": 5})
    relevant_docs = await retriever.ainvoke(req.message)
    context = "\n\n---\n\n".join([doc.page_content for doc in relevant_docs])
    
    # IMPROVED: More explicit chat prompt with stronger grounding
    chat_prompt = ChatPromptTemplate.from_messages([
        ("system", """You are analyzing a specific webpage. Your answers must be 100% grounded in the context below.

STRICT RULES:
1. Answer ONLY from the provided context
2. If the context doesn't contain the answer, respond: "I cannot find this information on the page."
3. Do NOT use external knowledge or make assumptions
4. Quote relevant parts when helpful
5. Be concise and direct

CONTEXT FROM WEBPAGE:
{context}
"""),
        MessagesPlaceholder(variable_name="history"),
        ("human", "{question}")
    ])
    
    chat_chain = chat_prompt | llm | StrOutputParser()
    
    response = await chat_chain.ainvoke({
        "context": context,
        "history": memory,
        "question": req.message
    })
    
    # Manage conversation memory
    memory.append(HumanMessage(content=req.message))
    memory.append(AIMessage(content=response))
    if len(memory) > 8:  # Keep last 4 exchanges
        memory = memory[-8:]
    session["memory"] = memory
        
    return {"result": response}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
