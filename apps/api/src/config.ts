import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().default("postgres://localhost:5432/careerpilot"),
  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_REASONING_MODEL: z.string().default("claude-opus-5-5"),
  CLAUDE_EXTRACTION_MODEL: z.string().default("claude-haiku-5-5"),
  // Free alternative: any OpenAI-compatible endpoint (used when ANTHROPIC_API_KEY is unset).
  //   Gemini (free tier): LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
  //                       LLM_API_KEY=<from aistudio.google.com>  LLM_MODEL=gemini-3.5-flash
  //   Ollama (local):     LLM_BASE_URL=http://localhost:11434/v1  LLM_MODEL=qwen2.5:3b
  //   Groq (free tier):   LLM_BASE_URL=https://api.groq.com/openai/v1  LLM_API_KEY=...  LLM_MODEL=<see console.groq.com>
  LLM_BASE_URL: z.string().url().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),
  LLM_EXTRACTION_MODEL: z.string().optional(),
  /** Comma-separated models to try when the main one is busy or rate-limited. */
  LLM_FALLBACK_MODELS: z.string().optional(),
  LLM_RETRY_BASE_MS: z.coerce.number().default(1500),
  /** Max total time for one AI call across retries and fallback models, then rules take over. */
  LLM_TOTAL_BUDGET_MS: z.coerce.number().default(240_000),
  LLM_TIMEOUT_MS: z.coerce.number().default(180_000),
  EMBEDDINGS: z.enum(["local", "off"]).default("local"),
  ADZUNA_APP_ID: z.string().optional(),
  ADZUNA_APP_KEY: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  // PORT is what most hosts (Render, Railway, Fly) inject.
  API_PORT: z.coerce.number().default(Number(process.env.PORT) || 4000),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  SESSION_SECRET: z.string().min(16).default("dev-only-secret-change-me"),
  NODE_ENV: z.string().default("development"),
  /** smtps://user:pass@host:465 (any provider). Unset = no emails. */
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default("CareerPilot <reports@careerpilot.local>"),
  /** Public URL of the web app, for links in emails. */
  APP_URL: z.string().default("http://localhost:3000"),
  /** Comma-separated emails that get admin access (beta metrics). */
  ADMIN_EMAILS: z.string().default(""),
});

// Empty strings in .env mean "unset".
const raw = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ""),
);

export const config = Env.parse(raw);
export const isProd = config.NODE_ENV === "production";

if (isProd && (config.SESSION_SECRET === "dev-only-secret-change-me" || config.SESSION_SECRET.length < 32)) {
  throw new Error("SESSION_SECRET must be set to a random string of 32+ characters in production");
}
