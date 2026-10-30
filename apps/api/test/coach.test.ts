import { describe, expect, it } from "vitest";
import { rulePlan, schedule, tasksForGap, type GapInput } from "../src/coach/plan.js";
import { ruleQuestions } from "../src/coach/questions.js";
import { htmlToText } from "../src/sources/http.js";
import { titleScore } from "../src/sources/relevance.js";
import { locationAllowed } from "../src/services/research.js";

const gap = (skill: string, over: Partial<GapInput> = {}): GapInput => ({
  skill, evidenceScore: 0, evidenceTier: null, via: "none", learnability: "weeks", sampleSentence: `Experience with ${skill}.`, frequency: 0.6, ...over,
});

describe("plan generation (rules)", () => {
  it("learn + build for missing skills, a short prove task for applied ones", () => {
    expect(tasksForGap(gap("Docker"), "Backend Developer").map((t) => t.type)).toEqual(["learn", "build"]);
    const prove = tasksForGap(gap("OpenCV", { evidenceTier: 2, via: "direct", evidenceScore: 0.6 }), "CV Intern");
    expect(prove.map((t) => t.type)).toEqual(["prove"]);
    expect(prove[0]!.proofArtifact).toMatch(/number|link/);
  });

  it("links official resources when known and never invents URLs", () => {
    expect(tasksForGap(gap("PyTorch"), "x")[0]!.resourceUrl).toMatch(/^https:\/\/pytorch\.org/);
    expect(tasksForGap(gap("Camera Calibration"), "x")[0]!.resourceUrl).toBeNull();
  });

  it("never exceeds the weekly hour budget (unless a single task is bigger) and ends with practice", () => {
    const tasks = rulePlan({ role: "CV Intern", hoursPerWeek: 8, weeks: 6, gaps: ["PyTorch", "Object Detection", "Docker", "ONNX", "C++"].map((s) => gap(s)) });
    const byWeek = new Map<number, number>();
    for (const t of tasks) byWeek.set(t.week, (byWeek.get(t.week) ?? 0) + t.estHours);
    for (const [week, hours] of byWeek) {
      const single = tasks.filter((t) => t.week === week).length === 1;
      expect(hours <= 8 || single).toBe(true);
    }
    expect(Math.max(...tasks.map((t) => t.week))).toBeLessThanOrEqual(6);
    expect(tasks.at(-1)).toMatchObject({ type: "practice", week: 6 });
  });

  it("drops tasks that don't fit instead of overflowing the plan", () => {
    const tasks = schedule(Array.from({ length: 20 }, (_, i) => ({ skill: `S${i}`, type: "learn" as const, title: "t", detail: "d", resourceUrl: null, estHours: 5, proofArtifact: null })), 5, 2);
    expect(tasks.every((t) => t.week <= 2)).toBe(true);
    expect(tasks).toHaveLength(2);
  });

  it("ignores soft skills", () => {
    expect(rulePlan({ role: "x", hoursPerWeek: 10, weeks: 2, gaps: [gap("Communication"), gap("SQL")] }).every((t) => t.skill !== "Communication")).toBe(true);
  });
});

describe("question generation (rules)", () => {
  it("mixes bank, JD-grounded, project and behavioral questions with rubrics", () => {
    const qs = ruleQuestions({
      role: "CV Intern",
      gaps: [{ skill: "Object Detection", sampleSentence: "Train and evaluate object detection models." }, { skill: "Camera Calibration", sampleSentence: null }],
      evidence: [{ text: "Built lane detector with OpenCV, 18% fewer false detections", context: "Lane Detection", skills: ["OpenCV"], tier: 3 }],
    });
    const kinds = new Set(qs.map((q) => q.kind));
    expect([...kinds].sort()).toEqual(["behavioral", "concept", "jd", "project"]);
    expect(qs.find((q) => q.kind === "concept" && q.skill === "Object Detection")!.prompt).toMatch(/IoU|mAP/);
    expect(qs.find((q) => q.kind === "concept" && q.skill === "Camera Calibration")!.prompt).toMatch(/Camera Calibration/);
    expect(qs.find((q) => q.kind === "jd")!.grounding).toBe("Train and evaluate object detection models.");
    expect(qs.find((q) => q.kind === "project")!.grounding).toMatch(/lane detector/);
    expect(qs.every((q) => q.rubric.length >= 3)).toBe(true);
  });
});

describe("sources helpers", () => {
  it("converts (double-escaped) job HTML to readable text", () => {
    const html = "&lt;h3&gt;Requirements&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;Python &amp;amp; SQL&lt;/li&gt;&lt;li&gt;Docker&lt;/li&gt;&lt;/ul&gt;";
    expect(htmlToText(html)).toBe("Requirements\n\n- Python & SQL\n- Docker");
  });

  it("scores titles by role family, seniority and opposing families", () => {
    expect(titleScore("Backend Developer", "SDE-1 Backend")).toBeGreaterThan(titleScore("Backend Developer", "Frontend Engineer"));
    expect(titleScore("Computer Vision Intern", "Computer Vision Intern")).toBeGreaterThan(titleScore("Computer Vision Intern", "Staff Computer Vision Engineer"));
    expect(titleScore("Data Analyst", "Account Executive")).toBeLessThan(0);
  });

  it("requires a shared or adjacent role family (live-run regression)", () => {
    for (const t of ["Operations Associate, Sanctions", "Social Media, Customer Support Associate", "Product & Strategy Associate", "Software Engineer, Intern"]) {
      expect(titleScore("Computer Vision Intern", t)).toBeLessThan(0);
    }
    expect(titleScore("Computer Vision Intern", "AI Researcher Intern")).toBeGreaterThan(0.45);
    expect(titleScore("Backend Developer", "Software Engineer, Intern")).toBeGreaterThan(0);
    expect(titleScore("Computer Vision Intern", "Specialist Seller (AI Products)")).toBeLessThan(0);
    expect(titleScore("Computer Vision Intern", "Product Management - AI Payments")).toBeLessThan(0);
  });

  it("filters out roles an India-based applicant can't take", () => {
    expect(locationAllowed("Bengaluru, India", { location: "Remote - US" })).toBe(false);
    expect(locationAllowed("Bengaluru, India", { location: "San Francisco, California" })).toBe(false);
    expect(locationAllowed("Bengaluru, India", { location: "Hybrid in Bangalore, India" })).toBe(true);
    expect(locationAllowed("Bengaluru, India", { location: "Remote" })).toBe(true);
    expect(locationAllowed("Bengaluru, India", { location: null })).toBe(true);
    expect(locationAllowed("Berlin", { location: "Remote - US" })).toBe(true);
  });
});
