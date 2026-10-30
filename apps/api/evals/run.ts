/**
 * Extraction eval (docs/05-evaluation.md). Usage:
 *   npm run eval              # rule-based extractors (no API key needed)
 *   npm run eval -- --llm     # rule-based ∪ Claude (needs ANTHROPIC_API_KEY)
 *   npm run eval -- --verbose # print per-document misses
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractRequirements, extractRequirementsRules } from "../src/extract/jd.js";
import { parseResume, parseResumeRules } from "../src/extract/resume.js";
import { config } from "../src/config.js";
import { llmProvider } from "../src/llm.js";
import { bestBySkill } from "../src/scoring.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const useLlm = process.argv.includes("--llm");
const verbose = process.argv.includes("--verbose");

interface Labels {
  jds: Record<string, { must: string[]; nice: string[] }>;
  resumes: Record<string, Record<string, number>>;
}

export interface EvalReport {
  jd: { precision: number; recall: number; kindAccuracy: number; docs: number };
  resume: { precision: number; recall: number; tierWithin1: number; tierExact: number; docs: number };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export async function runEval(opts = { useLlm: false, verbose: false }): Promise<EvalReport> {
  const labels: Labels = JSON.parse(await readFile(path.join(here, "data/labels.json"), "utf8"));

  let tp = 0, fp = 0, fn = 0, kindOk = 0;
  for (const [name, gold] of Object.entries(labels.jds)) {
    const text = await readFile(path.join(here, `data/jds/${name}.txt`), "utf8");
    const reqs = opts.useLlm ? (await extractRequirements(text)).requirements : extractRequirementsRules(text);
    const goldKind = new Map<string, string>([...gold.must.map((s) => [s, "must"] as const), ...gold.nice.map((s) => [s, "nice"] as const)]);
    const got = new Map(reqs.map((r) => [r.skill, r.kind]));
    const misses: string[] = [];
    for (const [skill, kind] of got) {
      if (goldKind.has(skill)) {
        tp++;
        if (goldKind.get(skill) === kind) kindOk++;
        else misses.push(`kind ${skill}: got ${kind}, want ${goldKind.get(skill)}`);
      } else {
        fp++;
        misses.push(`extra ${skill}`);
      }
    }
    for (const skill of goldKind.keys()) if (!got.has(skill)) (fn++, misses.push(`missed ${skill}`));
    if (opts.verbose && misses.length) console.log(`JD ${name}:\n  ${misses.join("\n  ")}`);
  }
  const jd = { precision: tp / (tp + fp), recall: tp / (tp + fn), kindAccuracy: kindOk / tp, docs: Object.keys(labels.jds).length };

  let rtp = 0, rfp = 0, rfn = 0, within1 = 0, exact = 0;
  for (const [name, gold] of Object.entries(labels.resumes)) {
    const text = await readFile(path.join(here, `data/resumes/${name}.txt`), "utf8");
    const parsed = opts.useLlm ? await parseResume(text) : parseResumeRules(text);
    const best = bestBySkill(parsed.evidence);
    const misses: string[] = [];
    for (const [skill, item] of best) {
      const want = gold[skill];
      if (want === undefined) {
        rfp++;
        misses.push(`extra ${skill} (tier ${item.tier}: "${item.text.slice(0, 60)}")`);
        continue;
      }
      rtp++;
      if (Math.abs(item.tier - want) <= 1) within1++;
      if (item.tier === want) exact++;
      else misses.push(`tier ${skill}: got ${item.tier}, want ${want}`);
    }
    for (const skill of Object.keys(gold)) if (!best.has(skill)) (rfn++, misses.push(`missed ${skill}`));
    if (opts.verbose && misses.length) console.log(`Resume ${name}:\n  ${misses.join("\n  ")}`);
  }
  const resume = {
    precision: rtp / (rtp + rfp), recall: rtp / (rtp + rfn), tierWithin1: within1 / rtp, tierExact: exact / rtp,
    docs: Object.keys(labels.resumes).length,
  };
  return { jd, resume };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await runEval({ useLlm, verbose });
  const model = llmProvider() === "anthropic" ? config.CLAUDE_EXTRACTION_MODEL : config.LLM_EXTRACTION_MODEL ?? config.LLM_MODEL;
  console.log(`\nMode: ${useLlm ? `rules + ${llmProvider() === "none" ? "no model configured (rules only)" : model}` : "rules only"}`);
  console.log(`JD requirements (${r.jd.docs} docs):  precision ${pct(r.jd.precision)}  recall ${pct(r.jd.recall)}  must/nice accuracy ${pct(r.jd.kindAccuracy)}`);
  console.log(`Resume evidence (${r.resume.docs} docs): precision ${pct(r.resume.precision)}  recall ${pct(r.resume.recall)}  tier ±1 ${pct(r.resume.tierWithin1)}  tier exact ${pct(r.resume.tierExact)}`);
  await mkdir(path.join(here, "results"), { recursive: true });
  const file = path.join(here, "results", `${new Date().toISOString().slice(0, 10)}-${useLlm ? "llm" : "rules"}.json`);
  await writeFile(file, JSON.stringify(r, null, 2));
  console.log(`saved ${path.relative(process.cwd(), file)}`);
}
