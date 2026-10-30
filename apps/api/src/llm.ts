import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { config } from "./config.js";
import { currentUserId } from "./context.js";
import { query } from "./db/pool.js";

/**
 * Structured-output LLM calls. Providers, in order of preference:
 *   1. Claude (ANTHROPIC_API_KEY): native structured outputs.
 *   2. Any OpenAI-compatible endpoint (LLM_BASE_URL): free options are Ollama (local), Groq and
 *      Gemini's free tiers. Output is requested as JSON and validated against the same zod schema.
 *   3. None: every feature falls back to its deterministic rules.
 * Callers check `llmEnabled()` (via withFallback) and degrade gracefully on any failure.
 */
let client: Anthropic | null = null;

export type Provider = "anthropic" | "openai-compatible" | "none";

export function llmProvider(): Provider {
  if (config.ANTHROPIC_API_KEY) return "anthropic";
  if (config.LLM_BASE_URL && config.LLM_MODEL) {
    // Hosted APIs need a key; a local server (Ollama on localhost / a private network name) doesn't.
    const host = new URL(config.LLM_BASE_URL).hostname;
    const local = host === "localhost" || host === "127.0.0.1" || !host.includes(".");
    if (config.LLM_API_KEY || local) return "openai-compatible";
  }
  return "none";
}

export const llmEnabled = () => llmProvider() !== "none";

function getClient() {
  client ??= new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, maxRetries: 3 });
  return client;
}

export class LlmError extends Error {}

export type Tier = "reasoning" | "extraction";

/** USD per million tokens (input, output, cache read). Keep in sync with Anthropic pricing. */
const PRICES: Record<string, [number, number, number]> = {
  "claude-opus-5-5": [4, 20, 0.2],
  "claude-sonnet-5-5": [2, 10, 0.2],
  "claude-haiku-5-5": [0.1, 0.5, 0.01],
};

export function costUsd(model: string, input: number, output: number, cacheRead = 0): number {
  const [i, o, c] = PRICES[model] ?? [4, 20, 0.2]; // unknown model: assume Opus-tier so we never under-report
  return (input * i + output * o + cacheRead * c) / 1_000_000;
}

async function recordUsage(
  label: string,
  model: string,
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null },
  fixedCost?: number,
) {
  try {
    await query(
      `INSERT INTO llm_usage (user_id, label, model, input_tokens, output_tokens, cache_read_tokens, cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [currentUserId(), label, model, usage.input_tokens, usage.output_tokens, usage.cache_read_input_tokens ?? 0,
        fixedCost ?? costUsd(model, usage.input_tokens, usage.output_tokens, usage.cache_read_input_tokens ?? 0)],
    );
  } catch (e) {
    console.warn("[llm] usage not recorded:", (e as Error).message);
  }
}

export interface StructuredCall<S extends z.ZodType> {
  /** For usage accounting. */
  label?: string;
  tier: Tier;
  /** Stable instructions. Kept byte-identical across calls so prompt caching hits. */
  system: string;
  /** Per-request content (JD text, resume text, ...). */
  input: string;
  schema: S;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}

export async function structured<S extends z.ZodType>(call: StructuredCall<S>): Promise<z.infer<S>> {
  const provider = llmProvider();
  if (provider === "none") throw new LlmError("no LLM configured");
  if (provider === "openai-compatible") return openAiCompatible(call);
  const model = call.tier === "reasoning" ? config.CLAUDE_REASONING_MODEL : config.CLAUDE_EXTRACTION_MODEL;
  // Server-side refusal fallback is available on Opus/Sonnet 5.5-class models, not Haiku.
  const withFallback = !model.includes("haiku");

  const response = await getClient().beta.messages.parse({
    model,
    max_tokens: call.maxTokens ?? 16000,
    system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: call.input }],
    output_config: {
      format: betaZodOutputFormat(call.schema),
      effort: call.effort ?? (call.tier === "reasoning" ? "medium" : "low"),
    },
    ...(withFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  });

  await recordUsage(call.label ?? call.tier, model, response.usage);
  if (response.stop_reason === "refusal") throw new LlmError("model declined the request");
  if (response.stop_reason === "max_tokens") throw new LlmError("response truncated (max_tokens)");
  if (response.parsed_output == null) throw new LlmError("response did not match schema");
  return response.parsed_output as z.infer<S>;
}

/**
 * OpenAI-compatible chat completions (Ollama, Groq, Gemini, OpenRouter, ...). Asks for JSON that
 * matches the zod schema (json_schema response format, falling back to json_object + the schema in
 * the prompt for providers that don't support it) and validates the result with zod.
 */
async function openAiCompatible<S extends z.ZodType>(call: StructuredCall<S>): Promise<z.infer<S>> {
  const model = call.tier === "extraction" ? (config.LLM_EXTRACTION_MODEL ?? config.LLM_MODEL!) : config.LLM_MODEL!;
  const schema = z.toJSONSchema(call.schema);
  const deadline = Date.now() + config.LLM_TOTAL_BUDGET_MS;
  const base = config.LLM_BASE_URL!.replace(/\/$/, "");
  const post = (responseFormat: object, system: string, model: string) =>
    fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(config.LLM_API_KEY ? { authorization: `Bearer ${config.LLM_API_KEY}` } : {}) },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: Math.min(call.maxTokens ?? 8000, 8000),
        response_format: responseFormat,
        messages: [
          { role: "system", content: system },
          { role: "user", content: call.input },
        ],
      }),
      signal: AbortSignal.timeout(Math.max(1000, Math.min(config.LLM_TIMEOUT_MS, deadlineLeft()))),
    });

  const deadlineLeft = () => deadline - Date.now();
  const withSchema = `${call.system}\n\nRespond with only a JSON object matching this JSON Schema:\n${JSON.stringify(schema)}`;
  // Free tiers fail in two ways: 503 "busy" (retry once after a pause) and 429 "quota" (per-model
  // daily/minute limits: go straight to the next model). Timeouts also move on. The whole call has a
  // time budget; past it, the caller's rules-based fallback takes over.
  const models = [model, ...(config.LLM_FALLBACK_MODELS ?? "").split(",").map((m) => m.trim()).filter((m) => m && m !== model)];
  let res: Response | null = null;
  let usedModel = model;
  outer: for (const m of models) {
    usedModel = m;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (Date.now() > deadline) break outer;
      try {
        res = await post({ type: "json_schema", json_schema: { name: "output", schema } }, withSchema, m);
        if (res.status === 400 || res.status === 422) res = await post({ type: "json_object" }, withSchema, m);
      } catch (e) {
        // Timeout or network error: this model is too slow right now, so move to the next one.
        res = null;
        console.warn(`[llm] ${m}: ${(e as Error).message}; trying next model`);
        continue outer;
      }
      if (res.ok) break outer;
      if (res.status === 429) continue outer; // this model's quota is used up: next model
      if (res.status < 500) break outer; // a real error (bad key, bad request): don't retry
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Math.min(10_000, (retryAfter > 0 ? retryAfter * 1000 : 0) || config.LLM_RETRY_BASE_MS * 3 ** attempt);
      if (Date.now() + wait > deadline) break outer;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  if (!res) throw new LlmError(`${new URL(base).host}: no model answered within the time budget`);
  if (!res.ok) throw new LlmError(`${new URL(base).host} returned ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  await recordUsage(call.label ?? call.tier, usedModel, {
    input_tokens: data.usage?.prompt_tokens ?? 0,
    output_tokens: data.usage?.completion_tokens ?? 0,
  }, 0);
  const choice = data.choices?.[0];
  if (choice?.finish_reason === "length") throw new LlmError("response truncated");
  const text = (choice?.message?.content ?? "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new LlmError("response was not valid JSON");
  }
  const parsed = call.schema.safeParse(json);
  if (!parsed.success) throw new LlmError(`response did not match schema: ${parsed.error.issues[0]?.message}`);
  return parsed.data as z.infer<S>;
}

/** Runs an LLM call, returning `fallback()` if the LLM is disabled or errors. */
export async function withFallback<T>(
  label: string,
  llm: () => Promise<T>,
  fallback: () => T | Promise<T>,
): Promise<{ value: T; usedLlm: boolean }> {
  if (!llmEnabled()) return { value: await fallback(), usedLlm: false };
  try {
    return { value: await llm(), usedLlm: true };
  } catch (e) {
    console.warn(`[llm] ${label} failed, using fallback: ${(e as Error).message}`);
    return { value: await fallback(), usedLlm: false };
  }
}
