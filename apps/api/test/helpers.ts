import { readFile } from "node:fs/promises";
import request from "supertest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { pool } from "../src/db/pool.js";
import { seedSkills } from "../src/skills/repo.js";

export const app = createApp();

/** Fresh schema + seeded taxonomy in the test database. */
export async function resetDb() {
  if (!/_test\b/.test(process.env.DATABASE_URL ?? "")) throw new Error("refusing to reset a non-test database");
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(() => {});
  await seedSkills();
}

let n = 0;
export async function newUser() {
  const email = `user${++n}-${Date.now()}@test.dev`;
  const res = await request(app).post("/auth/register").send({ email, password: "correct-horse-battery" }).expect(201);
  const token = res.body.token as string;
  const auth = { Authorization: `Bearer ${token}` };
  return { id: res.body.id as string, email, token, auth };
}

export const fixture = (p: string) => readFile(new URL(`../evals/data/${p}`, import.meta.url), "utf8");
export const binaryFixture = (p: string) => readFile(new URL(`./fixtures/${p}`, import.meta.url));
