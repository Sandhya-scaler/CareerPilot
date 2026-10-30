/**
 * Offline CLI (no database needed):
 *   npm run cli -- match <resume.pdf|docx|txt> <jd.txt>
 *   npm run cli -- jd <jd.txt>
 *   npm run cli -- resume <resume.pdf>
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractRequirements } from "./extract/jd.js";
import { parseResume } from "./extract/resume.js";
import { fileToText } from "./extract/text.js";
import { matchRequirements } from "./scoring.js";
import { taxonomy } from "./skills/taxonomy.js";
import { TIER_LABEL } from "./types.js";

const [cmd, a, b] = process.argv.slice(2);

// `npm run cli -w apps/api` runs from apps/api; resolve paths against where the user typed the command.
const load = async (p: string) => fileToText(await readFile(path.resolve(process.env.INIT_CWD ?? process.cwd(), p)), path.basename(p));
const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
const bar = (x: number) => "█".repeat(Math.round(x * 10)).padEnd(10, "·");

async function main() {
  if (cmd === "resume" && a) {
    const r = await parseResume(await load(a));
    console.log(`${r.name ?? "(no name found)"} · ${r.evidence.length} evidence lines${r.usedLlm ? " · Claude-assisted" : ""}\n`);
    for (const e of r.evidence) console.log(`T${e.tier} ${pad(e.skills.join(", "), 34)} ${pad(e.text, 90)}`);
    return;
  }
  if (cmd === "jd" && a) {
    const { requirements, usedLlm } = await extractRequirements(await load(a));
    console.log(`${requirements.length} requirements${usedLlm ? " · Claude-assisted" : ""}\n`);
    for (const r of requirements) console.log(`${r.kind.padEnd(4)} ${pad(r.skill, 24)} ${pad(r.sourceSentence, 90)}`);
    return;
  }
  if (cmd === "match" && a && b) {
    const [resume, jd] = await Promise.all([parseResume(await load(a)), extractRequirements(await load(b))]);
    const result = matchRequirements(jd.requirements, resume.evidence, taxonomy);
    console.log(`\nCoverage ${Math.round(result.coverage * 100)}%  (must-haves ${Math.round(result.mustCoverage * 100)}%)\n`);
    console.log(`${pad("SKILL", 22)} ${"KIND".padEnd(5)} ${"EVIDENCE".padEnd(10)}  ${pad("JD ASKS", 44)}  YOUR EVIDENCE`);
    for (const i of result.items) {
      if (!i.scored) continue;
      const e = i.evidence;
      const ev = e.item
        ? `${e.via === "adjacent" ? `~${e.viaSkill}: ` : e.via === "implied" ? `via ${e.viaSkill}: ` : ""}[${TIER_LABEL[e.item.tier]}] ${e.item.text}`
        : "— missing";
      console.log(`${pad(i.skill, 22)} ${i.kind.padEnd(5)} ${bar(e.score)}  ${pad(i.requirement.sourceSentence, 44)}  ${pad(ev, 80)}`);
    }
    const soft = result.items.filter((i) => !i.scored).map((i) => i.skill);
    if (soft.length) console.log(`\nAlso mentioned (not scored): ${soft.join(", ")}`);
    return;
  }
  console.log("usage:\n  npm run cli -- match <resume> <jd>\n  npm run cli -- jd <jd>\n  npm run cli -- resume <resume>");
  process.exitCode = 1;
}

await main();
