import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

/**
 * Local sentence embeddings (BAAI/bge-small-en-v1.5, 384-d) via transformers.js.
 * With EMBEDDINGS=off (tests, low-resource machines) every caller falls back to lexical similarity.
 */
export const EMBED_DIM = 384;
export const embeddingsEnabled = () => config.EMBEDDINGS === "local";

type Extractor = (texts: string[], opts: object) => Promise<{ tolist(): number[][] }>;
let extractor: Promise<Extractor> | null = null;

async function load(): Promise<Extractor> {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.cacheDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../.cache/models");
  return (await pipeline("feature-extraction", "Xenova/bge-small-en-v1.5", { dtype: "q8" })) as unknown as Extractor;
}

export async function embed(texts: string[]): Promise<number[][] | null> {
  if (!embeddingsEnabled() || texts.length === 0) return null;
  extractor ??= load();
  const fe = await extractor;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 32) {
    const batch = texts.slice(i, i + 32).map((t) => t.slice(0, 2000));
    out.push(...(await fe(batch, { pooling: "cls", normalize: true })).tolist());
  }
  return out;
}

export async function embedOne(text: string): Promise<number[] | null> {
  return (await embed([text]))?.[0] ?? null;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const STOP = new Set("a an and the of for to in on with at by or is are be as we you our your from".split(" "));

export function tokens(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/[^a-z0-9+#.]+/).filter((t) => t.length > 1 && !STOP.has(t)),
  );
}

/** Jaccard overlap of word tokens; the no-embeddings fallback. */
export function lexicalSimilarity(a: string, b: string): number {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}
