import { config } from "../config.js";
import { one, query } from "../db/pool.js";

export async function isAdmin(userId: string): Promise<boolean> {
  const u = await one<{ email: string; is_admin: boolean }>("SELECT email, is_admin FROM users WHERE id = $1", [userId]);
  if (!u) return false;
  const allow = config.ADMIN_EMAILS.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return u.is_admin || allow.includes(u.email.toLowerCase());
}

/**
 * Beta metrics, matching docs/02-product-spec.md §Success metrics:
 *   activation      share of users with a match report or market map within a day of signing up
 *   core value      share of planners who added ≥2 new pieces of evidence (plan/GitHub) within 4 weeks
 *   retention       users active in the last 7 days
 *   outcome         interview rate per application, tailored resume vs not
 */
export async function betaMetrics() {
  const users = await one<{ total: number; last7: number }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE id IN (
              SELECT user_id FROM runs WHERE created_at > now() - interval '7 days'
              UNION SELECT user_id FROM applications WHERE updated_at > now() - interval '7 days'
              UNION SELECT user_id FROM attempts WHERE created_at > now() - interval '7 days'
              UNION SELECT p.user_id FROM plan_tasks t JOIN plans p ON p.id = t.plan_id WHERE t.completed_at > now() - interval '7 days'
            ))::int AS last7
     FROM users`,
  );
  const activated = await one<{ n: number }>(
    `SELECT count(DISTINCT u.id)::int AS n FROM users u
     WHERE EXISTS (SELECT 1 FROM match_reports m WHERE m.user_id = u.id AND m.created_at < u.created_at + interval '1 day')
        OR EXISTS (SELECT 1 FROM market_maps mm WHERE mm.user_id = u.id AND mm.created_at < u.created_at + interval '1 day')`,
  );
  const coreValue = await one<{ planners: number; grew: number }>(
    `WITH planners AS (SELECT user_id, min(created_at) AS first_plan FROM plans GROUP BY user_id)
     SELECT count(*)::int AS planners,
            count(*) FILTER (WHERE (SELECT count(*) FROM evidence_items e
                                    WHERE e.user_id = p.user_id AND e.source IN ('plan', 'github', 'assessment')
                                      AND e.created_at < p.first_plan + interval '28 days') >= 2)::int AS grew
     FROM planners p`,
  );
  const outcomes = await query<{ tailored: boolean; applied: number; progressed: number }>(
    `SELECT (v.job_id IS NOT NULL) AS tailored,
            count(*) FILTER (WHERE a.applied_at IS NOT NULL)::int AS applied,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM application_events e WHERE e.application_id = a.id
                                           AND e.type IN ('status:oa', 'status:interview', 'status:offer')))::int AS progressed
     FROM applications a LEFT JOIN resume_versions v ON v.id = a.resume_version_id
     GROUP BY 1`,
  );
  const interviews = await one<{ sessions: number; avg: number | null }>(
    `SELECT count(*)::int AS sessions, round(avg((summary->>'averageScore')::numeric), 2)::float AS avg
     FROM interview_sessions WHERE status = 'done'`,
  );
  const cost = await one<{ usd: number | null; calls: number }>(
    "SELECT round(sum(cost_usd), 4)::float AS usd, count(*)::int AS calls FROM llm_usage",
  );
  const feedback = await query(
    `SELECT f.page, f.rating, f.message, f.created_at, u.email FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     ORDER BY f.created_at DESC LIMIT 50`,
  );
  const rate = (o?: { applied: number; progressed: number }) => (o && o.applied ? o.progressed / o.applied : null);
  return {
    users: users!.total,
    activeLast7Days: users!.last7,
    activationRate: users!.total ? activated!.n / users!.total : null,
    coreValueRate: coreValue!.planners ? coreValue!.grew / coreValue!.planners : null,
    planners: coreValue!.planners,
    interviewRate: {
      tailored: rate(outcomes.find((o) => o.tailored)),
      notTailored: rate(outcomes.find((o) => !o.tailored)),
      applications: outcomes.reduce((s, o) => s + o.applied, 0),
    },
    mockInterviews: interviews,
    llm: cost,
    feedback,
  };
}

export async function addFeedback(userId: string | null, page: string, message: string, rating?: number) {
  await query("INSERT INTO feedback (user_id, page, rating, message) VALUES ($1, $2, $3, $4)", [userId, page, rating ?? null, message]);
}
