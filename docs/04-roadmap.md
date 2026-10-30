# 04 — Roadmap and status

Status as of 2026-10-30. ✅ done and tested · 🟡 partly done · ⬜ not started.

## Phase 0 — Setup ✅
- ✅ npm workspaces (`apps/api` Express, `apps/web` Next.js), `.env.example`
- ✅ Postgres 17 + pgvector (Homebrew locally; `pgvector/pgvector:pg17` in Docker/CI)
- ✅ SQL migrations applied on boot
- ✅ Claude structured-output wrapper; local bge-small embeddings
- ✅ Taxonomy: 183 skills, 985 aliases, related/parent graph

## Phase 1 — Core intelligence ✅
- ✅ Resume parsing (PDF/DOCX/TXT) → evidence with tiers (group-level outcomes and links)
- ✅ JD → requirements with verbatim source sentence, must/nice, years, alternatives
- ✅ Skill normalization (alias → embedding ≥ 0.86 → `unknown_skills` queue)
- ✅ Scoring with direct / implied / adjacent credit
- ✅ Match report API + offline CLI (`npm run cli -- match resume.pdf jd.txt`)
- ✅ Eval set: 4 resumes × 8 JDs, hand-labeled; gated in tests

## Phase 2 — Agents and golden path ✅
- ✅ Greenhouse / Lever / Ashby (24 verified boards) / Adzuna / Arbeitnow, plus relevance gate and India location filter
- ✅ Market skill map
- ✅ LangGraph pipeline with PostgresSaver, two interrupts, SSE progress, resume-after-restart
- ✅ Budgeted plan, practice questions with rubrics
- ✅ Live run against real boards (bugs found and fixed: relevance, location, sentence splitting)

## Phase 3 — Usable product ✅
- ✅ Web UI: onboarding, prepare flow with HITL, market map, ledger, plan, practice, jobs
- ✅ Application tracker (kanban, events, follow-up drafts)
- ✅ Resume versioning + grounded tailoring + diff + print-to-PDF
- ✅ Auth (scrypt + signed session cookie) and per-user isolation (tested)

## Phase 4 — Standout features ✅
- ✅ Mock interview loop, follow-ups, weak skills written back to the plan
- ✅ Voice mock interviews (browser speech: questions read aloud, answers dictated)
- ✅ Weekly progress report: page, Monday generation, opt-in email over any SMTP provider (tested against a real SMTP server)
- ✅ Ghost-job flag with daily liveness re-check
- ✅ Follow-up nudges (dashboard, tracker, weekly report)
- ✅ GitHub import → verified/demonstrated evidence

## Phase 5 — Harden and launch 🟡
- ✅ Eval gate + LLM-guard tests + e2e smoke (88 API tests)
- ✅ Cost tracking per user per week (`/account`)
- ✅ Rate limits (Postgres-backed, multi-instance), production secret check, data export, account deletion, privacy page
- ✅ Docker: images built and the full e2e smoke test passes against `docker compose` (Colima)
- ✅ Multi-instance safe: scheduler claims and taxonomy seeding coordinate through Postgres
- ✅ Beta tooling: in-app feedback, `/admin` metrics (activation, evidence growth, interview rate tailored vs not, AI spend)
- ✅ India coverage: 33 verified boards, 24 with India roles
- ✅ CI green on GitHub (typecheck, 88 tests incl. eval gate, eval report, web build): github.com/Sandhya-scaler/CareerPilot
- 🟡 Free deploy: `render.yaml` (Render free + Neon free) written; applying it needs your accounts
- ✅ Free AI layer: any OpenAI-compatible API (Gemini free tier, Groq, local Ollama), same guards as Claude. Verified live with Ollama and with Gemini (e2e passes on Gemini in 26 s); quota/busy/timeout handling with fallback models and a per-step time budget
- ✅ AI eval with real models (Ollama, Gemini): equals rules-only on the eval set (additive-only by design); results in `05-evaluation.md`
- ⬜ Beta with 10–20 classmates, then outcome interviews (the tooling is ready)

## What only you can do
1. Deploy for free: Neon + Render blueprint (steps in `06-operations.md`).
2. Invite classmates; read `/admin` weekly. Grow the eval set with consented, anonymized resumes.

## Risks
| Risk | Mitigation (in place) |
|---|---|
| Job APIs change or rate-limit | Pasted-JD path always works; per-board failures are isolated and cached |
| Extraction noise | Taxonomy + eval gate in CI; extractor version invalidates the cache |
| LLM invents resume content | Reorder-only default; grounding check on every rewrite; tests with a lying mock model |
| Weak India coverage | 15 India-region boards (of 24) + location filter; Adzuna `/in/` with a key; pasted JDs |
| Cost | Haiku for extraction, extraction cache, prompt caching, usage logged per user |
