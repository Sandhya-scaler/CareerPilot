import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { keywordGrade } from "../src/coach/grade.js";
import { pool } from "../src/db/pool.js";
import { ghostRisk } from "../src/services/ghost.js";
import { languageSkills, repoEvidence } from "../src/services/github.js";
import { weekStartOf } from "../src/services/reports.js";
import { settle } from "../src/services/runs.js";
import { clearSourceCache } from "../src/sources/http.js";
import { app, fixture, newUser, resetDb } from "./helpers.js";

beforeAll(resetDb);
afterEach(() => {
  vi.unstubAllGlobals();
  clearSourceCache();
});
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 100));
  await pool.end();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("keyword grading (no-LLM fallback)", () => {
  const rubric = [
    "IoU = intersection / union of boxes",
    "NMS keeps the highest-scoring box and suppresses overlapping ones above an IoU threshold",
    "Detectors emit many overlapping candidates per object",
    "Mentions threshold trade-off (missed vs duplicate detections)",
  ];
  it("scores a complete answer high", () => {
    const g = keywordGrade(
      "IoU is the intersection over union of two boxes. Detectors emit many overlapping candidate boxes per object, so NMS keeps the highest scoring box and suppresses overlapping boxes whose IoU is above a threshold. A low threshold risks missed detections of nearby objects; a high threshold leaves duplicate detections.",
      rubric,
      "Explain IoU and NMS",
    );
    expect(g.score).toBeGreaterThanOrEqual(4);
    expect(g.followUp).toBeNull();
    expect(g.gradedBy).toBe("keywords");
  });
  it("caps one-liners and asks a follow-up on the first missed point", () => {
    const g = keywordGrade("It removes duplicate boxes.", rubric, "Explain IoU and NMS");
    expect(g.score).toBeLessThanOrEqual(2);
    expect(g.missed.length).toBeGreaterThan(0);
    expect(g.followUp).toMatch(/^Let's go one level deeper/);
    expect(g.followUp!.toLowerCase()).toContain("intersection / union of boxes");
  });
});

describe("ghost-job risk", () => {
  const now = new Date("2026-10-30T00:00:00Z");
  it("is low for a fresh, specific, listed posting", () => {
    expect(ghostRisk({ postedAt: new Date("2026-10-20"), delistedAt: null, reposts: 0, requirementCount: 9 }, now)).toEqual({ risk: 0, reasons: [] });
  });
  it("flags delisted, stale, reposted and vague postings with reasons", () => {
    const g = ghostRisk({ postedAt: new Date("2026-05-01"), delistedAt: new Date("2026-10-25"), reposts: 2, requirementCount: 1 }, now);
    expect(g.risk).toBe(1);
    expect(g.reasons.join(" ")).toMatch(/No longer listed.*Posted 182 days ago.*reposted 2 times.*Few concrete/);
  });
});

describe("GitHub evidence", () => {
  it("maps measured languages to tier 4 and README mentions to tier 3", () => {
    const langs = languageSkills({ Python: 9000, "Jupyter Notebook": 4000, Shell: 200 });
    expect(langs.map((l) => l.skill)).toEqual(["Python", "Jupyter"]); // Shell < 10%
    const ev = repoEvidence(
      { name: "helmet-detector", full_name: "a/helmet-detector", description: "YOLOv8 helmet detection", html_url: "https://github.com/a/helmet-detector", fork: false, archived: false, topics: ["computer-vision", "pytorch"], stargazers_count: 3, pushed_at: "", size: 10 },
      langs,
      "# Helmet detector\nTrained with PyTorch, exported to ONNX. Great teamwork.",
    );
    expect(ev[0]).toMatchObject({ tier: 4, skills: ["Python", "Jupyter"] });
    expect(ev[1]!.tier).toBe(3);
    expect(ev[1]!.skills).toEqual(expect.arrayContaining(["Object Detection", "Computer Vision", "PyTorch", "ONNX"]));
    expect(ev[1]!.skills).not.toContain("Teamwork");
  });
});

describe("weekly report dates", () => {
  it("anchors weeks on Monday", () => {
    expect(weekStartOf(new Date("2026-10-30T12:00:00Z"))).toBe("2026-10-26"); // Friday
    expect(weekStartOf(new Date("2026-10-26T00:00:00Z"))).toBe("2026-10-26"); // Monday
    expect(weekStartOf(new Date("2026-11-01T23:00:00Z"))).toBe("2026-10-26"); // Sunday
  });
});

async function userWithPlan() {
  const u = await newUser();
  await request(app).post("/api/resumes").set(u.auth).send({ text: await fixture("resumes/cv-student.txt") }).expect(201);
  await request(app).post("/api/jobs/ingest").set(u.auth).send({ text: await fixture("jds/cv-intern-a.txt") }).expect(201);
  await request(app).post("/api/jobs/ingest").set(u.auth).send({ text: await fixture("jds/cv-intern-b.txt") }).expect(201);
  const start = await request(app).post("/api/careers/prepare").set(u.auth).send({ role: "Computer Vision Intern", skipResearch: true }).expect(202);
  const runId = start.body.runId;
  await settle(runId);
  await request(app).post(`/api/runs/${runId}/resume`).set(u.auth).send({}).expect(202);
  await settle(runId);
  for (let i = 0; i < 50; i++) {
    const r = await request(app).get(`/api/runs/${runId}`).set(u.auth);
    if (r.body.status === "done") return { ...u, run: r.body };
    await new Promise((res) => setTimeout(res, 50));
    await settle(runId);
  }
  throw new Error("pipeline didn't finish");
}

describe("mock interview (LangGraph loop)", () => {
  it("asks, grades, follows up on weak answers, and writes weak skills back to the plan", async () => {
    const u = await userWithPlan();
    const start = await request(app).post("/api/interviews").set(u.auth).send({ count: 3 }).expect(201);
    expect(start.body.question).toMatchObject({ number: 1, total: 3, isFollowup: false });

    // Weak answer → follow-up on the same question
    const weak = await request(app).post(`/api/interviews/${start.body.id}/answer`).set(u.auth).send({ answer: "Not sure." }).expect(200);
    expect(weak.body.lastGrade.score).toBeLessThanOrEqual(2);
    expect(weak.body.question.isFollowup).toBe(true);
    expect(weak.body.question.number).toBe(1);

    // Answer the follow-up, then the remaining questions
    let s = await request(app).post(`/api/interviews/${start.body.id}/answer`).set(u.auth).send({ answer: "Still not sure, sorry." }).expect(200);
    expect(s.body.question.isFollowup).toBe(false);
    expect(s.body.question.number).toBe(2);
    while (s.body.question) {
      const rubric: string[] = s.body.question.rubric;
      const good = `${rubric.join(". ")}. For example in my lane detection project I measured this carefully and compared alternatives before choosing.`;
      s = await request(app).post(`/api/interviews/${start.body.id}/answer`).set(u.auth).send({ answer: good }).expect(200);
    }
    expect(s.body.status).toBe("done");
    expect(s.body.summary.averageScore).toBeGreaterThan(1);
    expect(s.body.summary.weakSkills.length).toBeGreaterThanOrEqual(s.body.summary.addedTasks > 0 ? 1 : 0);
    await request(app).post(`/api/interviews/${start.body.id}/answer`).set(u.auth).send({ answer: "more" }).expect(409);

    const detail = await request(app).get(`/api/interviews/${start.body.id}`).set(u.auth).expect(200);
    expect(detail.body.attempts.length).toBeGreaterThanOrEqual(4); // 3 questions + ≥1 follow-up
    expect(detail.body.attempts[0].graded_by).toBe("keywords");

    if (s.body.summary.weakSkills.length) {
      const plan = await request(app).get("/api/plans/active").set(u.auth).expect(200);
      expect(plan.body.tasks.some((t: { title: string }) => t.title.startsWith("Revisit "))).toBe(true);
    }

    const other = await newUser();
    await request(app).get(`/api/interviews/${start.body.id}`).set(other.auth).expect(404);
  });

  it("refuses to start without questions", async () => {
    const u = await newUser();
    await request(app).post("/api/interviews").set(u.auth).send({}).expect(409);
  });

  it("starts a job-specific interview grounded in that JD", async () => {
    const u = await newUser();
    await request(app).post("/api/resumes").set(u.auth).send({ text: await fixture("resumes/frontend-newgrad.txt") }).expect(201);
    const job = await request(app).post("/api/jobs/ingest").set(u.auth).send({ text: await fixture("jds/frontend-dev.txt") }).expect(201);
    const s = await request(app).post("/api/interviews").set(u.auth).send({ jobId: job.body.id, count: 4 }).expect(201);
    expect(s.body.question.total).toBe(4);
    expect(s.body.job_id).toBe(job.body.id);
  });
});

describe("weekly report", () => {
  it("summarizes the week's work and is idempotent", async () => {
    const u = await userWithPlan();
    const plan = await request(app).get("/api/plans/active").set(u.auth).expect(200);
    const build = plan.body.tasks.find((t: { type: string }) => t.type === "build");
    await request(app).patch(`/api/plan-tasks/${build.id}`).set(u.auth).send({ status: "done", proof: "github.com/me/project with 0.8 mAP" }).expect(200);
    const job = await request(app).get("/api/jobs").set(u.auth).expect(200);
    const a = await request(app).post("/api/applications").set(u.auth).send({ jobId: job.body[0].id, status: "applied" }).expect(201);
    expect(a.body.status).toBe("applied");

    const r = await request(app).get("/api/reports/weekly").set(u.auth).expect(200);
    expect(r.body.tasksDone).toHaveLength(1);
    expect(r.body.evidenceAdded).toHaveLength(1);
    expect(r.body.applications.events.map((e: { type: string }) => e.type)).toContain("status:applied");
    expect(r.body.headline).toMatch(/1 plan task done, 1 new piece of evidence, 1 application sent/);
    expect(r.body.readiness).toBeGreaterThan(0);
    expect(r.body.nextWeek.length).toBeGreaterThan(0);
    await request(app).get("/api/reports/weekly").set(u.auth).expect(200);
    const list = await request(app).get("/api/reports").set(u.auth).expect(200);
    expect(list.body).toHaveLength(1);
  });
});

describe("liveness check", () => {
  it("marks saved ATS jobs delisted when they vanish from the board", async () => {
    const u = await newUser();
    const cv = await fixture("jds/cv-intern-a.txt");
    let listed = true;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const s = String(url);
      if (s.endsWith("/boards/acme/jobs")) return json({ jobs: listed ? [{ id: 7, title: "Computer Vision Intern", location: { name: "Bengaluru" } }] : [] });
      if (s.endsWith("/boards/acme/jobs/7")) return json({ id: 7, title: "Computer Vision Intern", content: cv });
      return json({}, 404);
    }));
    const r = await request(app).post("/api/jobs/search").set(u.auth)
      .send({ role: "Computer Vision Intern", location: "Bengaluru", companies: [{ ats: "greenhouse", token: "acme" }], onlyCompanies: true }).expect(200);
    expect(r.body.jobIds).toHaveLength(1);

    let check = await request(app).post("/api/jobs/check-liveness").set(u.auth).expect(200);
    expect(check.body.delisted).toBe(0);
    listed = false;
    clearSourceCache();
    check = await request(app).post("/api/jobs/check-liveness").set(u.auth).expect(200);
    expect(check.body.delisted).toBe(1);
    const job = await request(app).get(`/api/jobs/${r.body.jobIds[0]}`).set(u.auth).expect(200);
    expect(job.body.ghost_risk).toBeGreaterThanOrEqual(0.7);
    expect(job.body.ghost_reasons[0]).toMatch(/No longer listed/);
  });
});

describe("GitHub import", () => {
  it("imports public repos as verified/demonstrated evidence and replaces on re-import", async () => {
    const u = await newUser();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const s = String(url);
      if (s.includes("/users/octo/repos")) {
        return json([
          { name: "detector", full_name: "octo/detector", description: "YOLO detector for shelves", html_url: "https://github.com/octo/detector", fork: false, archived: false, topics: ["pytorch"], stargazers_count: 2, pushed_at: "", size: 50 },
          { name: "forked", full_name: "octo/forked", description: "", html_url: "", fork: true, archived: false, stargazers_count: 0, pushed_at: "", size: 5 },
        ]);
      }
      if (s.endsWith("/repos/octo/detector/languages")) return json({ Python: 1000 });
      if (s.endsWith("/repos/octo/detector/readme")) return new Response("Trained with PyTorch and exported to ONNX.", { status: 200 });
      if (s.includes("/users/nobody/repos")) return json({ message: "Not Found" }, 404);
      return json({}, 404);
    }));
    const r = await request(app).post("/api/github/import").set(u.auth).send({ username: "octo" }).expect(200);
    expect(r.body).toMatchObject({ repos: 1, evidence: 2 });
    expect(r.body.skills).toEqual(expect.arrayContaining(["Python", "PyTorch", "ONNX", "Object Detection"]));
    await request(app).post("/api/github/import").set(u.auth).send({ username: "octo" }).expect(200);
    const ev = await request(app).get("/api/github/evidence").set(u.auth).expect(200);
    expect(ev.body).toHaveLength(2);
    expect(ev.body.find((e: { tier: number }) => e.tier === 4).skills).toEqual(["Python"]);
    await request(app).post("/api/github/import").set(u.auth).send({ username: "nobody" }).expect(404);
    await request(app).post("/api/github/import").set(u.auth).send({ username: "bad name!" }).expect(400);
  });
});
