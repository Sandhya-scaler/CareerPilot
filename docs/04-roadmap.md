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

## Phase 4 — Standout features 🟡
- ✅ Mock interview loop (text), follow-ups, weak skills written back to the plan
- 🟡 Weekly progress report: page + Monday generation ✅. **Email ⬜** (needs an email provider)
- ✅ Ghost-job flag with daily liveness re-check
- ✅ Follow-up nudges (dashboard, tracker, weekly report)
- ✅ GitHub import → verified/demonstrated evidence
- ⬜ Voice mock interviews

## Phase 5 — Harden and launch 🟡
- ✅ Eval gate + LLM-guard tests + e2e smoke; CI workflow written (**not yet run on GitHub**)
- ✅ Cost tracking per user per week (`/account`)
- ✅ Rate limits, production secret check, data export, account deletion, privacy page
- 🟡 Deploy: Dockerfiles + compose written, **not built locally (Docker isn't installed here)**. See `06-operations.md`
- ⬜ Beta with 10–20 classmates, then outcome interviews
- ⬜ Run the eval with Claude enabled (`npm run eval -- --llm`) once an API key is available

## Next steps, in order
1. Add `ANTHROPIC_API_KEY` and run `npm run eval -- --llm`, compared with rules-only (96.5% P / 100% R today).
2. Grow the eval set to 10 resumes × 50 JDs using real (consented, anonymized) resumes from the beta.
3. Push to GitHub so CI runs; deploy (Neon + Railway/Fly + Vercel).
4. Add more India company boards to `sources/boards.ts` (verify each token first) and an Adzuna key.
5. Weekly email via Resend or SES; voice interviews.

## Risks
| Risk | Mitigation (in place) |
|---|---|
| Job APIs change or rate-limit | Pasted-JD path always works; per-board failures are isolated and cached |
| Extraction noise | Taxonomy + eval gate in CI; extractor version invalidates the cache |
| LLM invents resume content | Reorder-only default; grounding check on every rewrite; tests with a lying mock model |
| Weak India coverage | 15 India-region boards (of 24) + location filter; Adzuna `/in/` with a key; pasted JDs |
| Cost | Haiku for extraction, extraction cache, prompt caching, usage logged per user |
