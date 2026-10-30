# 05 — Evaluation (how we know it's actually good)

An AI career tool that's confidently wrong does real harm, because people spend weeks learning the wrong things. Measure every agent.

## Gold dataset (build in Phase 1, grow over time)
- **10 resumes** (yours, friends' with consent, and anonymized public samples) across 4 personas.
- **50 JDs** across 5 roles (CV intern, SDE intern, data analyst, ML engineer, backend dev), with India/US mix.
- Hand labels:
  - per JD: list of `(skill, must|nice)`
  - per resume: list of `(skill, tier, evidence line)`
  - per resume×JD pair (20 pairs): expected covered/missing skills

Store under `evals/data/` as JSON. Never commit real PII: anonymize names, emails, and phone numbers.

## Metrics per component
| Component | Metric | Target |
|---|---|---|
| JD requirement extraction | Skill precision / recall vs labels | P ≥ 0.9, R ≥ 0.85 |
| JD must/nice classification | Accuracy | ≥ 0.85 |
| Skill normalization | % mapped to the correct canonical skill | ≥ 0.95 |
| Resume evidence extraction | Skill recall; tier accuracy (±1 tier) | R ≥ 0.9; ±1 tier ≥ 0.9 |
| Match report | Covered/missing precision vs labels | ≥ 0.85 |
| Tailoring grounding | Unsupported claims per resume (auto-check + manual spot check) | **0** |
| Question quality | LLM-judge + human rating 1–5 on relevance/difficulty | avg ≥ 4 |
| Plan quality | Human rating: realistic for the stated hours? addresses top gaps? | avg ≥ 4 |
| Latency | Golden path, 30 JDs | < 90 s |
| Cost | Golden path tokens | track; target < $0.15/run |

## Grounding check (automated)
For each tailored resume version:
1. Extract skills, tools, and numbers from the new text.
2. Each must match an `evidence_item` of the user (exact/alias match for skills; exact match for numbers).
3. Anything else counts as a violation, so the edit is rejected and logged.

## Process
- `uv run python -m evals.run --component extraction` → prints metrics and writes `evals/results/<date>.json`.
- Run on every prompt change. Add to CI in Phase 5.
- Keep a `evals/failures.md` log. Each real-world bug becomes a new gold case.

## Results log
| Date | Mode | JD P / R / must-nice | Resume P / R / tier exact | Notes |
|---|---|---|---|---|
| 2026-10-30 | rules only | 96.5 / 100 / 96.3 | 98.8 / 100 / 97.5 | baseline |
| 2026-10-30 | rules + qwen2.5:3b (Ollama, local) | 96.5 / 100 / 96.3 | 98.8 / 100 / 97.5 | First run was *worse* (must/nice 92.7, tier exact 93.8): the model upgraded "nice" → "must" and tagged Java on a Spring Boot bullet. Fixed by making AI output additive-only (it can add missed skills, never override the rules). ~12 s per document on an 8 GB Mac. |

On this small set the rules are already near the ceiling, so AI extraction doesn't raise the scores. Its value shows on grading: on the same IoU/NMS question, a keyword-stuffed non-answer scored 1/5 with the local model (it reads for meaning), while a correct, well-explained answer scored 3/5 (small models grade harshly). Re-run with Gemini (`npm run eval -- --llm`) once a free key is set.
