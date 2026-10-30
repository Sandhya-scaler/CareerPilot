import { Annotation, END, START, StateGraph, interrupt, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { gradeAnswer, type Grade } from "../coach/grade.js";
import { query } from "../db/pool.js";
import { getCheckpointer } from "./pipeline.js";

/**
 * Mock interview loop (docs/03-architecture.md, Coach Agent):
 *
 *   ask ⏸ → grade → (follow-up ask ⏸ → grade) → next question … → finish
 *
 * At most one follow-up per question, asked only when the answer scored ≤ 3. On finish, skills
 * averaging below 3 become practice tasks in the user's active plan.
 */
export interface AskItem {
  questionId: string | null;
  skill: string | null;
  prompt: string;
  rubric: string[];
  isFollowup: boolean;
}

export const InterviewState = Annotation.Root({
  userId: Annotation<string>(),
  queue: Annotation<AskItem[]>(),
  index: Annotation<number>(),
  followUp: Annotation<AskItem | null>(),
  answer: Annotation<string | null>(),
  lastGrade: Annotation<(Grade & { prompt: string }) | null>(),
  results: Annotation<{ skill: string | null; score: number; isFollowup: boolean }[]>(),
  summary: Annotation<InterviewSummary | null>(),
});

export interface InterviewSummary {
  averageScore: number;
  bySkill: { skill: string; average: number; attempts: number }[];
  weakSkills: string[];
  addedTasks: number;
}

type S = typeof InterviewState.State;
const current = (s: S): AskItem | null => s.followUp ?? s.queue[s.index] ?? null;

async function ask(s: S) {
  const item = current(s);
  if (!item) return {};
  const answer = interrupt<{ type: "question"; item: AskItem; number: number; total: number }, string>({
    type: "question",
    item,
    number: Math.min(s.index + 1, s.queue.length),
    total: s.queue.length,
  });
  return { answer: String(answer ?? "").slice(0, 8000) };
}

async function grade(s: S, config: LangGraphRunnableConfig) {
  const item = current(s)!;
  const g = await gradeAnswer(item.prompt, item.rubric, s.answer ?? "");
  await query(
    `INSERT INTO attempts (user_id, question_id, interview_session_id, prompt, is_followup, answer, score, covered, missed, feedback, graded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [s.userId, item.questionId, config.configurable?.thread_id, item.prompt, item.isFollowup, s.answer ?? "", g.score,
      JSON.stringify(g.covered), JSON.stringify(g.missed), g.feedback, g.gradedBy],
  );
  const results = [...s.results, { skill: item.skill, score: g.score, isFollowup: item.isFollowup }];
  const lastGrade = { ...g, prompt: item.prompt };
  if (!item.isFollowup && g.followUp) {
    return {
      results,
      lastGrade,
      answer: null,
      followUp: { questionId: item.questionId, skill: item.skill, prompt: g.followUp, rubric: g.missed.length ? g.missed : item.rubric, isFollowup: true },
    };
  }
  return { results, lastGrade, answer: null, followUp: null, index: s.index + 1 };
}

async function finish(s: S, config: LangGraphRunnableConfig) {
  const main = s.results.filter((r) => !r.isFollowup);
  const by = new Map<string, number[]>();
  for (const r of main) {
    if (!r.skill) continue;
    by.set(r.skill, [...(by.get(r.skill) ?? []), r.score]);
  }
  const bySkill = [...by].map(([skill, xs]) => ({ skill, average: xs.reduce((a, b) => a + b, 0) / xs.length, attempts: xs.length }));
  const weakSkills = bySkill.filter((b) => b.average < 3).map((b) => b.skill);

  // Write weak areas back into the active plan as practice tasks for the current week.
  let addedTasks = 0;
  const plan = (await query<{ id: string; start_date: string; weeks: number }>(
    "SELECT id, start_date, weeks FROM plans WHERE user_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    [s.userId],
  ))[0];
  if (plan) {
    const week = Math.min(plan.weeks, Math.floor((Date.now() - new Date(plan.start_date).getTime()) / (7 * 86_400_000)) + 1);
    for (const skill of weakSkills) {
      const missed = (await query<{ missed: string[] }>(
        `SELECT a.missed FROM attempts a JOIN questions q ON q.id = a.question_id JOIN skills k ON k.id = q.skill_id
         WHERE a.interview_session_id = $1 AND k.canonical_name = $2 AND NOT a.is_followup ORDER BY a.created_at`,
        [config.configurable?.thread_id, skill],
      )).flatMap((r) => r.missed).slice(0, 3);
      const exists = await query(
        "SELECT 1 FROM plan_tasks t JOIN skills k ON k.id = t.skill_id WHERE t.plan_id = $1 AND k.canonical_name = $2 AND t.type = 'practice' AND t.status = 'todo'",
        [plan.id, skill],
      );
      if (exists.length) continue;
      await query(
        `INSERT INTO plan_tasks (plan_id, week, position, skill_id, type, title, detail, est_hours)
         VALUES ($1, $2, 1000, (SELECT id FROM skills WHERE canonical_name = $3), 'practice', $4, $5, 1.5)`,
        [plan.id, week, skill, `Revisit ${skill} interview answers`,
          `Your mock interview answers on ${skill} averaged below 3/5.${missed.length ? ` Work on: ${missed.join("; ")}.` : ""} Re-answer out loud, then run another mock interview.`],
      );
      addedTasks++;
    }
  }
  const all = main.map((r) => r.score);
  const summary: InterviewSummary = {
    averageScore: all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0,
    bySkill,
    weakSkills,
    addedTasks,
  };
  await query("UPDATE interview_sessions SET status = 'done', summary = $2, ended_at = now() WHERE id = $1", [config.configurable?.thread_id, JSON.stringify(summary)]);
  return { summary };
}

const route = (s: S) => (current(s) ? "ask" : "finish");

let compiled: Awaited<ReturnType<typeof build>> | null = null;

async function build() {
  return new StateGraph(InterviewState)
    .addNode("ask", ask)
    .addNode("grade", grade)
    .addNode("finish", finish)
    .addConditionalEdges(START, route, ["ask", "finish"])
    .addEdge("ask", "grade")
    .addConditionalEdges("grade", route, ["ask", "finish"])
    .addEdge("finish", END)
    .compile({ checkpointer: await getCheckpointer() });
}

export async function interviewGraph() {
  compiled ??= await build();
  return compiled;
}
