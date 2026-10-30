/** Small helpers shared by job-source connectors: polite fetch, TTL cache, HTML → text. */

const UA = "CareerPilot/0.1 (personal job-research assistant; respects public job board APIs)";

export class SourceError extends Error {}

export async function getJson<T>(url: string, timeoutMs = 15_000): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new SourceError(`${res.status} from ${new URL(url).host}`);
  return (await res.json()) as T;
}

const cache = new Map<string, { at: number; value?: unknown; error?: Error; ttl: number }>();
export const BOARD_TTL_MS = 6 * 3600 * 1000;
const ERROR_TTL_MS = 10 * 60 * 1000;

/**
 * Memoizes a fetch for `ttlMs` (default 6h) so repeated research runs don't hammer job boards.
 * Failures are cached for 10 minutes too (a dead board shouldn't be retried on every search).
 */
export async function cached<T>(key: string, fn: () => Promise<T>, ttlMs = BOARD_TTL_MS): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) {
    if (hit.error) throw hit.error;
    return hit.value as T;
  }
  try {
    const value = await fn();
    cache.set(key, { at: Date.now(), value, ttl: ttlMs });
    return value;
  } catch (e) {
    cache.set(key, { at: Date.now(), error: e as Error, ttl: ERROR_TTL_MS });
    throw e;
  }
}

export function clearSourceCache() {
  cache.clear();
}

/** Runs `fn` over items with at most `limit` in flight. Failures become `null`. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array(items.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i]!);
      } catch (e) {
        console.warn(`[sources] ${(e as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", bull: "•" };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+|#39);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/** HTML job description → plain text that keeps headings, bullets and paragraphs on their own lines. */
export function htmlToText(html: string): string {
  let s = html.includes("&lt;") ? decodeEntities(html) : html; // Greenhouse double-escapes
  s = s
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "")
    .replace(/<\/(p|div|h[1-6]|ul|ol|tr|section)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<h[1-6][^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(s)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l, i, arr) => l || (arr[i - 1] ?? "") !== "")
    .join("\n")
    .trim();
}
