import { one, query } from "../db/pool.js";
import { notFound } from "../http.js";
import { diffLines, renderText, rephraseForJob, reorderForJob, type ResumeContent } from "../tailor/tailor.js";
import { evidenceForUser } from "./evidence.js";
import { jobRequirements } from "./jobs.js";

/** Creates a tailored resume version for a job: grounded reorder (+ optional grounded rephrasing). */
export async function tailorVersion(userId: string, versionId: string, jobId: string) {
  const base = await one<{ id: string; resume_id: string; content: ResumeContent }>(
    `SELECT v.id, v.resume_id, v.content FROM resume_versions v JOIN resumes r ON r.id = v.resume_id
     WHERE v.id = $1 AND r.user_id = $2`,
    [versionId, userId],
  );
  if (!base) throw notFound("resume version");
  const job = await one<{ title: string; company: string | null }>("SELECT title, company FROM jobs WHERE id = $1", [jobId]);
  if (!job) throw notFound("job");

  const requirements = await jobRequirements(jobId);
  const reordered = reorderForJob(base.content, requirements);
  const userSkills = new Set((await evidenceForUser(userId, versionId)).flatMap((e) => e.skills));
  const rephrased = await rephraseForJob(reordered.content, requirements, userSkills);
  const edits = [...reordered.edits, ...rephrased.edits];

  const label = `Tailored: ${job.title}${job.company ? ` @ ${job.company}` : ""}`.slice(0, 120);
  const row = await one<{ id: string }>(
    `INSERT INTO resume_versions (resume_id, parent_version_id, job_id, label, raw_text, content, change_log)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [base.resume_id, base.id, jobId, label, renderText(rephrased.content), rephrased.content, JSON.stringify(edits)],
  );
  return { versionId: row!.id, label, edits, usedLlm: rephrased.usedLlm };
}

export async function versionDiff(userId: string, versionId: string) {
  const v = await one<{ raw_text: string; parent_version_id: string | null; change_log: unknown }>(
    `SELECT v.raw_text, v.parent_version_id, v.change_log FROM resume_versions v JOIN resumes r ON r.id = v.resume_id
     WHERE v.id = $1 AND r.user_id = $2`,
    [versionId, userId],
  );
  if (!v) throw notFound("resume version");
  if (!v.parent_version_id) return { parentId: null, lines: v.raw_text.split("\n").map((text) => ({ op: "same" as const, text })), changeLog: [] };
  const parent = await one<{ content: ResumeContent }>("SELECT content FROM resume_versions WHERE id = $1", [v.parent_version_id]);
  const before = renderText(parent!.content).split("\n");
  return { parentId: v.parent_version_id, lines: diffLines(before, v.raw_text.split("\n")), changeLog: v.change_log };
}

export async function versionsForJob(userId: string, jobId: string) {
  return query(
    `SELECT v.id, v.label, v.created_at FROM resume_versions v JOIN resumes r ON r.id = v.resume_id
     WHERE r.user_id = $1 AND v.job_id = $2 ORDER BY v.created_at DESC`,
    [userId, jobId],
  );
}
