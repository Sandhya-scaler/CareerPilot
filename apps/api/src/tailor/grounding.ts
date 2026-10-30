import { findMetrics } from "../extract/text.js";
import { taxonomy } from "../skills/taxonomy.js";

/**
 * The no-fabrication guarantee (docs/05-evaluation.md §Grounding check).
 *
 * A rewritten resume line is grounded when:
 *   1. every skill it mentions is one the user has evidence for (any line, any source), and
 *   2. every number in it appears in the original line (no invented metrics), and
 *   3. it does not claim a stronger outcome than the original ("deployed" / "led") unless the
 *      original already said so.
 */
export interface GroundingResult {
  ok: boolean;
  violations: string[];
}

const CLAIM_WORDS = /\b(deployed|in production|shipped|launched|led|managed|owned|architected|scaled|optimi[sz]ed|reduced|increased|improved|award|winner|published|patent)\w*/gi;

const numbersIn = (text: string) => {
  const metrics = findMetrics(text).flatMap((m) => m.match(/\d+(?:[.,]\d+)*/g) ?? []);
  const bare = text.match(/\b\d+(?:[.,]\d+)*\b/g) ?? [];
  return new Set([...metrics, ...bare].map((n) => n.replace(/,/g, "")));
};

export function checkGrounding(original: string, rewritten: string, userSkills: Set<string>): GroundingResult {
  const violations: string[] = [];

  const before = new Set(taxonomy.findInText(original).map((m) => m.skill));
  for (const m of taxonomy.findInText(rewritten)) {
    if (!before.has(m.skill) && !userSkills.has(m.skill)) {
      violations.push(`adds skill "${m.surface}" with no evidence in your profile`);
    }
  }

  const origNums = numbersIn(original);
  for (const n of numbersIn(rewritten)) {
    if (!origNums.has(n)) violations.push(`adds number "${n}" not in the original line`);
  }

  const origClaims = new Set((original.match(CLAIM_WORDS) ?? []).map((w) => w.toLowerCase().slice(0, 6)));
  for (const w of rewritten.match(CLAIM_WORDS) ?? []) {
    if (!origClaims.has(w.toLowerCase().slice(0, 6))) violations.push(`adds claim "${w}" not in the original line`);
  }

  return { ok: violations.length === 0, violations };
}
