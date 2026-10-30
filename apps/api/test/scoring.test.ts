import { describe, expect, it } from "vitest";
import {
  buildMarketMap, evidenceFor, bestBySkill, gapPriority, marketCoverage, marketWeight, matchRequirements, rankGaps,
  type EvidenceRef, type Requirement,
} from "../src/scoring.js";
import { taxonomy } from "../src/skills/taxonomy.js";

const ev = (text: string, tier: EvidenceRef["tier"], skills: string[]): EvidenceRef => ({ text, tier, skills });
const req = (skill: string, kind: "must" | "nice" = "must"): Requirement => ({
  skill, kind, yearsMin: null, sourceSentence: `Experience with ${skill}`,
});

describe("evidenceFor", () => {
  it("uses the strongest direct item", () => {
    const best = bestBySkill([ev("Skills: OpenCV", 1, ["OpenCV"]), ev("Built lane detector with OpenCV, 92% acc", 3, ["OpenCV"])]);
    const e = evidenceFor("OpenCV", best, taxonomy);
    expect(e.via).toBe("direct");
    expect(e.score).toBe(0.85);
    expect(e.item?.tier).toBe(3);
  });

  it("gives half credit through related skills", () => {
    const best = bestBySkill([ev("Trained CNN in TensorFlow", 2, ["TensorFlow"])]);
    const e = evidenceFor("PyTorch", best, taxonomy);
    expect(e.via).toBe("adjacent");
    expect(e.viaSkill).toBe("TensorFlow");
    expect(e.score).toBeCloseTo(0.3);
  });

  it("prefers adjacent credit over a weaker direct claim", () => {
    const best = bestBySkill([ev("Skills: PyTorch", 1, ["PyTorch"]), ev("Shipped TF model to prod", 4, ["TensorFlow"])]);
    // direct 0.3 < adjacent 0.5
    expect(evidenceFor("PyTorch", best, taxonomy).via).toBe("adjacent");
  });

  it("returns none when nothing matches", () => {
    expect(evidenceFor("Kubernetes", new Map(), taxonomy)).toMatchObject({ score: 0, via: "none", item: null });
  });
});

describe("matchRequirements", () => {
  it("weights must-haves double and ignores soft skills", () => {
    const r = matchRequirements(
      [req("Python"), req("Docker", "nice"), req("Communication")],
      [ev("Python services in production", 3, ["Python"])],
      taxonomy,
    );
    // (1*0.85 + 0.5*0) / 1.5
    expect(r.coverage).toBeCloseTo(0.85 / 1.5);
    expect(r.mustCoverage).toBeCloseTo(0.85);
    expect(r.items.find((i) => i.skill === "Communication")?.scored).toBe(false);
  });

  it("links each item to its evidence and explains the next step", () => {
    const r = matchRequirements([req("OpenCV")], [ev("Built lane detector with OpenCV", 2, ["OpenCV"])], taxonomy);
    expect(r.items[0]!.evidence.item?.text).toBe("Built lane detector with OpenCV");
    expect(r.items[0]!.explanation).toMatch(/^Applied\. .*measurable outcome/);
  });

  it("is 0 with no requirements", () => {
    expect(matchRequirements([], [], taxonomy).coverage).toBe(0);
  });
});

describe("market map + gaps", () => {
  const jobs = [
    { requirements: [req("Python"), req("PyTorch"), req("Docker", "nice")] },
    { requirements: [req("Python"), req("PyTorch", "nice"), req("Communication")] },
    { requirements: [req("Python"), req("OpenCV")] },
    { requirements: [req("Python"), req("PyTorch")] },
  ];

  it("computes frequency, must-rate and weight", () => {
    const m = buildMarketMap(jobs, taxonomy);
    const py = m.find((s) => s.skill === "Python")!;
    const torch = m.find((s) => s.skill === "PyTorch")!;
    expect(py).toMatchObject({ frequency: 1, mustRate: 1, weight: 1 });
    expect(torch.frequency).toBe(0.75);
    expect(torch.mustRate).toBeCloseTo(2 / 3);
    expect(torch.weight).toBeCloseTo(marketWeight(0.75, 2 / 3));
    expect(m.some((s) => s.skill === "Communication")).toBe(false);
    expect(m[0]!.skill).toBe("Python");
  });

  it("counts a skill once per job, must winning over nice", () => {
    const m = buildMarketMap([{ requirements: [req("Docker", "nice"), req("Docker", "must")] }], taxonomy);
    expect(m[0]).toMatchObject({ skill: "Docker", mustRate: 1 });
  });

  it("ranks gaps by weight × gap × learnability and drops demonstrated skills", () => {
    const m = buildMarketMap(jobs, taxonomy);
    const gaps = rankGaps(m, [ev("Python APIs serving 10k users", 3, ["Python"]), ev("Skills: PyTorch", 1, ["PyTorch"])], taxonomy);
    expect(gaps.map((g) => g.skill)).not.toContain("Python");
    expect(gaps[0]!.skill).toBe("PyTorch");
    expect(gaps[0]!.priority).toBeCloseTo(gapPriority(m.find((s) => s.skill === "PyTorch")!.weight, 0.3, "weeks"));
  });

  it("market coverage rises with evidence", () => {
    const m = buildMarketMap(jobs, taxonomy);
    const low = marketCoverage(m, [ev("Skills: Python", 1, ["Python"])], taxonomy);
    const high = marketCoverage(m, [ev("Python prod 5k users", 3, ["Python"]), ev("PyTorch model 90% acc", 3, ["PyTorch"])], taxonomy);
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(1);
  });
});

describe("implied credit", () => {
  it("credits a general skill from specific evidence at 0.9×", () => {
    const best = bestBySkill([ev("YOLOv8 detector, 0.81 mAP", 3, ["Object Detection"])]);
    const e = evidenceFor("Computer Vision", best, taxonomy);
    expect(e.via).toBe("implied");
    expect(e.viaSkill).toBe("Object Detection");
    expect(e.score).toBeCloseTo(0.85 * 0.9);
  });

  it("is transitive (Next.js → React → JavaScript) but never upward", () => {
    const best = bestBySkill([ev("Next.js app, 300 users", 3, ["Next.js"])]);
    expect(evidenceFor("JavaScript", best, taxonomy).via).toBe("implied");
    const general = bestBySkill([ev("Computer vision coursework", 1, ["Computer Vision"])]);
    expect(evidenceFor("Object Detection", general, taxonomy).via).not.toBe("implied");
  });
});
