import { Router } from "express";
import { z } from "zod";
import { userId } from "../auth.js";
import { one } from "../db/pool.js";
import { parse, Uuid } from "../http.js";
import { rateLimit } from "../ratelimit.js";
import { getMarketMap, latestMarketMap, listMarketMaps } from "../services/market.js";
import { activePlan, createPlanFromMarket, getPlan, listQuestions, updateTask } from "../services/plans.js";
import { researchJobs } from "../services/research.js";
import { getRun, listRuns, resumeRun, startPrepareRun } from "../services/runs.js";

export const agentsRouter = Router();

const Company = z.object({
  ats: z.enum(["greenhouse", "lever", "ashby"]),
  token: z.string().regex(/^[a-z0-9-_.]+$/i, "board token: letters, digits, - _ ."),
  company: z.string().max(100).optional(),
});

const Prepare = z.object({
  role: z.string().min(2).max(120),
  location: z.string().max(120).nullable().optional(),
  hoursPerWeek: z.number().int().min(1).max(60).optional(),
  weeks: z.number().int().min(1).max(26).default(6),
  limit: z.number().int().min(3).max(60).default(25),
  companies: z.array(Company).max(20).default([]),
  includeSavedJobs: z.boolean().default(true),
  skipResearch: z.boolean().default(false),
});

/** Golden path: research → resume check (HITL) → market map → plan + questions. Async; poll or stream the run. */
agentsRouter.post("/careers/prepare", rateLimit({ name: "prepare", windowMs: 3600_000, max: 12 }), async (req, res) => {
  const body = parse(Prepare, req.body);
  const uid = userId(req);
  const user = await one<{ hours_per_week: number }>("SELECT hours_per_week FROM users WHERE id = $1", [uid]);
  await one(
    "UPDATE users SET target_role = $2, location = COALESCE($3, location), hours_per_week = COALESCE($4, hours_per_week) WHERE id = $1 RETURNING id",
    [uid, body.role, body.location ?? null, body.hoursPerWeek ?? null],
  );
  const runId = await startPrepareRun({
    userId: uid,
    role: body.role,
    location: body.location ?? null,
    hoursPerWeek: body.hoursPerWeek ?? user?.hours_per_week ?? 8,
    weeks: body.weeks,
    limit: body.limit,
    companies: body.companies,
    includeSavedJobs: body.includeSavedJobs,
    skipResearch: body.skipResearch,
  });
  res.status(202).json({ runId });
});

agentsRouter.get("/runs", async (req, res) => {
  res.json(await listRuns(userId(req)));
});

agentsRouter.get("/runs/:id", async (req, res) => {
  res.json(await getRun(userId(req), parse(Uuid, req.params.id)));
});

/** Server-sent events: progress messages, then a final status event. */
agentsRouter.get("/runs/:id/events", async (req, res) => {
  const uid = userId(req);
  const id = parse(Uuid, req.params.id);
  await getRun(uid, id); // 404 before switching to a stream
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  let after = Number(req.query.after ?? 0) || 0;
  let lastStatus = "";
  let closed = false;
  req.on("close", () => (closed = true));
  while (!closed) {
    const run = await getRun(uid, id, after);
    for (const e of run.events) {
      res.write(`id: ${e.id}\nevent: progress\ndata: ${JSON.stringify(e)}\n\n`);
      after = e.id;
    }
    if (run.status !== lastStatus) {
      lastStatus = run.status;
      res.write(`event: status\ndata: ${JSON.stringify({ status: run.status, pending: run.pending, result: run.result, error: run.error })}\n\n`);
    }
    if (run.status === "done" || run.status === "failed") break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  res.end();
});

agentsRouter.post("/runs/:id/resume", async (req, res) => {
  const id = parse(Uuid, req.params.id);
  await resumeRun(userId(req), id, req.body?.value ?? null);
  res.status(202).json({ runId: id });
});

/** Research only (no plan): find and store relevant JDs for a role. */
agentsRouter.post("/jobs/search", rateLimit({ name: "search", windowMs: 3600_000, max: 30 }), async (req, res) => {
  const body = parse(Prepare.pick({ role: true, location: true, limit: true, companies: true }).extend({ onlyCompanies: z.boolean().default(false) }), req.body);
  const r = await researchJobs({ userId: userId(req), role: body.role, location: body.location ?? null, limit: body.limit, companies: body.companies, onlyCompanies: body.onlyCompanies });
  res.json(r);
});

agentsRouter.get("/market-maps", async (req, res) => {
  res.json(await listMarketMaps(userId(req)));
});

agentsRouter.get("/market-maps/latest", async (req, res) => {
  res.json(await latestMarketMap(userId(req)));
});

agentsRouter.get("/market-maps/:id", async (req, res) => {
  res.json(await getMarketMap(userId(req), parse(Uuid, req.params.id)));
});

agentsRouter.post("/market-maps/:id/plan", async (req, res) => {
  const body = parse(z.object({ hoursPerWeek: z.number().int().min(1).max(60), weeks: z.number().int().min(1).max(26) }), req.body);
  const planId = await createPlanFromMarket(userId(req), parse(Uuid, req.params.id), body);
  res.status(201).json(await getPlan(userId(req), planId));
});

agentsRouter.get("/plans/active", async (req, res) => {
  res.json(await activePlan(userId(req)));
});

agentsRouter.get("/plans/:id", async (req, res) => {
  res.json(await getPlan(userId(req), parse(Uuid, req.params.id)));
});

agentsRouter.patch("/plan-tasks/:id", async (req, res) => {
  const body = parse(z.object({ status: z.enum(["todo", "doing", "done", "skipped"]), proof: z.string().max(1000).optional() }), req.body);
  res.json(await updateTask(userId(req), parse(Uuid, req.params.id), body));
});

agentsRouter.get("/questions", async (req, res) => {
  const q = parse(z.object({ skill: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).optional() }), req.query);
  res.json(await listQuestions(userId(req), q));
});
