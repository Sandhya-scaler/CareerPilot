# 02 — Product spec

## One-liner
**CareerPilot turns "I want role X" into an evidence-backed plan: what the market asks for, what you've actually proven, the shortest path to close the gap, and a tracker that keeps you moving.**

## Principles (non-negotiable)
1. **Evidence or it didn't happen.** Every "you have skill X" links to a resume line, a project, a repo, or a passed assessment. Every "you lack X" links to the JD lines that ask for it.
2. **Never fabricate.** Tailoring may reorder, rephrase, and emphasize. It may **not** invent tools, metrics, or experience. New claims require explicit user confirmation (a human-in-the-loop interrupt).
3. **Market, not one posting.** Gaps are weighted by how often and how strongly *many* JDs for the role ask for them.
4. **Assist, don't auto-apply.** The user submits applications themselves. No bots, no ToS violations.
5. **Small weekly wins.** Plans are capped to the hours the user says they have.

## Personas
| Persona | Example | Main job-to-be-done |
|---|---|---|
| **Student / intern seeker** | 3rd-year B.Tech wanting a Computer Vision internship | "What should I learn and build in the next 8 weeks to be credible?" |
| **Career switcher** | Backend dev → ML engineer | "Which of my existing experience transfers, and what's the real gap?" |
| **Active applicant** | New grad applying to 40 roles | "Tailor fast, track everything, prep for the interviews I get." |
| **Upskilling professional** | Not applying yet | "Am I still market-relevant for my role? What's trending?" |

## Core user journey (the "golden path")
```
1. Onboard      → upload resume (PDF/DOCX) + target role + location + hours/week + deadline
2. Research     → agent pulls 20–50 relevant JDs (APIs + any JDs the user pastes)
3. Profile      → resume parsed into evidence items; user confirms/edits (HITL)
4. Match        → market skill map + per-skill evidence strength + gap list
5. Plan         → prioritized weekly plan (learn → build → prove), sized to hours/week
6. Practice     → targeted questions + mock interview on gap skills
7. Apply        → pick a JD → tailored resume version + match report → user applies → tracked
8. Weekly loop  → progress report, plan re-ranking, follow-up reminders
```

## Features by priority

### P0 — MVP (must work end-to-end)
- **Resume ingestion:** PDF/DOCX → structured profile (education, experience, projects, skills) → **evidence items**, each with source span, skill tags, and strength.
- **JD ingestion:** paste text or URL, plus fetch from Greenhouse/Lever/Ashby boards and Adzuna. JD → requirements (skill, must/nice, years, source sentence).
- **Market skill map** for a target role: aggregated across N JDs, showing frequency and must-have rate per skill.
- **Evidence-linked match report** (per JD and per market), scored per requirement (see `03-architecture.md` §Scoring).
- **Prep plan:** ranked gaps → weekly tasks (resource + mini-project + "proof" artifact).
- **Practice questions** per gap skill (conceptual, applied, project-based), with answer rubrics.
- **Application tracker:** Kanban (Saved → Applied → OA → Interview → Offer/Rejected), dates, notes.

### P1 — Standout features
- **Resume versioning:** a base resume plus tailored versions per JD, with diff view and a "why this change" note linked to JD requirements. Export to PDF.
- **Interview simulation:** multi-turn mock interview (technical + behavioral). It scores each answer against a rubric, asks follow-up probes, and records weak areas back into the plan.
- **Weekly progress report:** tasks done, skills moved up an evidence tier, applications sent and their responses, next week's focus.
- **Ghost-job / freshness flag:** posting age, repost count, whether the posting is still live on the company's own ATS.
- **Follow-up nudges:** "Applied 10 days ago, no response. Here's a short follow-up template."

### P2 — Later
- GitHub import (repo languages, README) to auto-verify project evidence.
- Skill assessments (short quizzes) that upgrade evidence to "verified".
- Cover letter drafts (same no-fabrication rule).
- Saved searches with alerts.
- Team / cohort mode (bootcamps like Scaler can see aggregate cohort gaps).

### Non-goals
Auto-applying, scraping LinkedIn/Naukri, salary negotiation bots, a generic "ATS score" with no explanation.

## Evidence tiers (the key concept)
| Tier | Meaning | Example | Weight |
|---|---|---|---|
| 0 — None | Not mentioned | — | 0.0 |
| 1 — Claimed | Listed in the skills section only | "Skills: OpenCV" | 0.3 |
| 2 — Applied | Used in a project/job bullet | "Built a lane detector with OpenCV" | 0.6 |
| 3 — Demonstrated | Applied with outcome/scale/link | "…92% mAP, deployed, github.com/…" | 0.85 |
| 4 — Verified | Passed an in-app assessment, or an external cert/repo confirmed | Quiz passed, repo analyzed | 1.0 |

The user can move skills up tiers by finishing plan tasks. **That's the progress metric.**

## Worked example: "Help me prepare for a Computer Vision internship"
1. Research Agent fetches 30 CV-intern JDs (Adzuna `/in/` + seed company boards + 3 the user pasted).
2. Market map: Python 97%, PyTorch 80%, OpenCV 73%, CNNs 70%, object detection (YOLO/DETR) 53%, Docker 27%, ONNX/TensorRT 20%.
3. Resume shows: Python (T3), OpenCV (T2, one college project), PyTorch (T1, claimed only), no detection work.
4. Gaps ranked by `market_weight × (1 − evidence)`: PyTorch evidence, object detection, CNN fundamentals depth.
5. Plan (8 h/week, 6 weeks): Week 1–2 train a ResNet on a custom dataset in PyTorch, then push the repo. Week 3–4 fine-tune YOLO on a small domain dataset and write a blog post with mAP. Week 5 export to ONNX and add a FastAPI demo. Week 6 mock interviews.
6. Practice: "Explain IoU and NMS", "Why does batch norm help?", "Walk me through your lane-detection project: what failed?"
7. Tailored resume for a specific JD reorders projects and surfaces the OpenCV bullet. It does **not** add "YOLO" until the Week 3 project exists.

## Success metrics
- **Activation:** % of users who reach a match report within 10 minutes of signup.
- **Core value:** % of users whose evidence tier rises for ≥ 2 gap skills within 4 weeks.
- **Retention:** weekly active users who open the weekly report.
- **Outcome (self-reported):** interview rate per application before vs after using the tool.
- **Trust:** hallucination rate in tailored resumes (target **0** unsupported claims, checked automatically, see `05-evaluation.md`).
