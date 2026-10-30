import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { parseResumeRules } from "../src/extract/resume.js";
import { checkGrounding } from "../src/tailor/grounding.js";
import { diffLines, renderText, reorderForJob } from "../src/tailor/tailor.js";
import { app, fixture, newUser, resetDb } from "./helpers.js";

beforeAll(resetDb);
afterAll(() => pool.end());

describe("deterministic tailoring", () => {
  it("only reorders: same lines before and after, most relevant first, every move explained", async () => {
    const parsed = parseResumeRules(await fixture("resumes/cv-student.txt"));
    const before = renderText(parsed);
    const reqs = [
      { skill: "CNNs", kind: "must" as const, sourceSentence: "Solid understanding of CNNs." },
      { skill: "Keras", kind: "must" as const, sourceSentence: "Keras experience." },
      { skill: "PyTorch", kind: "must" as const, sourceSentence: "Hands-on PyTorch." },
    ];
    const { content, edits } = reorderForJob(parsed, reqs);
    const after = renderText(content);
    // Nothing added, removed or reworded: the same words, only in a different order.
    const words = (t: string) => t.split(/[\s,]+/).filter(Boolean).sort();
    expect(words(after)).toEqual(words(before));
    const projects = content.sections.find((s) => s.name === "projects")!;
    expect(projects.lines[0]).toBe("Handwritten Digit Classifier");
    const skills = content.sections.find((s) => s.name === "skills")!;
    expect(skills.lines.find((l) => l.startsWith("Libraries"))).toMatch(/^Libraries: PyTorch \(basic\), /);
    expect(edits.map((e) => e.op)).toEqual(expect.arrayContaining(["reorder_projects", "reorder_skills"]));
    expect(edits.every((e) => e.reason.length > 10)).toBe(true);
    // Every non-skills line is an original line verbatim.
    for (const line of after.split("\n").filter((l) => !/^(Languages|Libraries|Tools):/.test(l))) expect(before.split("\n")).toContain(line);
  });

  it("diffs lines", () => {
    expect(diffLines(["a", "b", "c"], ["b", "a", "c"]).filter((d) => d.op !== "same")).toHaveLength(2);
  });

  it("grounding check guards the 50-resume no-fabrication target on reorder output", async () => {
    // Reordering can't fabricate; prove it on every fixture × JD combination.
    const resumes = ["cv-student", "backend-switcher", "data-analyst-fresher", "frontend-newgrad"];
    const jds = ["cv-intern-a", "ml-engineer", "data-analyst", "frontend-dev", "backend-node", "genai-engineer"];
    const { extractRequirementsRules } = await import("../src/extract/jd.js");
    let checked = 0;
    for (const r of resumes) {
      const parsed = parseResumeRules(await fixture(`resumes/${r}.txt`));
      const skills = new Set(parsed.evidence.flatMap((e) => e.skills));
      for (const j of jds) {
        const reqs = extractRequirementsRules(await fixture(`jds/${j}.txt`));
        const { edits } = reorderForJob(parsed, reqs);
        for (const e of edits) {
          if (e.op === "reorder_skills") expect(checkGrounding(e.before, e.after, skills).ok).toBe(true);
        }
        checked++;
      }
    }
    expect(checked).toBe(24);
  });
});

describe("tailoring + versioning API", () => {
  it("creates a tailored version linked to its job and parent, with a diff", async () => {
    const u = await newUser();
    const r = await request(app).post("/api/resumes").set(u.auth).send({ text: await fixture("resumes/backend-switcher.txt"), title: "Main" }).expect(201);
    const job = await request(app).post("/api/jobs/ingest").set(u.auth).send({ text: await fixture("jds/ml-engineer.txt") }).expect(201);
    const t = await request(app).post(`/api/resume-versions/${r.body.versionId}/tailor`).set(u.auth).send({ jobId: job.body.id }).expect(201);
    expect(t.body.label).toMatch(/^Tailored: Machine Learning Engineer/);
    expect(t.body.usedLlm).toBe(false);

    const v = await request(app).get(`/api/resume-versions/${t.body.versionId}`).set(u.auth).expect(200);
    expect(v.body.parent_version_id).toBe(r.body.versionId);
    expect(v.body.job_id).toBe(job.body.id);

    const diff = await request(app).get(`/api/resume-versions/${t.body.versionId}/diff`).set(u.auth).expect(200);
    expect(diff.body.parentId).toBe(r.body.versionId);
    expect(diff.body.lines.some((l: { op: string }) => l.op !== "same")).toBe(true);
    expect(diff.body.changeLog.length).toBeGreaterThan(0);

    // Matching with the tailored version uses the base version's evidence.
    const base = await request(app).post("/api/match").set(u.auth).send({ jobId: job.body.id, resumeVersionId: r.body.versionId }).expect(201);
    const tailored = await request(app).post("/api/match").set(u.auth).send({ jobId: job.body.id, resumeVersionId: t.body.versionId }).expect(201);
    expect(tailored.body.coverage).toBeCloseTo(base.body.coverage, 5);

    // Tailored versions never become the "latest base" resume.
    const list = await request(app).get("/api/resumes").set(u.auth).expect(200);
    expect(list.body[0].versions).toHaveLength(2);
    const versions = await request(app).get(`/api/jobs/${job.body.id}/versions`).set(u.auth).expect(200);
    expect(versions.body[0].id).toBe(t.body.versionId);
  });
});

describe("application tracker", () => {
  it("tracks status changes with events and follow-ups", async () => {
    const u = await newUser();
    const job = await request(app).post("/api/jobs/ingest").set(u.auth).send({ text: await fixture("jds/frontend-dev.txt") }).expect(201);
    const a = await request(app).post("/api/applications").set(u.auth).send({ jobId: job.body.id }).expect(201);
    expect(a.body).toMatchObject({ status: "saved", applied_at: null, next_followup_at: null });
    await request(app).post("/api/applications").set(u.auth).send({ jobId: job.body.id }).expect(409);

    const applied = await request(app).patch(`/api/applications/${a.body.id}`).set(u.auth).send({ status: "applied", notes: "Referred by Asha" }).expect(200);
    expect(applied.body.applied_at).toBeTruthy();
    const days = (new Date(applied.body.next_followup_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);

    const interview = await request(app).patch(`/api/applications/${a.body.id}`).set(u.auth).send({ status: "interview" }).expect(200);
    expect(interview.body.next_followup_at).toBeNull();
    expect(interview.body.events.map((e: { type: string }) => e.type)).toEqual(["status:saved", "status:applied", "status:interview"]);
    expect(interview.body.notes).toBe("Referred by Asha");

    const other = await newUser();
    await request(app).get(`/api/applications/${a.body.id}`).set(other.auth).expect(404);
    await request(app).patch(`/api/applications/${a.body.id}`).set(other.auth).send({ status: "offer" }).expect(404);

    const list = await request(app).get("/api/applications").set(u.auth).expect(200);
    expect(list.body).toHaveLength(1);
    await request(app).delete(`/api/applications/${a.body.id}`).set(u.auth).expect(204);
  });
});
