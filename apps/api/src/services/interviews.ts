import { randomUUID } from "node:crypto";
import { Command } from "@langchain/langgraph";
import { generateQuestions } from "../coach/questions.js";
import { one, query } from "../db/pool.js";
import { interviewGraph, type AskItem } from "../graph/interview.js";
import { HttpError, notFound } from "../http.js";
import { skillId } from "../skills/repo.js";
import { evidenceForUser } from "./evidence.js";
import { jobRequirements } from "./jobs.js";

interface QRow {
  id: string;
  skill: string | null;
  kind: string;
  prompt: string;
  rubric: string[];
}

/** Picks a varied set: JD-grounded, concept, project deep-dive, then behavioral; skills spread out. */
function pickMix(qs: QRow[], count: number): QRow[] {
  const order = ["jd", "concept", "project", "applied", "behavioral"];
  const buckets = order.map((k) => qs.filter((q) => q.kind === k));
  const out: QRow[] = [];
  const usedSkills = new Set<string>();
  for (let round = 0; out.length < count && round < 10; round++) {
    for (const b of buckets) {
      const next = b.find((q) => !out.includes(q) && (!q.skill || !usedSkills.has(q.skill) || round > 1));
      if (next && out.length < count) {
        out.push(next);
        if (next.skill) usedSkills.add(next.skill);
      }
    }
  }
  return out;
}

/** For a job-specific interview, writes questions grounded in that JD's requirements. */
async function questionsForJob(userId: string, jobId: string): Promise<QRow[]> {
  const reqs = await jobRequirements(jobId);
  const evidence = await evidenceForUser(userId);
  const gaps = reqs.filter((r) => r.category !== "soft").sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "must" ? -1 : 1))
    .map((r) => ({ skill: r.skill, sampleSentence: r.sourceSentence }));
  const { questions } = await generateQuestions({ role: "this role", gaps, evidence }, 12);
  const rows: QRow[] = [];
  for (const q of questions) {
    const r = await one<{ id: string }>(
      `INSERT INTO questions (user_id, job_id, skill_id, kind, prompt, rubric, grounding, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, clock_timestamp()) RETURNING id`,
      [userId, jobId, q.skill ? await skillId(q.skill) : null, q.kind, q.prompt, JSON.stringify(q.rubric), q.grounding],
    );
    rows.push({ id: r!.id, skill: q.skill, kind: q.kind, prompt: q.prompt, rubric: q.rubric });
  }
  return rows;
}

async function sessionState(userId: string, sessionId: string) {
  const session = await one<{ id: string; status: string; job_id: string | null; summary: unknown; started_at: string }>(
    "SELECT id, status, job_id, summary, started_at FROM interview_sessions WHERE id = $1 AND user_id = $2",
    [sessionId, userId],
  );
  if (!session) throw notFound("interview");
  const graph = await interviewGraph();
  const snap = await graph.getState({ configurable: { thread_id: sessionId } });
  const pending = snap.tasks.flatMap((t) => t.interrupts ?? [])[0]?.value as
    | { item: AskItem; number: number; total: number }
    | undefined;
  const v = snap.values as { lastGrade?: unknown; summary?: unknown };
  return {
    ...session,
    question: pending ? { ...pending.item, number: pending.number, total: pending.total } : null,
    lastGrade: v.lastGrade ?? null,
    summary: v.summary ?? session.summary,
  };
}

export async function startInterview(userId: string, opts: { jobId?: string; count?: number }) {
  const count = opts.count ?? 5;
  let pool: QRow[];
  if (opts.jobId) {
    if (!(await one("SELECT 1 FROM jobs WHERE id = $1", [opts.jobId]))) throw notFound("job");
    pool = await questionsForJob(userId, opts.jobId);
  } else {
    pool = await query<QRow>(
      `SELECT q.id, s.canonical_name AS skill, q.kind, q.prompt, q.rubric FROM questions q
       LEFT JOIN skills s ON s.id = q.skill_id
       WHERE q.user_id = $1 AND q.plan_id = (SELECT id FROM plans WHERE user_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1)
       ORDER BY q.created_at`,
      [userId],
    );
  }
  if (pool.length === 0) throw new HttpError(409, "no practice questions yet: build a plan first, or start an interview from a job page");
  const picked = pickMix(pool, count);

  const id = randomUUID();
  await query("INSERT INTO interview_sessions (id, user_id, job_id, question_ids) VALUES ($1, $2, $3, $4)", [id, userId, opts.jobId ?? null, picked.map((q) => q.id)]);
  const graph = await interviewGraph();
  await graph.invoke(
    {
      userId,
      queue: picked.map((q) => ({ questionId: q.id, skill: q.skill, prompt: q.prompt, rubric: q.rubric, isFollowup: false })),
      index: 0,
      followUp: null,
      answer: null,
      lastGrade: null,
      results: [],
      summary: null,
    },
    { configurable: { thread_id: id } },
  );
  return sessionState(userId, id);
}

export async function answerInterview(userId: string, sessionId: string, answer: string) {
  const s = await sessionState(userId, sessionId);
  if (s.status !== "active" || !s.question) throw new HttpError(409, "this interview is finished");
  const graph = await interviewGraph();
  await graph.invoke(new Command({ resume: answer }), { configurable: { thread_id: sessionId } });
  return sessionState(userId, sessionId);
}

export const getInterview = sessionState;

export async function listInterviews(userId: string) {
  return query(
    `SELECT s.id, s.status, s.job_id, j.title AS job_title, s.summary, s.started_at, s.ended_at,
            cardinality(s.question_ids) AS questions
     FROM interview_sessions s LEFT JOIN jobs j ON j.id = s.job_id
     WHERE s.user_id = $1 ORDER BY s.started_at DESC LIMIT 20`,
    [userId],
  );
}

export async function interviewAttempts(userId: string, sessionId: string) {
  await sessionState(userId, sessionId);
  return query(
    `SELECT id, prompt, is_followup, answer, score, covered, missed, feedback, graded_by, created_at
     FROM attempts WHERE interview_session_id = $1 ORDER BY created_at`,
    [sessionId],
  );
}
