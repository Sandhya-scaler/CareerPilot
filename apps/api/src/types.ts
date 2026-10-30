/** Evidence tiers (docs/02-product-spec.md): 0 none, 1 claimed, 2 applied, 3 demonstrated, 4 verified. */
export type Tier = 0 | 1 | 2 | 3 | 4;
export const TIER_WEIGHT: Record<Tier, number> = { 0: 0, 1: 0.3, 2: 0.6, 3: 0.85, 4: 1 };
export const TIER_LABEL: Record<Tier, string> = { 0: "none", 1: "claimed", 2: "applied", 3: "demonstrated", 4: "verified" };

export type ResumeSection =
  | "header" | "summary" | "education" | "experience" | "projects" | "skills" | "certifications"
  | "achievements" | "publications" | "leadership" | "coursework" | "other";

export interface EvidenceDraft {
  section: ResumeSection | "github" | "manual" | "assessment" | "plan";
  /** Project / job / org the line belongs to. */
  context: string | null;
  text: string;
  tier: Tier;
  skills: string[];
  metrics: string[];
  links: string[];
}

export interface ParsedResume {
  name: string | null;
  email: string | null;
  links: string[];
  sections: { name: ResumeSection; heading: string; lines: string[] }[];
  evidence: EvidenceDraft[];
}

export type RequirementKind = "must" | "nice";

export interface RequirementDraft {
  skill: string;
  kind: RequirementKind;
  yearsMin: number | null;
  sourceSentence: string;
}
