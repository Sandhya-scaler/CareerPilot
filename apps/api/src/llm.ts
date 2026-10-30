import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { config } from "./config.js";

/**
 * Thin wrapper over Claude structured outputs.
 *
 * Every LLM-backed feature in CareerPilot has a deterministic fallback, so callers check
 * `llmEnabled()` and degrade gracefully when no key is configured or a call fails.
 */
let client: Anthropic | null = null;

export const llmEnabled = () => Boolean(config.ANTHROPIC_API_KEY);

function getClient() {
  client ??= new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, maxRetries: 3 });
  return client;
}

export class LlmError extends Error {}

export type Tier = "reasoning" | "extraction";

export interface StructuredCall<S extends z.ZodType> {
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
  if (!llmEnabled()) throw new LlmError("ANTHROPIC_API_KEY not configured");
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

  if (response.stop_reason === "refusal") throw new LlmError("model declined the request");
  if (response.stop_reason === "max_tokens") throw new LlmError("response truncated (max_tokens)");
  if (response.parsed_output == null) throw new LlmError("response did not match schema");
  return response.parsed_output as z.infer<S>;
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
