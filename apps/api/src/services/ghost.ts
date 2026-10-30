import { query } from "../db/pool.js";
import { boardFor, type Ats } from "../sources/connectors.js";

/**
 * Ghost-job risk (docs/02-product-spec.md, P1). 67% of job seekers report running into postings
 * that aren't really hiring. Signals, each with a plain-language reason:
 *   - the posting disappeared from the company's own job board,
 *   - it has been up a long time,
 *   - the same role was reposted under new IDs,
 *   - it lists few concrete requirements.
 */
export interface GhostInput {
  postedAt: Date | null;
  delistedAt: Date | null;
  reposts: number;
  requirementCount: number;
}

const days = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / 86_400_000);

export function ghostRisk(j: GhostInput, now = new Date()): { risk: number; reasons: string[] } {
  let risk = 0;
  const reasons: string[] = [];
  if (j.delistedAt) {
    risk += 0.7;
    reasons.push(`No longer listed on the company's job board (since ${j.delistedAt.toISOString().slice(0, 10)}).`);
  }
  if (j.postedAt) {
    const age = days(j.postedAt, now);
    if (age > 120) (risk += 0.5), reasons.push(`Posted ${age} days ago.`);
    else if (age > 60) (risk += 0.3), reasons.push(`Posted ${age} days ago.`);
    else if (age > 45) (risk += 0.15), reasons.push(`Posted ${age} days ago.`);
  }
  if (j.reposts > 0) {
    risk += Math.min(0.3, 0.15 * j.reposts);
    reasons.push(`The same role was reposted ${j.reposts} time${j.reposts > 1 ? "s" : ""}.`);
  }
  if (j.requirementCount < 3) {
    risk += 0.15;
    reasons.push("Few concrete requirements listed.");
  }
  return { risk: Math.min(1, Math.round(risk * 100) / 100), reasons };
}

/** Recomputes and stores ghost risk for the given jobs (or all jobs any user saved). */
export async function refreshGhostRisk(jobIds?: string[]) {
  const rows = await query<{ id: string; posted_at: Date | null; delisted_at: Date | null; reposts: number; reqs: number }>(
    `SELECT j.id, j.posted_at, j.delisted_at,
            (SELECT count(*)::int FROM jobs o
              WHERE o.id <> j.id AND o.source = j.source AND (o.content_hash = j.content_hash
                OR (lower(o.company) = lower(j.company) AND lower(o.title) = lower(j.title)))
                AND o.fetched_at > now() - interval '120 days') AS reposts,
            (SELECT count(*)::int FROM job_requirements r WHERE r.job_id = j.id) AS reqs
     FROM jobs j
     WHERE ($1::uuid[] IS NULL AND j.id IN (SELECT job_id FROM user_jobs)) OR j.id = ANY($1::uuid[])`,
    [jobIds ?? null],
  );
  for (const r of rows) {
    const g = ghostRisk({ postedAt: r.posted_at, delistedAt: r.delisted_at, reposts: r.reposts, requirementCount: r.reqs });
    await query("UPDATE jobs SET ghost_risk = $2, ghost_reasons = $3 WHERE id = $1", [r.id, g.risk, g.reasons]);
  }
  return rows.length;
}

/**
 * Re-reads the company boards behind saved ATS jobs: still listed → last_seen_at = now;
 * missing → delisted_at set. Boards that fail to load are skipped (no false "delisted").
 */
export async function checkLiveness() {
  const jobs = await query<{ id: string; source: Ats; source_id: string }>(
    `SELECT DISTINCT j.id, j.source, j.source_id FROM jobs j JOIN user_jobs uj ON uj.job_id = j.id
     WHERE j.source IN ('greenhouse', 'lever', 'ashby')`,
  );
  const byBoard = new Map<string, typeof jobs>();
  for (const j of jobs) {
    const key = `${j.source}:${j.source_id.split(":")[0]}`;
    byBoard.set(key, [...(byBoard.get(key) ?? []), j]);
  }
  let delisted = 0;
  for (const [key, list] of byBoard) {
    const [ats, token] = key.split(":") as [Ats, string];
    let live: Set<string>;
    try {
      live = new Set((await boardFor(ats, token)).map((l) => l.sourceId));
    } catch {
      continue;
    }
    for (const j of list) {
      if (live.has(j.source_id)) {
        await query("UPDATE jobs SET last_seen_at = now(), delisted_at = NULL WHERE id = $1", [j.id]);
      } else {
        await query("UPDATE jobs SET delisted_at = COALESCE(delisted_at, now()) WHERE id = $1", [j.id]);
        delisted++;
      }
    }
  }
  await refreshGhostRisk();
  return { checked: jobs.length, delisted };
}
