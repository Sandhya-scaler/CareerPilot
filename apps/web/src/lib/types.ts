export type Tier = 0 | 1 | 2 | 3 | 4;

export interface Me {
  id: string;
  email: string;
  name: string | null;
  target_role: string | null;
  location: string | null;
  hours_per_week: number;
  email_reports: boolean;
  is_admin: boolean;
}

export interface Evidence {
  id: string;
  source: string;
  section: string;
  context: string | null;
  text: string;
  tier: Tier;
  skills: string[];
  metrics: string[];
  links: string[];
  confirmed: boolean;
}

export interface Requirement {
  id: string;
  skill: string;
  category: string;
  kind: "must" | "nice";
  yearsMin: number | null;
  sourceSentence: string;
}

export interface MatchItem {
  skill: string;
  category: string;
  kind: "must" | "nice";
  importance: number;
  evidence_score: number;
  via: "direct" | "implied" | "adjacent" | "none";
  via_skill: string | null;
  requirement_text: string;
  evidence_text: string | null;
  evidence_tier: Tier | null;
  evidence_context: string | null;
  explanation: string;
  scored: boolean;
}

export interface MatchReport {
  id: string;
  job_id: string;
  coverage: number;
  must_coverage: number;
  summary: string;
  created_at: string;
  job_title: string;
  job_company: string | null;
  items: MatchItem[];
}

export interface Job {
  id: string;
  source: string;
  url: string | null;
  company: string | null;
  title: string;
  location: string | null;
  posted_at: string | null;
  fetched_at: string;
  ghost_risk: number | null;
  ghost_reasons: string[];
  description?: string;
  requirements?: Requirement[];
  requirement_count?: number;
  last_coverage?: number | null;
  latest_report?: MatchReport | null;
}

export interface Gap {
  skill: string;
  priority: number;
  learnability: string;
  frequency: number;
  mustRate: number;
  evidenceScore: number;
  via: string;
  viaSkill: string | null;
  evidenceText: string | null;
  evidenceTier: Tier | null;
  evidenceLabel: string;
  sampleSentence: string | null;
}

export interface MarketMap {
  id: string;
  role: string;
  location: string | null;
  created_at: string;
  jobCount: number;
  readiness: number;
  skills: { skill: string; category: string; frequency: number; mustRate: number; weight: number; jobCount: number; sampleSentence: string | null }[];
  gaps: Gap[];
  jobs: { id: string; title: string; company: string | null; location: string | null; url: string | null; source: string }[];
}

export interface PlanTask {
  id: string;
  week: number;
  skill: string | null;
  type: "learn" | "build" | "prove" | "practice";
  title: string;
  detail: string;
  resource_url: string | null;
  est_hours: number;
  proof_artifact: string | null;
  status: "todo" | "doing" | "done" | "skipped";
  proof: string | null;
  evidence_id: string | null;
}

export interface Question {
  id: string;
  skill: string | null;
  kind: string;
  prompt: string;
  rubric: string[];
  grounding: string | null;
}

export interface Plan {
  id: string;
  role: string;
  start_date: string;
  weeks: number;
  hours_per_week: number;
  generated_by: string;
  progress: number;
  tasks: PlanTask[];
  questions: Question[];
}

export type AppStatus = "saved" | "applied" | "oa" | "interview" | "offer" | "rejected" | "withdrawn";

export interface Application {
  id: string;
  job_id: string;
  resume_version_id: string | null;
  status: AppStatus;
  applied_at: string | null;
  next_followup_at: string | null;
  notes: string;
  title: string;
  company: string | null;
  location: string | null;
  url: string | null;
  coverage: number | null;
  resume_label: string | null;
  updated_at: string;
}

export interface Run {
  id: string;
  status: "running" | "waiting" | "done" | "failed";
  pending: { type: "need_resume"; message: string } | { type: "confirm_evidence"; versionId: string; message: string; evidence: Evidence[] } | null;
  result: { marketMapId: string; planId: string; jobIds: string[]; researchStats: { scanned: number; relevant: number } | null } | null;
  error: string | null;
  events: { id: number; at: string; step: string; message: string }[];
}
