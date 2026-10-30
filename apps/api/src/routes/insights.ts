import { Router } from "express";
import { z } from "zod";
import { userId } from "../auth.js";
import { parse, Uuid } from "../http.js";
import { checkLiveness } from "../services/ghost.js";
import { githubEvidence, importGithub } from "../services/github.js";
import { answerInterview, getInterview, interviewAttempts, listInterviews, startInterview } from "../services/interviews.js";
import { generateWeeklyReport, listReports, weekStartOf } from "../services/reports.js";

export const insightsRouter = Router();

// ---- Mock interviews -----------------------------------------------------------------------------

insightsRouter.post("/interviews", async (req, res) => {
  const body = parse(z.object({ jobId: Uuid.optional(), count: z.number().int().min(1).max(12).optional() }), req.body ?? {});
  res.status(201).json(await startInterview(userId(req), body));
});

insightsRouter.get("/interviews", async (req, res) => {
  res.json(await listInterviews(userId(req)));
});

insightsRouter.get("/interviews/:id", async (req, res) => {
  const id = parse(Uuid, req.params.id);
  res.json({ ...(await getInterview(userId(req), id)), attempts: await interviewAttempts(userId(req), id) });
});

insightsRouter.post("/interviews/:id/answer", async (req, res) => {
  const body = parse(z.object({ answer: z.string().trim().min(1, "write or say an answer first").max(8000) }), req.body);
  res.json(await answerInterview(userId(req), parse(Uuid, req.params.id), body.answer));
});

// ---- Weekly reports ------------------------------------------------------------------------------

insightsRouter.get("/reports", async (req, res) => {
  res.json(await listReports(userId(req)));
});

/** This week's report is rebuilt on every request so it's always current; past weeks are as stored. */
insightsRouter.get("/reports/weekly", async (req, res) => {
  const q = parse(z.object({ week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.query);
  res.json(await generateWeeklyReport(userId(req), q.week ? weekStartOf(new Date(q.week)) : weekStartOf()));
});

// ---- GitHub ---------------------------------------------------------------------------------------

insightsRouter.post("/github/import", async (req, res) => {
  const body = parse(z.object({ username: z.string().regex(/^[a-z\d](?:[a-z\d-]{0,38})$/i, "not a valid GitHub username") }), req.body);
  res.json(await importGithub(userId(req), body.username));
});

insightsRouter.get("/github/evidence", async (req, res) => {
  res.json(await githubEvidence(userId(req)));
});

// ---- Ghost-job checks (also run daily by the scheduler) -------------------------------------------

insightsRouter.post("/jobs/check-liveness", async (_req, res) => {
  res.json(await checkLiveness());
});
