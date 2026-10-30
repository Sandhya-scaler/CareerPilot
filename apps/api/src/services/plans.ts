import { generatePlan, type GapInput } from "../coach/plan.js";
import { generateQuestions } from "../coach/questions.js";
import { one, query, tx } from "../db/pool.js";
import { HttpError, notFound } from "../http.js";
import { skillId } from "../skills/repo.js";
import { draftFromText, evidenceForUser, insertEvidence } from "./evidence.js";
import { getMarketMap } from "./market.js";

/** Coach Agent core: plan + practice questions from a market map's ranked gaps. */
export async function createPlanFromMarket(userId: string, marketMapId: string, opts: { hoursPerWeek: number; weeks: number }) {
  const market = await getMarketMap(userId, marketMapId);
  const gaps: GapInput[] = market.gaps.map((g) => ({
    skill: g.skill,
    evidenceScore: g.evidenceScore,
    evidenceTier: g.evidenceTier,
    via: g.via,
    learnability: g.learnability,
    sampleSentence: g.sampleSentence,
    frequency: g.frequency,
  }));
  const plan = await generatePlan({ role: market.role, hoursPerWeek: opts.hoursPerWeek, weeks: opts.weeks, gaps });
  const evidence = await evidenceForUser(userId);
  const qs = await generateQuestions({ role: market.role, gaps, evidence });

  return tx(async (c) => {
    await c.query("UPDATE plans SET status = 'archived' WHERE user_id = $1 AND status = 'active'", [userId]);
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO plans (user_id, market_map_id, role, start_date, weeks, hours_per_week, generated_by)
       VALUES ($1, $2, $3, current_date, $4, $5, $6) RETURNING id`,
      [userId, marketMapId, market.role, opts.weeks, opts.hoursPerWeek, plan.generatedBy],
    );
    const planId = rows[0]!.id;
    for (const [i, t] of plan.tasks.entries()) {
      await c.query(
        `INSERT INTO plan_tasks (plan_id, week, position, skill_id, type, title, detail, resource_url, est_hours, proof_artifact)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [planId, t.week, i, t.skill ? await skillId(t.skill) : null, t.type, t.title, t.detail, t.resourceUrl, t.estHours, t.proofArtifact],
      );
    }
    for (const q of qs.questions) {
      await c.query(
        `INSERT INTO questions (user_id, plan_id, skill_id, kind, prompt, rubric, grounding, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, clock_timestamp())`,
        [userId, planId, q.skill ? await skillId(q.skill) : null, q.kind, q.prompt, JSON.stringify(q.rubric), q.grounding],
      );
    }
    return planId;
  });
}

export async function getPlan(userId: string, planId: string) {
  const plan = await one(
    `SELECT id, market_map_id, role, start_date, weeks, hours_per_week, status, generated_by, created_at
     FROM plans WHERE id = $1 AND user_id = $2`,
    [planId, userId],
  );
  if (!plan) throw notFound("plan");
  const tasks = await query(
    `SELECT t.id, t.week, t.position, s.canonical_name AS skill, t.type, t.title, t.detail, t.resource_url, t.est_hours,
            t.proof_artifact, t.status, t.proof, t.evidence_id, t.completed_at
     FROM plan_tasks t LEFT JOIN skills s ON s.id = t.skill_id WHERE t.plan_id = $1 ORDER BY t.week, t.position`,
    [planId],
  );
  const questions = await query(
    `SELECT q.id, s.canonical_name AS skill, q.kind, q.prompt, q.rubric, q.grounding
     FROM questions q LEFT JOIN skills s ON s.id = q.skill_id WHERE q.plan_id = $1 ORDER BY q.created_at, q.id`,
    [planId],
  );
  const done = tasks.filter((t) => t.status === "done").length;
  return { ...plan, progress: tasks.length ? done / tasks.length : 0, tasks, questions };
}

export async function activePlan(userId: string) {
  const p = await one<{ id: string }>(
    "SELECT id FROM plans WHERE user_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    [userId],
  );
  return p ? getPlan(userId, p.id) : null;
}

/**
 * Updates a task. Completing a build/prove task with proof (a link or a description with an
 * outcome) records it as evidence, which is how the plan raises the user's evidence tiers.
 */
export async function updateTask(userId: string, taskId: string, patch: { status: "todo" | "doing" | "done" | "skipped"; proof?: string }) {
  const task = await one<{ id: string; type: string; skill: string | null; title: string; evidence_id: string | null }>(
    `SELECT t.id, t.type, s.canonical_name AS skill, t.title, t.evidence_id
     FROM plan_tasks t JOIN plans p ON p.id = t.plan_id LEFT JOIN skills s ON s.id = t.skill_id
     WHERE t.id = $1 AND p.user_id = $2`,
    [taskId, userId],
  );
  if (!task) throw notFound("task");
  const needsProof = patch.status === "done" && (task.type === "build" || task.type === "prove");
  if (needsProof && !patch.proof?.trim()) {
    throw new HttpError(422, "add proof (a link or a sentence with the result) to complete this task");
  }

  return tx(async (c) => {
    let evidenceId = task.evidence_id;
    if (needsProof && task.skill && !evidenceId) {
      const draft = draftFromText(patch.proof!.trim(), "plan", task.title, [task.skill]);
      evidenceId = (await insertEvidence(c, userId, null, "plan", [draft], true))[0] ?? null;
    }
    if (patch.status !== "done" && evidenceId) {
      await c.query("DELETE FROM evidence_items WHERE id = $1 AND user_id = $2", [evidenceId, userId]);
      evidenceId = null;
    }
    const { rows } = await c.query(
      `UPDATE plan_tasks SET status = $2, proof = COALESCE($3, proof), evidence_id = $4,
         completed_at = CASE WHEN $2 = 'done' THEN COALESCE(completed_at, now()) ELSE NULL END
       WHERE id = $1 RETURNING id, status, proof, evidence_id, completed_at`,
      [taskId, patch.status, patch.proof ?? null, evidenceId],
    );
    return rows[0];
  });
}

export async function listQuestions(userId: string, opts: { skill?: string; limit?: number } = {}) {
  return query(
    `SELECT q.id, s.canonical_name AS skill, q.kind, q.prompt, q.rubric, q.grounding, q.created_at
     FROM questions q LEFT JOIN skills s ON s.id = q.skill_id
     WHERE q.user_id = $1 AND ($2::text IS NULL OR s.canonical_name = $2)
     ORDER BY q.created_at DESC LIMIT $3`,
    [userId, opts.skill ?? null, opts.limit ?? 50],
  );
}
