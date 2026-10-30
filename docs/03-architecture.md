# 03 — Architecture

## Stack
| Layer | Choice | Why |
|---|---|---|
| API | **FastAPI** (Python 3.12, `uv`) | Async, Pydantic schemas shared with agents |
| Orchestration | **LangGraph 1.0** + `PostgresSaver` checkpointer | Durable multi-step runs, `interrupt()` for human-in-the-loop |
| LLM | Claude: Sonnet-class for reasoning, Haiku-class for bulk extraction | Strong structured output via tool use |
| DB | **PostgreSQL 16 + pgvector** | One DB for relational data, vectors, and LangGraph checkpoints |
| Embeddings | `BAAI/bge-small-en-v1.5` (local, 384-d); Voyage optional | Free, offline, good enough for skill/JD retrieval |
| Parsing | `pymupdf` (PDF), `python-docx` (DOCX) | Fast, keeps the layout order of text |
| Jobs | `APScheduler` in-process to start (Celery/Arq later) | Polling job sources, weekly reports |
| Frontend | Next.js + Tailwind + shadcn/ui (Phase 3); Streamlit for early demos | — |
| Infra | Docker Compose (api + postgres) | Neither Docker nor Postgres is installed yet: `brew install --cask docker` or `brew install postgresql@16 pgvector` |

## Agent graph

```
                        ┌──────────────────────┐
   user request ───────▶│  Supervisor (router) │◀──── weekly cron
                        └─────────┬────────────┘
        ┌──────────────┬──────────┼───────────────┬──────────────┐
        ▼              ▼          ▼               ▼              ▼
  Job Research     Resume      Matching         Coach        Tracker/Report
     Agent          Agent        Agent           Agent           Agent
  (fetch, dedupe,  (parse →    (score per      (plan, Qs,     (applications,
   extract reqs,   evidence,   requirement,    mock interview, weekly report,
   ghost-risk)     HITL confirm) market map)   tailoring)      nudges)
        │              │          │               │              │
        └──────────────┴──────────┴───────┬───────┴──────────────┘
                                          ▼
                            PostgreSQL + pgvector
```

**Supervisor pattern, but deterministic where possible.** The "prepare me for role X" flow is a **fixed pipeline** (Research → Resume → Match → Coach), not LLM routing. LLM routing is used only for free-form chat ("why is Docker ranked so low?"). Fixed pipelines are cheaper, testable, and debuggable.

### Graph state (sketch)
```python
class CareerState(TypedDict):
    user_id: str
    target_role: str
    location: str | None
    hours_per_week: int
    resume_version_id: str | None
    job_ids: list[str]
    market_map_id: str | None
    match_report_id: str | None
    plan_id: str | None
    pending_confirmation: dict | None   # payload shown to user during interrupt()
    messages: Annotated[list, add_messages]
```
State holds **IDs, not blobs**. Big data lives in Postgres tables. Checkpoints stay small.

### Agents in detail

**1. Job Research Agent**
- Tools: `search_adzuna(role, country, n)`, `fetch_greenhouse(token)`, `fetch_lever(slug)`, `fetch_ashby(org)`, `ingest_pasted_jd(text|url)`.
- Steps: fetch → normalize → **dedupe** (hash of company+title+location, plus embedding cosine > 0.95) → relevance filter (embed role query vs JD title+summary, keep the top N) → **requirement extraction** (Haiku, JSON schema) → ghost-risk score.
- Requirement schema: `{skill_raw, skill_id, kind: must|nice, years_min?, source_sentence}`. `source_sentence` is mandatory because it powers evidence links.

**2. Resume Agent**
- Parse PDF/DOCX → sections → **evidence items** `{text, section, skills[], tier, metrics[], links[]}`.
- Tier assignment: rule-based first (skills section → T1; bullet with skill → T2; bullet with number/link/deploy → T3), then an LLM check for edge cases.
- **HITL:** `interrupt({"evidence": [...]})`. The user confirms or edits before matching. This is how "verified experience" stays honest.

**3. Matching Agent**: mostly **deterministic math**, with the LLM used only for explanations (see Scoring).

**4. Coach Agent**
- Plan generator: ranked gaps + hours/week + deadline → weekly tasks of type `learn | build | prove | practice`. Every *build* task names the evidence artifact it will produce.
- Question generator: per gap skill, 3 kinds (concept, applied, "your project" probe) + rubric. RAG over JDs so questions mirror real requirements.
- Mock interview: a subgraph looping `ask → user answer (interrupt) → grade vs rubric → follow-up or next`. Weak areas are written back to the plan.
- Resume tailoring: input base version + JD + match report. Output is **edit operations** (reorder, rephrase bullet X, hide Y), not a free-form rewrite. A **grounding check** rejects any edit that introduces a skill/metric absent from the evidence items. New claims trigger `interrupt()` for confirmation.

**5. Tracker/Report Agent**
- CRUD for applications + events. Weekly cron: tasks done, tier changes, application funnel, next week's focus → stored report + optional email.

## Scoring (the evidence-linked match)

For each requirement *r* in a JD (or each skill *s* in the market map):

```
importance(r)  = 1.0 if must-have else 0.5
evidence(s)    = max tier weight over the user's evidence items tagged with s
                 (0, .3, .6, .85, 1.0) — partial credit 0.5× for "adjacent" skills
                 via taxonomy/embedding similarity (e.g. TensorFlow → PyTorch)
coverage(JD)   = Σ importance·evidence / Σ importance          → 0–100%
market_weight(s) = freq(s across JDs) × (0.5 + 0.5·must_rate(s))
gap_priority(s)  = market_weight(s) × (1 − evidence(s)) × learnability(s)
```
- `learnability` is an LLM-estimated effort bucket (days/weeks/months), so quick wins rank higher at equal impact.
- **Every score row stores both links:** `jd_requirement.source_sentence` ↔ `evidence_item.text`. The UI shows them side by side. This is the "evidence-linked" feature.
- No single magic "ATS score". The output is coverage % plus the reasons.

## Data model (Postgres)

```
users(id, email, name, target_role, location, hours_per_week, created_at)

resumes(id, user_id, title, is_base)
resume_versions(id, resume_id, parent_version_id, job_id?, content_json, file_path,
                change_log_json, created_at)            -- versioning + diff lineage
evidence_items(id, user_id, resume_version_id?, source: resume|github|assessment|manual,
               section, text, tier, metrics_json, links_json, confirmed_by_user, embedding vector(384))
evidence_skills(evidence_id, skill_id)

skills(id, canonical_name, category, esco_uri?, embedding vector(384))
skill_aliases(alias, skill_id)

jobs(id, source, source_id, url, company, title, location, remote, posted_at,
     fetched_at, last_seen_at, description, content_hash, ghost_risk, embedding vector(384))
job_requirements(id, job_id, skill_id, kind, years_min, source_sentence)

market_maps(id, user_id, role, job_ids[], created_at)
market_skills(market_map_id, skill_id, frequency, must_rate, weight)

match_reports(id, user_id, job_id? | market_map_id?, resume_version_id, coverage, created_at)
match_items(report_id, skill_id, importance, evidence_score, evidence_id?, requirement_id?, explanation)

plans(id, user_id, role, start_date, end_date, hours_per_week, status)
plan_tasks(id, plan_id, week, skill_id, type, title, resource_url, est_hours,
           proof_artifact, status, completed_at)

questions(id, skill_id, job_id?, kind, prompt, rubric_json)
attempts(id, user_id, question_id, interview_session_id?, answer, score, feedback, created_at)
interview_sessions(id, user_id, job_id?, mode, started_at, summary_json)

applications(id, user_id, job_id, resume_version_id, status, applied_at, next_followup_at, notes)
application_events(id, application_id, type, at, notes)

weekly_reports(id, user_id, week_start, content_json)
-- + LangGraph checkpoint tables (created by PostgresSaver.setup())
```
Indexes: HNSW on every `embedding`, unique `(source, source_id)` on jobs, `(user_id, status)` on applications.

## API surface (FastAPI)

```
POST /resumes                    upload → parse → returns evidence for confirmation
POST /resumes/{id}/confirm       resume the interrupted graph with user edits
POST /jobs/search                {role, location, n} → research run
POST /jobs/ingest                {text | url}
POST /careers/prepare            {role, location, hours_per_week, deadline} → full pipeline (thread_id)
GET  /runs/{thread_id}           status / pending interrupt payload
POST /runs/{thread_id}/resume    Command(resume=…)
GET  /market-maps/{id}
GET  /match-reports/{id}
GET  /plans/{id}  PATCH /plan-tasks/{id}
POST /resumes/{id}/tailor        {job_id} → new version + diff
POST /interviews                 start mock; POST /interviews/{id}/answer
CRUD /applications
GET  /reports/weekly?week=
```
Long runs are async: return `thread_id` and stream progress via SSE (`/runs/{id}/events`).

## Repo layout

```
careerpilot/
├── docs/                      ← this plan
├── pyproject.toml             (uv, python 3.12)
├── docker-compose.yml         (postgres+pgvector, api)
├── .env.example               ANTHROPIC_API_KEY, DATABASE_URL, ADZUNA_APP_ID/KEY
├── app/
│   ├── main.py                FastAPI app
│   ├── api/                   routers (resumes, jobs, careers, plans, interviews, applications)
│   ├── db/                    SQLAlchemy models, Alembic migrations
│   ├── graph/
│   │   ├── state.py
│   │   ├── pipeline.py        fixed prepare-for-role graph
│   │   ├── supervisor.py      free-form chat router
│   │   └── agents/            research.py resume.py matching.py coach.py tracker.py
│   ├── sources/               adzuna.py greenhouse.py lever.py ashby.py pasted.py
│   ├── skills/                taxonomy.py (alias + embedding normalization), seed_skills.csv
│   ├── scoring.py             pure functions, heavily unit-tested
│   ├── llm.py                 Claude client, structured-output helpers, prompt caching
│   └── embeddings.py
├── evals/                     gold JDs/resumes + scripts (see 05-evaluation.md)
├── tests/
└── web/                       Next.js (Phase 3)
```

## Cross-cutting concerns
- **Privacy:** resumes are PII. Encrypt the file store, provide a delete-my-data endpoint, never send PII to job sources, and don't log resume text.
- **Cost control:** Haiku for extraction, prompt caching on long system prompts, cache JD extraction by `content_hash` (the same JD is never extracted twice across users).
- **Rate limits:** per-source token bucket. Cache fetched boards for 6–12h.
- **Observability:** LangSmith or simple structured logs per node (latency, tokens, cost).
- **Auth:** start single-user (local). Add Clerk/Auth.js or FastAPI-Users in Phase 3.
