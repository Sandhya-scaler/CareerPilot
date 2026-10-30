# 01 — Research: who hurts, why, and what data we may legally use

Researched 2026-10-30. Survey numbers come mostly from job-platform vendors (Monster, Resume Genius), so treat them as directional rather than precise.

## 1. The real pain (what users told surveys)

| Pain | Evidence | What CareerPilot does about it |
|---|---|---|
| **Tailoring is the hardest part of the resume** | 41–48% say tailoring per job is the hardest part (Monster 2026; Resume Genius 2026). 68% spend under 30 min per tailoring. | It produces a tailored resume version in about 2 minutes. Every change can be traced back to evidence you already have. |
| **ATS anxiety / black box** | 77% worry their resume gets filtered before a human sees it. 50% don't understand how ATS works. 60% say not knowing whether a human saw the resume is their biggest frustration. | It gives a transparent match report: *which* JD requirement is covered by *which* resume line, and what's missing. There's no fake "ATS score". |
| **Ghost jobs** | 67% of job seekers report running into ghost jobs (Resume Genius 2026). | A **freshness/ghost-risk flag** on each job, based on posting age, reposts, and whether the job still appears on the company's own ATS. |
| **Mental load / mental health** | 49% say the job hunt hurts their mental health. | One weekly plan of small, concrete tasks and a weekly progress report. Progress you can see beats an endless list of applications. |
| **Not knowing what to learn** | (Common in student/fresher communities, including the Scaler/BITS cohort this author belongs to) | Skill-gap analysis is aggregated across *many* JDs for the target role, so the user learns what the market actually asks for and isn't chasing one posting. |

**Core insight:** existing tools either *write* (resume builders, which often invent experience) or *list* (job boards). Few tools **reason over evidence**: "this is what you've actually proven, this is what the market needs, and this is the shortest path between the two." That's CareerPilot's wedge.

## 2. Competitive landscape (short)

| Category | Examples | Gap we exploit |
|---|---|---|
| Resume scanners | Jobscan, Resume Worded | Keyword matching against one JD. They don't model evidence strength, don't aggregate across the market, and offer no learning plan. |
| AI resume writers | Teal, Rezi, Kickresume | They tend to hallucinate achievements. Tracking is shallow. |
| Trackers | Huntr, Teal tracker | Manual. No intelligence connects tracking → learning → interview prep. |
| Interview prep | Pramp, LeetCode, Final Round AI | Not tied to the user's specific gaps or to the target JD. |
| Auto-apply bots | LazyApply etc. | They spam applications, hurt candidates' reputations, and often violate site ToS. **We deliberately do not auto-submit.** |

## 3. Job data sources (legal, "permitted")

Rule: **only official APIs or public feeds that companies publish for exactly this purpose. Never scrape LinkedIn, Naukri, Indeed, or Glassdoor** (their ToS forbid it, and LinkedIn actively sues scrapers).

| Source | Auth | Coverage | Notes |
|---|---|---|---|
| **User-pasted JD / URL** | — | Anything | **Primary source for MVP.** The user is always allowed to paste a JD they're reading. Works for Naukri, LinkedIn, and others without scraping. |
| **Greenhouse Job Board API** `boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` | None (read) | One company per board token | Public, meant to be consumed. Poll politely (no published rate limits). |
| **Lever Postings API** `api.lever.co/v0/postings/{company}?mode=json` | None | One company per slug | Only published postings. |
| **Ashby Posting API** `api.ashbyhq.com/posting-api/job-board/{org}?includeCompensation=true` | None | One company per org | Rate-limited per IP; no server-side search. |
| **Adzuna API** | Free app_id/key | Aggregated search, **includes India (`/in/`)**, UK, US, etc. | Free-tier limits differ across sources (roughly 250/day). Check the developer portal. Terms require attribution. |
| **Arbeitnow API** | None | EU + remote | No salary field. |
| **Remotive API** | None | Remote | Feed delayed 24h. Asks for ≤ ~4 calls/day and no reposting to other boards. Use it for analysis only, not redistribution. |
| **USAJOBS API** | Free key | US government | — |
| **HN "Who is hiring" (Algolia HN API)** | None | Startups, monthly | Great for tech roles. Data is free text, so extraction is needed. |

**India strategy:** no public Naukri/Internshala API exists. Combine (a) user-pasted JDs, (b) Adzuna `/in/`, and (c) a curated seed list of India-hiring companies that use Greenhouse/Lever/Ashby (many startups do: Razorpay, CRED, Postman, etc.). Verify each board token before seeding.

**Data hygiene:** store the source + source URL + fetch time per job. Respect each source's caching and attribution rules. Don't republish listings publicly, because they're used for the user's private analysis only.

## 4. Skill taxonomy (to normalize "PyTorch" = "pytorch" = "Torch")

- **ESCO** (EU Commission): open web API and downloadable dataset, 13k+ skills. Pin a version.
- **O\*NET** (US Dept. of Labor): free database of occupations and tech skills.
- **Lightcast Open Skills**: free tier with registration, the most "tech-aware" of the three.

Plan: start with a **small hand-curated alias table** (≈500 tech skills) seeded from Lightcast/ESCO, plus embedding similarity to catch unseen variants. Don't import 13k skills on day one.

## 5. Tech facts that shape the design

- **LangGraph 1.0** (GA Oct 2025): stable `interrupt()` / `Command(resume=…)` for human-in-the-loop. A checkpointer is required, and `PostgresSaver` is the production choice (its `setup()` creates its tables). The supervisor pattern routes work to specialist agents.
- **pgvector** keeps embeddings in the same Postgres database, so no separate vector DB is needed.
- **Python:** local is 3.14. Pin the project to **3.12** via `uv` for library compatibility (some ML wheels lag behind).
- **LLM:** Claude. Use Sonnet-class for reasoning (matching rationale, coaching) and Haiku-class for bulk extraction (JD → skills). Structured output via tool use / JSON schema.
- **Embeddings:** Anthropic has no embedding model. Default to local `BAAI/bge-small-en-v1.5` (free, offline, 384-dim). Voyage AI is an optional upgrade.

## Sources

- [Monster — Application Black Box Report](https://www.monster.com/career-advice/research/application-black-box-report)
- [Monster — State of the Resume 2026](https://www.monster.com/career-advice/research/state-of-the-resume-2026)
- [HR Dive — longer resumes, ATS concerns](https://www.hrdive.com/news/job-seekers-longer-resumes-growing-ats-concerns-monster/810834/)
- [Resume Genius — Hiring insights report](https://resumegenius.com/blog/job-hunting/hiring-insights-report)
- [CPA Practice Advisor — Ghost jobs 67%](https://www.cpapracticeadvisor.com/2026/04/30/ghost-jobs-still-haunting-67-of-job-seekers-report-finds/)
- [Free job APIs in 2026 (JobsPipe — vendor, verify)](https://jobspipe.dev/blog/free-job-api)
- [Adzuna API terms (UK Digital Marketplace)](https://assets.applytosupply.digitalmarketplace.service.gov.uk/g-cloud-15/documents/702167/617913156478105-terms-and-conditions-2026-01-29-2009.pdf)
- [Greenhouse public jobs API integration](https://medium.com/@sevicdev/integration-with-greenhouse-public-jobs-api-b548b23ad867)
- [Lever API guide 2026](https://100hires.com/lever-api.html)
- [13 ATS platforms with public job posting APIs (TheirStack)](https://theirstack.com/en/blog/13-ats-platforms-with-public-job-posting-api)
- [Arbeitnow job board API](https://www.arbeitnow.com/blog/job-board-api)
- [Public APIs — Jobs category](https://publicapis.dev/category/jobs)
- [ESCO services API](https://esco.ec.europa.eu/ar/use-esco/use-esco-services-api)
- [LangGraph 1.0 guide](https://josenobile.pages.dev/guides/langgraph/)
- [LangGraph interrupt() for HITL](https://medium.com/@areebahmed575/langgraphs-interrupt-function-the-simpler-way-to-build-human-in-the-loop-agents-faef98891a92)
