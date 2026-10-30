import type pg from "pg";
import { pool, query } from "../db/pool.js";
import { findLinks, findMetrics, hasShippedSignal } from "../extract/text.js";
import { skillId } from "../skills/repo.js";
import { taxonomy } from "../skills/taxonomy.js";
import type { EvidenceDraft, Tier } from "../types.js";

export interface EvidenceRow {
  id: string;
  source: string;
  section: string;
  context: string | null;
  text: string;
  tier: Tier;
  skills: string[];
  metrics: string[];
  links: string[];
  confirmed: boolean;
  resume_version_id: string | null;
}

type Db = Pick<pg.PoolClient, "query">;

export async function insertEvidence(
  db: Db,
  userId: string,
  versionId: string | null,
  source: "resume" | "github" | "assessment" | "manual" | "plan",
  items: EvidenceDraft[],
  confirmed = false,
): Promise<string[]> {
  const ids: string[] = [];
  for (const e of items) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO evidence_items (user_id, resume_version_id, source, section, context, text, tier, metrics, links, confirmed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [userId, versionId, source, e.section, e.context, e.text, e.tier, e.metrics, e.links, confirmed],
    );
    const id = rows[0]!.id;
    ids.push(id);
    for (const s of new Set(e.skills)) {
      await db.query("INSERT INTO evidence_skills (evidence_id, skill_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, await skillId(s)]);
    }
  }
  return ids;
}

const EVIDENCE_SELECT = `
  SELECT e.id, e.source, e.section, e.context, e.text, e.tier, e.metrics, e.links, e.confirmed, e.resume_version_id,
         COALESCE(array_agg(s.canonical_name ORDER BY s.canonical_name) FILTER (WHERE s.id IS NOT NULL), '{}') AS skills
  FROM evidence_items e
  LEFT JOIN evidence_skills es ON es.evidence_id = e.id
  LEFT JOIN skills s ON s.id = es.skill_id`;

/**
 * The user's evidence pool for matching: the chosen resume version's lines plus everything not tied
 * to a resume (GitHub repos, passed assessments, completed plan tasks, manual entries).
 */
export async function evidenceForUser(userId: string, versionId?: string | null): Promise<EvidenceRow[]> {
  const version = versionId ?? (await latestVersionId(userId));
  return query<EvidenceRow>(
    `${EVIDENCE_SELECT}
     WHERE e.user_id = $1 AND (e.resume_version_id = $2 OR e.resume_version_id IS NULL)
     GROUP BY e.id ORDER BY e.created_at, e.id`,
    [userId, version],
  );
}

export async function evidenceForVersion(userId: string, versionId: string): Promise<EvidenceRow[]> {
  return query<EvidenceRow>(
    `${EVIDENCE_SELECT} WHERE e.user_id = $1 AND e.resume_version_id = $2 GROUP BY e.id ORDER BY e.created_at, e.id`,
    [userId, versionId],
  );
}

/** Newest *base* (non-tailored) resume version. */
export async function latestVersionId(userId: string): Promise<string | null> {
  const rows = await query<{ id: string }>(
    `SELECT v.id FROM resume_versions v JOIN resumes r ON r.id = v.resume_id
     WHERE r.user_id = $1 AND v.job_id IS NULL ORDER BY v.created_at DESC LIMIT 1`,
    [userId],
  );
  return rows[0]?.id ?? null;
}

/**
 * Tier for evidence a user types in by hand: same rules as resume lines. Users can describe their
 * own experience, but "demonstrated" still needs an outcome or a link, and "verified" (4) is only
 * granted by assessments / repo analysis.
 */
export function manualTier(text: string): Tier {
  return findMetrics(text).length || findLinks(text).length || hasShippedSignal(text) ? 3 : 2;
}

export function draftFromText(text: string, section: EvidenceDraft["section"], context: string | null = null, skills?: string[]): EvidenceDraft {
  const found = taxonomy.findInText(text).map((m) => m.skill);
  return {
    section,
    context,
    text,
    tier: manualTier(text),
    skills: [...new Set([...(skills ?? []), ...found])].filter((s) => taxonomy.get(s)),
    metrics: findMetrics(text),
    links: findLinks(text),
  };
}

export interface EvidenceEdits {
  update?: { id: string; tier?: Tier; skills?: string[]; remove?: boolean }[];
  add?: { text: string; skills?: string[]; context?: string | null }[];
}

/**
 * Applies the user's review of extracted evidence (the human-in-the-loop step) and marks the
 * version's evidence as confirmed. Users may lower a tier or drop items freely; raising a tier is
 * capped by what the text supports.
 */
export async function confirmEvidence(userId: string, versionId: string, edits: EvidenceEdits) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const u of edits.update ?? []) {
      const { rows } = await client.query<{ text: string; tier: Tier; section: string }>(
        "SELECT text, tier, section FROM evidence_items WHERE id = $1 AND user_id = $2 AND resume_version_id = $3",
        [u.id, userId, versionId],
      );
      const row = rows[0];
      if (!row) continue;
      if (u.remove) {
        await client.query("DELETE FROM evidence_items WHERE id = $1", [u.id]);
        continue;
      }
      if (u.tier !== undefined) {
        // Lists (skills/summary/education) are claims by nature; bullets can be re-graded from their text.
        const listLike = ["skills", "summary", "education", "coursework"].includes(row.section);
        const ceiling = listLike ? row.tier : Math.max(row.tier, manualTier(row.text));
        await client.query("UPDATE evidence_items SET tier = $2 WHERE id = $1", [u.id, Math.min(u.tier, ceiling, 3)]);
      }
      if (u.skills) {
        await client.query("DELETE FROM evidence_skills WHERE evidence_id = $1", [u.id]);
        for (const s of u.skills.map((x) => taxonomy.normalize(x)).filter((x): x is string => Boolean(x))) {
          await client.query("INSERT INTO evidence_skills VALUES ($1, $2) ON CONFLICT DO NOTHING", [u.id, await skillId(s)]);
        }
      }
    }
    const additions = (edits.add ?? [])
      .map((a) => draftFromText(a.text, "manual", a.context ?? null, (a.skills ?? []).map((s) => taxonomy.normalize(s) ?? s)))
      .filter((d) => d.skills.length > 0);
    await insertEvidence(client, userId, versionId, "resume", additions, true);
    await client.query("UPDATE evidence_items SET confirmed = true WHERE user_id = $1 AND resume_version_id = $2", [userId, versionId]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return evidenceForVersion(userId, versionId);
}
