import { config } from "../config.js";
import { query, tx } from "../db/pool.js";
import { HttpError } from "../http.js";
import { taxonomy } from "../skills/taxonomy.js";
import type { EvidenceDraft } from "../types.js";
import { insertEvidence } from "./evidence.js";

/**
 * GitHub import: public repos become evidence.
 *   - Languages GitHub measured in the code → tier 4 (verified: the code exists and is public).
 *   - Skills named in the description/topics/README → tier 3 (demonstrated, with a link).
 * Re-importing replaces the previous GitHub evidence.
 */
const LANGUAGE_SKILL: Record<string, string> = {
  "Jupyter Notebook": "Jupyter",
  Dockerfile: "Docker",
  Shell: "Bash",
  HCL: "Terraform",
  Vue: "Vue.js",
  "C#": "C#",
  "C++": "C++",
  Cuda: "CUDA",
  Svelte: "Svelte",
  Solidity: "Solidity",
  SCSS: "CSS",
};

interface Repo {
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  fork: boolean;
  archived: boolean;
  topics?: string[];
  stargazers_count: number;
  pushed_at: string;
  size: number;
}

async function gh<T>(path: string, accept = "application/vnd.github+json"): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: accept,
      "User-Agent": "CareerPilot",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(config.GITHUB_TOKEN ? { Authorization: `Bearer ${config.GITHUB_TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) throw new HttpError(404, "GitHub user not found");
  if (res.status === 403 || res.status === 429) throw new HttpError(429, "GitHub rate limit reached; try again later (or set GITHUB_TOKEN)");
  if (!res.ok) throw new HttpError(502, `GitHub returned ${res.status}`);
  return (accept.includes("raw") ? await res.text() : await res.json()) as T;
}

export function languageSkills(bytes: Record<string, number>): { skill: string; share: number }[] {
  const total = Object.values(bytes).reduce((a, b) => a + b, 0);
  if (!total) return [];
  return Object.entries(bytes)
    .map(([lang, b]) => ({ skill: LANGUAGE_SKILL[lang] ?? taxonomy.normalize(lang), share: b / total }))
    .filter((x): x is { skill: string; share: number } => Boolean(x.skill) && x.share >= 0.1);
}

export function repoEvidence(repo: Repo, langs: { skill: string; share: number }[], readme: string): EvidenceDraft[] {
  const out: EvidenceDraft[] = [];
  if (langs.length) {
    out.push({
      section: "github",
      context: `GitHub: ${repo.name}`,
      text: `Code in ${repo.name}: ${langs.map((l) => `${Math.round(l.share * 100)}% ${l.skill}`).join(", ")} (measured by GitHub)`,
      tier: 4,
      skills: [...new Set(langs.map((l) => l.skill))],
      metrics: repo.stargazers_count ? [`${repo.stargazers_count} stars`] : [],
      links: [repo.html_url],
    });
  }
  const described = [repo.description ?? "", ...(repo.topics ?? []).map((t) => t.replace(/-/g, " ")), readme.slice(0, 6000)].join("\n");
  const mentioned = taxonomy.findInText(described).map((m) => m.skill).filter((s) => taxonomy.category(s) !== "soft" && !langs.some((l) => l.skill === s));
  if (mentioned.length) {
    out.push({
      section: "github",
      context: `GitHub: ${repo.name}`,
      text: `${repo.name}${repo.description ? `: ${repo.description}` : ""}`.slice(0, 300),
      tier: 3,
      skills: [...new Set(mentioned)].slice(0, 12),
      metrics: [],
      links: [repo.html_url],
    });
  }
  return out;
}

export async function importGithub(userId: string, username: string, maxRepos = 12) {
  const repos = (await gh<Repo[]>(`/users/${encodeURIComponent(username)}/repos?sort=pushed&per_page=50&type=owner`))
    .filter((r) => !r.fork && r.size > 0)
    .slice(0, maxRepos);
  const drafts: EvidenceDraft[] = [];
  for (const repo of repos) {
    const langs = languageSkills(await gh<Record<string, number>>(`/repos/${repo.full_name}/languages`));
    let readme = "";
    try {
      readme = await gh<string>(`/repos/${repo.full_name}/readme`, "application/vnd.github.raw+json");
    } catch {
      /* no README */
    }
    drafts.push(...repoEvidence(repo, langs, readme));
  }
  await tx(async (c) => {
    await c.query("DELETE FROM evidence_items WHERE user_id = $1 AND source = 'github'", [userId]);
    await insertEvidence(c, userId, null, "github", drafts, true);
    await c.query("UPDATE users SET github_username = $2 WHERE id = $1", [userId, username]);
  });
  return { repos: repos.length, evidence: drafts.length, skills: [...new Set(drafts.flatMap((d) => d.skills))].sort() };
}

export async function githubEvidence(userId: string) {
  return query(
    `SELECT e.id, e.context, e.text, e.tier, e.links, COALESCE(array_agg(s.canonical_name) FILTER (WHERE s.id IS NOT NULL), '{}') AS skills
     FROM evidence_items e LEFT JOIN evidence_skills es ON es.evidence_id = e.id LEFT JOIN skills s ON s.id = es.skill_id
     WHERE e.user_id = $1 AND e.source = 'github' GROUP BY e.id ORDER BY e.context, e.tier DESC`,
    [userId],
  );
}
