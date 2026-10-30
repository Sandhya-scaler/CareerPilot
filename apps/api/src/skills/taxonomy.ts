import { PARENTS, SKILLS, type Category, type SkillDef } from "./data.js";

export interface SkillMatch {
  skill: string;
  /** Text as it appeared in the source. */
  surface: string;
  index: number;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

// A skill token must not be glued to other word characters. '+' and '#' count as word chars so
// "C" never matches inside "C++"/"C#".
const BEFORE = "(?<![A-Za-z0-9+#])";
const AFTER = "(?![A-Za-z0-9+#])";

// Words that, right before a case-sensitive single-letter skill, mean it isn't the language.
const LETTER_FALSE_PREFIX = /(series|plan|type|grade|vitamin|class|tier|option|section|part)\s+$/i;

export class Taxonomy {
  readonly skills = new Map<string, SkillDef>();
  private aliasToSkill = new Map<string, string>(); // case-insensitive, lower-cased keys
  private exactToSkill = new Map<string, string>(); // case-sensitive
  private ciRegex: RegExp;
  private csRegex: RegExp | null;
  private relatedMap = new Map<string, Set<string>>();
  private childrenMap = new Map<string, Set<string>>();

  constructor(defs: SkillDef[] = SKILLS, parents: Record<string, string[]> = PARENTS) {
    for (const d of defs) {
      if (this.skills.has(d.name)) throw new Error(`duplicate skill ${d.name}`);
      this.skills.set(d.name, d);
      const exact = (d.aliases ?? []).filter((a) => a.startsWith("=")).map((a) => a.slice(1));
      const nameIsCaseSensitive = exact.some((e) => e.toLowerCase() === d.name.toLowerCase());
      for (const e of exact) this.exactToSkill.set(e, d.name);
      const ci = (d.aliases ?? []).filter((a) => !a.startsWith("="));
      if (!nameIsCaseSensitive) ci.push(d.name);
      for (const a of ci) {
        const k = norm(a);
        const prev = this.aliasToSkill.get(k);
        if (prev && prev !== d.name) throw new Error(`alias "${a}" maps to both ${prev} and ${d.name}`);
        this.aliasToSkill.set(k, d.name);
      }
    }
    // Related is symmetric.
    for (const d of defs) {
      for (const r of d.related ?? []) {
        if (!this.skills.has(r)) throw new Error(`${d.name} relates to unknown skill ${r}`);
        this.link(d.name, r);
      }
    }
    for (const [child, ps] of Object.entries(parents)) {
      if (!this.skills.has(child)) throw new Error(`PARENTS: unknown skill ${child}`);
      for (const p of ps) {
        if (!this.skills.has(p)) throw new Error(`PARENTS: ${child} -> unknown skill ${p}`);
        if (!this.childrenMap.has(p)) this.childrenMap.set(p, new Set());
        this.childrenMap.get(p)!.add(child);
      }
    }
    const byLength = (xs: string[]) => xs.sort((a, b) => b.length - a.length).map(escape).map((a) => a.replace(/ /g, "\\s+"));
    this.ciRegex = new RegExp(`${BEFORE}(${byLength([...this.aliasToSkill.keys()]).join("|")})${AFTER}`, "gi");
    const cs = [...this.exactToSkill.keys()];
    this.csRegex = cs.length ? new RegExp(`${BEFORE}(${byLength(cs).join("|")})${AFTER}`, "g") : null;
  }

  private link(a: string, b: string) {
    if (a === b) return;
    if (!this.relatedMap.has(a)) this.relatedMap.set(a, new Set());
    if (!this.relatedMap.has(b)) this.relatedMap.set(b, new Set());
    this.relatedMap.get(a)!.add(b);
    this.relatedMap.get(b)!.add(a);
  }

  get(name: string) {
    return this.skills.get(name);
  }

  category(name: string): Category | undefined {
    return this.skills.get(name)?.category;
  }

  related(name: string): string[] {
    return [...(this.relatedMap.get(name) ?? [])];
  }

  /** Skills whose evidence implies this one (transitively): OpenCV and YOLO imply Computer Vision. */
  descendants(name: string): string[] {
    const out = new Set<string>();
    const stack = [...(this.childrenMap.get(name) ?? [])];
    while (stack.length) {
      const c = stack.pop()!;
      if (out.has(c) || c === name) continue;
      out.add(c);
      stack.push(...(this.childrenMap.get(c) ?? []));
    }
    return [...out];
  }

  /** Every alias for a skill (for display / grounding checks). */
  aliasesOf(name: string): string[] {
    const out = [name];
    for (const [a, s] of this.aliasToSkill) if (s === name) out.push(a);
    for (const [a, s] of this.exactToSkill) if (s === name) out.push(a);
    return [...new Set(out)];
  }

  /** Exact alias lookup for a raw skill string (e.g. from an LLM). */
  normalize(raw: string): string | undefined {
    const trimmed = raw.trim();
    const exact = this.exactToSkill.get(trimmed);
    if (exact) return exact;
    const k = norm(trimmed);
    return (
      this.aliasToSkill.get(k) ??
      this.aliasToSkill.get(k.replace(/[()]/g, "").trim()) ??
      // "PyTorch (deep learning)" -> try the head before a parenthetical / slash
      this.aliasToSkill.get(norm(trimmed.split(/[(/,]/)[0] ?? ""))
    );
  }

  /** All skill mentions in a text, ordered by position, first mention per skill. */
  findInText(text: string): SkillMatch[] {
    const found = new Map<string, SkillMatch>();
    const add = (skill: string, surface: string, index: number) => {
      const prev = found.get(skill);
      if (!prev || index < prev.index) found.set(skill, { skill, surface, index });
    };
    for (const m of text.matchAll(this.ciRegex)) {
      const skill = this.aliasToSkill.get(norm(m[1]!));
      if (skill) add(skill, m[1]!, m.index!);
    }
    if (this.csRegex) {
      for (const m of text.matchAll(this.csRegex)) {
        const surface = m[1]!;
        if (surface.length === 1 && LETTER_FALSE_PREFIX.test(text.slice(Math.max(0, m.index! - 12), m.index!))) continue;
        // Single capital letters are only trusted inside skill-ish lists ("Python, R, SQL" / "C/C++").
        if (surface.length === 1 && !looksLikeList(text, m.index!, surface.length)) continue;
        if (surface.length > 1 && looksLikeEnglish(text, m.index!, surface.length)) continue;
        add(this.exactToSkill.get(surface)!, surface, m.index!);
      }
    }
    return [...found.values()].sort((a, b) => a.index - b.index);
  }
}

const TECH_FOLLOWERS = new Set(
  "and or with developer developers engineer engineers experience components apps applications app programming server servers backend frontend hooks code language native ecosystem stack framework projects project modules services routines lang".split(" "),
);

/** "React to incidents", "Go above and beyond", "Express yourself": a sentence-initial word followed by plain prose. */
function looksLikeEnglish(text: string, index: number, len: number) {
  const before = text.slice(Math.max(0, index - 3), index);
  const sentenceStart = index === 0 || /(^|[.!?:;•\n-])\s*$/.test(before);
  if (!sentenceStart) return false;
  const next = /^\s+([a-z]+)/.exec(text.slice(index + len, index + len + 30));
  return Boolean(next && !TECH_FOLLOWERS.has(next[1]!));
}

function looksLikeList(text: string, index: number, len: number) {
  const before = text.slice(Math.max(0, index - 3), index);
  const after = text.slice(index + len, index + len + 3);
  return /[,/|(:•·]\s*$/.test(before) || /^\s*[,/|)]/.test(after) || /\b(in|and|or|using|with)\s+$/i.test(text.slice(Math.max(0, index - 7), index));
}

export const taxonomy = new Taxonomy();
