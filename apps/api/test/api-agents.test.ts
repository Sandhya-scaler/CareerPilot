import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { pool } from "../src/db/pool.js";
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

async function waitFor(auth: Record<string, string>, runId: string, statuses: string[]) {
  await settle(runId);
  for (let i = 0; i < 100; i++) {
    const r = await request(app).get(`/api/runs/${runId}`).set(auth).expect(200);
    if (statuses.includes(r.body.status)) return r.body;
    await new Promise((res) => setTimeout(res, 50));
    await settle(runId);
  }
  throw new Error("run did not settle");
}

/** Fake public ATS boards so tests never hit the network. */
async function stubBoards() {
  const cvA = await fixture("jds/cv-intern-a.txt");
  const cvB = await fixture("jds/cv-intern-b.txt");
  const ml = await fixture("jds/ml-engineer.txt");
  const fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("boards-api.greenhouse.io/v1/boards/groww/jobs/101")) return json({ id: 101, title: "Computer Vision Intern", content: cvA.replace(/\n/g, "<br>") });
    if (u.includes("boards-api.greenhouse.io/v1/boards/groww/jobs")) {
      return json({ jobs: [
        { id: 101, title: "Computer Vision Intern", location: { name: "Bengaluru, India" }, absolute_url: "https://example.com/101", first_published: "2026-10-01T00:00:00Z" },
        { id: 102, title: "Assistant Manager - Internal Audit", location: { name: "Bengaluru, India" } },
      ] });
    }
    if (u.includes("api.lever.co/v0/postings/cred")) {
      return json([{ id: "abc", text: "ML Intern - Computer Vision", hostedUrl: "https://example.com/abc", createdAt: Date.now(), categories: { location: "Bangalore" }, descriptionPlain: cvB, lists: [] }]);
    }
    if (u.includes("api.ashbyhq.com/posting-api/job-board/sarvam")) {
      return json({ jobs: [
        { id: "z1", title: "Machine Learning Engineer, Vision", location: "Bengaluru", isListed: true, descriptionPlain: ml, publishedAt: "2026-10-10T00:00:00Z" },
        { id: "z2", title: "Account Executive", location: "Mumbai", isListed: true, descriptionPlain: "Sell things. ".repeat(50) },
      ] });
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("research agent", () => {
  it("finds relevant roles across ATS boards and skips irrelevant ones", async () => {
    const u = await newUser();
    const fetchMock = await stubBoards();
    const r = await request(app).post("/api/jobs/search").set(u.auth).send({ role: "Computer Vision Intern", location: "Bengaluru", limit: 10 }).expect(200);
    expect(r.body.jobIds).toHaveLength(3);
    expect(r.body.sources).toEqual({ greenhouse: 1, lever: 1, ashby: 1 });
    expect(r.body.failedSources.length).toBeGreaterThan(0); // the other seed boards 404 in the stub
    const jobs = await request(app).get("/api/jobs").set(u.auth).expect(200);
    const titles = jobs.body.map((j: { title: string }) => j.title).sort();
    expect(titles).toEqual(["Computer Vision Intern", "ML Intern - Computer Vision", "Machine Learning Engineer, Vision"]);
    // Second search within the cache window doesn't refetch boards.
    const calls = fetchMock.mock.calls.length;
    await request(app).post("/api/jobs/search").set(u.auth).send({ role: "Computer Vision Intern", location: "Bengaluru" }).expect(200);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });
});

describe("prepare pipeline (LangGraph)", () => {
  it("pauses for a resume, then for evidence review, then produces a market map and plan", async () => {
    const u = await newUser();
    await stubBoards();
    const start = await request(app).post("/api/careers/prepare").set(u.auth)
      .send({ role: "Computer Vision Intern", location: "Bengaluru", hoursPerWeek: 8, weeks: 6 }).expect(202);
    const runId = start.body.runId;

    let run = await waitFor(u.auth, runId, ["waiting", "failed"]);
    expect(run.status).toBe("waiting");
    expect(run.pending.type).toBe("need_resume");

    const resume = await request(app).post("/api/resumes").set(u.auth).send({ text: await fixture("resumes/cv-student.txt") }).expect(201);
    await request(app).post(`/api/runs/${runId}/resume`).set(u.auth).send({}).expect(202);
    run = await waitFor(u.auth, runId, ["waiting", "failed"]);
    expect(run.pending.type).toBe("confirm_evidence");
    expect(run.pending.versionId).toBe(resume.body.versionId);
    expect(run.pending.evidence.length).toBeGreaterThan(5);

    await request(app).post(`/api/runs/${runId}/resume`).set(u.auth)
      .send({ value: { add: [{ text: "Fine-tuned YOLOv8 in PyTorch on 1,200 shelf images reaching 0.81 mAP", context: "Shelf detector" }] } })
      .expect(202);
    run = await waitFor(u.auth, runId, ["done", "failed"]);
    expect(run.error).toBeNull();
    expect(run.status).toBe("done");
    expect(run.events.map((e: { step: string }) => e.step)).toEqual(expect.arrayContaining(["research", "resume", "match", "coach", "done"]));

    const market = await request(app).get(`/api/market-maps/${run.result.marketMapId}`).set(u.auth).expect(200);
    expect(market.body.jobCount).toBe(3);
    expect(market.body.skills[0].skill).toBe("Python");
    expect(market.body.readiness).toBeGreaterThan(0);
    expect(market.body.gaps.length).toBeGreaterThan(0);
    expect(market.body.gaps.find((g: { skill: string }) => g.skill === "Python")).toBeUndefined(); // demonstrated

    const plan = await request(app).get(`/api/plans/${run.result.planId}`).set(u.auth).expect(200);
    expect(plan.body.generated_by).toBe("rules");
    expect(plan.body.tasks.length).toBeGreaterThan(3);
    expect(plan.body.questions.length).toBeGreaterThan(5);
    expect(plan.body.tasks.at(-1).type).toBe("practice");

    // Completing a build task with proof becomes evidence and raises market readiness.
    const build = plan.body.tasks.find((t: { type: string; skill: string }) => t.type === "build")!;
    await request(app).patch(`/api/plan-tasks/${build.id}`).set(u.auth).send({ status: "done" }).expect(422);
    const done = await request(app).patch(`/api/plan-tasks/${build.id}`).set(u.auth)
      .send({ status: "done", proof: `Shipped a ${build.skill} project: github.com/aaravm/${build.skill.toLowerCase().replace(/\W+/g, "-")}` })
      .expect(200);
    expect(done.body.evidence_id).toBeTruthy();
    const after = await request(app).get(`/api/market-maps/${run.result.marketMapId}`).set(u.auth).expect(200);
    expect(after.body.readiness).toBeGreaterThan(market.body.readiness);

    // Undoing the task removes the evidence again.
    await request(app).patch(`/api/plan-tasks/${build.id}`).set(u.auth).send({ status: "todo" }).expect(200);
    const undone = await request(app).get(`/api/market-maps/${run.result.marketMapId}`).set(u.auth).expect(200);
    expect(undone.body.readiness).toBeCloseTo(market.body.readiness, 5);
  });

  it("can analyze only the user's pasted JDs and fails clearly when there are none", async () => {
    const u = await newUser();
    const empty = await request(app).post("/api/careers/prepare").set(u.auth).send({ role: "Data Analyst", skipResearch: true }).expect(202);
    const failed = await waitFor(u.auth, empty.body.runId, ["failed", "done", "waiting"]);
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatch(/Paste a few JDs/);

    await request(app).post("/api/resumes").set(u.auth).send({ text: await fixture("resumes/data-analyst-fresher.txt") }).expect(201);
    await request(app).post("/api/jobs/ingest").set(u.auth).send({ text: await fixture("jds/data-analyst.txt") }).expect(201);
    const start = await request(app).post("/api/careers/prepare").set(u.auth).send({ role: "Data Analyst", skipResearch: true, weeks: 4, hoursPerWeek: 6 }).expect(202);
    let run = await waitFor(u.auth, start.body.runId, ["waiting", "failed", "done"]);
    expect(run.pending.type).toBe("confirm_evidence");
    await request(app).post(`/api/runs/${start.body.runId}/resume`).set(u.auth).send({}).expect(202);
    run = await waitFor(u.auth, start.body.runId, ["done", "failed"]);
    expect(run.status).toBe("done");
    // Resuming a finished run is a conflict, other users can't see it.
    await request(app).post(`/api/runs/${start.body.runId}/resume`).set(u.auth).send({}).expect(409);
    const other = await newUser();
    await request(app).get(`/api/runs/${start.body.runId}`).set(other.auth).expect(404);
  });
});
