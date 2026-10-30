import { one, query, tx } from "../db/pool.js";
import { HttpError, notFound } from "../http.js";

export type AppStatus = "saved" | "applied" | "oa" | "interview" | "offer" | "rejected" | "withdrawn";
export const FOLLOWUP_DAYS = 7;

const SELECT = `
  SELECT a.id, a.job_id, a.resume_version_id, a.status, a.applied_at, a.next_followup_at, a.notes, a.created_at, a.updated_at,
         j.title, j.company, j.location, j.url, j.ghost_risk,
         v.label AS resume_label,
         (SELECT round(m.coverage::numeric, 3) FROM match_reports m
           WHERE m.job_id = a.job_id AND m.user_id = a.user_id ORDER BY m.created_at DESC LIMIT 1)::float AS coverage
  FROM applications a JOIN jobs j ON j.id = a.job_id LEFT JOIN resume_versions v ON v.id = a.resume_version_id`;

export async function listApplications(userId: string) {
  return query(`${SELECT} WHERE a.user_id = $1 ORDER BY a.updated_at DESC`, [userId]);
}

export async function getApplication(userId: string, id: string) {
  const app = await one(`${SELECT} WHERE a.id = $1 AND a.user_id = $2`, [id, userId]);
  if (!app) throw notFound("application");
  const events = await query("SELECT id::int, type, at, notes FROM application_events WHERE application_id = $1 ORDER BY at, id", [id]);
  return { ...app, events };
}

export async function createApplication(userId: string, input: { jobId: string; status?: AppStatus; resumeVersionId?: string | null; notes?: string }) {
  const job = await one("SELECT 1 FROM jobs WHERE id = $1", [input.jobId]);
  if (!job) throw notFound("job");
  if (input.resumeVersionId) await assertOwnsVersion(userId, input.resumeVersionId);
  const status = input.status ?? "saved";
  const id = await tx(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO applications (user_id, job_id, resume_version_id, status, notes, applied_at, next_followup_at)
       VALUES ($1, $2, $3, $4, $5,
               CASE WHEN $4 <> 'saved' THEN now() END,
               CASE WHEN $4 = 'applied' THEN now() + make_interval(days => $6) END)
       ON CONFLICT (user_id, job_id) DO NOTHING RETURNING id`,
      [userId, input.jobId, input.resumeVersionId ?? null, status, input.notes ?? "", FOLLOWUP_DAYS],
    );
    if (!rows[0]) throw new HttpError(409, "you're already tracking this job");
    await c.query("INSERT INTO application_events (application_id, type) VALUES ($1, $2)", [rows[0].id, `status:${status}`]);
    await c.query("INSERT INTO user_jobs (user_id, job_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, input.jobId]);
    return rows[0].id;
  });
  return getApplication(userId, id);
}

async function assertOwnsVersion(userId: string, versionId: string) {
  const ok = await one("SELECT 1 FROM resume_versions v JOIN resumes r ON r.id = v.resume_id WHERE v.id = $1 AND r.user_id = $2", [versionId, userId]);
  if (!ok) throw notFound("resume version");
}

/**
 * Status changes are logged as events. Moving to "applied" sets applied_at and schedules a
 * follow-up; any later status clears the follow-up (the employer responded).
 */
export async function updateApplication(
  userId: string,
  id: string,
  patch: { status?: AppStatus; notes?: string; resumeVersionId?: string | null; nextFollowupAt?: string | null },
) {
  const cur = await one<{ status: AppStatus }>("SELECT status FROM applications WHERE id = $1 AND user_id = $2", [id, userId]);
  if (!cur) throw notFound("application");
  if (patch.resumeVersionId) await assertOwnsVersion(userId, patch.resumeVersionId);
  await tx(async (c) => {
    if (patch.status && patch.status !== cur.status) {
      await c.query(
        `UPDATE applications SET status = $2,
           applied_at = CASE WHEN $2 = 'applied' THEN COALESCE(applied_at, now()) ELSE applied_at END,
           next_followup_at = CASE WHEN $2 = 'applied' THEN now() + make_interval(days => $3) ELSE NULL END
         WHERE id = $1`,
        [id, patch.status, FOLLOWUP_DAYS],
      );
      await c.query("INSERT INTO application_events (application_id, type) VALUES ($1, $2)", [id, `status:${patch.status}`]);
    }
    if (patch.notes !== undefined) {
      await c.query("UPDATE applications SET notes = $2 WHERE id = $1", [id, patch.notes]);
    }
    if (patch.resumeVersionId !== undefined) {
      await c.query("UPDATE applications SET resume_version_id = $2 WHERE id = $1", [id, patch.resumeVersionId]);
    }
    if (patch.nextFollowupAt !== undefined) {
      await c.query("UPDATE applications SET next_followup_at = $2 WHERE id = $1", [id, patch.nextFollowupAt]);
    }
    await c.query("UPDATE applications SET updated_at = now() WHERE id = $1", [id]);
  });
  return getApplication(userId, id);
}

export async function deleteApplication(userId: string, id: string) {
  const rows = await query("DELETE FROM applications WHERE id = $1 AND user_id = $2 RETURNING id", [id, userId]);
  if (!rows.length) throw notFound("application");
}

/** Application funnel counts for the dashboard / weekly report. */
export async function funnel(userId: string) {
  const rows = await query<{ status: AppStatus; n: number }>(
    "SELECT status, count(*)::int AS n FROM applications WHERE user_id = $1 GROUP BY status",
    [userId],
  );
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<Record<AppStatus, number>>;
}
