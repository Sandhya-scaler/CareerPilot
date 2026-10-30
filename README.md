# CareerPilot

> Turn "I want role X" into an evidence-backed plan: what employers ask for, what you've actually proven, the shortest path between the two, and a tracker that keeps you moving.

CareerPilot reads current job descriptions for a role and checks every requirement against what your resume actually shows. Each match links a JD sentence to a resume line. The gaps become a weekly plan that fits your hours. **It never invents experience.** Tailored resumes only reorder by default. Any AI rewording has to pass a grounding check: no new skills, numbers or claims.

## What it does
- **Market map:** reads 10–50 current postings for your role (public company job-board APIs, or JDs you paste from anywhere) and shows what's asked for, how often, and how often it's a must-have.
- **Evidence-linked matching:** every requirement sits next to your strongest proof, graded on a 4-step *proof ladder*: claimed → applied → demonstrated → verified.
- **Weekly plan:** gaps ranked by demand × gap × learnability and scheduled into your hours. Finishing a build task with proof (a link or a result) adds evidence and raises your readiness.
- **Practice:** questions from your gaps, from real JD sentences and from your own projects, each with a rubric. Mock interviews (typed or spoken) ask follow-ups on weak answers and add practice tasks to your plan.
- **Applications:** a kanban tracker with follow-up reminders and drafts, plus a ghost-job flag for postings that vanished from the company board or look stale.
- **Resume versions:** tailored per job, with a line diff, a "why each change" log and print-to-PDF.
- **GitHub import:** languages GitHub measures in your public repos count as verified evidence.
- **Weekly report:** what you did, new evidence, readiness change, what's next, optionally emailed every Monday.

Everything works **for free without any API key** (rules, a curated question bank, keyword grading). For an AI layer, use a **free Gemini key** or a **local Ollama model** through `LLM_BASE_URL`, or Claude via `ANTHROPIC_API_KEY`. See [06 operations](docs/06-operations.md#free-ai-layer-optional). Every AI output passes the same no-fabrication checks.

## Quick start
```bash
brew install postgresql@17 pgvector && brew services start postgresql@17
createdb careerpilot && createdb careerpilot_test
cp .env.example .env            # set SESSION_SECRET (openssl rand -hex 32)
npm install
npm run seed
npm run dev:api                 # :4000
npm run dev:web                 # :3000 → create an account → "Prepare for a role"
```
Or with Docker: `SESSION_SECRET=$(openssl rand -hex 32) docker compose up --build` → http://localhost:3000.
Free hosting: Render + Neon via the included `render.yaml` ([steps](docs/06-operations.md#deploying-for-free-render--neon-blueprint-included)).

No database handy? Try the offline CLI: `npm run cli -w apps/api -- match path/to/resume.pdf path/to/jd.txt`.

## Quality
| Check | Result |
|---|---|
| JD requirement extraction (8 hand-labeled JDs, rules only) | precision 96.5%, recall 100%, must/nice 96.3% |
| Resume evidence (4 hand-labeled resumes, rules only) | precision 98.8%, recall 100%, tier exact 97.5% |
| API tests | 97 passing: extraction, scoring, grounding, HITL pipeline, interviews, isolation between users, LLM guards with a mocked model that fabricates, email over real SMTP, multi-instance claims |
| End to end | `npm run e2e` drives the golden path in Chrome as a new user; passes against the dev servers, `docker compose`, and with Gemini's free tier powering every AI step (26 s) |

These are small, synthetic eval sets. Grow them with real (consented) resumes before trusting the numbers broadly.

## Docs
| | |
|---|---|
| [01 research](docs/01-research.md) | User pain points, competitors, legal job data sources (incl. India), taxonomies |
| [02 product spec](docs/02-product-spec.md) | Principles, personas, features, evidence tiers, worked example |
| [03 architecture](docs/03-architecture.md) | Stack, agents → code, scoring, data model, API |
| [04 roadmap & status](docs/04-roadmap.md) | What's done, what's partial, what's next |
| [05 evaluation](docs/05-evaluation.md) | Metrics, targets, grounding check |
| [06 operations](docs/06-operations.md) | Setup, config, Docker, deploy, costs |

## Stack
Express 5 · Next.js 16 · Tailwind 4 · LangGraph.js (Postgres checkpoints, human-in-the-loop interrupts) · Claude (Opus for reasoning, Haiku for extraction) · PostgreSQL 17 + pgvector · local bge-small embeddings · Vitest · Playwright-core
