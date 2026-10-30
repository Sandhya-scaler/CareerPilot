import { config } from "../config.js";
import { cached, getJson, htmlToText, SourceError } from "./http.js";

/**
 * Connectors for job sources that publish listings for exactly this purpose (docs/01-research.md §3).
 * No scraping of sites whose terms forbid it.
 */

export type Ats = "greenhouse" | "lever" | "ashby";

/** Cheap listing entry used for relevance filtering before fetching full descriptions. */
export interface Listing {
  source: string;
  sourceId: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean | null;
  url: string | null;
  postedAt: string | null;
  /** Present when the listing endpoint already includes it (Lever, Ashby, Adzuna, Arbeitnow). */
  description?: string;
  /** For Greenhouse: fetch the description lazily. */
  fetchDescription?: () => Promise<string>;
}

// ---- Greenhouse ------------------------------------------------------------------------------------

interface GhJob {
  id: number;
  title: string;
  location?: { name?: string };
  absolute_url?: string;
  first_published?: string;
  updated_at?: string;
  company_name?: string;
  content?: string;
}

export async function greenhouseBoard(token: string, company = token): Promise<Listing[]> {
  const data = await cached(`gh:${token}`, () => getJson<{ jobs: GhJob[] }>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs`));
  return data.jobs.map((j) => ({
    source: "greenhouse",
    sourceId: `${token}:${j.id}`,
    title: j.title,
    company: j.company_name ?? company,
    location: j.location?.name ?? null,
    remote: /remote/i.test(j.location?.name ?? "") || null,
    url: j.absolute_url ?? null,
    postedAt: j.first_published ?? j.updated_at ?? null,
    fetchDescription: async () => {
      const full = await cached(`gh:${token}:${j.id}`, () =>
        getJson<GhJob>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs/${j.id}`),
      );
      return htmlToText(full.content ?? "");
    },
  }));
}

// ---- Lever -----------------------------------------------------------------------------------------

interface LeverJob {
  id: string;
  text: string;
  hostedUrl?: string;
  createdAt?: number;
  workplaceType?: string;
  categories?: { location?: string; team?: string; commitment?: string };
  descriptionPlain?: string;
  lists?: { text: string; content: string }[];
  additionalPlain?: string;
}

export async function leverBoard(slug: string, company = slug): Promise<Listing[]> {
  const jobs = await cached(`lever:${slug}`, () => getJson<LeverJob[]>(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`));
  return jobs.map((j) => ({
    source: "lever",
    sourceId: `${slug}:${j.id}`,
    title: j.text,
    company,
    location: j.categories?.location ?? null,
    remote: j.workplaceType ? j.workplaceType === "remote" : null,
    url: j.hostedUrl ?? null,
    postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    description: [
      j.descriptionPlain ?? "",
      ...(j.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`),
      j.additionalPlain ?? "",
    ].join("\n\n").trim(),
  }));
}

// ---- Ashby -----------------------------------------------------------------------------------------

interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  isRemote?: boolean;
  jobUrl?: string;
  publishedAt?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  isListed?: boolean;
}

export async function ashbyBoard(org: string, company = org): Promise<Listing[]> {
  const data = await cached(`ashby:${org}`, () =>
    getJson<{ jobs: AshbyJob[] }>(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(org)}?includeCompensation=false`),
  );
  return data.jobs
    .filter((j) => j.isListed !== false)
    .map((j) => ({
      source: "ashby",
      sourceId: `${org}:${j.id}`,
      title: j.title,
      company,
      location: j.location ?? null,
      remote: j.isRemote ?? null,
      url: j.jobUrl ?? null,
      postedAt: j.publishedAt ?? null,
      description: j.descriptionPlain || htmlToText(j.descriptionHtml ?? ""),
    }));
}

export function boardFor(ats: Ats, token: string, company?: string) {
  switch (ats) {
    case "greenhouse":
      return greenhouseBoard(token, company);
    case "lever":
      return leverBoard(token, company);
    case "ashby":
      return ashbyBoard(token, company);
  }
}

// ---- Adzuna (aggregator; free key) ------------------------------------------------------------------

interface AdzunaResult {
  id: string;
  title: string;
  description: string;
  redirect_url: string;
  created: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
}

export const adzunaEnabled = () => Boolean(config.ADZUNA_APP_ID && config.ADZUNA_APP_KEY);

/**
 * Adzuna search. Note: Adzuna returns description *snippets* (~500 chars), so these jobs contribute
 * fewer requirements than full postings. Attribution to Adzuna is shown in the UI per their terms.
 */
export async function adzunaSearch(role: string, country: string, limit = 20, where?: string | null): Promise<Listing[]> {
  if (!adzunaEnabled()) return [];
  const params = new URLSearchParams({
    app_id: config.ADZUNA_APP_ID!,
    app_key: config.ADZUNA_APP_KEY!,
    results_per_page: String(Math.min(limit, 50)),
    what: role,
    "content-type": "application/json",
  });
  if (where) params.set("where", where);
  const url = `https://api.adzuna.com/v1/api/jobs/${encodeURIComponent(country)}/search/1?${params}`;
  const data = await cached(`adzuna:${country}:${role}:${where ?? ""}`, () => getJson<{ results: AdzunaResult[] }>(url), 12 * 3600 * 1000);
  return data.results.map((r) => ({
    source: "adzuna",
    sourceId: r.id,
    title: htmlToText(r.title),
    company: r.company?.display_name ?? "Unknown",
    location: r.location?.display_name ?? null,
    remote: null,
    url: r.redirect_url,
    postedAt: r.created,
    description: htmlToText(r.description),
  }));
}

// ---- Arbeitnow (EU + remote; no key) -------------------------------------------------------------

interface ArbeitnowJob {
  slug: string;
  title: string;
  company_name: string;
  description: string;
  remote: boolean;
  url: string;
  location: string;
  created_at: number;
}

export async function arbeitnowJobs(pages = 2): Promise<Listing[]> {
  const out: Listing[] = [];
  for (let page = 1; page <= pages; page++) {
    const data = await cached(`arbeitnow:${page}`, () => getJson<{ data: ArbeitnowJob[] }>(`https://www.arbeitnow.com/api/job-board-api?page=${page}`));
    out.push(
      ...data.data.map((j) => ({
        source: "arbeitnow",
        sourceId: j.slug,
        title: j.title,
        company: j.company_name,
        location: j.location,
        remote: j.remote,
        url: j.url,
        postedAt: new Date(j.created_at * 1000).toISOString(),
        description: htmlToText(j.description),
      })),
    );
  }
  return out;
}

export { SourceError };
