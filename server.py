import asyncio
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from langchain_ollama import ChatOllama, OllamaEmbeddings
from langchain_core.prompts import PromptTemplate, ChatPromptTemplate, MessagesPlaceholder
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document
from langchain_core.vectorstores import InMemoryVectorStore
from langchain_core.messages import HumanMessage, AIMessage
from langchain_core.output_parsers import StrOutputParser

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

class ChatRequest(BaseModel):
    session_id: str
    message: str

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

@app.post("/analyze")
async def analyze_content(req: AnalyzeRequest):
    try:
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
