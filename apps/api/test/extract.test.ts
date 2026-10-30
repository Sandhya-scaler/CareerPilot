import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { alternativeSkills, extractRequirementsRules, guessTitle, sentences } from "../src/extract/jd.js";
import { parseResumeRules, sectionOf } from "../src/extract/resume.js";
import { findLinks, findMetrics, logicalLines } from "../src/extract/text.js";
import { taxonomy } from "../src/skills/taxonomy.js";
import { runEval } from "../evals/run.js";

const fixture = (p: string) => readFile(new URL(`../evals/data/${p}`, import.meta.url), "utf8");

describe("taxonomy", () => {
  it("matches aliases on word boundaries and normalizes", () => {
    const skills = taxonomy.findInText("Experience with PyTorch, k8s, REST APIs and C/C++.").map((m) => m.skill);
    expect(skills).toEqual(["PyTorch", "Kubernetes", "REST APIs", "C", "C++"]);
  });

  it("does not treat ordinary English as skills", () => {
    const text = "React to incidents quickly. Go above and beyond. You will excel. The rest of the team. Upload your CV. Series C funded.";
    expect(taxonomy.findInText(text)).toEqual([]);
  });

  it("normalizes LLM-style raw names", () => {
    expect(taxonomy.normalize("pytorch (deep learning)")).toBe("PyTorch");
    expect(taxonomy.normalize("Golang")).toBe("Go");
    expect(taxonomy.normalize("totally-unknown-tool")).toBeUndefined();
  });

  it("has a symmetric related graph", () => {
    expect(taxonomy.related("TensorFlow")).toContain("PyTorch");
    expect(taxonomy.related("PyTorch")).toContain("TensorFlow");
  });
});

describe("text helpers", () => {
  it("finds outcome metrics but not years", () => {
    const m = findMetrics("Reduced latency by 40% for 2M+ requests in 2024");
    expect(m.some((x) => x.includes("40%"))).toBe(true);
    expect(m.some((x) => x.includes("2024"))).toBe(false);
    expect(findMetrics("Graduated in 2024")).toEqual([]);
    expect(findMetrics("reached 0.86 AUC")).toEqual(["0.86 AUC"]);
    expect(findMetrics("weekly reports for 120 stores")).toEqual(["120 stores"]);
  });

  it("finds links with or without protocol", () => {
    expect(findLinks("code: github.com/a/b, demo https://x.dev/app.")).toEqual(["github.com/a/b", "https://x.dev/app"]);
  });

  it("re-joins hard-wrapped bullet lines", () => {
    const lines = ["• Built a pipeline that processes images from many cameras and", "stores results in Postgres.", "• Second bullet."];
    expect(logicalLines(lines, () => false)).toHaveLength(2);
  });
});

describe("resume parser", () => {
  it("detects common section headings", () => {
    expect(sectionOf("TECHNICAL SKILLS")).toBe("skills");
    expect(sectionOf("Work Experience:")).toBe("experience");
    expect(sectionOf("Positions of Responsibility")).toBe("leadership");
    expect(sectionOf("Built a CNN in PyTorch to classify images")).toBeNull();
  });

  it("grades evidence tiers from section, outcomes and links", async () => {
    const r = parseResumeRules(await fixture("resumes/cv-student.txt"));
    expect(r.email).toBe("aarav.mehta@example.com");
    expect(r.name).toBe("Aarav Mehta");
    const tierOf = (skill: string) => Math.max(...r.evidence.filter((e) => e.skills.includes(skill)).map((e) => e.tier));
    expect(tierOf("PyTorch")).toBe(1); // skills list only
    expect(tierOf("MATLAB")).toBe(2); // used, no outcome
    expect(tierOf("Keras")).toBe(3); // 98.9% accuracy
    expect(tierOf("OpenCV")).toBe(3); // project has a public repo
  });

  it("attaches bullets to their project/job title", async () => {
    const r = parseResumeRules(await fixture("resumes/backend-switcher.txt"));
    const airflow = r.evidence.find((e) => e.skills.includes("Apache Airflow") && e.section === "experience");
    expect(airflow?.context).toMatch(/FinServe/);
    expect(airflow?.metrics).toContain("40%");
  });

  it("does not read skills from URLs or degree names", async () => {
    const r = parseResumeRules(await fixture("resumes/cv-student.txt"));
    const git = r.evidence.filter((e) => e.skills.includes("Git"));
    expect(Math.max(...git.map((e) => e.tier))).toBe(1);
    expect(r.evidence.some((e) => e.skills.includes("Communication"))).toBe(false);
  });
});

describe("JD extractor", () => {
  it("uses section headings for must vs nice and skips company blurbs", async () => {
    const reqs = extractRequirementsRules(await fixture("jds/cv-intern-a.txt"));
    const kind = (s: string) => reqs.find((r) => r.skill === s)?.kind;
    expect(kind("PyTorch")).toBe("must");
    expect(kind("ONNX")).toBe("nice");
    expect(kind("Kubernetes")).toBeUndefined(); // only in "About Us"
    expect(reqs.find((r) => r.skill === "PyTorch")?.sourceSentence).toBe("Hands-on experience with PyTorch.");
  });

  it("treats 'A, B or C' as alternatives", () => {
    const reqs = extractRequirementsRules("Requirements:\n- Proficiency in at least one of Java, Go or Python.\n- Strong SQL.");
    expect(reqs.find((r) => r.skill === "Java")?.kind).toBe("nice");
    expect(reqs.find((r) => r.skill === "SQL")?.kind).toBe("must");
    const m = taxonomy.findInText("Node.js and Express or NestJS");
    expect([...alternativeSkills("Node.js and Express or NestJS", m)].sort()).toEqual(["Express", "NestJS"]);
  });

  it("reads cue words and years", () => {
    const reqs = extractRequirementsRules("We need 3+ years of Python. Familiarity with Docker is a plus.");
    expect(reqs.find((r) => r.skill === "Python")).toMatchObject({ kind: "must", yearsMin: 3 });
    expect(reqs.find((r) => r.skill === "Docker")?.kind).toBe("nice");
  });

  it("doesn't split sentences at abbreviations (live-run regression)", () => {
    expect(sentences("Fine-tuning of models using PEFT (e.g. LoRA, QLoRA etc.), and Knowledge Distillation. Strong Python.")).toEqual([
      "Fine-tuning of models using PEFT (e.g. LoRA, QLoRA etc.), and Knowledge Distillation.",
      "Strong Python.",
    ]);
  });

  it("guesses a title", () => {
    expect(guessTitle("Job Title: Backend Developer\nWe build...")).toBe("Backend Developer");
  });
});

describe("eval gate (docs/05-evaluation.md targets)", () => {
  it("meets extraction targets on the labeled set", async () => {
    const r = await runEval();
    expect(r.jd.precision).toBeGreaterThanOrEqual(0.9);
    expect(r.jd.recall).toBeGreaterThanOrEqual(0.85);
    expect(r.jd.kindAccuracy).toBeGreaterThanOrEqual(0.85);
    expect(r.resume.recall).toBeGreaterThanOrEqual(0.9);
    expect(r.resume.tierWithin1).toBeGreaterThanOrEqual(0.9);
  });
});
