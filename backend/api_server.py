"""
Klarity API Server
"""


import crewai.llms.cache as _crewai_cache
_crewai_cache.mark_cache_breakpoint = lambda msg: msg

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from crewai import Agent, Task, Crew, Process, LLM
from crewai_tools import TavilySearchTool

load_dotenv()

# ---------- Set up the crew (same as before) ----------



groq_llm = LLM(model="groq/llama-3.1-8b-instant")
search_tool = TavilySearchTool()

classifier = Agent(
    role="Topic Classifier",
    goal="Identify which academic or research field a given topic belongs to",
    backstory="An experienced research librarian skilled at identifying which domain a topic falls under.",
    llm=groq_llm
    
)

finder = Agent(
    role="Research Source Finder",
    goal="Search the web and find relevant, high-quality sources on a given research topic",
    backstory="A skilled research assistant who finds the most relevant and reliable sources across all disciplines.",
    llm=groq_llm,
    tools=[search_tool]
)

credibility_checker = Agent(
    role="Source Credibility Checker",
    goal="Evaluate the credibility of each source and assign a score with reasoning",
    backstory="A meticulous fact-checker who rigorously evaluates whether a source can be trusted.",
    llm=groq_llm
)

synthesizer = Agent(
    role="Research Synthesizer",
    goal="Combine findings from credible sources into a clear summary",
    backstory="A science communicator who turns multi-source research into clear, accurate summaries.",
    llm=groq_llm
)

classify_task = Task(
    description="Determine which academic field this topic belongs to: {topic}",
    expected_output="The field name with a one-sentence justification",
    agent=classifier
)

find_task = Task(
    description="Find at least 5 credible sources related to this topic: {topic}",
    expected_output="A list of at least 5 sources with title, URL, and short summary",
    agent=finder,
    context=[classify_task]
)

credibility_task = Task(
    description="Score each source found for credibility (1-10) with reasoning, using field-appropriate standards.",
    expected_output="Each source with a credibility score and explanation",
    agent=credibility_checker,
    context=[classify_task, find_task]
)

synthesize_task = Task(
    description=(
        "Using only sources scoring 6+, write a summary in EXACTLY this structure every time:\n"
        "1. A synthesis paragraph (6-8 sentences, thorough and detailed) covering what is known about the topic, "
        "including any agreements or contradictions between sources.\n"
        "2. A blank line, then a heading 'Sources and Credibility Scores:'\n"
        "3. A numbered list of every source used, each on its own line, in this exact format: "
        "'Title - Score/10 - plain URL' (no markdown brackets, no parentheses around the URL).\n"
        "Do not repeat this list. Do not omit the sources list even for niche topics."
    ),
    expected_output=(
        "A thorough synthesis paragraph, followed by a 'Sources and Credibility Scores:' heading "
        "and a numbered list of sources with title, score, and plain-text URL — in that exact structure, every time"
    ),
    agent=synthesizer,
    context=[classify_task, find_task, credibility_task]
)


crew = Crew(
    agents=[classifier, finder, credibility_checker, synthesizer],
    tasks=[classify_task, find_task, credibility_task, synthesize_task],
    process=Process.sequential
)


# ---------- Set up the web server ----------

app = FastAPI()

# This allows our Lovable frontend (running on a different domain)
# to actually call this server - without it, browsers block the request
# for security reasons (this is called CORS).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# This defines what data we expect to receive - just a "topic" string.
class TopicRequest(BaseModel):
    topic: str


# This creates an endpoint at /validate that accepts POST requests.
# When called, it runs our crew and returns the result as JSON.
@app.post("/validate")
def validate_topic(request: TopicRequest):
    result = crew.kickoff(inputs={"topic": request.topic})
    return {"result": str(result)}


# A simple health check endpoint, useful for testing the server is alive.
@app.get("/")
def health_check():
    return {"status": "Klarity API is running"}

import uvicorn

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000) 
