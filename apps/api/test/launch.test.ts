import type { AddressInfo } from "node:net";
import { SMTPServer } from "smtp-server";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { pool, query } from "../src/db/pool.js";
import { claim } from "../src/scheduler.js";
import { renderWeeklyEmail, resetTransport, sendWeeklyReport } from "../src/services/email.js";
import { generateWeeklyReport, weekStartOf, type WeeklyReport } from "../src/services/reports.js";
import { ensureSkillsSeeded } from "../src/skills/repo.js";
import { app, newUser, resetDb } from "./helpers.js";

/** A real SMTP server on a random local port that records every message. */
const inbox: { to: string; raw: string }[] = [];
const smtp = new SMTPServer({
  authOptional: true,
  disabledCommands: ["STARTTLS"],
  onData(stream, session, cb) {
    let raw = "";
    stream.on("data", (c) => (raw += c));
    stream.on("end", () => {
      inbox.push({ to: session.envelope.rcptTo.map((r) => r.address).join(","), raw });
      cb();
    });
  },
});

beforeAll(async () => {
  await resetDb();
  await new Promise<void>((r) => smtp.listen(0, "127.0.0.1", r));
  const port = (smtp.server.address() as AddressInfo).port;
  (config as { SMTP_URL?: string }).SMTP_URL = `smtp://127.0.0.1:${port}`;
  resetTransport();
});
afterAll(async () => {
  (config as { SMTP_URL?: string }).SMTP_URL = undefined;
  await new Promise<void>((r) => smtp.close(() => r()));
  await pool.end();
});

const sample: WeeklyReport = {
  weekStart: "2026-10-26",
  headline: "2 plan tasks done, 1 new piece of evidence.",
  readiness: 0.42,
  readinessDelta: 0.05,
  tasksDone: [{ title: "Build: <PyTorch> mini-project", skill: "PyTorch" }],
  evidenceAdded: [{ text: "github.com/a/b 0.8 mAP", skills: ["PyTorch"], tier: 3, source: "plan" }],
  interviews: { sessions: 0, averageScore: null, weakSkills: [] },
  applications: { events: [], funnel: {} },
  followUpsDue: [{ title: "ML Intern", company: "Acme", appliedAt: null }],
  nextWeek: [{ title: "Learn Docker fundamentals", estHours: 3 }],
};

describe("weekly email", () => {
  it("renders text and escaped HTML with the key facts and an unsubscribe link", () => {
    const m = renderWeeklyEmail(sample, "Aarav Mehta");
    expect(m.subject).toBe("Your CareerPilot week: 2 plan tasks done, 1 new piece of evidence");
    expect(m.text).toMatch(/^Hi Aarav,/);
    expect(m.text).toContain("Market readiness: 42%");
    expect(m.text).toContain("- ML Intern at Acme");
    expect(m.html).toContain("Build: &lt;PyTorch&gt; mini-project");
    expect(m.html).not.toContain("<PyTorch>");
    expect(m.html).toContain(`${config.APP_URL}/account`);
  });

  it("sends only to opted-in users, once per week, over real SMTP", async () => {
    const u = await newUser();
    const week = weekStartOf();
    await generateWeeklyReport(u.id, week);
    expect(await sendWeeklyReport(u.id, week)).toBe(false); // not opted in
    await request(app).patch("/auth/me").set(u.auth).send({ email_reports: true }).expect(200);
    expect(await sendWeeklyReport(u.id, week)).toBe(true);
    expect(await sendWeeklyReport(u.id, week)).toBe(false); // already emailed
    expect(inbox.filter((m) => m.to === u.email)).toHaveLength(1);
    expect(inbox.at(-1)!.raw).toMatch(/Subject: Your CareerPilot week/);
  });

  it("lets a user send this week's report to themselves", async () => {
    const u = await newUser();
    const status = await request(app).get("/api/reports/email-status").set(u.auth).expect(200);
    expect(status.body.enabled).toBe(true);
    await request(app).post("/api/reports/weekly/email").set(u.auth).expect(200);
    expect(inbox.some((m) => m.to === u.email)).toBe(true);
  });
});

describe("multi-instance safety", () => {
  it("scheduler claims run a job once per period even when instances race", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => claim("race-test", 3600_000)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await claim("race-test", 3600_000)).toBe(false);
    await query("UPDATE job_runs SET last_run = now() - interval '2 hours' WHERE name = 'race-test'");
    expect(await claim("race-test", 3600_000)).toBe(true);
  });

  it("rate limits are shared through Postgres", async () => {
    process.env.DISABLE_RATE_LIMIT = "0";
    try {
      const u = await newUser();
      const send = () => request(app).post("/api/feedback").set(u.auth).send({ page: "/", message: "hello there" });
      for (let i = 0; i < 20; i++) await send().expect(201);
      const blocked = await send().expect(429);
      expect(blocked.headers["retry-after"]).toBeTruthy();
      const other = await newUser();
      await request(app).post("/api/feedback").set(other.auth).send({ page: "/", message: "separate bucket" }).expect(201);
    } finally {
      process.env.DISABLE_RATE_LIMIT = "1";
    }
  });

  it("seeds the taxonomy once per version", async () => {
    await query("DELETE FROM job_runs WHERE name LIKE 'taxonomy:%'");
    const logs: string[] = [];
    await ensureSkillsSeeded((s) => logs.push(s));
    await ensureSkillsSeeded((s) => logs.push(s));
    expect(logs).toHaveLength(1);
  });
});

describe("beta feedback and metrics", () => {
  it("records feedback and restricts metrics to admins", async () => {
    const u = await newUser();
    await request(app).post("/api/feedback").set(u.auth).send({ page: "/plan", message: "Week 2 felt too heavy", rating: 4 }).expect(201);
    await request(app).post("/api/feedback").set(u.auth).send({ page: "/plan", message: "" }).expect(400);
    await request(app).get("/api/admin/metrics").set(u.auth).expect(403);

    await query("UPDATE users SET is_admin = true WHERE id = $1", [u.id]);
    const me = await request(app).get("/auth/me").set(u.auth).expect(200);
    expect(me.body.is_admin).toBe(true);
    const m = await request(app).get("/api/admin/metrics").set(u.auth).expect(200);
    expect(m.body.users).toBeGreaterThan(0);
    expect(m.body.feedback.some((f: { message: string }) => f.message === "Week 2 felt too heavy")).toBe(true);
    expect(m.body).toHaveProperty("interviewRate.tailored");
  });
});
