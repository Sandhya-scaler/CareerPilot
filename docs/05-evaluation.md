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
