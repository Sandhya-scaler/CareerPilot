/**
 * Evidence-linked scoring (docs/03-architecture.md §Scoring). Pure functions: no I/O, no LLM.
 *
 *   importance(r)    = 1.0 must | 0.5 nice
 *   evidence(s)      = tier weight of the best item for s, or 0.5 x best related skill's (adjacent)
 *   coverage         = Σ importance·evidence / Σ importance
 *   market_weight(s) = freq(s) × (0.5 + 0.5·must_rate(s))
 *   gap_priority(s)  = market_weight(s) × (1 − evidence(s)) × learnability(s)
 */
import type { Taxonomy } from "./skills/taxonomy.js";
import { TIER_LABEL, TIER_WEIGHT, type RequirementKind, type Tier } from "./types.js";

export const IMPORTANCE: Record<RequirementKind, number> = { must: 1, nice: 0.5 };
export const ADJACENT_FACTOR = 0.5;
export const IMPLIED_FACTOR = 0.9;
export const LEARNABILITY: Record<"days" | "weeks" | "months", number> = { days: 1, weeks: 0.8, months: 0.6 };

/** Soft skills are shown but never scored: they can't be evidenced from a resume line. */
export const isScored = (tax: Taxonomy, skill: string) => tax.category(skill) !== "soft";

export interface EvidenceRef {
  id?: string;
  text: string;
  context?: string | null;
  tier: Tier;
  skills: string[];
}

export interface SkillEvidence<E extends EvidenceRef = EvidenceRef> {
  score: number;
  via: "direct" | "implied" | "adjacent" | "none";
  item: E | null;
  /** For implied/adjacent credit: which skill supplied it. */
  viaSkill: string | null;
}

export function bestBySkill<E extends EvidenceRef>(items: E[]): Map<string, E> {
  const best = new Map<string, E>();
  for (const item of items) {
    for (const s of item.skills) {
      const prev = best.get(s);
      if (!prev || item.tier > prev.tier) best.set(s, item);
    }
  }
  return best;
}

/**
 * Best credit for a skill: direct evidence, evidence for a more specific skill (implied, 0.9×), or
 * evidence for a sibling technology (adjacent, 0.5×). Ties go to the more direct kind.
 */
export function evidenceFor<E extends EvidenceRef>(skill: string, best: Map<string, E>, tax: Taxonomy): SkillEvidence<E> {
  let out: SkillEvidence<E> = { score: 0, via: "none", item: null, viaSkill: null };
  const consider = (cand: SkillEvidence<E>) => {
    if (cand.score > out.score + 1e-9) out = cand;
  };
  const direct = best.get(skill);
  if (direct) consider({ score: TIER_WEIGHT[direct.tier], via: "direct", item: direct, viaSkill: null });
  for (const c of tax.descendants(skill)) {
    const item = best.get(c);
    if (item) consider({ score: TIER_WEIGHT[item.tier] * IMPLIED_FACTOR, via: "implied", item, viaSkill: c });
  }
  for (const r of tax.related(skill)) {
    const item = best.get(r);
    if (item) consider({ score: TIER_WEIGHT[item.tier] * ADJACENT_FACTOR, via: "adjacent", item, viaSkill: r });
  }
  return out;
}

export interface Requirement {
  id?: string;
  skill: string;
  kind: RequirementKind;
  yearsMin: number | null;
  sourceSentence: string;
}

export interface MatchItem<E extends EvidenceRef = EvidenceRef> {
  skill: string;
  kind: RequirementKind;
  importance: number;
  requirement: Requirement;
  evidence: SkillEvidence<E>;
  scored: boolean;
  explanation: string;
}

export interface MatchResult<E extends EvidenceRef = EvidenceRef> {
  /** 0..1 over scored requirements. */
  coverage: number;
  mustCoverage: number;
  items: MatchItem<E>[];
}

export function explain(item: Omit<MatchItem, "explanation">): string {
  const e = item.evidence;
  const years = item.requirement.yearsMin ? ` The posting asks for ${item.requirement.yearsMin}+ years.` : "";
  if (!item.scored) return "Soft skill. Shown for context, not scored; show it in interviews and project write-ups.";
  if (e.via === "direct" && e.item) {
    return `${cap(TIER_LABEL[e.item.tier])} (tier ${e.item.tier}): "${truncate(e.item.text)}".${nextStep(e.item.tier)}${years}`;
  }
  if (e.via === "implied" && e.item) {
    return `Shown through ${e.viaSkill} (${TIER_LABEL[e.item.tier]}): "${truncate(e.item.text)}".${years}`;
  }
  if (e.via === "adjacent" && e.item) {
    return `Not shown directly. Partial credit from related ${e.viaSkill}: "${truncate(e.item.text)}". A small ${item.skill} project would close this.${years}`;
  }
  return `No evidence in your profile.${item.kind === "must" ? " This is a must-have." : " Nice-to-have."}${years}`;
}

function nextStep(tier: Tier): string {
  if (tier <= 1) return " Listed only: add a project bullet that uses it.";
  if (tier === 2) return " Add a measurable outcome or link to make it demonstrated.";
  return "";
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
const truncate = (s: string, n = 110) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function matchRequirements<E extends EvidenceRef>(requirements: Requirement[], evidence: E[], tax: Taxonomy): MatchResult<E> {
  const best = bestBySkill(evidence);
  const items: MatchItem<E>[] = requirements.map((requirement) => {
    const scored = isScored(tax, requirement.skill);
    const base = {
      skill: requirement.skill,
      kind: requirement.kind,
      importance: IMPORTANCE[requirement.kind],
      requirement,
      evidence: evidenceFor(requirement.skill, best, tax),
      scored,
    };
    return { ...base, explanation: explain(base) };
  });
  const scoredItems = items.filter((i) => i.scored);
  const must = scoredItems.filter((i) => i.kind === "must");
  return {
    coverage: weightedCoverage(scoredItems),
    mustCoverage: weightedCoverage(must),
    items: items.sort((a, b) => b.importance - a.importance || a.evidence.score - b.evidence.score),
  };
}

function weightedCoverage(items: { importance: number; evidence: { score: number } }[]): number {
  const total = items.reduce((s, i) => s + i.importance, 0);
  if (total === 0) return 0;
  return items.reduce((s, i) => s + i.importance * i.evidence.score, 0) / total;
}

// ---- Market-level ----------------------------------------------------------------------------

export interface MarketSkill {
  skill: string;
  /** Fraction of JDs mentioning the skill. */
  frequency: number;
  /** Of JDs mentioning it, fraction listing it as must-have. */
  mustRate: number;
  weight: number;
  jobCount: number;
}

export function marketWeight(frequency: number, mustRate: number): number {
  return frequency * (0.5 + 0.5 * mustRate);
}

/** Aggregates per-job requirements into a market skill map. */
export function buildMarketMap(jobs: { requirements: Pick<Requirement, "skill" | "kind">[] }[], tax: Taxonomy): MarketSkill[] {
  const n = jobs.length;
  if (n === 0) return [];
  const counts = new Map<string, { jobs: number; must: number }>();
  for (const job of jobs) {
    const seen = new Map<string, RequirementKind>();
    for (const r of job.requirements) {
      if (seen.get(r.skill) !== "must") seen.set(r.skill, r.kind);
    }
    for (const [skill, kind] of seen) {
      const c = counts.get(skill) ?? { jobs: 0, must: 0 };
      c.jobs++;
      if (kind === "must") c.must++;
      counts.set(skill, c);
    }
  }
  return [...counts]
    .filter(([skill]) => isScored(tax, skill))
    .map(([skill, c]) => {
      const frequency = c.jobs / n;
      const mustRate = c.must / c.jobs;
      return { skill, frequency, mustRate, weight: marketWeight(frequency, mustRate), jobCount: c.jobs };
    })
    .sort((a, b) => b.weight - a.weight || a.skill.localeCompare(b.skill));
}

export interface Gap<E extends EvidenceRef = EvidenceRef> {
  skill: string;
  market: MarketSkill;
  evidence: SkillEvidence<E>;
  learnability: "days" | "weeks" | "months";
  priority: number;
}

export function gapPriority(weight: number, evidence: number, learnability: keyof typeof LEARNABILITY): number {
  return weight * (1 - evidence) * LEARNABILITY[learnability];
}

/**
 * Ranks skills to work on. Skills the user already demonstrates (tier ≥ 3) drop out; the rest are
 * ordered by market weight × remaining gap × how quickly they can be learned.
 */
export function rankGaps<E extends EvidenceRef>(market: MarketSkill[], evidence: E[], tax: Taxonomy, minFrequency = 0.1): Gap<E>[] {
  const best = bestBySkill(evidence);
  return market
    .filter((m) => m.frequency >= minFrequency)
    .map((m) => {
      const ev = evidenceFor(m.skill, best, tax);
      const learnability = tax.get(m.skill)?.learn ?? "weeks";
      return { skill: m.skill, market: m, evidence: ev, learnability, priority: gapPriority(m.weight, ev.score, learnability) };
    })
    .filter((g) => g.evidence.score < TIER_WEIGHT[3])
    .sort((a, b) => b.priority - a.priority);
}

/** Market readiness: coverage of the market skill map weighted by market weight. */
export function marketCoverage<E extends EvidenceRef>(market: MarketSkill[], evidence: E[], tax: Taxonomy): number {
  const best = bestBySkill(evidence);
  const total = market.reduce((s, m) => s + m.weight, 0);
  if (!total) return 0;
  return market.reduce((s, m) => s + m.weight * evidenceFor(m.skill, best, tax).score, 0) / total;
}
