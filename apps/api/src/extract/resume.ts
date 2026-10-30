import { z } from "zod";
import { structured, withFallback } from "../llm.js";
import { taxonomy } from "../skills/taxonomy.js";
import type { EvidenceDraft, ParsedResume, ResumeSection, Tier } from "../types.js";
import { BULLET_RE, findLinks, findMetrics, hasShippedSignal, logicalLines, stripBullet } from "./text.js";

const SECTION_PATTERNS: [ResumeSection, RegExp][] = [
  ["summary", /^(professional\s+)?(summary|profile|objective|about( me)?|career objective)$/i],
  ["education", /^(education|academic (background|details|qualifications?)|academics|qualifications?)$/i],
  ["experience", /^((work|professional|industry|relevant)\s+)?(experience|employment( history)?|work history|internships?|internship experience)$/i],
  ["projects", /^((academic|personal|key|selected|technical|major)\s+)?projects?( experience| work)?$/i],
  ["skills", /^((technical|key|core|relevant)\s+)?(skills|skill set|skills (&|and) (tools|interests|technologies)|technologies|tech stack|tools (&|and) technologies|competencies)$/i],
  ["certifications", /^(certifications?|certificates?|licenses?( (&|and) certifications)?|courses?( (&|and) certifications)?|online courses)$/i],
  ["achievements", /^(achievements?|awards?( (&|and) (honou?rs|achievements))?|honou?rs( (&|and) awards)?|accomplishments|competitions|hackathons)$/i],
  ["publications", /^(publications?|research( experience| papers)?|papers)$/i],
  ["leadership", /^(leadership|positions? of responsibility|extra[- ]?curricular( activities)?|volunteer(ing)?( experience)?|activities)$/i],
  ["coursework", /^(relevant )?coursework$/i],
];

export function sectionOf(line: string): ResumeSection | null {
  const l = line.replace(/[:|•\-–—_=*#]+$/g, "").replace(/^[#*\s]+/, "").trim();
  if (l.length > 48 || l.length < 3) return null;
  for (const [name, re] of SECTION_PATTERNS) if (re.test(l)) return name;
  return null;
}

const DATE_RE = /\b(19|20)\d{2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*['’]?\d{2,4}|present|current/i;

/**
 * A "title" line inside experience/projects heads a group of bullets: short, not a bullet,
 * not a sentence (often has dates, "|" or an org name).
 */
function isTitleLine(line: string): boolean {
  if (BULLET_RE.test(line)) return false;
  if (line.length > 110) return false;
  if (/[.!?]$/.test(line) && !DATE_RE.test(line)) return false;
  return DATE_RE.test(line) || /[|–—@]/.test(line) || line.split(" ").length <= 9;
}

function groupByTitle(lines: string[]): { title: string | null; lines: string[] }[] {
  const groups: { title: string | null; lines: string[] }[] = [];
  for (const line of lines) {
    if (isTitleLine(line) || groups.length === 0) groups.push({ title: isTitleLine(line) ? line : null, lines: [line] });
    else groups[groups.length - 1]!.lines.push(line);
  }
  return groups;
}

function tierFor(section: ResumeSection, text: string, groupStrong: boolean, links: string[]): Tier {
  switch (section) {
    case "skills":
      // "DSA: solved 400+ LeetCode problems" is more than a bare claim.
      return findMetrics(text).length > 0 ? 2 : 1;
    case "summary":
    case "coursework":
    case "education":
      return 1;
    case "certifications":
      return 2;
    default: {
      const strong = findMetrics(text).length > 0 || links.length > 0 || hasShippedSignal(text);
      return strong || groupStrong ? 3 : 2;
    }
  }
}

/** Rule-based resume parser: sections -> logical lines -> evidence items with skills and tiers. */
export function parseResumeRules(text: string): ParsedResume {
  const raw = text.split("\n");
  const lines = logicalLines(raw, (l) => sectionOf(l) !== null);

  const sections: ParsedResume["sections"] = [{ name: "header", heading: "", lines: [] }];
  for (const line of lines) {
    const s = sectionOf(line);
    if (s) sections.push({ name: s, heading: line, lines: [] });
    else sections[sections.length - 1]!.lines.push(line);
  }

  const header = sections[0]!.lines;
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? null;
  const name =
    header
      .map((l) => l.split(/[|·•,]/)[0]!.trim())
      .find((l) => !l.includes("@") && !/\d{5,}/.test(l) && /^[A-Za-z][A-Za-z .'-]{2,40}$/.test(l)) ?? null;

  const evidence: EvidenceDraft[] = [];
  for (const sec of sections) {
    if (sec.name === "header") continue;
    const grouped = sec.name === "experience" || sec.name === "projects" || sec.name === "leadership";
    for (const group of grouped ? groupByTitle(sec.lines) : sec.lines.map((l) => ({ title: null, lines: [l] }))) {
      // A project/job with a public link is demonstrated as a whole: every bullet in it is checkable.
      // A title like "Lane Detection | Python, OpenCV" is itself evidence, demonstrated if any bullet has an outcome.
      const groupLinked = group.lines.some((l) => findLinks(l).length > 0);
      const groupOutcome = group.lines.some((l) => findMetrics(l).length > 0 || hasShippedSignal(l));
      for (const line of group.lines) {
        const isTitle = line === group.title;
        const textLine = stripBullet(line);
        const links = findLinks(textLine);
        // URLs are evidence links, not skill mentions ("github.com/..." is not Git experience).
        const prose = links.reduce((t, l) => t.replace(l, " "), textLine);
        const skills = taxonomy
          .findInText(prose)
          .map((m) => m.skill)
          // Degree names ("Electronics and Communication Engineering") aren't soft-skill evidence.
          .filter((sk) => !(sec.name === "education" && taxonomy.category(sk) === "soft"));
        const metrics = findMetrics(textLine);
        if (skills.length === 0) continue; // nothing to anchor a claim to
        evidence.push({
          section: sec.name,
          context: isTitle ? null : group.title,
          text: textLine,
          tier: tierFor(sec.name, textLine, groupLinked || (isTitle && groupOutcome), links),
          skills,
          metrics,
          links,
        });
      }
    }
  }
  return { name, email, links: findLinks(text), sections, evidence };
}

const LlmEvidence = z.object({
  items: z.array(
    z.object({
      line: z.string().describe("The resume line, copied verbatim"),
      skills: z.array(z.string()).describe("Technical skills this line directly demonstrates"),
    }),
  ),
});

const RESUME_SYSTEM = `You tag resume lines with the technical skills they directly demonstrate.

Rules:
- Only tag a skill when the line itself shows it being used or named (e.g. "trained a ResNet-50" demonstrates CNNs and Deep Learning).
- Never infer skills from job titles, company names, or general impressions.
- Copy each line verbatim from the resume. Skip lines with no technical skill.
- Use common canonical names (PyTorch, Object Detection, REST APIs, PostgreSQL).`;

/**
 * Parses a resume; when Claude is available it adds skills the alias matcher missed, but only on
 * lines that exist verbatim in the resume and only for skills that resolve to the taxonomy.
 */
export async function parseResume(text: string): Promise<ParsedResume & { usedLlm: boolean }> {
  const parsed = parseResumeRules(text);
  const { value, usedLlm } = await withFallback(
    "resume-tagging",
    () => structured({ tier: "extraction", system: RESUME_SYSTEM, input: text, schema: LlmEvidence }),
    () => ({ items: [] }),
  );
  for (const item of value.items) {
    const target = parsed.evidence.find((e) => e.text === item.line.trim() || item.line.includes(e.text));
    if (!target) continue; // not verbatim: ignore rather than invent
    for (const s of item.skills) {
      const canonical = taxonomy.normalize(s);
      if (canonical && !target.skills.includes(canonical)) target.skills.push(canonical);
    }
  }
  return { ...parsed, usedLlm };
}
