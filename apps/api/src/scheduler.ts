import { checkLiveness } from "./services/ghost.js";
import { activeUserIds, generateWeeklyReport, weekStartOf } from "./services/reports.js";

/**
 * In-process scheduler (single API instance). Hourly tick:
 *   - once a day: re-check saved ATS postings are still listed and refresh ghost-job risk;
 *   - on Mondays: write last week's progress report for active users (idempotent per week).
 * Run a separate worker instead if you scale the API horizontally.
 */
let lastLiveness = 0;
let lastReportWeek = "";

export async function tick(now = new Date()) {
  if (now.getTime() - lastLiveness > 24 * 3600 * 1000) {
    lastLiveness = now.getTime();
    const r = await checkLiveness();
    console.log(`[scheduler] liveness: ${r.checked} saved postings checked, ${r.delisted} delisted`);
  }
  const thisWeek = weekStartOf(now);
  if (now.getUTCDay() === 1 && lastReportWeek !== thisWeek) {
    lastReportWeek = thisWeek;
    const lastWeek = weekStartOf(new Date(now.getTime() - 7 * 86_400_000));
    const users = await activeUserIds();
    for (const u of users) await generateWeeklyReport(u, lastWeek);
    console.log(`[scheduler] weekly reports for ${users.length} users (week of ${lastWeek})`);
  }
}

export function startScheduler() {
  const run = () => tick().catch((e) => console.error("[scheduler]", e));
  setTimeout(run, 30_000);
  return setInterval(run, 3600 * 1000);
}
