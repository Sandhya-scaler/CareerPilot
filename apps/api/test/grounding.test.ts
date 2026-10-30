import { describe, expect, it } from "vitest";
import { checkGrounding } from "../src/tailor/grounding.js";

const skills = new Set(["Python", "OpenCV", "Flask", "Keras", "CNNs"]);

describe("grounding check (no-fabrication guarantee)", () => {
  it("accepts rephrasing that keeps facts", () => {
    const r = checkGrounding(
      "Built a classical lane detection pipeline using Canny edges and Hough transforms on 2,000 dashcam frames.",
      "Engineered a lane detection pipeline in Python with OpenCV (Canny + Hough) over 2,000 dashcam frames.",
      skills,
    );
    expect(r).toEqual({ ok: true, violations: [] });
  });

  it("rejects skills the user has no evidence for", () => {
    const r = checkGrounding("Trained a small CNN in Keras on MNIST.", "Trained a CNN in PyTorch on MNIST.", skills);
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toMatch(/PyTorch/);
  });

  it("allows a skill the user has evidenced elsewhere", () => {
    expect(checkGrounding("Wrote an endpoint to serve predictions.", "Wrote a Flask endpoint to serve predictions.", skills).ok).toBe(true);
  });

  it("rejects invented or changed numbers", () => {
    expect(checkGrounding("Reduced false detections by 18%.", "Reduced false detections by 28%.", skills).violations).toEqual([
      'adds number "28" not in the original line',
    ]);
    expect(checkGrounding("Built a dashboard for the ops team.", "Built a dashboard used by 50 analysts.", skills).ok).toBe(false);
  });

  it("rejects inflated claims", () => {
    const r = checkGrounding("Built a Flask endpoint to serve predictions.", "Deployed a Flask endpoint to production serving predictions.", skills);
    expect(r.ok).toBe(false);
    expect(r.violations.join(" ")).toMatch(/Deployed/);
    expect(checkGrounding("Led a team of 6 to build a prototype.", "Led a 6-person team building a prototype.", skills).ok).toBe(true);
  });
});
