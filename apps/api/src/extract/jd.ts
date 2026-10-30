import { z } from "zod";
import { structured, withFallback } from "../llm.js";
import { taxonomy } from "../skills/taxonomy.js";
import type { RequirementDraft, RequirementKind } from "../types.js";
import { BULLET_RE, cleanText, logicalLines, stripBullet } from "./text.js";

/** Bump when extraction output changes so cached requirements are recomputed. */
export const EXTRACTOR_VERSION = 2;

type JdSection = "must" | "nice" | "resp" | "skip" | "intro";

const HEADINGS: [JdSection, RegExp][] = [
  ["nice", /(nice[- ]to[- ]haves?|preferred|bonus|good[- ]to[- ]have|pluses|plus points|desired|desirable|extra credit|would be (great|nice)|it'?s a plus|stand out)/i],
  ["skip", /(about (us|the company|the team|our company)|^about (?!you\b|the role\b|this role\b)[\w&.]+$|who we are|benefits|perks|what we offer|compensation|salary|pay range|equal (employment )?opportunity|eeo|why join|our (culture|values|mission)|life at|how to apply|diversity|inclusion|accommodation|privacy|hiring process|interview process)/i],
  ["must", /(requirements?|qualifications?|must[- ]haves?|what you('ll)? (need|bring)|what we('re| are)? looking for|who you are|you (should|must|will) have|you have|skills( required)?|required|minimum|basic|eligibility|about you|your profile|tech(nical)? stack|technologies|ideal candidate|candidate profile|key skills)/i],
  ["resp", /(responsibilities|what you('ll| will)? do|the role|role overview|your role|day[- ]to[- ]day|you will|job description|key duties|duties|what you'll work on|the opportunity|in this role)/i],
];

function headingOf(line: string): JdSection | null {
  const l = line.replace(/^[#*\s]+|[*:\s]+$/g, "");
  if (l.length > 70 || BULLET_RE.test(line)) return null;
  // A heading is short and either ends with ":" in the source, is Title/UPPER case, or is a markdown heading.
  const headingish = /:\s*$/.test(line) || /^#{1,4}\s/.test(line) || /^\*\*.*\*\*:?$/.test(line) || l.split(" ").length <= 7;
  if (!headingish) return null;
  for (const [kind, re] of HEADINGS) if (re.test(l)) return kind;
  return null;
}

const NICE_CUE = /(nice[- ]to[- ]have|preferred|is a (big )?plus|\ba plus\b|bonus|good[- ]to[- ]have|ideally|desirable|familiarity with|exposure to|optional|added advantage|an advantage|not required|would be great|is helpful|helpful but|bonus points)/i;
const YEARS_RE = /(\d{1,2})\s*\+?\s*(?:-|to|–)?\s*(?:\d{1,2}\s*)?\+?\s*(?:years?|yrs?)/i;

const ABBREV = /\b(e\.g|i\.e|etc|vs|incl|approx|esp|resp|min|max|yrs?|no|Sr|Jr|Dr|Mr|Ms|Inc|Ltd|Pvt|Co)\.(?=\s)/gi;

/** Splits a line into sentences without breaking "Node.js", "e.g. LoRA", "3.5". */
export function sentences(line: string): string[] {
  return line
    .replace(ABBREV, (m) => `${m.slice(0, -1)}\u0000`)
    .split(/(?<=[.!?])\s+(?=[A-Z(])/)
    .map((s) => s.replace(/\u0000/g, ".").trim())
    .filter(Boolean);
}

export function extractRequirementsRules(jdText: string): RequirementDraft[] {
  const lines = logicalLines(cleanText(jdText).split("\n"), (l) => headingOf(l) !== null);
  const hasHeadings = lines.some((l) => headingOf(l) !== null);

  let section: JdSection = hasHeadings ? "intro" : "must";
  const found = new Map<string, RequirementDraft>();

  for (const line of lines) {
    const h = headingOf(line);
    if (h) {
      section = h;
      continue;
    }
    if (section === "skip") continue;
    for (const sentence of sentences(stripBullet(line))) {
      const matches = taxonomy.findInText(sentence);
      if (matches.length === 0) continue;
      const years = Number(sentence.match(YEARS_RE)?.[1]) || null;
      const cue = NICE_CUE.test(sentence);
      let kind: RequirementKind;
      if (section === "nice" || cue) kind = "nice";
      else if (section === "intro") kind = "nice"; // company blurb before the real sections
      else kind = "must";
      const alternatives = alternativeSkills(sentence, matches);
      for (const m of matches) {
        // "Java, Go or Python": any one satisfies the requirement, so none is individually a must.
        const k: RequirementKind = alternatives.has(m.skill) ? "nice" : kind;
        upsert(found, { skill: m.skill, kind: k, yearsMin: years, sourceSentence: sentence });
      }
    }
  }
  return [...found.values()];
}

/** Skills listed as interchangeable options: "A or B", "A, B or C", "one of A, B, C", "A/B". */
export function alternativeSkills(sentence: string, matches: { skill: string; surface: string; index: number }[]): Set<string> {
  const out = new Set<string>();
  if (matches.length < 2) return out;
  const oneOf = /\b(one of|any of|either)\b/i.test(sentence);
  let run: typeof matches = [matches[0]!];
  let runHasOr = false;
  const flush = () => {
    const distinct = new Set(run.map((m) => m.skill));
    if (distinct.size >= 2 && (runHasOr || oneOf)) distinct.forEach((s) => out.add(s));
  };
  for (let i = 1; i < matches.length; i++) {
    const prev = matches[i - 1]!, cur = matches[i]!;
    const between = sentence.slice(prev.index + prev.surface.length, cur.index);
    if (/^\s*(,|\/|or|,\s*or|,\s*and\/or|and\/or)\s*$/i.test(between)) {
      if (/or|\//i.test(between)) runHasOr = true;
      run.push(cur);
    } else {
      flush();
      run = [cur];
      runHasOr = false;
    }
  }
  flush();
  return out;
}

function upsert(found: Map<string, RequirementDraft>, r: RequirementDraft) {
  const prev = found.get(r.skill);
  if (!prev) {
    found.set(r.skill, r);
    return;
  }
  // Must beats nice; keep the sentence that justified the stronger kind.
  if (prev.kind === "nice" && r.kind === "must") found.set(r.skill, { ...r, yearsMin: r.yearsMin ?? prev.yearsMin });
  else if (r.yearsMin && (!prev.yearsMin || r.yearsMin > prev.yearsMin)) prev.yearsMin = r.yearsMin;
}

const LlmRequirements = z.object({
  requirements: z.array(
    z.object({
      skill: z.string(),
      kind: z.enum(["must", "nice"]),
      years_min: z.number().nullable(),
      source_sentence: z.string().describe("The exact sentence or bullet from the job description, verbatim"),
    }),
  ),
});

const JD_SYSTEM = `You extract technical skill requirements from job descriptions.

For each distinct skill/technology/technique the role asks for:
- kind = "must" if the posting requires it, "nice" if it is preferred, a bonus, or "familiarity/exposure".
- years_min = minimum years of experience if stated for that skill, else null.
- source_sentence = the sentence or bullet that asks for it, copied verbatim.
Ignore the company description, benefits and legal text. Use common canonical names (e.g. "PyTorch", "Object Detection", "REST APIs").`;

/**
 * Rule-based extraction, unioned with Claude's when available. LLM requirements are kept only if
 * the skill maps to the taxonomy and the source sentence really appears in the JD.
 */
export async function extractRequirements(jdText: string): Promise<{ requirements: RequirementDraft[]; usedLlm: boolean }> {
  const rules = extractRequirementsRules(jdText);
  const { value, usedLlm } = await withFallback(
    "jd-extraction",
    () => structured({
        label: "jd-extraction", tier: "extraction", system: JD_SYSTEM, input: jdText, schema: LlmRequirements }),
    () => ({ requirements: [] }),
  );
  const found = new Map(rules.map((r) => [r.skill, r]));
  const haystack = jdText.replace(/\s+/g, " ").toLowerCase();
  for (const r of value.requirements) {
    const skill = taxonomy.normalize(r.skill);
    const sentence = r.source_sentence.replace(/\s+/g, " ").trim();
    if (!skill || !haystack.includes(sentence.toLowerCase().slice(0, 80))) continue;
    // The model only adds skills the rules missed; it never overrides the rules' must/nice reading
    // (measured: letting it upgrade nice→must broke "A or B" alternatives and lowered accuracy).
    if (!found.has(skill)) found.set(skill, { skill, kind: r.kind, yearsMin: r.years_min, sourceSentence: sentence });
  }
  return { requirements: [...found.values()], usedLlm };
}

/** Best-effort title/company from a pasted JD when the user didn't provide them. */
export function guessTitle(jdText: string): string {
  const first = cleanText(jdText).split("\n").find((l) => l.length > 3 && l.length < 90 && !headingOf(l));
  return (first ?? "Untitled role").replace(/^(job title|title|role|position)\s*:\s*/i, "").replace(/[#*]/g, "").trim();
}
