import { createHash } from "node:crypto";
import { embedOne } from "../embeddings.js";
import { one, query, tx, vec } from "../db/pool.js";
import { EXTRACTOR_VERSION, extractRequirements, guessTitle } from "../extract/jd.js";
import { cleanText } from "../extract/text.js";
import { notFound } from "../http.js";
import { skillId } from "../skills/repo.js";
import { refreshGhostRisk } from "./ghost.js";
import type { RequirementDraft } from "../types.js";

export interface JobInput {
  source: string;
  sourceId?: string;
  url?: string | null;
  company?: string | null;
  title?: string | null;
  location?: string | null;
  remote?: boolean | null;
  postedAt?: Date | string | null;
  description: string;
}

export const contentHash = (text: string) =>
  createHash("sha256").update(cleanText(text).toLowerCase().replace(/\s+/g, " ")).digest("hex");

/**
 * Stores a job (deduplicated by source+source_id) and its requirements. Requirement extraction is
 * cached by content hash: the same JD text is never extracted twice, across users and sources.
 */
export async function upsertJob(input: JobInput): Promise<{ id: string; created: boolean }> {
  const description = cleanText(input.description);
  const hash = contentHash(description);
  const sourceId = input.sourceId ?? hash.slice(0, 24);
  const title = input.title?.trim() || guessTitle(description);

  const existing = await one<{ id: string; content_hash: string; extractor_version: number }>(
    "SELECT id, content_hash, extractor_version FROM jobs WHERE source = $1 AND source_id = $2",
    [input.source, sourceId],
  );
  if (existing && existing.content_hash === hash && existing.extractor_version === EXTRACTOR_VERSION) {
    await query("UPDATE jobs SET last_seen_at = now() WHERE id = $1", [existing.id]);
    return { id: existing.id, created: false };
  }

  const requirements = await requirementsFor(hash, description);
  const embedding = await embedOne(`${title}\n${description.slice(0, 1500)}`);

  const id = await tx(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO jobs (source, source_id, url, company, title, location, remote, posted_at, description, content_hash, embedding, extractor_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (source, source_id) DO UPDATE SET
         url = EXCLUDED.url, company = EXCLUDED.company, title = EXCLUDED.title, location = EXCLUDED.location,
         remote = EXCLUDED.remote, posted_at = COALESCE(EXCLUDED.posted_at, jobs.posted_at),
         description = EXCLUDED.description, content_hash = EXCLUDED.content_hash,
         embedding = EXCLUDED.embedding, extractor_version = EXCLUDED.extractor_version, last_seen_at = now()
       RETURNING id`,
      [input.source, sourceId, input.url ?? null, input.company ?? null, title, input.location ?? null,
        input.remote ?? null, input.postedAt ?? null, description, hash, vec(embedding), EXTRACTOR_VERSION],
    );
    const jobId = rows[0]!.id;
    await c.query("DELETE FROM job_requirements WHERE job_id = $1", [jobId]);
    for (const r of requirements) {
      await c.query(
        `INSERT INTO job_requirements (job_id, skill_id, kind, years_min, source_sentence) VALUES ($1, $2, $3, $4, $5)`,
        [jobId, await skillId(r.skill), r.kind, r.yearsMin, r.sourceSentence],
      );
    }
    return jobId;
  });
  await refreshGhostRisk([id]);
  return { id, created: !existing };
}

async function requirementsFor(hash: string, description: string): Promise<RequirementDraft[]> {
  const cached = await query<RequirementDraft>(
    `SELECT s.canonical_name AS skill, r.kind, r.years_min AS "yearsMin", r.source_sentence AS "sourceSentence"
     FROM job_requirements r JOIN skills s ON s.id = r.skill_id
     WHERE r.job_id = (SELECT id FROM jobs WHERE content_hash = $1 AND extractor_version = $2 ORDER BY fetched_at LIMIT 1)`,
    [hash, EXTRACTOR_VERSION],
  );
  if (cached.length) return cached;
  return (await extractRequirements(description)).requirements;
}

export async function saveJobForUser(userId: string, jobId: string) {
  await query("INSERT INTO user_jobs (user_id, job_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, jobId]);
}

export interface JobRequirementRow {
  id: string;
  skill: string;
  category: string;
  kind: "must" | "nice";
  yearsMin: number | null;
  sourceSentence: string;
}

export async function jobRequirements(jobId: string): Promise<JobRequirementRow[]> {
  return query<JobRequirementRow>(
    `SELECT r.id, s.canonical_name AS skill, s.category, r.kind, r.years_min AS "yearsMin", r.source_sentence AS "sourceSentence"
     FROM job_requirements r JOIN skills s ON s.id = r.skill_id WHERE r.job_id = $1
     ORDER BY (r.kind = 'must') DESC, s.canonical_name`,
    [jobId],
  );
}

const JOB_COLUMNS = `j.id, j.source, j.url, j.company, j.title, j.location, j.remote, j.posted_at, j.fetched_at,
  j.last_seen_at, j.ghost_risk, j.ghost_reasons`;

export async function getJob(jobId: string) {
  const job = await one(`SELECT ${JOB_COLUMNS}, j.description FROM jobs j WHERE j.id = $1`, [jobId]);
  if (!job) throw notFound("job");
  return { ...job, requirements: await jobRequirements(jobId) };
}

export async function listUserJobs(userId: string) {
  return query(
    `SELECT ${JOB_COLUMNS}, uj.added_at,
            (SELECT count(*) FROM job_requirements r WHERE r.job_id = j.id)::int AS requirement_count,
            (SELECT round(m.coverage::numeric, 3) FROM match_reports m
              WHERE m.job_id = j.id AND m.user_id = $1 ORDER BY m.created_at DESC LIMIT 1)::float AS last_coverage
     FROM user_jobs uj JOIN jobs j ON j.id = uj.job_id
     WHERE uj.user_id = $1 ORDER BY uj.added_at DESC`,
    [userId],
  );
}

export async function removeUserJob(userId: string, jobId: string) {
  await query("DELETE FROM user_jobs WHERE user_id = $1 AND job_id = $2", [userId, jobId]);
}
