import { createApp } from "./app.js";
import { config } from "./config.js";
import { migrate } from "./db/migrate.js";

await migrate();
createApp().listen(config.API_PORT, () => {
  console.log(`CareerPilot API on http://localhost:${config.API_PORT}`);
});
