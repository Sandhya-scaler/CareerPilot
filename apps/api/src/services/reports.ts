import { one, query } from "../db/pool.js";
import { funnel } from "./applications.js";
import { latestMarketMap } from "./market.js";

/** Monday (UTC) of the week containing `d`, as YYYY-MM-DD. */
export function weekStartOf(d = new Date()): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

export interface WeeklyReport {
  weekStart: string;
  headline: string;
  readiness: number | null;
  readinessDelta: number | null;
  tasksDone: { title: string; skill: string | null }[];
  evidenceAdded: { text: string; skills: string[]; tier: number; source: string }[];
  interviews: { sessions: number; averageScore: number | null; weakSkills: string[] };
  applications: { events: { type: string; title: string }[]; funnel: Record<string, number> };
  followUpsDue: { title: string; company: string | null; appliedAt: string | null }[];
  nextWeek: { title: string; estHours: number }[];
}

/** Builds (or rebuilds) the weekly progress report and stores it. */
export async function generateWeeklyReport(userId: string, weekStart = weekStartOf()): Promise<WeeklyReport> {
  const range = [userId, weekStart] as const;
  const window = "$2::date AND $2::date + 7";

  const tasksDone = await query<{ title: string; skill: string | null }>(
    `SELECT t.title, s.canonical_name AS skill FROM plan_tasks t JOIN plans p ON p.id = t.plan_id LEFT JOIN skills s ON s.id = t.skill_id
     WHERE p.user_id = $1 AND t.status = 'done' AND t.completed_at::date BETWEEN ${window} - 1 ORDER BY t.completed_at`,
    [...range],
  );
  const evidenceAdded = await query<{ text: string; skills: string[]; tier: number; source: string }>(
    `SELECT e.text, e.tier, e.source, COALESCE(array_agg(s.canonical_name) FILTER (WHERE s.id IS NOT NULL), '{}') AS skills
     FROM evidence_items e LEFT JOIN evidence_skills es ON es.evidence_id = e.id LEFT JOIN skills s ON s.id = es.skill_id
     WHERE e.user_id = $1 AND e.source <> 'resume' AND e.created_at::date BETWEEN ${window} - 1
     GROUP BY e.id ORDER BY e.created_at`,
    [...range],
  );
  const sessions = await query<{ summary: { averageScore: number; weakSkills: string[] } | null }>(
    `SELECT summary FROM interview_sessions WHERE user_id = $1 AND status = 'done' AND ended_at::date BETWEEN ${window} - 1`,
    [...range],
  );
  const scored = sessions.filter((s) => s.summary);
  const appEvents = await query<{ type: string; title: string }>(
    `SELECT e.type, j.title FROM application_events e JOIN applications a ON a.id = e.application_id JOIN jobs j ON j.id = a.job_id
     WHERE a.user_id = $1 AND e.at::date BETWEEN ${window} - 1 ORDER BY e.at`,
    [...range],
  );
  const followUpsDue = await query<{ title: string; company: string | null; appliedAt: string | null }>(
    `SELECT j.title, j.company, a.applied_at AS "appliedAt" FROM applications a JOIN jobs j ON j.id = a.job_id
     WHERE a.user_id = $1 AND a.status = 'applied' AND a.next_followup_at::date < $2::date + 7`,
    [...range],
  );
  const plan = await one<{ id: string; start_date: string }>(
    "SELECT id, start_date FROM plans WHERE user_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    [userId],
  );
  let nextWeek: { title: string; estHours: number }[] = [];
  if (plan) {
    const nextPlanWeek = Math.floor((new Date(weekStart).getTime() + 7 * 86_400_000 - new Date(plan.start_date).getTime()) / (7 * 86_400_000)) + 1;
    nextWeek = await query(
      `SELECT title, est_hours AS "estHours" FROM plan_tasks WHERE plan_id = $1 AND status IN ('todo', 'doing') AND week <= $2
       ORDER BY week, position LIMIT 6`,
      [plan.id, Math.max(1, nextPlanWeek)],
    );
  }

  const market = await latestMarketMap(userId);
  const readiness = market?.readiness ?? null;
  const prev = await one<{ readiness: number | null }>(
    "SELECT readiness FROM weekly_reports WHERE user_id = $1 AND week_start < $2 ORDER BY week_start DESC LIMIT 1",
    [...range],
  );
  const readinessDelta = readiness != null && prev?.readiness != null ? readiness - prev.readiness : null;

  const parts: string[] = [];
  if (tasksDone.length) parts.push(`${tasksDone.length} plan task${tasksDone.length > 1 ? "s" : ""} done`);
  if (evidenceAdded.length) parts.push(`${evidenceAdded.length} new piece${evidenceAdded.length > 1 ? "s" : ""} of evidence`);
  const applied = appEvents.filter((e) => e.type === "status:applied").length;
  if (applied) parts.push(`${applied} application${applied > 1 ? "s" : ""} sent`);
  if (scored.length) parts.push(`${scored.length} mock interview${scored.length > 1 ? "s" : ""}`);
  let headline = parts.length ? `${parts.join(", ")}.` : "A quiet week. One small task keeps the momentum going.";
  if (readinessDelta != null && Math.abs(readinessDelta) >= 0.005) {
    headline += ` Market readiness ${readinessDelta > 0 ? "up" : "down"} ${Math.abs(Math.round(readinessDelta * 100))} points to ${Math.round(readiness! * 100)}%.`;
  }

  const report: WeeklyReport = {
    weekStart,
    headline,
    readiness,
    readinessDelta,
    tasksDone,
    evidenceAdded,
    interviews: {
      sessions: scored.length,
      averageScore: scored.length ? scored.reduce((s, x) => s + x.summary!.averageScore, 0) / scored.length : null,
      weakSkills: [...new Set(scored.flatMap((s) => s.summary!.weakSkills))],
    },
    applications: { events: appEvents, funnel: await funnel(userId) },
    followUpsDue,
    nextWeek,
  };
  await query(
    `INSERT INTO weekly_reports (user_id, week_start, readiness, content) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, week_start) DO UPDATE SET readiness = EXCLUDED.readiness, content = EXCLUDED.content, created_at = now()`,
    [userId, weekStart, readiness, JSON.stringify(report)],
  );
  return report;
}

export async function listReports(userId: string) {
  return query(
    "SELECT week_start, readiness, content->>'headline' AS headline FROM weekly_reports WHERE user_id = $1 ORDER BY week_start DESC LIMIT 26",
    [userId],
  );
}

/** Users with any activity in the last 30 days, for the scheduled Monday run. */
export async function activeUserIds(): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `SELECT DISTINCT u.id FROM users u WHERE
       EXISTS (SELECT 1 FROM plans p WHERE p.user_id = u.id AND p.created_at > now() - interval '30 days')
       OR EXISTS (SELECT 1 FROM applications a WHERE a.user_id = u.id AND a.updated_at > now() - interval '30 days')`,
  );
  return rows.map((r) => r.id);
}
