import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { userId } from "../auth.js";
import { MAX_UPLOAD_BYTES, cleanText, fileToText } from "../extract/text.js";
import { HttpError, parse, Uuid } from "../http.js";
import { confirmEvidence } from "../services/evidence.js";
import { getJob, listUserJobs, removeUserJob, saveJobForUser, upsertJob } from "../services/jobs.js";
import { getReport, latestReportForJob, matchJob } from "../services/match.js";
import { createResume, deleteResume, getVersion, listResumes } from "../services/resumes.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

export const coreRouter = Router();

// ---- Resumes -------------------------------------------------------------------------------------

coreRouter.post("/resumes", upload.single("file"), async (req, res) => {
  let text: string;
  let title: string;
  if (req.file) {
    text = await fileToText(req.file.buffer, req.file.originalname, req.file.mimetype);
    title = (req.body?.title as string | undefined)?.trim() || req.file.originalname.replace(/\.[^.]+$/, "");
  } else {
    const body = parse(z.object({ text: z.string().min(50, "paste the full resume text"), title: z.string().max(120).optional() }), req.body);
    text = cleanText(body.text);
    title = body.title?.trim() || "My resume";
  }
  res.status(201).json(await createResume(userId(req), text, title));
});

coreRouter.get("/resumes", async (req, res) => {
  res.json(await listResumes(userId(req)));
});

coreRouter.get("/resume-versions/:id", async (req, res) => {
  res.json(await getVersion(userId(req), parse(Uuid, req.params.id)));
});

const Edits = z.object({
  update: z
    .array(z.object({
      id: Uuid,
      tier: z.number().int().min(0).max(4).optional(),
      skills: z.array(z.string()).optional(),
      remove: z.boolean().optional(),
    }))
    .optional(),
  add: z.array(z.object({ text: z.string().min(5).max(500), skills: z.array(z.string()).optional(), context: z.string().max(200).nullable().optional() })).optional(),
});

/** Human-in-the-loop: the user reviews extracted evidence before it is used for matching. */
coreRouter.post("/resume-versions/:id/confirm", async (req, res) => {
  const edits = parse(Edits, req.body ?? {}) as Parameters<typeof confirmEvidence>[2];
  res.json(await confirmEvidence(userId(req), parse(Uuid, req.params.id), edits));
});

coreRouter.delete("/resumes/:id", async (req, res) => {
  await deleteResume(userId(req), parse(Uuid, req.params.id));
  res.status(204).end();
});

// ---- Jobs ----------------------------------------------------------------------------------------

const PastedJob = z.object({
  text: z.string().min(80, "paste the full job description"),
  title: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
  url: z.string().url().optional(),
  location: z.string().max(200).optional(),
});

coreRouter.post("/jobs/ingest", async (req, res) => {
  const body = parse(PastedJob, req.body);
  const { id } = await upsertJob({
    source: "pasted",
    description: body.text,
    title: body.title,
    company: body.company,
    url: body.url,
    location: body.location,
  });
  await saveJobForUser(userId(req), id);
  res.status(201).json(await getJob(id));
});

coreRouter.get("/jobs", async (req, res) => {
  res.json(await listUserJobs(userId(req)));
});

coreRouter.get("/jobs/:id", async (req, res) => {
  const id = parse(Uuid, req.params.id);
  res.json({ ...(await getJob(id)), latest_report: await latestReportForJob(userId(req), id) });
});

coreRouter.post("/jobs/:id/save", async (req, res) => {
  const id = parse(Uuid, req.params.id);
  await getJob(id);
  await saveJobForUser(userId(req), id);
  res.status(204).end();
});

coreRouter.delete("/jobs/:id", async (req, res) => {
  await removeUserJob(userId(req), parse(Uuid, req.params.id));
  res.status(204).end();
});

// ---- Matching ------------------------------------------------------------------------------------

coreRouter.post("/match", async (req, res) => {
  const body = parse(z.object({ jobId: Uuid, resumeVersionId: Uuid.optional() }), req.body);
  res.status(201).json(await matchJob(userId(req), body.jobId, body.resumeVersionId));
});

coreRouter.get("/match-reports/:id", async (req, res) => {
  res.json(await getReport(userId(req), parse(Uuid, req.params.id)));
});

coreRouter.use((err: unknown, _req: unknown, _res: unknown, next: (e: unknown) => void) => {
  if (err instanceof multer.MulterError) return next(new HttpError(err.code === "LIMIT_FILE_SIZE" ? 413 : 400, err.message));
  next(err);
});
