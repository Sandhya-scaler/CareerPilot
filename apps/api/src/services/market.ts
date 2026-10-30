import { one, query, tx } from "../db/pool.js";
import { HttpError, notFound } from "../http.js";
import { buildMarketMap, marketCoverage, rankGaps, type MarketSkill } from "../scoring.js";
import { skillId } from "../skills/repo.js";
import { taxonomy } from "../skills/taxonomy.js";
import { TIER_LABEL } from "../types.js";
import { evidenceForUser, type EvidenceRow } from "./evidence.js";

/** Aggregates the requirements of `jobIds` into a stored market skill map. */
export async function createMarketMap(userId: string, role: string, location: string | null, jobIds: string[]) {
  if (jobIds.length === 0) throw new HttpError(422, "no job descriptions to analyze");
  const rows = await query<{ job_id: string; skill: string; kind: "must" | "nice"; source_sentence: string }>(
    `SELECT r.job_id, s.canonical_name AS skill, r.kind, r.source_sentence
     FROM job_requirements r JOIN skills s ON s.id = r.skill_id WHERE r.job_id = ANY($1::uuid[])`,
    [jobIds],
  );
  const byJob = new Map<string, { skill: string; kind: "must" | "nice" }[]>();
  const sample = new Map<string, string>();
  for (const r of rows) {
    if (!byJob.has(r.job_id)) byJob.set(r.job_id, []);
    byJob.get(r.job_id)!.push({ skill: r.skill, kind: r.kind });
    if (!sample.has(r.skill) || r.kind === "must") sample.set(r.skill, r.source_sentence);
  }
  const usable = jobIds.filter((id) => byJob.has(id));
  const market = buildMarketMap(usable.map((id) => ({ requirements: byJob.get(id)! })), taxonomy);

  const id = await tx(async (c) => {
    const { rows: m } = await c.query<{ id: string }>(
      "INSERT INTO market_maps (user_id, role, location, job_ids) VALUES ($1, $2, $3, $4) RETURNING id",
      [userId, role, location, usable],
    );
    for (const s of market) {
      await c.query(
        `INSERT INTO market_skills (market_map_id, skill_id, frequency, must_rate, weight, job_count, sample_sentence)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [m[0]!.id, await skillId(s.skill), s.frequency, s.mustRate, s.weight, s.jobCount, sample.get(s.skill) ?? null],
      );
    }
    return m[0]!.id;
  });
  return id;
}

export async function loadMarket(marketMapId: string): Promise<(MarketSkill & { sampleSentence: string | null; category: string })[]> {
  return query(
    `SELECT s.canonical_name AS skill, s.category, m.frequency, m.must_rate AS "mustRate", m.weight, m.job_count AS "jobCount",
            m.sample_sentence AS "sampleSentence"
     FROM market_skills m JOIN skills s ON s.id = m.skill_id
     WHERE m.market_map_id = $1 ORDER BY m.weight DESC, s.canonical_name`,
    [marketMapId],
  );
}

/**
 * Market map + the user's live standing against it. Gaps are computed from *current* evidence,
 * so finishing plan tasks moves the numbers without regenerating anything.
 */
export async function getMarketMap(userId: string, marketMapId: string) {
  const map = await one<{ id: string; role: string; location: string | null; job_ids: string[]; created_at: string }>(
    "SELECT id, role, location, job_ids, created_at FROM market_maps WHERE id = $1 AND user_id = $2",
    [marketMapId, userId],
  );
  if (!map) throw notFound("market map");
  const market = await loadMarket(map.id);
  const evidence = await evidenceForUser(userId);
  const gaps = rankGaps<EvidenceRow>(market, evidence, taxonomy);
  const jobs = await query(
    "SELECT id, title, company, location, url, source, posted_at, ghost_risk FROM jobs WHERE id = ANY($1::uuid[]) ORDER BY company, title",
    [map.job_ids],
  );
  return {
    ...map,
    jobCount: map.job_ids.length,
    readiness: marketCoverage(market, evidence, taxonomy),
    skills: market,
    gaps: gaps.map((g) => ({
      skill: g.skill,
      priority: g.priority,
      learnability: g.learnability,
      frequency: g.market.frequency,
      mustRate: g.market.mustRate,
      evidenceScore: g.evidence.score,
      via: g.evidence.via,
      viaSkill: g.evidence.viaSkill,
      evidenceText: g.evidence.item?.text ?? null,
      evidenceTier: g.evidence.item?.tier ?? null,
      evidenceLabel: g.evidence.item ? TIER_LABEL[g.evidence.item.tier] : "none",
      sampleSentence: market.find((m) => m.skill === g.skill)?.sampleSentence ?? null,
    })),
    jobs,
  };
}

export async function latestMarketMap(userId: string) {
  const r = await one<{ id: string }>("SELECT id FROM market_maps WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", [userId]);
  return r ? getMarketMap(userId, r.id) : null;
}

export async function listMarketMaps(userId: string) {
  return query(
    `SELECT id, role, location, cardinality(job_ids) AS job_count, created_at FROM market_maps
     WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
}
