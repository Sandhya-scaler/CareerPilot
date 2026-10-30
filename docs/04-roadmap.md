# 04 — Roadmap (build order)

Each phase ends with something **demoable**. The estimate assumes one developer working part-time (~15 h/week).

## Phase 0 — Setup (2–3 days)
- [ ] `uv init`, Python 3.12, FastAPI skeleton, `.env.example`
- [ ] Postgres 16 + pgvector (Docker Compose, or Homebrew)
- [ ] SQLAlchemy models + Alembic migration for the core tables
- [ ] `llm.py` (Claude structured output helper) + `embeddings.py` (bge-small)
- [ ] Seed `skills` + `skill_aliases` (~300 tech skills to start)
- **Demo:** `GET /health`, DB connected, `embed("pytorch")` works

## Phase 1 — Core intelligence, no UI (1.5–2 weeks) ⭐ most important
- [ ] Resume parsing → evidence items with tiers (PDF + DOCX)
- [ ] Pasted-JD ingestion → requirements with `source_sentence`
- [ ] Skill normalization (alias table → embedding fallback → "unknown" queue)
- [ ] `scoring.py`: coverage, market weight, gap priority (**unit tests first**)
- [ ] Match report for 1 resume × 1 JD, with evidence links
- [ ] Eval set v0: 5 resumes × 10 JDs, hand-labeled (see `05-evaluation.md`)
- **Demo (CLI):** `careerpilot match resume.pdf jd.txt` prints a requirement-by-requirement table: covered by which line, missing which

## Phase 2 — Agents & the golden path (2 weeks)
- [ ] Job sources: Greenhouse, Lever, Ashby, Adzuna (`/in/`, `/us/`, `/gb/`) + dedupe + relevance filter
- [ ] Market skill map across N JDs
- [ ] LangGraph pipeline Research → Resume (HITL confirm) → Match → Coach with `PostgresSaver`
- [ ] Prep plan generator (sized to hours/week)
- [ ] Practice question generator + rubric
- [ ] FastAPI endpoints + SSE run progress
- **Demo:** "Prepare me for a Computer Vision internship in Bangalore, 8 h/week" → market map, gaps, 6-week plan, 15 questions

## Phase 3 — Usable product (2–3 weeks)
- [ ] Web UI (Next.js): onboarding, market map, match report with side-by-side evidence, plan checklist
- [ ] Application tracker (Kanban)
- [ ] Resume versioning + tailoring with grounding check + diff view + PDF export
- [ ] Auth + per-user data isolation
- **Demo:** a friend uses it end-to-end without help

## Phase 4 — Standout features (2 weeks)
- [ ] Mock interview subgraph (text first; voice later)
- [ ] Weekly progress report (cron + page + email)
- [ ] Ghost-job / freshness flag
- [ ] Follow-up nudges
- [ ] GitHub import → auto-upgrade evidence tiers

## Phase 5 — Harden & launch (ongoing)
- [ ] Eval suite in CI. Block merges on a hallucination regression.
- [ ] Cost dashboard (tokens per user per week)
- [ ] Deploy: Fly.io/Railway (API) + Neon/Supabase (Postgres with pgvector) + Vercel (web)
- [ ] Beta with 10–20 classmates/cohort members, then interview them about outcomes
- [ ] Privacy policy, data deletion

## Risks & mitigations
| Risk | Mitigation |
|---|---|
| Job APIs change or rate-limit us | Pasted-JD path always works. Sources sit behind one interface. Cache aggressively. |
| Skill extraction noise ("communication" vs "Kubernetes") | Taxonomy normalization + category filter + eval set |
| LLM invents resume content | Edit-ops tailoring + automated grounding check + HITL for new claims |
| Weak India coverage | Adzuna `/in/` + curated India company boards + pasted JDs |
| Cost per user | Haiku for extraction, JD extraction cache by hash, prompt caching |
| Scope creep | Phase 1 gate: don't start agents until the match report is accurate on the eval set |

## Definition of "solid" before showing anyone
1. Match report precision ≥ 0.85 on the labeled set (see evals).
2. Zero unsupported claims in 50 tailored resumes.
3. Golden path finishes in < 90 s for 30 JDs.
4. Each recommendation is clickable down to the source sentence.
