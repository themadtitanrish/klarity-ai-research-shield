Klarity

A research validation tool built with a multi-agent AI pipeline. Give it any research topic, from any field, science, history, arts, whatever, and it finds sources, checks how credible each one actually is, and gives you a summary you can trust instead of digging through search results yourself.

How it works
Four AI agents work through the topic in sequence:
1. Classifies which academic field the topic belongs to
2. Searches the web and finds relevant sources
3. Scores each source's credibility, using standards that fit the field (peer review matters for science, primary sources matter for history)
4. Synthesizes everything into one summary, using only the sources that scored well

Project structure
This repo has two parts:
- Root folder: the frontend, built with React and Vite
- backend/ folder: a FastAPI server running the CrewAI multi-agent pipeline, using Groq for inference and Tavily for web search

Deployment
The frontend is deployed via Lovable. The backend is deployed separately on Render, and the frontend calls it over a simple POST request.

The frontend was built with AI-assisted tooling (Lovable) for speed, then customized and connected to the backend I built myself. The backend, the CrewAI multi-agent pipeline, FastAPI server, and prompt design, is hand-written.

Running it locally
Frontend:
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev

Backend (needs Python and uv):
cd backend
uv sync
uv run uvicorn api_server:app --reload

Still a work in progress. Next up is better source coverage and cleaning up how results are displayed.
