import { one, query, tx } from "../db/pool.js";
import { HttpError, notFound } from "../http.js";
import { matchRequirements, type MatchResult } from "../scoring.js";
import { skillId } from "../skills/repo.js";
import { taxonomy } from "../skills/taxonomy.js";
import { evidenceForUser, latestVersionId, type EvidenceRow } from "./evidence.js";
import { jobRequirements } from "./jobs.js";

export function summarize(result: MatchResult, title: string): string {
  const scored = result.items.filter((i) => i.scored);
  const must = scored.filter((i) => i.kind === "must");
  const mustCovered = must.filter((i) => i.evidence.score >= 0.6).length;
  const strengths = scored.filter((i) => i.evidence.via === "direct" && i.evidence.score >= 0.85).map((i) => i.skill);
  const gaps = must.filter((i) => i.evidence.score < 0.3).map((i) => i.skill);
  const parts = [
    `${title}: ${Math.round(result.coverage * 100)}% coverage. You show applied evidence for ${mustCovered} of ${must.length} must-haves.`,
  ];
  if (strengths.length) parts.push(`Strongest: ${strengths.slice(0, 4).join(", ")}.`);
  if (gaps.length) parts.push(`Missing must-haves: ${gaps.slice(0, 5).join(", ")}.`);
  return parts.join(" ");
}

/** Scores the user's evidence against one job and stores the report. */
export async function matchJob(userId: string, jobId: string, versionId?: string | null) {
  const job = await one<{ title: string }>("SELECT title FROM jobs WHERE id = $1", [jobId]);
  if (!job) throw notFound("job");
  const version = versionId ?? (await latestVersionId(userId));
  if (!version) throw new HttpError(409, "upload a resume first");
  const owns = await one(
    "SELECT 1 FROM resume_versions v JOIN resumes r ON r.id = v.resume_id WHERE v.id = $1 AND r.user_id = $2",
    [version, userId],
  );
  if (!owns) throw notFound("resume version");

  const reqs = await jobRequirements(jobId);
  const evidence = await evidenceForUser(userId, version);
  const result = matchRequirements<EvidenceRow>(reqs, evidence, taxonomy);
  const summary = summarize(result, job.title);

  const reportId = await tx(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO match_reports (user_id, job_id, resume_version_id, coverage, must_coverage, summary)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [userId, jobId, version, result.coverage, result.mustCoverage, summary],
    );
    const id = rows[0]!.id;
    for (const item of result.items) {
      const e = item.evidence;
      await c.query(
        `INSERT INTO match_items (report_id, skill_id, importance, evidence_score, via, via_skill, evidence_id, requirement_id,
           requirement_text, evidence_text, evidence_tier, evidence_context, explanation, kind, scored)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [id, await skillId(item.skill), item.importance, e.score, e.via, e.viaSkill, e.item?.id ?? null, item.requirement.id ?? null,
          item.requirement.sourceSentence, e.item?.text ?? null, e.item?.tier ?? null, e.item?.context ?? null,
          item.explanation, item.kind, item.scored],
      );
    }
    return id;
  });
  return getReport(userId, reportId);
}

export async function getReport(userId: string, reportId: string) {
  const report = await one(
    `SELECT m.id, m.job_id, m.market_map_id, m.resume_version_id, m.coverage, m.must_coverage, m.summary, m.created_at,
            j.title AS job_title, j.company AS job_company
     FROM match_reports m LEFT JOIN jobs j ON j.id = m.job_id
     WHERE m.id = $1 AND m.user_id = $2`,
    [reportId, userId],
  );
  if (!report) throw notFound("match report");
  const items = await query(
    `SELECT s.canonical_name AS skill, s.category, i.kind, i.importance, i.evidence_score, i.via, i.via_skill,
            i.requirement_text, i.evidence_id, i.evidence_text, i.evidence_tier, i.evidence_context, i.explanation, i.scored
     FROM match_items i JOIN skills s ON s.id = i.skill_id
     WHERE i.report_id = $1
     ORDER BY i.scored DESC, i.importance DESC, i.evidence_score ASC, s.canonical_name`,
    [reportId],
  );
  return { ...report, items };
}

export async function latestReportForJob(userId: string, jobId: string) {
  const r = await one<{ id: string }>(
    "SELECT id FROM match_reports WHERE user_id = $1 AND job_id = $2 ORDER BY created_at DESC LIMIT 1",
    [userId, jobId],
  );
  return r ? getReport(userId, r.id) : null;
}
