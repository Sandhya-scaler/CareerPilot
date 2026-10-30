import { z } from "zod";
import { groupByTitle } from "../extract/resume.js";
import { BULLET_RE, stripBullet } from "../extract/text.js";
import { structured, withFallback } from "../llm.js";
import { taxonomy } from "../skills/taxonomy.js";
import type { ParsedResume, RequirementKind, ResumeSection } from "../types.js";
import { checkGrounding } from "./grounding.js";

export type ResumeContent = Pick<ParsedResume, "name" | "email" | "links" | "sections">;

export interface TailorEdit {
  op: "move_section" | "reorder_projects" | "reorder_bullets" | "reorder_skills" | "rephrase" | "rejected_rephrase";
  section: string;
  before: string;
  after: string;
  reason: string;
}

export interface TailorRequirement {
  skill: string;
  kind: RequirementKind;
  sourceSentence: string;
}

/** Weight of a line for this JD: must-have skills 1, nice 0.5; a skill also counts for its parents. */
export function lineRelevance(line: string, reqs: Map<string, RequirementKind>): { score: number; matched: string[] } {
  const matched = new Set<string>();
  for (const m of taxonomy.findInText(line)) {
    if (reqs.has(m.skill)) matched.add(m.skill);
    for (const [skill] of reqs) if (taxonomy.descendants(skill).includes(m.skill)) matched.add(skill);
  }
  let score = 0;
  for (const s of matched) score += reqs.get(s) === "must" ? 1 : 0.5;
  return { score, matched: [...matched] };
}

const stableSortDesc = <T>(xs: T[], key: (x: T) => number) =>
  xs.map((x, i) => ({ x, i, k: key(x) })).sort((a, b) => b.k - a.k || a.i - b.i).map((e) => e.x);

const why = (matched: string[]) => (matched.length ? `matches ${matched.slice(0, 4).join(", ")} from the job description` : "less relevant to this job");

/**
 * Deterministic tailoring: only reorders. Nothing is added, removed or reworded, so it is
 * grounded by construction. Every move is recorded with the JD skills that justified it.
 */
export function reorderForJob(content: ResumeContent, requirements: TailorRequirement[]): { content: ResumeContent; edits: TailorEdit[] } {
  const reqs = new Map<string, RequirementKind>();
  for (const r of requirements) if (reqs.get(r.skill) !== "must") reqs.set(r.skill, r.kind);
  const edits: TailorEdit[] = [];
  const sections = content.sections.map((s) => ({ ...s, lines: [...s.lines] }));

  for (const sec of sections) {
    if (sec.name === "projects" || sec.name === "experience" || sec.name === "leadership") {
      const groups = groupByTitle(sec.lines);
      for (const g of groups) {
        const head = g.title ? [g.lines[0]!] : [];
        const bullets = g.title ? g.lines.slice(1) : g.lines;
        const sorted = stableSortDesc(bullets, (b) => lineRelevance(b, reqs).score);
        if (sorted.some((b, i) => b !== bullets[i])) {
          const top = sorted[0]!;
          edits.push({ op: "reorder_bullets", section: sec.heading, before: stripBullet(bullets[0]!), after: stripBullet(top), reason: `Moved up: ${why(lineRelevance(top, reqs).matched)}` });
        }
        g.lines = [...head, ...sorted];
      }
      // Projects are reordered by relevance; jobs keep chronological order (recruiters expect it).
      let ordered = groups;
      if (sec.name === "projects") {
        ordered = stableSortDesc(groups, (g) => g.lines.reduce((s, l) => s + lineRelevance(l, reqs).score, 0));
        if (ordered.some((g, i) => g !== groups[i]) && ordered[0]!.title) {
          edits.push({
            op: "reorder_projects",
            section: sec.heading,
            before: groups[0]!.title ?? "",
            after: ordered[0]!.title,
            reason: `Most relevant project first: ${why(lineRelevance(ordered[0]!.lines.join(" "), reqs).matched)}`,
          });
        }
      }
      sec.lines = ordered.flatMap((g) => g.lines);
    }

    if (sec.name === "skills") {
      sec.lines = sec.lines.map((line) => {
        const m = /^([^:]{2,40}):\s*(.+)$/.exec(stripBullet(line));
        const label = m ? `${m[1]}: ` : "";
        const items = (m ? m[2]! : stripBullet(line)).split(/\s*,\s*/);
        if (items.length < 3) return line;
        const sorted = stableSortDesc(items, (it) => lineRelevance(it, reqs).score);
        if (sorted.every((it, i) => it === items[i])) return line;
        const prefix = BULLET_RE.exec(line)?.[0] ?? "";
        const after = `${prefix}${label}${sorted.join(", ")}`;
        edits.push({ op: "reorder_skills", section: sec.heading, before: line, after, reason: "Skills the job asks for listed first" });
        return after;
      });
    }
  }

  // For student resumes, put Projects above Experience when projects match the job better.
  const score = (name: ResumeSection) =>
    sections.filter((s) => s.name === name).reduce((sum, s) => sum + s.lines.reduce((a, l) => a + lineRelevance(l, reqs).score, 0), 0);
  const pi = sections.findIndex((s) => s.name === "projects");
  const ei = sections.findIndex((s) => s.name === "experience");
  if (pi > ei && ei >= 0 && score("projects") > score("experience") * 1.5) {
    const [proj] = sections.splice(pi, 1);
    sections.splice(ei, 0, proj!);
    edits.push({ op: "move_section", section: proj!.heading, before: `${sections[ei + 1]!.heading} first`, after: `${proj!.heading} first`, reason: "Your projects match this job better than your work experience" });
  }

  return { content: { ...content, sections }, edits };
}

const Rephrase = z.object({
  rewrites: z.array(z.object({
    original: z.string().describe("The bullet, verbatim"),
    rewritten: z.string(),
  })),
});

const REPHRASE_SYSTEM = `You tailor resume bullets to a job description without changing facts.

Rules (strict):
- Keep every fact, number and tool exactly as stated. Never add a tool, metric, scale, team size or outcome that is not in the original bullet.
- You may: use the job's terminology for things the bullet already describes, lead with the result, tighten wording, use a strong accurate verb.
- Do not upgrade claims (e.g. "built" must not become "deployed to production"; "helped" must not become "led").
- Keep each bullet to one line (under 30 words). Return only bullets you actually improved.`;

/** Optional Claude rephrasing; every rewrite must pass the grounding check or it is rejected (and logged). */
export async function rephraseForJob(
  content: ResumeContent,
  requirements: TailorRequirement[],
  userSkills: Set<string>,
): Promise<{ content: ResumeContent; edits: TailorEdit[]; usedLlm: boolean }> {
  const reqs = new Map(requirements.map((r) => [r.skill, r.kind] as const));
  const candidates = content.sections
    .filter((s) => s.name === "experience" || s.name === "projects")
    .flatMap((s) => s.lines.filter((l) => BULLET_RE.test(l)).map((l) => ({ section: s.heading, line: l, rel: lineRelevance(l, reqs).score })))
    .filter((c) => c.rel > 0)
    .sort((a, b) => b.rel - a.rel)
    .slice(0, 6);
  if (candidates.length === 0) return { content, edits: [], usedLlm: false };

  const { value, usedLlm } = await withFallback(
    "rephrase",
    () => structured({
        label: "rephrase",
      tier: "reasoning",
      system: REPHRASE_SYSTEM,
      input: JSON.stringify({
        job_requirements: requirements.filter((r) => r.kind === "must").slice(0, 12).map((r) => r.sourceSentence),
        bullets: candidates.map((c) => stripBullet(c.line)),
      }),
      schema: Rephrase,
      effort: "low",
    }),
    () => ({ rewrites: [] }),
  );

  const edits: TailorEdit[] = [];
  const sections = content.sections.map((s) => ({ ...s, lines: [...s.lines] }));
  for (const r of value.rewrites) {
    const cand = candidates.find((c) => stripBullet(c.line) === r.original.trim());
    if (!cand || r.rewritten.trim() === r.original.trim()) continue;
    const g = checkGrounding(r.original, r.rewritten, userSkills);
    if (!g.ok) {
      edits.push({ op: "rejected_rephrase", section: cand.section, before: r.original, after: r.rewritten, reason: `Rejected by grounding check: ${g.violations.join("; ")}` });
      continue;
    }
    const sec = sections.find((s) => s.heading === cand.section)!;
    const idx = sec.lines.indexOf(cand.line);
    const prefix = BULLET_RE.exec(cand.line)?.[0] ?? "• ";
    sec.lines[idx] = `${prefix}${r.rewritten.trim()}`;
    edits.push({ op: "rephrase", section: cand.section, before: r.original, after: r.rewritten.trim(), reason: "Uses the job's wording; facts unchanged (grounding check passed)" });
  }
  return { content: { ...content, sections }, edits, usedLlm };
}

export function renderText(content: ResumeContent): string {
  const out: string[] = [];
  for (const s of content.sections) {
    if (s.name !== "header") out.push("", s.heading);
    out.push(...s.lines);
  }
  return out.join("\n").trim();
}

/** Line-level LCS diff for the version comparison view. */
export function diffLines(a: string[], b: string[]): { op: "same" | "add" | "del"; text: string }[] {
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: { op: "same" | "add" | "del"; text: string }[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) (out.push({ op: "same", text: a[i]! }), i++, j++);
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) out.push({ op: "del", text: a[i++]! });
    else out.push({ op: "add", text: b[j++]! });
  }
  while (i < n) out.push({ op: "del", text: a[i++]! });
  while (j < m) out.push({ op: "add", text: b[j++]! });
  return out;
}
