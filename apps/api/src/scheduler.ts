import { query } from "./db/pool.js";
import { sendWeeklyReport } from "./services/email.js";
import { checkLiveness } from "./services/ghost.js";
import { activeUserIds, generateWeeklyReport, weekStartOf } from "./services/reports.js";

/**
 * Scheduler, safe to run on every API instance: each job is claimed with one atomic UPSERT on
 * `job_runs`, so exactly one instance runs it per period. Hourly tick:
 *   - daily: re-check saved ATS postings are still listed, refresh ghost-job risk, prune rate limits;
 *   - Mondays: write last week's progress report for active users and email those who opted in.
 */
export async function claim(name: string, everyMs: number): Promise<boolean> {
  const rows = await query(
    `INSERT INTO job_runs (name, last_run) VALUES ($1, now())
     ON CONFLICT (name) DO UPDATE SET last_run = now()
       WHERE job_runs.last_run < now() - $2 * interval '1 millisecond'
     RETURNING name`,
    [name, everyMs],
  );
  return rows.length > 0;
}

export async function tick(now = new Date()) {
  if (await claim("daily", 23 * 3600 * 1000)) {
    const r = await checkLiveness();
    await query("DELETE FROM rate_limits WHERE reset_at < now() - interval '1 day'");
    console.log(`[scheduler] liveness: ${r.checked} saved postings checked, ${r.delisted} delisted`);
  }
  if (now.getUTCDay() === 1) {
    const lastWeek = weekStartOf(new Date(now.getTime() - 7 * 86_400_000));
    if (await claim(`weekly:${lastWeek}`, 365 * 86_400_000)) {
      const users = await activeUserIds();
      let emailed = 0;
      for (const u of users) {
        await generateWeeklyReport(u, lastWeek);
        try {
          if (await sendWeeklyReport(u, lastWeek)) emailed++;
        } catch (e) {
          console.error(`[scheduler] email to ${u} failed:`, (e as Error).message);
        }
      }
      console.log(`[scheduler] weekly reports for ${users.length} users (week of ${lastWeek}), ${emailed} emailed`);
    }
  }
}

export function startScheduler() {
  if (process.env.DISABLE_SCHEDULER === "1") return null;
  const run = () => tick().catch((e) => console.error("[scheduler]", e));
  setTimeout(run, 30_000);
  return setInterval(run, 3600 * 1000);
}
