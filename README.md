# CareerPilot — AI Job Application Agent

> Turn "I want role X" into an evidence-backed plan: what the market asks for, what you've actually proven, the shortest path to close the gap, and a tracker that keeps you moving.

**Status:** planning complete, implementation not started (2026-10-30).

## Why this matters
- 41–48% of job seekers say **tailoring a resume per job** is the hardest part.
- 77% fear an **ATS filter** silently rejects them, and 60% say not knowing whether a human ever saw their resume is the worst part.
- 67% have run into **ghost jobs**.
- Existing tools either *write* (and invent experience) or *list* jobs. Few of them **reason over evidence**.

CareerPilot's wedge: **evidence-linked skill matching**. Every "you have X" points to a resume line, and every "you lack X" points to the JD sentences asking for it. The tool never fabricates.

## The plan
| Doc | What's inside |
|---|---|
| [01-research](docs/01-research.md) | User pain points (with sources), competitors, **legal job data sources** (incl. India), skill taxonomies, tech facts |
| [02-product-spec](docs/02-product-spec.md) | Principles, personas, golden path, P0/P1/P2 features, **evidence tiers**, worked CV-internship example, success metrics |
| [03-architecture](docs/03-architecture.md) | Stack, LangGraph agent graph, scoring formulas, Postgres schema, API, repo layout |
| [04-roadmap](docs/04-roadmap.md) | 5 phases with demoable milestones, risks, "definition of solid" |
| [05-evaluation](docs/05-evaluation.md) | Gold dataset, per-agent metrics and targets, grounding check |

## Agents
| Agent | Job |
|---|---|
| Job Research | Fetch JDs from permitted APIs (Greenhouse/Lever/Ashby/Adzuna) and pasted JDs; dedupe; extract requirements; flag ghost jobs |
| Resume | Parse resume → evidence items with tiers; user confirms (human-in-the-loop) |
| Matching | Deterministic, evidence-linked scoring per requirement and across the market |
| Coach | Weekly prep plan, practice questions, mock interviews, grounded resume tailoring |
| Tracker/Report | Applications, follow-ups, weekly progress report |

## Stack
FastAPI · LangGraph 1.0 (PostgresSaver) · Claude · PostgreSQL 16 + pgvector · bge-small embeddings · Next.js (later)

## Next step
Start **Phase 0 → Phase 1** in [04-roadmap](docs/04-roadmap.md). Phase 1's gate: the match report must be accurate on the labeled eval set before any agents get built.
