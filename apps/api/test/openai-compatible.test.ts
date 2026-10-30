import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { config } from "../src/config.js";
import { pool, query } from "../src/db/pool.js";
import { extractRequirements } from "../src/extract/jd.js";
import { llmProvider, structured } from "../src/llm.js";
import { resetDb } from "./helpers.js";

/** A fake OpenAI-compatible server (what Ollama, Groq and Gemini expose). */
let reply: (body: { response_format: { type: string } }) => { status: number; json: unknown };
const requests: { response_format: { type: string }; model: string; messages: { role: string; content: string }[] }[] = [];
let server: Server;

const cfg = config as unknown as Record<string, unknown>;

beforeAll(async () => {
  await resetDb();
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw);
      requests.push(body);
      const r = reply(body);
      res.writeHead(r.status, { "content-type": "application/json" });
      res.end(JSON.stringify(r.json));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  cfg.LLM_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  cfg.LLM_MODEL = "qwen2.5:3b";
});
afterAll(async () => {
  cfg.LLM_BASE_URL = undefined;
  cfg.LLM_MODEL = undefined;
  await new Promise<void>((r) => server.close(() => r()));
  await pool.end();
});
beforeEach(() => (requests.length = 0));

const chat = (content: string, finish = "stop") => ({
  status: 200,
  json: { choices: [{ message: { content }, finish_reason: finish }], usage: { prompt_tokens: 120, completion_tokens: 30 } },
});
const Schema = z.object({ skills: z.array(z.string()) });

describe("OpenAI-compatible provider (free: Ollama / Groq / Gemini)", () => {
  it("is selected when LLM_BASE_URL is set and no Anthropic key exists", () => {
    expect(llmProvider()).toBe("openai-compatible");
  });

  it("stays off for a hosted API without a key (no failing calls on every request)", () => {
    const local = cfg.LLM_BASE_URL;
    cfg.LLM_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
    expect(llmProvider()).toBe("none");
    cfg.LLM_API_KEY = "test-key";
    expect(llmProvider()).toBe("openai-compatible");
    cfg.LLM_API_KEY = undefined;
    cfg.LLM_BASE_URL = local;
  });

  it("requests json_schema output and validates it", async () => {
    reply = () => chat('{"skills":["PyTorch"]}');
    const out = await structured({ label: "t", tier: "reasoning", system: "sys", input: "in", schema: Schema });
    expect(out).toEqual({ skills: ["PyTorch"] });
    expect(requests[0]!.response_format.type).toBe("json_schema");
    expect(requests[0]!.model).toBe("qwen2.5:3b");
    expect(requests[0]!.messages[0]!.content).toContain("JSON Schema");
  });

  it("retries with json_object when json_schema is unsupported, and strips code fences", async () => {
    reply = (b) => (b.response_format.type === "json_schema" ? { status: 400, json: { error: "unsupported" } } : chat('```json\n{"skills":[]}\n```'));
    expect(await structured({ tier: "extraction", system: "s", input: "i", schema: Schema })).toEqual({ skills: [] });
    expect(requests.map((r) => r.response_format.type)).toEqual(["json_schema", "json_object"]);
  });

  it("rejects malformed or truncated output", async () => {
    reply = () => chat("not json at all");
    await expect(structured({ tier: "reasoning", system: "s", input: "i", schema: Schema })).rejects.toThrow(/not valid JSON/);
    reply = () => chat('{"skills":"PyTorch"}');
    await expect(structured({ tier: "reasoning", system: "s", input: "i", schema: Schema })).rejects.toThrow(/did not match schema/);
    reply = () => chat('{"skills":[', "length");
    await expect(structured({ tier: "reasoning", system: "s", input: "i", schema: Schema })).rejects.toThrow(/truncated/);
  });

  it("falls back to the rules when the model fails, and logs free calls at $0", async () => {
    reply = () => chat("garbage");
    const r = await extractRequirements("Requirements:\n- Strong Python and SQL.\n- Experience with Docker.");
    expect(r.usedLlm).toBe(false);
    expect(r.requirements.map((x) => x.skill).sort()).toEqual(["Docker", "Python", "SQL"]);
    const [row] = await query<{ cost: number }>("SELECT sum(cost_usd)::float AS cost FROM llm_usage");
    expect(row!.cost).toBe(0);
  });
});
