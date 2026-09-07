"""
Klarity API Server
"""


import logging
import math
import re
import time
from threading import Lock

import crewai.llms.cache as _crewai_cache
_crewai_cache.mark_cache_breakpoint = lambda msg: msg

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, HttpUrl, ValidationError
from dotenv import load_dotenv
from crewai import Agent, Task, Crew, Process, LLM
from crewai_tools import TavilySearchTool
from litellm.exceptions import RateLimitError

load_dotenv()

logger = logging.getLogger("klarity")
research_lock = Lock()


class ScoredSource(BaseModel):
    title: str = Field(min_length=1)
    url: HttpUrl
    score: int = Field(strict=True, ge=1, le=10, description="Actual numeric credibility rating from 1 to 10, never a placeholder")
    description: str = Field(min_length=1, description="Reason for this source's credibility rating")


class ResearchReport(BaseModel):
    summary: str = Field(min_length=1)
    sources: list[ScoredSource] = Field(description="Sources actually evaluated; empty if none could be verified")


def retry_delay(error: RateLimitError, attempt: int) -> float:
    """Honor Groq's cooldown, including when LiteLLM only preserves its message."""
    response = getattr(error, "response", None)
    headers = getattr(response, "headers", {}) or {}
    try:
        seconds = float(headers.get("retry-after", ""))
        if math.isfinite(seconds) and seconds >= 0:
            return seconds + 1
    except (TypeError, ValueError):
        pass

    match = re.search(r"try again in\s+((?:\d+(?:\.\d+)?\s*[hms]\s*)+)", str(error), re.I)
    if match:
        units = {"h": 3600, "m": 60, "s": 1}
        seconds = sum(float(value) * units[unit.lower()] for value, unit in
                      re.findall(r"(\d+(?:\.\d+)?)\s*([hms])", match[1], re.I))
        return seconds + 1
    return min(10 * (2 ** attempt), 60)


class RetryingGroqLLM(LLM):
    def call(self, *args, **kwargs):
        # Retry this LLM call, preserving completed agents and search results.
        # Long (e.g. daily) cooldowns must fail promptly, not occupy a worker.
        waited = 0.0
        for attempt in range(4):
            try:
                return super().call(*args, **kwargs)
            except RateLimitError as error:
                delay = retry_delay(error, attempt)
                if attempt == 3 or waited + delay > 90:
                    raise
                logger.warning("Groq rate limit; retrying AI call in %.1fs (%d/3)", delay, attempt + 1)
                time.sleep(delay)
                waited += delay

# ---------- Set up the research crew ----------


groq_llm = RetryingGroqLLM(
    model="groq/openai/gpt-oss-20b",
    max_tokens=1800,
    reasoning_effort="low",
    num_retries=0,  # Retries above respect the provider's cooldown.
    timeout=45,
)
search_tool = TavilySearchTool(max_results=5, max_content_length_per_result=700)

def build_crew():
    classifier = Agent(
        role="Topic Classifier",
        goal="Identify which academic or research field a given topic belongs to",
        backstory="An experienced research librarian skilled at identifying which domain a topic falls under.",
        llm=groq_llm,
        max_retry_limit=0,
    )

    finder = Agent(
        role="Research Source Finder",
        goal="Search the web and find relevant, high-quality sources on a given research topic",
        backstory="A skilled research assistant who finds the most relevant and reliable sources across all disciplines.",
        llm=groq_llm,
        tools=[search_tool],
        max_iter=6,
        max_retry_limit=0,
    )

    credibility_checker = Agent(
        role="Source Credibility Checker",
        goal="Evaluate the credibility of each source and assign a score with reasoning",
        backstory="A meticulous fact-checker who rigorously evaluates whether a source can be trusted.",
        llm=groq_llm,
        max_retry_limit=0,
    )

    synthesizer = Agent(
        role="Research Synthesizer",
        goal="Combine findings from credible sources into a clear summary",
        backstory="A science communicator who turns multi-source research into clear, accurate summaries.",
        llm=groq_llm,
        max_retry_limit=0,
    )

    classify_task = Task(
        description="Determine which academic field this topic belongs to: {topic}",
        expected_output="The field name with a one-sentence justification",
        agent=classifier
    )

    find_task = Task(
        description=("Find 5 credible sources related to this topic: {topic}. "
                     "Start with one focused search and only search again if needed. "
                     "Use only real sources returned by the search tool; never invent sources or URLs."),
        expected_output="Up to 5 sources with title, URL, and a one-sentence summary each. Explain if fewer were found. Keep the total under 450 words.",
        agent=finder,
        context=[classify_task]
    )

    credibility_task = Task(
        description="Score each source found for credibility (1-10) with reasoning, using field-appropriate standards.",
        expected_output="Each source's title, URL, credibility score, and one sentence of reasoning. Keep the total under 450 words.",
        agent=credibility_checker,
        context=[classify_task, find_task]
    )

    synthesize_task = Task(
        description=(
            "Return a JSON research report. The summary must be a 6-8 sentence synthesis using only "
            "sources rated 6 or above, noting agreements and contradictions. "
            "In sources, include each evaluated source's title, exact URL, numeric integer score "
            "from 1 to 10, and a short description explaining that rating. "
            "Copy the credibility checker's actual ratings; do not invent new scores. "
            "The score field must contain a number such as 8, never 'Score/10', '8/10', or a placeholder. "
            "Do not repeat the sources list inside summary. If no credible evidence was found, "
            "say so explicitly rather than inventing sources or claims."
        ),
        expected_output=(
            "A JSON object with summary and sources. Each source has title, url, score (an integer 1-10), "
            "and description (the reasoning for its rating)."
        ),
        agent=synthesizer,
        output_pydantic=ResearchReport,
        context=[classify_task, find_task, credibility_task]
    )


    return Crew(
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
    topic: str = Field(min_length=2, max_length=300)


# This creates an endpoint at /validate that accepts POST requests.
# When called, it runs our crew and returns the result as JSON.
@app.post("/validate")
def validate_topic(request: TopicRequest):
    # A single free-tier worker must not run competing crews against the same
    # token quota or share mutable agent/task state across concurrent requests.
    if not research_lock.acquire(blocking=False):
        raise HTTPException(429, "Research is busy. Please try again shortly.", headers={"Retry-After": "20"})
    try:
        result = build_crew().kickoff(inputs={"topic": request.topic})
        try:
            report = result.pydantic
            if not isinstance(report, ResearchReport):
                report = ResearchReport.model_validate_json(result.raw)
        except (ValidationError, ValueError, TypeError) as error:
            raise HTTPException(502, "The research report contained invalid credibility scores. Please try again.") from error
        return {"result": report.model_dump_json()}
    except RateLimitError as error:
        logger.warning("Groq cooldown exceeds the research retry budget")
        raise HTTPException(
            429,
            "The AI provider's usage limit was reached. Please try again later.",
            headers={"Retry-After": str(math.ceil(retry_delay(error, 0)))},
        ) from error
    finally:
        research_lock.release()


# A simple health check endpoint, useful for testing the server is alive.
@app.get("/")
def health_check():
    return {"status": "Klarity API is running"}

import uvicorn

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000) 
