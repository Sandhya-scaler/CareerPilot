import { createApp } from "./app.js";
import { config } from "./config.js";
import { migrate } from "./db/migrate.js";
import { startScheduler } from "./scheduler.js";
import { ensureSkillsSeeded } from "./skills/repo.js";
import { resumeOrphanedRuns } from "./services/runs.js";

await migrate();
await ensureSkillsSeeded();
createApp().listen(config.API_PORT, () => {
  console.log(`CareerPilot API on http://localhost:${config.API_PORT}`);
  resumeOrphanedRuns().catch((e) => console.error("resuming runs failed", e));
  startScheduler();
});
