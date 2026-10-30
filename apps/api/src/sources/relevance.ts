import { cosine, embed, lexicalSimilarity } from "../embeddings.js";

/**
 * Job-title relevance for a target role. Measured on real titles (2026-10-30): title embeddings
 * alone rank "Frontend Engineer" above "Backend Engineer" for "Backend Developer", so we combine
 *   - role-family keywords (with opposing families penalized),
 *   - seniority fit (interns shouldn't see Staff roles),
 *   - embedding similarity as a tie-breaker.
 */
interface Family {
  name: string;
  terms: RegExp;
  opposes?: string[];
}

const FAMILIES: Family[] = [
  { name: "cv", terms: /\b(computer vision|vision|perception|imaging|image|video|multimodal|cv|autonomy|robotics)\b/i },
  { name: "ml", terms: /\b(machine learning|ml|ai|applied scientist|research scientist|deep learning|mle|modeling|genai|llm)\b/i },
  { name: "genai", terms: /\b(genai|gen ai|generative|llm|nlp|language model|ai engineer|applied ai|conversational)\b/i },
  { name: "ds", terms: /\b(data scien\w*|decision scien\w*|quantitative|statistic\w*)\b/i },
  { name: "analyst", terms: /\b(analyst|analytics|business intelligence|bi|insights|reporting)\b/i },
  { name: "de", terms: /\b(data engineer\w*|data platform|etl|big data|analytics engineer)\b/i },
  { name: "backend", terms: /\b(backend|back[- ]end|server[- ]side|platform|api|distributed systems|infrastructure)\b/i, opposes: ["frontend", "mobile"] },
  { name: "frontend", terms: /\b(frontend|front[- ]end|ui engineer|web developer|react|javascript)\b/i, opposes: ["backend"] },
  { name: "fullstack", terms: /\b(full[- ]?stack)\b/i },
  { name: "mobile", terms: /\b(android|ios|mobile|flutter|react native)\b/i, opposes: ["backend"] },
  { name: "devops", terms: /\b(devops|sre|site reliability|cloud engineer|platform engineer|infrastructure)\b/i },
  { name: "security", terms: /\b(security|appsec|infosec|penetration|cyber)\b/i },
  { name: "qa", terms: /\b(qa|quality|test|sdet|automation engineer)\b/i },
  { name: "swe", terms: /\b(software engineer|software developer|sde|swe|developer|programmer)\b/i },
  { name: "design", terms: /\b(designer|ux|ui\/ux|product design)\b/i },
  { name: "product", terms: /\b(product manager|pm|program manager)\b/i },
];

const JUNIOR = /\b(intern(ship)?|trainee|apprentice|graduate|new grad|fresher|entry[- ]level|junior|jr\.?|associate|sde[- ]?(1|i)\b|campus)\b/i;
const SENIOR = /\b(senior|sr\.?|staff|principal|lead|head|director|manager|vp|architect|sde[- ]?(3|iii)\b|distinguished)\b/i;
const NON_TECH = /\b(sales|account executive|account manager|recruiter|talent|marketing|legal|counsel|finance|accountant|audit|hr|people partner|customer success|customer support|support specialist|support operations|office|executive assistant|business development|operations associate|operations|content|social media|sanctions|fraud|payroll|compliance|verifications?|travel|cst|strategy associate|program manager|project manager|product manager|product management|seller|selling|pre-?sales|chief of staff|partnerships|procurement|facilities|tax|treasury)\b/i;

/** Families close enough that a title in one is worth showing for a role in the other. */
const ADJACENT: Record<string, string[]> = {
  cv: ["ml", "genai"],
  ml: ["cv", "genai", "ds"],
  genai: ["ml"],
  ds: ["ml", "analyst"],
  analyst: ["ds", "de"],
  de: ["backend", "analyst"],
  backend: ["fullstack", "devops", "de"],
  frontend: ["fullstack"],
  fullstack: ["backend", "frontend"],
  devops: ["backend"],
};

function familiesOf(text: string): Set<string> {
  return new Set(FAMILIES.filter((f) => f.terms.test(text)).map((f) => f.name));
}

/**
 * Title relevance. A title must share a role family (or an adjacent one) with the target role to
 * be relevant at all; seniority/location/embeddings only re-rank within that set. Live testing
 * showed that without this gate, "Operations Associate" outranked real matches for an intern search.
 */
export function titleScore(role: string, title: string): number {
  const rf = familiesOf(role);
  const tf = familiesOf(title);
  if (NON_TECH.test(title) && !NON_TECH.test(role)) return -1;
  let score = 0;
  const shared = [...rf].filter((f) => tf.has(f));
  const specificShared = shared.filter((f) => f !== "swe");
  const adjacent = [...rf].some((f) => (ADJACENT[f] ?? []).some((a) => tf.has(a)));
  if (specificShared.length) score += 0.6;
  else if (adjacent) score += 0.35;
  else if (shared.includes("swe")) score += 0.3;
  else if (rf.size > 0) return -1; // no family in common: not relevant
  // Family overlap is the main signal; generic "swe" alone is weak.
  for (const f of FAMILIES) {
    if (rf.has(f.name) && f.opposes?.some((o) => tf.has(o) && !rf.has(o))) score -= 0.4;
  }
  // Seniority fit
  const wantJunior = JUNIOR.test(role);
  if (wantJunior && JUNIOR.test(title)) score += 0.2;
  if (wantJunior && SENIOR.test(title)) score -= 0.5;
  if (!wantJunior && SENIOR.test(role) && JUNIOR.test(title)) score -= 0.3;
  return score + 0.3 * lexicalSimilarity(role, title);
}

const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

/**
 * Ranks items by relevance to the role. Uses embeddings when available (weight 0.4 on the
 * cosine above a 0.5 baseline), otherwise title rules only.
 */
export async function rankByRelevance<T>(role: string, items: T[], text: (t: T) => string): Promise<{ item: T; score: number }[]> {
  const base = items.map((item) => ({ item, score: titleScore(role, text(item)) }));
  const vecs = await embed([QUERY_PREFIX + role, ...items.map(text)]);
  if (vecs) {
    const [q, ...rest] = vecs;
    // Embeddings re-rank relevant titles; they can't rescue a title the family gate rejected.
    base.forEach((b, i) => {
      if (b.score > 0) b.score += 0.8 * Math.max(0, cosine(q!, rest[i]!) - 0.5);
    });
  }
  return base.sort((a, b) => b.score - a.score);
}

/** Minimum score for a listing to be considered relevant. */
export const RELEVANCE_THRESHOLD = 0.45;
