import { Router } from "express";
import { z } from "zod";
import { userId } from "../auth.js";
import { HttpError, parse } from "../http.js";
import { rateLimit } from "../ratelimit.js";
import { addFeedback, betaMetrics, isAdmin } from "../services/metrics.js";

export const adminRouter = Router();

adminRouter.post("/feedback", rateLimit({ name: "feedback", windowMs: 3600_000, max: 20 }), async (req, res) => {
  const body = parse(z.object({ page: z.string().max(200), message: z.string().trim().min(3).max(4000), rating: z.number().int().min(1).max(5).optional() }), req.body);
  await addFeedback(userId(req), body.page, body.message, body.rating);
  res.status(201).json({ ok: true });
});

adminRouter.get("/admin/metrics", async (req, res) => {
  if (!(await isAdmin(userId(req)))) throw new HttpError(403, "admins only");
  res.json(await betaMetrics());
});
