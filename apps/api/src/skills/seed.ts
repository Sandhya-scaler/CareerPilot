import { migrate } from "../db/migrate.js";
import { pool } from "../db/pool.js";
import { seedSkills } from "./repo.js";

await migrate();
await seedSkills(console.log);
await pool.end();
