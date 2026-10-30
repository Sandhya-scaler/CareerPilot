import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { authRouter, requireUser } from "./auth.js";
import { config } from "./config.js";
import { pool } from "./db/pool.js";
import { embeddingsEnabled } from "./embeddings.js";
import { errorHandler, HttpError } from "./http.js";
import { llmEnabled } from "./llm.js";
import { agentsRouter } from "./routes/agents.js";
import { coreRouter } from "./routes/core.js";
import { insightsRouter } from "./routes/insights.js";

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());

  app.get("/health", async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: true, llm: llmEnabled(), embeddings: embeddingsEnabled() });
  });

  app.use("/auth", authRouter);

  const api = express.Router();
  api.use(requireUser);
  api.use(coreRouter);
  api.use(agentsRouter);
  api.use(insightsRouter);
  app.use("/api", api);

  app.use((_req, _res, next) => next(new HttpError(404, "route not found")));
  app.use(errorHandler);
  return app;
}
