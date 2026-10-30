import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { config, isProd } from "./config.js";
import { requestContext } from "./context.js";
import { one, query } from "./db/pool.js";
import { HttpError, parse } from "./http.js";
import { rateLimit } from "./ratelimit.js";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const COOKIE = "cp_session";
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;

export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(pw: string, stored: string) {
  const [, saltHex, keyHex] = stored.split("$");
  if (!saltHex || !keyHex) return false;
  const key = await scrypt(pw, Buffer.from(saltHex, "hex"), 64);
  return timingSafeEqual(key, Buffer.from(keyHex, "hex"));
}

const sign = (payload: string) => createHmac("sha256", config.SESSION_SECRET).update(payload).digest("base64url");

/** Stateless session token: `<userId>.<expiryMs>.<hmac>`. */
export function sessionToken(userId: string, now = Date.now()) {
  const payload = `${userId}.${now + MAX_AGE_MS}`;
  return `${payload}.${sign(payload)}`;
}

export function readSession(token: string | undefined, now = Date.now()): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, exp, mac] = parts as [string, string, string];
  const expected = sign(`${userId}.${exp}`);
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  if (Number(exp) < now) return null;
  return userId;
}

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/** Accepts the session cookie, or `Authorization: Bearer <token>` for CLI/API clients. */
export function requireUser(req: Request, _res: Response, next: NextFunction) {
  const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  const userId = readSession(req.cookies?.[COOKIE] ?? bearer);
  if (!userId) return next(new HttpError(401, "not signed in"));
  req.userId = userId;
  requestContext.run({ userId }, () => next());
}

export const userId = (req: Request) => {
  if (!req.userId) throw new HttpError(401, "not signed in");
  return req.userId;
};

function setCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: isProd, maxAge: MAX_AGE_MS, path: "/" });
}

const Credentials = z.object({
  email: z.string().email().transform((e) => e.toLowerCase()),
  password: z.string().min(8, "password must be at least 8 characters"),
  name: z.string().max(100).optional(),
});

export const authRouter = Router();

authRouter.post("/register", rateLimit({ name: "register", windowMs: 3600_000, max: 10 }), async (req, res) => {
  const { email, password, name } = parse(Credentials, req.body);
  const exists = await one("SELECT 1 FROM users WHERE email = $1", [email]);
  if (exists) throw new HttpError(409, "an account with this email already exists");
  const user = await one<{ id: string }>(
    "INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id",
    [email, name ?? null, await hashPassword(password)],
  );
  const token = sessionToken(user!.id);
  setCookie(res, token);
  res.status(201).json({ id: user!.id, email, name: name ?? null, token });
});

authRouter.post("/login", rateLimit({ name: "login", windowMs: 15 * 60_000, max: 20 }), async (req, res) => {
  const { email, password } = parse(Credentials.omit({ name: true }), req.body);
  const user = await one<{ id: string; name: string | null; password_hash: string | null }>(
    "SELECT id, name, password_hash FROM users WHERE email = $1",
    [email],
  );
  if (!user?.password_hash || !(await verifyPassword(password, user.password_hash))) {
    throw new HttpError(401, "wrong email or password");
  }
  const token = sessionToken(user.id);
  setCookie(res, token);
  res.json({ id: user.id, email, name: user.name, token });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE, { path: "/" });
  res.status(204).end();
});

authRouter.get("/me", requireUser, async (req, res) => {
  const user = await one(
    "SELECT id, email, name, target_role, location, hours_per_week FROM users WHERE id = $1",
    [userId(req)],
  );
  if (!user) throw new HttpError(401, "account no longer exists");
  res.json(user);
});

const Profile = z.object({
  name: z.string().max(100).nullable().optional(),
  target_role: z.string().max(120).nullable().optional(),
  location: z.string().max(120).nullable().optional(),
  hours_per_week: z.number().int().min(1).max(80).optional(),
});

authRouter.patch("/me", requireUser, async (req, res) => {
  const p = parse(Profile, req.body);
  const user = await one(
    `UPDATE users SET
       name = CASE WHEN $2::boolean THEN $3 ELSE name END,
       target_role = CASE WHEN $4::boolean THEN $5 ELSE target_role END,
       location = CASE WHEN $6::boolean THEN $7 ELSE location END,
       hours_per_week = COALESCE($8, hours_per_week)
     WHERE id = $1 RETURNING id, email, name, target_role, location, hours_per_week`,
    [userId(req), "name" in p, p.name ?? null, "target_role" in p, p.target_role ?? null, "location" in p, p.location ?? null, p.hours_per_week ?? null],
  );
  res.json(user);
});

/** Everything we store about the user, as JSON (data portability). */
authRouter.get("/me/export", requireUser, async (req, res) => {
  const uid = userId(req);
  const tables: Record<string, string> = {
    profile: "SELECT id, email, name, target_role, location, hours_per_week, github_username, created_at FROM users WHERE id = $1",
    resumes: "SELECT r.title, v.label, v.raw_text, v.change_log, v.created_at FROM resumes r JOIN resume_versions v ON v.resume_id = r.id WHERE r.user_id = $1",
    evidence: "SELECT source, section, context, text, tier, links, confirmed, created_at FROM evidence_items WHERE user_id = $1",
    saved_jobs: "SELECT j.title, j.company, j.url, uj.added_at FROM user_jobs uj JOIN jobs j ON j.id = uj.job_id WHERE uj.user_id = $1",
    applications: "SELECT j.title, j.company, a.status, a.applied_at, a.notes FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.user_id = $1",
    plans: "SELECT p.role, t.week, t.title, t.status, t.proof FROM plans p JOIN plan_tasks t ON t.plan_id = p.id WHERE p.user_id = $1",
    interview_answers: "SELECT prompt, answer, score, feedback, created_at FROM attempts WHERE user_id = $1",
    weekly_reports: "SELECT week_start, content FROM weekly_reports WHERE user_id = $1",
  };
  const out: Record<string, unknown> = { exported_at: new Date().toISOString() };
  for (const [k, sql] of Object.entries(tables)) out[k] = await query(sql, [uid]);
  res.setHeader("Content-Disposition", 'attachment; filename="careerpilot-export.json"');
  res.json(out);
});

/** LLM usage and cost for this user, by week. */
authRouter.get("/me/usage", requireUser, async (req, res) => {
  res.json(
    await query(
      `SELECT date_trunc('week', at)::date AS week, label, count(*)::int AS calls,
              sum(input_tokens)::int AS input_tokens, sum(output_tokens)::int AS output_tokens, round(sum(cost_usd), 4)::float AS cost_usd
       FROM llm_usage WHERE user_id = $1 GROUP BY 1, 2 ORDER BY 1 DESC, 2`,
      [userId(req)],
    ),
  );
});

/** Permanently deletes the account and all of its data (cascades). */
authRouter.delete("/me", requireUser, async (req, res) => {
  await query("DELETE FROM users WHERE id = $1", [userId(req)]);
  res.clearCookie(COOKIE, { path: "/" });
  res.status(204).end();
});
