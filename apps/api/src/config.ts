import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().default("postgres://localhost:5432/careerpilot"),
  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_REASONING_MODEL: z.string().default("claude-opus-5-5"),
  CLAUDE_EXTRACTION_MODEL: z.string().default("claude-haiku-5-5"),
  EMBEDDINGS: z.enum(["local", "off"]).default("local"),
  ADZUNA_APP_ID: z.string().optional(),
  ADZUNA_APP_KEY: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  API_PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  SESSION_SECRET: z.string().min(16).default("dev-only-secret-change-me"),
  NODE_ENV: z.string().default("development"),
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
