import { readFile } from "node:fs/promises";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The Claude code paths, with the model mocked to return plausible-but-wrong output. These are the
 * guards that keep CareerPilot from fabricating: every LLM claim must be verbatim, in the taxonomy,
 * and grounded in the user's evidence.
 */
const responses: Record<string, unknown> = {};
let fail = false;

vi.mock("../src/llm.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/llm.js")>();
  return {
    ...actual,
    llmEnabled: () => true,
    // Same contract as the real one, but bound to the mocked llmEnabled/structured.
    withFallback: async <T,>(_label: string, llm: () => Promise<T>, fallback: () => T | Promise<T>) => {
      try {
        return { value: await llm(), usedLlm: true };
      } catch {
        return { value: await fallback(), usedLlm: false };
      }
    },
    structured: vi.fn(async (call: { label?: string }) => {
      if (fail) throw new actual.LlmError("boom");
      const r = responses[call.label ?? ""];
      if (!r) throw new actual.LlmError(`no mock for ${call.label}`);
      return r;
    }),
  };
});

const { extractRequirements } = await import("../src/extract/jd.js");
const { parseResumeRules } = await import("../src/extract/resume.js");
const { rephraseForJob } = await import("../src/tailor/tailor.js");
const { generatePlan } = await import("../src/coach/plan.js");
const { generateQuestions } = await import("../src/coach/questions.js");
const { gradeAnswer } = await import("../src/coach/grade.js");
const { costUsd } = await import("../src/llm.js");

const fixture = (p: string) => readFile(new URL(`../evals/data/${p}`, import.meta.url), "utf8");

beforeEach(() => {
  fail = false;
  for (const k of Object.keys(responses)) delete responses[k];
});

describe("JD extraction with Claude", () => {
  it("keeps verbatim, in-taxonomy requirements and drops invented ones", async () => {
    responses["jd-extraction"] = {
      requirements: [
        { skill: "PyTorch", kind: "must", years_min: null, source_sentence: "Hands-on experience with PyTorch." },
        { skill: "Kubernetes", kind: "must", years_min: null, source_sentence: "Must know Kubernetes deeply." }, // not in the JD
        { skill: "FooBarTool", kind: "must", years_min: null, source_sentence: "Experience with OpenCV." }, // not a skill
        { skill: "Image Classification", kind: "nice", years_min: null, source_sentence: "Solid understanding of CNNs and image processing fundamentals." },
      ],
    };
    const r = await extractRequirements(await fixture("jds/cv-intern-a.txt"));
    expect(r.usedLlm).toBe(true);
    const skills = r.requirements.map((x) => x.skill);
    expect(skills).not.toContain("Kubernetes");
    expect(skills).toContain("Image Classification"); // genuinely implied, verbatim sentence → added
    expect(skills).toContain("OpenCV"); // rules still contribute
  });

  it("falls back to rules when Claude errors", async () => {
    fail = true;
    const r = await extractRequirements(await fixture("jds/cv-intern-a.txt"));
    expect(r.usedLlm).toBe(false);
    expect(r.requirements.length).toBeGreaterThan(8);
  });
});

describe("tailoring rewrites with Claude", () => {
  it("applies grounded rewrites and rejects fabricated ones, with reasons", async () => {
    const parsed = parseResumeRules(await fixture("resumes/cv-student.txt"));
    responses["rephrase"] = {
      rewrites: [
        { original: "Trained a small CNN in Keras on MNIST reaching 98.9% test accuracy.", rewritten: "Reached 98.9% test accuracy on MNIST with a compact CNN built in Keras." },
        { original: "Wrote a Flask endpoint to serve predictions from the trained model.", rewritten: "Deployed a PyTorch model to production behind a Flask API." },
        { original: "Implemented image denoising filters in MATLAB and compared them with NumPy implementations.", rewritten: "Implemented 40 image denoising filters in MATLAB and NumPy." },
        // Not a line we sent (no JD skill in it): ignored entirely, never applied.
        { original: "Reduced false detections by 18% using region-of-interest masking and temporal smoothing.", rewritten: "Cut false detections by 18% with OpenCV." },
      ],
    };
    const reqs = [
      { skill: "CNNs", kind: "must" as const, sourceSentence: "CNNs" },
      { skill: "Flask", kind: "must" as const, sourceSentence: "Flask" },
      { skill: "MATLAB", kind: "must" as const, sourceSentence: "MATLAB" },
    ];
    const userSkills = new Set(parsed.evidence.flatMap((e) => e.skills));
    const { edits, content } = await rephraseForJob(parsed, reqs, userSkills);
    const applied = edits.filter((e) => e.op === "rephrase");
    const rejected = edits.filter((e) => e.op === "rejected_rephrase");
    expect(applied).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    expect(rejected.map((r) => r.reason).join(" ")).toMatch(/PyTorch|Deployed/);
    expect(rejected.map((r) => r.reason).join(" ")).toMatch(/"40"/);
    const text = content.sections.flatMap((s) => s.lines).join("\n");
    expect(text).toContain("compact CNN built in Keras");
    expect(text).not.toContain("40 image");
    expect(text).toContain("Reduced false detections by 18%");
    expect(text).not.toContain("Deployed a PyTorch");
  });
});

describe("plan, questions and grading with Claude", () => {
  const gaps = [
    { skill: "PyTorch", evidenceScore: 0.3, evidenceTier: 1, via: "direct", learnability: "weeks" as const, sampleSentence: "Hands-on experience with PyTorch.", frequency: 0.8 },
    { skill: "Docker", evidenceScore: 0, evidenceTier: null, via: "none", learnability: "days" as const, sampleSentence: "Familiarity with Docker.", frequency: 0.3 },
  ];

  it("drops plan tasks for skills that aren't gaps and caps hours at the weekly budget", async () => {
    responses["plan"] = {
      tasks: [
        { week: 1, skill: "PyTorch", type: "learn", title: "PyTorch basics", detail: "d", est_hours: 40, proof_artifact: null },
        { week: 1, skill: "Kubernetes", type: "build", title: "K8s cluster", detail: "d", est_hours: 5, proof_artifact: "repo" },
        { week: 2, skill: "Docker", type: "build", title: "Dockerize", detail: "d", est_hours: 4, proof_artifact: "repo" },
      ],
    };
    const r = await generatePlan({ role: "CV Intern", hoursPerWeek: 8, weeks: 4, gaps });
    expect(r.generatedBy).toBe("llm");
    expect(r.tasks.map((t) => t.skill)).not.toContain("Kubernetes");
    expect(r.tasks.every((t) => t.estHours <= 8)).toBe(true);
    expect(r.tasks.find((t) => t.skill === "PyTorch")!.resourceUrl).toMatch(/pytorch\.org/);
  });

  it("drops JD/project questions whose grounding isn't a real sentence", async () => {
    const q = (kind: string, grounding: string | null) => ({ skill: "PyTorch", kind, prompt: `${kind} question`, rubric: ["a", "b", "c"], grounding });
    responses["questions"] = {
      questions: [
        q("concept", null), q("concept", null), q("applied", null), q("behavioral", null),
        q("jd", "Hands-on experience with PyTorch."), // real
        q("jd", "Must have 5 years of PyTorch at FAANG."), // invented
        q("project", "Built an LLM startup with 1M users"), // not on the resume
      ],
    };
    const r = await generateQuestions({ role: "CV Intern", gaps, evidence: [{ text: "Trained a CNN in Keras", context: null, skills: ["Keras"], tier: 3 }] });
    expect(r.generatedBy).toBe("llm");
    expect(r.questions.filter((x) => x.kind === "jd")).toHaveLength(1);
    expect(r.questions.some((x) => x.kind === "project")).toBe(false);
  });

  it("keeps only rubric points that exist and suppresses follow-ups on strong answers", async () => {
    responses["grading"] = { score: 5, covered: ["Point A", "Made-up point"], missed: [], feedback: "Great.", follow_up: "Why?" };
    const g = await gradeAnswer("Q", ["Point A", "Point B"], "answer");
    expect(g).toMatchObject({ score: 5, covered: ["Point A"], followUp: null, gradedBy: "llm" });
  });
});

describe("cost accounting", () => {
  it("prices calls per model and over-reports unknown models", () => {
    expect(costUsd("claude-haiku-5-5", 1_000_000, 100_000)).toBeCloseTo(0.15);
    expect(costUsd("claude-opus-5-5", 10_000, 2_000, 50_000)).toBeCloseTo(0.04 + 0.04 + 0.01);
    expect(costUsd("some-future-model", 1_000_000, 0)).toBe(4);
  });
});
