import { z } from "zod";
import { structured, withFallback } from "../llm.js";
import { taxonomy } from "../skills/taxonomy.js";
import { RESOURCES, projectFor } from "./resources.js";

export type TaskType = "learn" | "build" | "prove" | "practice";

export interface PlanTaskDraft {
  week: number;
  skill: string | null;
  type: TaskType;
  title: string;
  detail: string;
  resourceUrl: string | null;
  estHours: number;
  proofArtifact: string | null;
}

export interface GapInput {
  skill: string;
  evidenceScore: number;
  evidenceTier: number | null;
  via: string;
  learnability: "days" | "weeks" | "months";
  sampleSentence: string | null;
  frequency: number;
}

export interface PlanInput {
  role: string;
  hoursPerWeek: number;
  weeks: number;
  gaps: GapInput[];
}

const HOURS: Record<GapInput["learnability"], { learn: number; build: number }> = {
  days: { learn: 3, build: 5 },
  weeks: { learn: 5, build: 8 },
  months: { learn: 8, build: 12 },
};

/**
 * Turns ranked gaps into tasks:
 *   - nothing / claimed only → learn + build (+ prove)
 *   - applied (tier 2)       → prove: add an outcome or a public link
 * Every build/prove task names the evidence it produces, so finishing it upgrades the profile.
 */
export function tasksForGap(g: GapInput, role: string): Omit<PlanTaskDraft, "week">[] {
  const res = RESOURCES[g.skill];
  const h = HOURS[g.learnability];
  const asks = g.sampleSentence ? ` Employers ask: "${g.sampleSentence}"` : "";
  if ((g.evidenceTier ?? 0) >= 2 && g.via === "direct") {
    return [{
      skill: g.skill,
      type: "prove",
      title: `Make your ${g.skill} work demonstrable`,
      detail: `You've used ${g.skill}, but there's no outcome or link yet. Add a measurable result (accuracy, latency, users, time saved) or publish the code/demo, then update the resume bullet.${asks}`,
      resourceUrl: null,
      estHours: 2,
      proofArtifact: "Resume bullet with a number or a public link",
    }];
  }
  return [
    {
      skill: g.skill,
      type: "learn",
      title: `Learn ${g.skill} fundamentals`,
      detail: `${res ? `Work through "${res.name}".` : `Work through the official ${g.skill} documentation.`} Focus on what ${role} postings ask for.${asks}`,
      resourceUrl: res?.url ?? null,
      estHours: h.learn,
      proofArtifact: null,
    },
    {
      skill: g.skill,
      type: "build",
      title: `Build: ${g.skill} mini-project`,
      detail: projectFor(g.skill, role),
      resourceUrl: null,
      estHours: h.build,
      proofArtifact: "GitHub repo with a README showing results",
    },
  ];
}

/**
 * Greedy week-by-week scheduler: highest-priority gaps first, never exceeding the weekly budget
 * (a task larger than the budget gets a week to itself). The final week is interview practice
 * when the plan is 3+ weeks long.
 */
export function schedule(tasks: Omit<PlanTaskDraft, "week">[], hoursPerWeek: number, weeks: number): PlanTaskDraft[] {
  const practiceWeek = weeks >= 3 ? weeks : null;
  const lastWorkWeek = practiceWeek ? weeks - 1 : weeks;
  const out: PlanTaskDraft[] = [];
  let week = 1;
  let used = 0;
  for (const t of tasks) {
    if (used > 0 && used + t.estHours > hoursPerWeek) {
      week++;
      used = 0;
    }
    if (week > lastWorkWeek) break;
    out.push({ ...t, week });
    used += t.estHours;
  }
  if (practiceWeek) {
    const practiced = [...new Set(out.map((t) => t.skill).filter(Boolean))].slice(0, 4).join(", ");
    out.push({
      week: practiceWeek,
      skill: null,
      type: "practice",
      title: "Mock interviews on this plan's skills",
      detail: `Do two mock interviews in CareerPilot covering ${practiced || "your target role"}. Re-do any question scored below 3/5.`,
      resourceUrl: null,
      estHours: Math.min(4, hoursPerWeek),
      proofArtifact: null,
    });
  }
  return out;
}

export function rulePlan(input: PlanInput): PlanTaskDraft[] {
  const technical = input.gaps.filter((g) => taxonomy.category(g.skill) !== "soft").slice(0, 8);
  return schedule(technical.flatMap((g) => tasksForGap(g, input.role)), input.hoursPerWeek, input.weeks);
}

const LlmPlan = z.object({
  tasks: z.array(
    z.object({
      week: z.number().int(),
      skill: z.string().nullable(),
      type: z.enum(["learn", "build", "prove", "practice"]),
      title: z.string(),
      detail: z.string(),
      est_hours: z.number(),
      proof_artifact: z.string().nullable(),
    }),
  ),
});

const PLAN_SYSTEM = `You are a pragmatic career coach writing a week-by-week preparation plan.

Rules:
- Only plan for the skill gaps provided, in priority order. Do not invent requirements.
- Each week's est_hours must sum to at most the weekly budget.
- Prefer "build" tasks that produce public proof (repo, demo, write-up); every build/prove task states its proof_artifact.
- For gaps where the person already has applied evidence, use a short "prove" task (add outcome or link) instead of re-learning.
- Make project ideas specific to the target role and realistic for the hours given.
- If the plan has 3+ weeks, the last week is interview practice.`;

/** Plan via Claude (reasoning tier), validated and re-scheduled; rule-based on any failure. */
export async function generatePlan(input: PlanInput): Promise<{ tasks: PlanTaskDraft[]; generatedBy: "llm" | "rules" }> {
  const { value, usedLlm } = await withFallback(
    "plan",
    async () => {
      const out = await structured({
        label: "plan",
        tier: "reasoning",
        system: PLAN_SYSTEM,
        input: JSON.stringify({
          target_role: input.role,
          weekly_hours: input.hoursPerWeek,
          weeks: input.weeks,
          gaps: input.gaps.slice(0, 8).map((g) => ({
            skill: g.skill,
            current_evidence: g.evidenceTier ? `tier ${g.evidenceTier}` : "none",
            share_of_postings: `${Math.round(g.frequency * 100)}%`,
            employer_wording: g.sampleSentence,
          })),
        }),
        schema: LlmPlan,
        effort: "medium",
      });
      const allowed = new Set(input.gaps.map((g) => g.skill));
      const tasks = out.tasks
        .filter((t) => t.type === "practice" || (t.skill && allowed.has(t.skill)))
        .map((t) => ({
          skill: t.skill && allowed.has(t.skill) ? t.skill : null,
          type: t.type,
          title: t.title.slice(0, 160),
          detail: t.detail.slice(0, 1200),
          resourceUrl: t.skill ? (RESOURCES[t.skill]?.url ?? null) : null,
          estHours: Math.max(1, Math.min(t.est_hours, input.hoursPerWeek)),
          proofArtifact: t.proof_artifact,
          week: t.week,
        }));
      if (tasks.length < 2) throw new Error("plan too small");
      // Re-schedule non-practice tasks with our budget-respecting scheduler.
      return schedule(tasks.filter((t) => t.type !== "practice"), input.hoursPerWeek, input.weeks);
    },
    () => rulePlan(input),
  );
  return { tasks: value, generatedBy: usedLlm ? "llm" : "rules" };
}
