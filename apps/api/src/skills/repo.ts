import { embed, cosine } from "../embeddings.js";
import { query, vec } from "../db/pool.js";
import { SKILLS } from "./data.js";
import { taxonomy } from "./taxonomy.js";

/** Upserts the in-code taxonomy into Postgres. Safe to re-run. */
export async function seedSkills(log: (s: string) => void = () => {}) {
  const vectors = await embed(SKILLS.map((s) => `${s.name}: ${(s.aliases ?? []).map((a) => a.replace(/^=/, "")).join(", ")}`));
  for (const [i, s] of SKILLS.entries()) {
    const [row] = await query<{ id: number }>(
      `INSERT INTO skills (canonical_name, category, learnability, related, embedding)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (canonical_name) DO UPDATE
         SET category = EXCLUDED.category, learnability = EXCLUDED.learnability, related = EXCLUDED.related,
             embedding = COALESCE(EXCLUDED.embedding, skills.embedding)
       RETURNING id`,
      [s.name, s.category, s.learn ?? "weeks", s.related ?? [], vec(vectors?.[i])],
    );
    for (const alias of taxonomy.aliasesOf(s.name)) {
      await query(
        `INSERT INTO skill_aliases (alias, skill_id) VALUES ($1, $2)
         ON CONFLICT (alias) DO UPDATE SET skill_id = EXCLUDED.skill_id`,
        [alias.toLowerCase(), row!.id],
      );
    }
  }
  idCache = null;
  log(`seeded ${SKILLS.length} skills${vectors ? " with embeddings" : ""}`);
}

let idCache: Promise<Map<string, number>> | null = null;

/** canonical_name -> skills.id */
export function skillIds(): Promise<Map<string, number>> {
  idCache ??= query<{ id: number; canonical_name: string }>("SELECT id, canonical_name FROM skills").then(
    (rows) => new Map(rows.map((r) => [r.canonical_name, r.id])),
  );
  return idCache;
}

export async function skillId(name: string): Promise<number> {
  const id = (await skillIds()).get(name);
  if (id === undefined) throw new Error(`skill not seeded: ${name} (run npm run seed)`);
  return id;
}

let vecCache: Promise<{ name: string; v: number[] }[]> | null = null;

/**
 * Maps a raw skill string to a canonical skill: alias lookup first, then embedding similarity
 * (threshold tuned conservatively; a wrong mapping is worse than an unknown). Unmapped strings
 * are recorded in `unknown_skills` so the taxonomy can grow.
 */
export async function resolveSkill(raw: string): Promise<string | undefined> {
  const direct = taxonomy.normalize(raw);
  if (direct) return direct;
  const v = (await embed([raw]))?.[0];
  if (v) {
    vecCache ??= query<{ canonical_name: string; embedding: number[] }>(
      "SELECT canonical_name, embedding::real[] AS embedding FROM skills WHERE embedding IS NOT NULL",
    ).then((rows) => rows.map((r) => ({ name: r.canonical_name, v: r.embedding })));
    let best: { name: string; score: number } | undefined;
    for (const s of await vecCache) {
      const score = cosine(v, s.v);
      if (!best || score > best.score) best = { name: s.name, score };
    }
    if (best && best.score >= 0.86) return best.name;
  }
  await query(
    `INSERT INTO unknown_skills (raw) VALUES ($1)
     ON CONFLICT (raw) DO UPDATE SET seen_count = unknown_skills.seen_count + 1, last_seen_at = now()`,
    [raw.trim().toLowerCase().slice(0, 120)],
  );
  return undefined;
}
