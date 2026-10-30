# 03 — Architecture (as built)

> Updated 2026-10-30 after implementation. The original plan used FastAPI. The stack is now **Express + Next.js** (TypeScript end to end), and the design is otherwise unchanged.

## Stack
| Layer | Choice | Notes |
|---|---|---|
| API | **Express 5** + TypeScript (run with `tsx`), zod validation | `apps/api` |
| Web | **Next.js 16** (App Router) + **Tailwind 4** | `apps/web`; proxies `/api` and `/auth` to the API so the session cookie is first-party |
| Orchestration | **LangGraph.js 1.x** + `PostgresSaver` | Two graphs: *prepare* pipeline and *mock interview* loop. Interrupts for human-in-the-loop |
| LLM | Claude via `@anthropic-ai/sdk` structured outputs | Reasoning: `claude-opus-5-5`. Bulk extraction: `claude-haiku-5-5` (env-configurable). Server-side refusal fallback on, prompt caching on system prompts |
| DB | **PostgreSQL 17 + pgvector 0.8** | Relational data, vectors (HNSW), LangGraph checkpoints |
| Embeddings | `Xenova/bge-small-en-v1.5` via transformers.js (local, 384-d) | `EMBEDDINGS=off` falls back to lexical similarity |
| Parsing | `unpdf` (PDF), `mammoth` (DOCX) | |
| Jobs | Greenhouse, Lever, Ashby public board APIs; Adzuna (optional key); Arbeitnow | 6h cache, 10-min negative cache, 4 concurrent requests max |
| Scheduling | Hourly tick on every instance; each job claimed atomically in `job_runs` | Daily liveness and ghost check, Monday weekly reports and emails, taxonomy seeding on boot |
| Email | nodemailer over any SMTP provider | Opt-in weekly report |
| Tests | Vitest + Supertest against a real test DB; Playwright-core e2e smoke | 88 API tests, including an eval gate, LLM-guard tests and a real SMTP server |

## Design principle: rules first, Claude second, guards always
Every LLM feature has a deterministic path that works with **no API key**:

| Feature | Without Claude | With Claude | Guard on Claude output |
|---|---|---|---|
| JD requirements | Section-aware rules + taxonomy | ∪ Haiku extraction | Skill must map to the taxonomy, sentence must be verbatim in the JD |
| Resume evidence | Section/bullet rules, tiers from outcomes/links | + Haiku skill tagging | Only verbatim lines; only taxonomy skills |
| Plan | Template per gap, budgeted scheduler | Opus plan | Only gap skills; re-scheduled by our budget scheduler |
| Questions | Curated bank + JD-grounded + project probes | Opus questions | JD/project questions must quote real sentences |
| Tailoring | Reorder only (grounded by construction) | + Opus rewording | `checkGrounding`: no new skills, numbers or claims; rejected rewrites are shown |
| Grading | Rubric keyword coverage (labeled as such) | Opus rubric grading | Covered/missed must be rubric points |

## Agents → code
```
Supervisor (fixed pipeline)   src/graph/pipeline.ts      research → ensure_resume ⏸ → confirm_evidence ⏸ → analyze → coach
Job Research Agent            src/services/research.ts   sources/connectors.ts, sources/relevance.ts, sources/boards.ts
Resume Agent                  src/extract/resume.ts      + services/evidence.ts (HITL confirm, tier ceilings), services/github.ts
Matching Agent                src/scoring.ts             pure functions; services/match.ts, services/market.ts
Coach Agent                   src/coach/*                plan.ts, questions.ts, grade.ts; graph/interview.ts (ask ⏸ → grade → follow-up → finish)
Tracker/Report Agent          services/applications.ts, services/reports.ts, services/ghost.ts, scheduler.ts
```

## Scoring (implemented in `src/scoring.ts`)
```
importance(r)     = 1.0 must | 0.5 nice           (soft skills shown, never scored)
evidence(s)       = max of:
                      direct     tier weight (0, .3, .6, .85, 1.0)
                      implied    0.9 × weight of a more specific skill (OpenCV ⇒ Computer Vision)
                      adjacent   0.5 × weight of a related skill (TensorFlow ~ PyTorch)
coverage(JD)      = Σ importance·evidence / Σ importance
market_weight(s)  = freq(s) × (0.5 + 0.5·must_rate(s))
gap_priority(s)   = market_weight × (1 − evidence) × learnability (days 1.0, weeks 0.8, months 0.6)
readiness         = Σ market_weight·evidence / Σ market_weight
```
"A, B or C" in a JD marks those skills as alternatives, so none of them is individually a must-have.

## Data model
Migrations live in `apps/api/migrations/001…007`:
- **001 core:** users, skills/aliases/unknown_skills, resumes/resume_versions/evidence_items/evidence_skills, jobs/user_jobs/job_requirements, match_reports/match_items
- **002:** match details (must coverage, via, evidence snapshot)
- **003 agents:** market_maps/market_skills, plans/plan_tasks, questions, runs/run_events
- **004 product:** applications/application_events
- **005:** extractor version, so cached requirements refresh when the extractor improves
- **006 insights:** interview_sessions/attempts, weekly_reports, users.github_username, jobs.delisted_at
- **007 ops:** llm_usage
- **008 launch:** email opt-in, feedback, rate_limits (shared counters), job_runs (scheduler claims), admin flag

LangGraph checkpoint tables are created by `PostgresSaver.setup()`.

## API surface
```
/auth     POST register, login, logout · GET/PATCH/DELETE me · GET me/export, me/usage
/api      resumes (POST multipart|text, GET) · resume-versions/:id (GET, POST confirm, POST tailor, GET diff)
          jobs (GET, POST ingest, POST search, GET :id, POST :id/save, DELETE :id, GET :id/versions, POST check-liveness)
          match (POST) · match-reports/:id
          careers/prepare (POST → runId) · runs, runs/:id, runs/:id/events (SSE), runs/:id/resume
          market-maps (GET, latest, :id, POST :id/plan) · plans/active, plans/:id · plan-tasks/:id (PATCH)
          questions · interviews (POST, GET, :id, :id/answer) · reports, reports/weekly
          applications (CRUD) · github/import, github/evidence · reports/weekly/email, reports/email-status
          feedback (POST) · admin/metrics (admins only)
```

## Repo layout
```
careerpilot/
├── docs/                    plan + this architecture
├── apps/api/
│   ├── migrations/          SQL, applied on boot
│   ├── src/{extract,skills,sources,coach,tailor,graph,services,routes}/
│   ├── src/{scoring,llm,embeddings,auth,ratelimit,scheduler,cli}.ts
│   ├── evals/               labeled resumes/JDs + runner
│   └── test/                vitest suites
├── apps/web/src/{app,components,lib}/   + e2e/smoke.mjs
├── docker-compose.yml, apps/*/Dockerfile
└── .github/workflows/ci.yml
```

## Cross-cutting
- **Privacy:** resumes stay in Postgres only. JSON export and cascading delete are available. Resume text is never logged. Job sources receive only role and location.
- **Cost:** every Claude call is logged to `llm_usage` with its USD cost and attributed to the user via AsyncLocalStorage (`/auth/me/usage`). JD extraction is cached by content hash and extractor version.
- **Safety rails:** rate limits on auth and expensive endpoints, the app refuses to boot in production with a weak `SESSION_SECRET`, and users are isolated on every query (tested).
- **Scaling:** rate-limit counters and scheduler claims live in Postgres, so any number of API instances can run. Agent runs execute in the instance that started them; after a restart, an instance resumes `running` runs from their checkpoints.
