import { one, query, tx } from "../db/pool.js";
import { parseResume } from "../extract/resume.js";
import { notFound } from "../http.js";
import { evidenceForVersion, insertEvidence } from "./evidence.js";

export async function createResume(userId: string, text: string, title: string) {
  const parsed = await parseResume(text);
  const { resumeId, versionId } = await tx(async (c) => {
    const r = await c.query<{ id: string }>("INSERT INTO resumes (user_id, title) VALUES ($1, $2) RETURNING id", [userId, title]);
    const resumeId = r.rows[0]!.id;
    const content = { name: parsed.name, email: parsed.email, links: parsed.links, sections: parsed.sections };
    const v = await c.query<{ id: string }>(
      "INSERT INTO resume_versions (resume_id, label, raw_text, content) VALUES ($1, 'Base', $2, $3) RETURNING id",
      [resumeId, text, content],
    );
    const versionId = v.rows[0]!.id;
    await insertEvidence(c, userId, versionId, "resume", parsed.evidence);
    return { resumeId, versionId };
  });
  return {
    resumeId,
    versionId,
    name: parsed.name,
    usedLlm: parsed.usedLlm,
    evidence: await evidenceForVersion(userId, versionId),
  };
}

export async function listResumes(userId: string) {
  return query(
    `SELECT r.id, r.title, r.created_at,
            json_agg(json_build_object('id', v.id, 'label', v.label, 'job_id', v.job_id, 'created_at', v.created_at)
                     ORDER BY v.created_at) AS versions
     FROM resumes r JOIN resume_versions v ON v.resume_id = r.id
     WHERE r.user_id = $1 GROUP BY r.id ORDER BY r.created_at DESC`,
    [userId],
  );
}

export async function getVersion(userId: string, versionId: string) {
  const v = await one(
    `SELECT v.id, v.resume_id, v.parent_version_id, v.job_id, v.label, v.raw_text, v.content, v.change_log, v.created_at,
            r.title AS resume_title
     FROM resume_versions v JOIN resumes r ON r.id = v.resume_id
     WHERE v.id = $1 AND r.user_id = $2`,
    [versionId, userId],
  );
  if (!v) throw notFound("resume version");
  return { ...v, evidence: await evidenceForVersion(userId, versionId) };
}

export async function deleteResume(userId: string, resumeId: string) {
  const rows = await query("DELETE FROM resumes WHERE id = $1 AND user_id = $2 RETURNING id", [resumeId, userId]);
  if (!rows.length) throw notFound("resume");
}
