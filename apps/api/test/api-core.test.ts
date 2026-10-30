import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { app, binaryFixture, fixture, newUser, resetDb } from "./helpers.js";

beforeAll(resetDb);
afterAll(() => pool.end());

describe("auth", () => {
  it("registers, logs in, rejects bad passwords and unauthenticated calls", async () => {
    const u = await newUser();
    await request(app).post("/auth/login").send({ email: u.email, password: "nope-nope-nope" }).expect(401);
    const ok = await request(app).post("/auth/login").send({ email: u.email, password: "correct-horse-battery" }).expect(200);
    expect(ok.headers["set-cookie"]?.[0]).toMatch(/cp_session=.*HttpOnly/);
    await request(app).get("/api/jobs").expect(401);
    await request(app).get("/api/jobs").set("Authorization", "Bearer forged.123.abc").expect(401);
    const me = await request(app).get("/auth/me").set(u.auth).expect(200);
    expect(me.body.email).toBe(u.email);
  });

  it("rejects duplicate emails and weak passwords", async () => {
    const u = await newUser();
    await request(app).post("/auth/register").send({ email: u.email, password: "another-password" }).expect(409);
    await request(app).post("/auth/register").send({ email: "x@test.dev", password: "short" }).expect(400);
  });

  it("updates the profile", async () => {
    const u = await newUser();
    const r = await request(app).patch("/auth/me").set(u.auth).send({ target_role: "Computer Vision Intern", hours_per_week: 10 }).expect(200);
    expect(r.body).toMatchObject({ target_role: "Computer Vision Intern", hours_per_week: 10 });
  });
});

describe("resume → evidence → job → match", () => {
  it("runs the full Phase 1 flow with evidence links", async () => {
    const u = await newUser();
    const resume = await request(app)
      .post("/api/resumes")
      .set(u.auth)
      .send({ text: await fixture("resumes/cv-student.txt"), title: "CV resume" })
      .expect(201);
    expect(resume.body.name).toBe("Aarav Mehta");
    const evidence = resume.body.evidence as { id: string; skills: string[]; tier: number; text: string; confirmed: boolean }[];
    expect(evidence.length).toBeGreaterThan(5);
    expect(evidence.every((e) => !e.confirmed)).toBe(true);

    // Human-in-the-loop: drop one line, try to inflate a claimed-only skill (capped), add a new line.
    const pytorch = evidence.find((e) => e.skills.includes("PyTorch") && e.tier === 1)!;
    const matlab = evidence.find((e) => e.skills.includes("MATLAB") && e.tier === 2)!;
    const confirmed = await request(app)
      .post(`/api/resume-versions/${resume.body.versionId}/confirm`)
      .set(u.auth)
      .send({
        update: [{ id: pytorch.id, tier: 4 }, { id: matlab.id, remove: true }],
        add: [{ text: "Fine-tuned a YOLOv8 detector in PyTorch on 1,200 shelf images, 0.81 mAP", context: "Shelf detector" }],
      })
      .expect(200);
    const after = confirmed.body as typeof evidence;
    expect(after.every((e) => e.confirmed)).toBe(true);
    expect(after.find((e) => e.id === pytorch.id)!.tier).toBe(1); // "Libraries: ... PyTorch (basic)" can't be inflated
    expect(after.some((e) => e.id === matlab.id)).toBe(false);
    const added = after.find((e) => e.text.startsWith("Fine-tuned"))!;
    expect(added.tier).toBe(3);
    expect(added.skills).toEqual(expect.arrayContaining(["Object Detection", "PyTorch"]));

    const job = await request(app)
      .post("/api/jobs/ingest")
      .set(u.auth)
      .send({ text: await fixture("jds/cv-intern-a.txt"), company: "Warehouse Robotics" })
      .expect(201);
    expect(job.body.title).toMatch(/Computer Vision Intern/);
    expect(job.body.requirements.length).toBeGreaterThan(8);

    const report = await request(app).post("/api/match").set(u.auth).send({ jobId: job.body.id }).expect(201);
    const items = report.body.items as { skill: string; via: string; evidence_text: string | null; requirement_text: string; evidence_tier: number | null; scored: boolean }[];
    expect(report.body.coverage).toBeGreaterThan(0.3);
    expect(report.body.coverage).toBeLessThan(1);
    const opencv = items.find((i) => i.skill === "OpenCV")!;
    expect(opencv.via).toBe("direct");
    expect(opencv.evidence_text).toContain("OpenCV");
    expect(opencv.requirement_text).toBe("Experience with OpenCV.");
    const detection = items.find((i) => i.skill === "Object Detection")!;
    expect(detection.evidence_tier).toBe(3); // from the line the user added
    expect(report.body.summary).toMatch(/coverage/);

    const listed = await request(app).get("/api/jobs").set(u.auth).expect(200);
    expect(listed.body[0].last_coverage).toBeCloseTo(report.body.coverage, 2);
  });

  it("accepts PDF and DOCX uploads", async () => {
    const u = await newUser();
    for (const f of ["resume.pdf", "resume.docx"]) {
      const r = await request(app).post("/api/resumes").set(u.auth).attach("file", await binaryFixture(f), f).expect(201);
      expect(r.body.evidence.some((e: { skills: string[] }) => e.skills.includes("OpenCV"))).toBe(true);
    }
    await request(app).post("/api/resumes").set(u.auth).attach("file", Buffer.from("hello"), "x.exe").expect(415);
  });

  it("reuses requirement extraction for identical JDs and dedupes jobs", async () => {
    const u = await newUser();
    const text = await fixture("jds/backend-node.txt");
    const a = await request(app).post("/api/jobs/ingest").set(u.auth).send({ text }).expect(201);
    const b = await request(app).post("/api/jobs/ingest").set(u.auth).send({ text }).expect(201);
    expect(b.body.id).toBe(a.body.id);
    expect(b.body.requirements).toEqual(a.body.requirements);
  });

  it("isolates users from each other's data", async () => {
    const alice = await newUser();
    const bob = await newUser();
    const r = await request(app).post("/api/resumes").set(alice.auth).send({ text: await fixture("resumes/backend-switcher.txt") }).expect(201);
    await request(app).get(`/api/resume-versions/${r.body.versionId}`).set(bob.auth).expect(404);
    const job = await request(app).post("/api/jobs/ingest").set(alice.auth).send({ text: await fixture("jds/ml-engineer.txt") }).expect(201);
    // Bob has no resume yet
    await request(app).post("/api/match").set(bob.auth).send({ jobId: job.body.id }).expect(409);
    // Bob can't match against Alice's resume version
    await request(app).post("/api/match").set(bob.auth).send({ jobId: job.body.id, resumeVersionId: r.body.versionId }).expect(404);
    const report = await request(app).post("/api/match").set(alice.auth).send({ jobId: job.body.id }).expect(201);
    await request(app).get(`/api/match-reports/${report.body.id}`).set(bob.auth).expect(404);
  });

  it("validates input", async () => {
    const u = await newUser();
    const bad = await request(app).post("/api/jobs/ingest").set(u.auth).send({ text: "too short" }).expect(400);
    expect(bad.body.details[0]).toMatch(/text/);
    await request(app).get("/api/match-reports/not-a-uuid").set(u.auth).expect(400);
  });

  it("deletes an account and all its data", async () => {
    const u = await newUser();
    await request(app).post("/api/resumes").set(u.auth).send({ text: await fixture("resumes/frontend-newgrad.txt") }).expect(201);
    await request(app).delete("/auth/me").set(u.auth).expect(204);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM evidence_items WHERE user_id = $1", [u.id]);
    expect(rows[0].n).toBe(0);
  });
});
