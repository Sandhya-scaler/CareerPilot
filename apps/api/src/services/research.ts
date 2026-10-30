import { SEED_BOARDS, adzunaCountry, isIndiaLocation, regionFor, type Board } from "../sources/boards.js";
import { adzunaEnabled, adzunaSearch, arbeitnowJobs, boardFor, type Ats, type Listing } from "../sources/connectors.js";
import { mapLimit } from "../sources/http.js";
import { rankByRelevance, RELEVANCE_THRESHOLD, titleScore } from "../sources/relevance.js";
import { saveJobForUser, upsertJob } from "./jobs.js";

export interface ResearchInput {
  userId: string;
  role: string;
  location?: string | null;
  limit?: number;
  companies?: { ats: Ats; token: string; company?: string }[];
  /** Only the user's companies (no seed boards / aggregators). */
  onlyCompanies?: boolean;
  onProgress?: (msg: string) => void | Promise<void>;
}

export interface ResearchResult {
  jobIds: string[];
  scanned: number;
  relevant: number;
  sources: Record<string, number>;
  failedSources: string[];
}

const MIN_DESCRIPTION = 300;

const GLOBAL_REMOTE = /^(remote|anywhere|worldwide|global|remote\s*[-–(,]?\s*(global|worldwide|anywhere|apac|asia|india)\)?)$/i;

/**
 * Hard location filter. For an India search, roles located elsewhere are dropped unless they are
 * open worldwide ("Remote - US" is not something an India-based applicant can usually take).
 * Unknown locations are kept.
 */
export function locationAllowed(want: string | null | undefined, l: Pick<Listing, "location">): boolean {
  if (!want || !isIndiaLocation(want)) return true;
  const loc = (l.location ?? "").trim();
  if (!loc) return true;
  return isIndiaLocation(loc) || GLOBAL_REMOTE.test(loc) || /\b(apac|asia)\b/i.test(loc);
}

function locationBoost(want: string | null | undefined, l: Listing): number {
  if (!want) return 0;
  const loc = (l.location ?? "").toLowerCase();
  const w = want.toLowerCase();
  const city = w.split(/[,\s]+/).find((t) => t.length > 3 && loc.includes(t));
  if (city) return 0.3;
  if (/remote/.test(w) && (l.remote || /remote/.test(loc))) return 0.25;
  if (isIndiaLocation(w) && isIndiaLocation(loc)) return 0.2;
  if (l.remote || /remote|anywhere/.test(loc)) return 0.1;
  return 0;
}

/**
 * Job Research Agent core: pull listings from permitted sources, keep the ones relevant to the role
 * (title rules + embeddings + location), fetch full descriptions and store them with requirements.
 */
export async function researchJobs(input: ResearchInput): Promise<ResearchResult> {
  const limit = input.limit ?? 25;
  const say = async (m: string) => void (await input.onProgress?.(m));
  const region = regionFor(input.location);

  const boards: Board[] = [
    ...(input.onlyCompanies ? [] : SEED_BOARDS.filter((b) => b.regions.includes(region))),
    ...(input.companies ?? []).map((c) => ({ ats: c.ats, token: c.token, company: c.company ?? c.token, regions: [region] })),
  ];
  const failedSources: string[] = [];
  const sources: Record<string, number> = {};

  await say(`Scanning ${boards.length} company job boards${!input.onlyCompanies && adzunaEnabled() ? " + Adzuna" : ""}…`);
  const fetched = await mapLimit(boards, 4, async (b) => {
    try {
      return await boardFor(b.ats, b.token, b.company);
    } catch (e) {
      failedSources.push(`${b.ats}:${b.token}`);
      throw e;
    }
  });
  let listings: Listing[] = fetched.flatMap((x) => x ?? []);

  if (!input.onlyCompanies) {
    if (adzunaEnabled()) {
      try {
        listings.push(...(await adzunaSearch(input.role, adzunaCountry(input.location), 40, input.location)));
      } catch {
        failedSources.push("adzuna");
      }
    }
    if (region === "global") {
      try {
        listings.push(...(await arbeitnowJobs(2)));
      } catch {
        failedSources.push("arbeitnow");
      }
    }
  }
  const scanned = listings.length;
  await say(`Scanned ${scanned} open roles. Ranking by relevance to "${input.role}"…`);

  // Cheap title pre-filter before embeddings (big boards list hundreds of roles).
  listings = listings.filter((l) => locationAllowed(input.location, l) && titleScore(input.role, l.title) > 0.15);
  const ranked = (await rankByRelevance(input.role, listings, (l) => l.title))
    .map((r) => ({ ...r, score: r.score + locationBoost(input.location, r.item) }))
    .filter((r) => r.score >= RELEVANCE_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  // One posting per (company, title): boards often list the same role per city.
  const seen = new Set<string>();
  const picked = ranked.filter((r) => {
    const k = `${r.item.company}|${r.item.title}`.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, Math.ceil(limit * 1.5));

  await say(`${ranked.length} relevant roles found. Reading the top ${picked.length} job descriptions…`);
  const stored = await mapLimit(picked, 4, async ({ item }) => {
    const description = item.description ?? (await item.fetchDescription?.()) ?? "";
    if (description.length < MIN_DESCRIPTION && item.source !== "adzuna") return null;
    const { id } = await upsertJob({
      source: item.source,
      sourceId: item.sourceId,
      url: item.url,
      company: item.company,
      title: item.title,
      location: item.location,
      remote: item.remote,
      postedAt: item.postedAt,
      description,
    });
    await saveJobForUser(input.userId, id);
    sources[item.source] = (sources[item.source] ?? 0) + 1;
    return id;
  });
  const jobIds = [...new Set(stored.filter((x): x is string => Boolean(x)))].slice(0, limit);
  await say(`Saved ${jobIds.length} job descriptions with extracted requirements.`);
  return { jobIds, scanned, relevant: ranked.length, sources, failedSources };
}
