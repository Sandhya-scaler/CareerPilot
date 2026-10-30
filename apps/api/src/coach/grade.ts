import { z } from "zod";
import { tokens } from "../embeddings.js";
import { structured, withFallback } from "../llm.js";

export interface Grade {
  score: number; // 1..5
  covered: string[];
  missed: string[];
  feedback: string;
  /** A probing follow-up when the answer was thin, else null. */
  followUp: string | null;
  gradedBy: "llm" | "keywords";
}

const stem = (w: string) => w.slice(0, 5);

/**
 * Keyword fallback: a rubric point counts as covered when ≥40% of its content words (prefix-stemmed)
 * appear in the answer. Crude but transparent; the UI labels it as keyword-based.
 */
export function keywordGrade(answer: string, rubric: string[], prompt: string): Grade {
  const said = new Set([...tokens(answer)].map(stem));
  const words = answer.trim().split(/\s+/).filter(Boolean).length;
  const covered: string[] = [];
  const missed: string[] = [];
  for (const point of rubric) {
    const keys = [...tokens(point)].filter((t) => t.length >= 4).map(stem);
    const hit = keys.filter((k) => said.has(k)).length;
    (keys.length && hit / keys.length >= 0.4 ? covered : missed).push(point);
  }
  let score = rubric.length ? Math.round(1 + (4 * covered.length) / rubric.length) : 1;
  if (words < 25) score = Math.min(score, 2); // a one-liner isn't an interview answer
  const feedback = missed.length
    ? `You covered ${covered.length} of ${rubric.length} points. Missing: ${missed.slice(0, 3).join("; ")}.${words < 25 ? " Aim for a fuller answer (about a minute spoken)." : ""}`
    : "You covered every point in the rubric. Next time, add a concrete example from your own work.";
  // Rubric points are written for the grader ("Gives a concrete example"); turn the first missed one into an ask.
  const ask = missed[0] ? missed[0].replace(/^(Mentions|Gives|States|Names|Explains|Uses|Addresses|Defines)\s+/i, "").replace(/\.$/, "") : "";
  const followUp = score <= 3 && ask ? `Let's go one level deeper on that question. Can you cover this part: ${ask[0]!.toLowerCase()}${ask.slice(1)}?` : null;
  return { score, covered, missed, feedback, followUp, gradedBy: "keywords" };
}

const LlmGrade = z.object({
  score: z.number().int().min(1).max(5),
  covered: z.array(z.string()),
  missed: z.array(z.string()),
  feedback: z.string().describe("2-3 sentences: what was strong, what to add, phrased to the candidate"),
  follow_up: z.string().nullable().describe("One probing follow-up question if score <= 3, else null"),
});

const GRADE_SYSTEM = `You are a fair, specific technical interviewer grading one answer against a rubric.

Score 1-5: 5 = covers every rubric point with correct detail and an example; 3 = core idea right but missing important points; 1 = wrong or no substance.
- "covered" and "missed" must be rubric points copied verbatim.
- Judge substance, not wording or grammar. Don't reward length alone.
- Feedback speaks to the candidate directly and names exactly what to add.
- If score <= 3, ask one follow-up that probes the most important missed point; otherwise null.`;

export async function gradeAnswer(prompt: string, rubric: string[], answer: string): Promise<Grade> {
  const { value } = await withFallback<Grade>(
    "grading",
    async () => {
      const g = await structured({
        label: "grading",
        tier: "reasoning",
        system: GRADE_SYSTEM,
        input: JSON.stringify({ question: prompt, rubric, answer }),
        schema: LlmGrade,
        effort: "low",
      });
      const inRubric = (p: string) => rubric.includes(p);
      return {
        score: g.score,
        covered: g.covered.filter(inRubric),
        missed: g.missed.filter(inRubric),
        feedback: g.feedback,
        followUp: g.score <= 3 ? g.follow_up : null,
        gradedBy: "llm" as const,
      };
    },
    () => keywordGrade(answer, rubric, prompt),
  );
  return value;
}
