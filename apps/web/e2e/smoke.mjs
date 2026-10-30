/**
 * End-to-end smoke test of the golden path, as a brand-new user, in a real browser.
 * Needs the API (4000) and web (3000) running. No job-board network calls (uses pasted JDs).
 *
 *   CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run e2e -w apps/web
 */
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const BASE = process.env.WEB_URL ?? "http://localhost:3000";
const fixture = (p) => readFile(new URL(`../../api/evals/data/${p}`, import.meta.url), "utf8");
const step = (m) => console.log(`✓ ${m}`);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.setDefaultTimeout(20_000);

try {
  await page.goto(`${BASE}/login`);
  await page.click("role=tab[name='Create account']");
  await page.fill("#name", "E2E Tester");
  await page.fill("#email", `e2e-${Date.now()}@example.com`);
  await page.fill("#password", "e2e-password-123");
  await page.click("form button.btn");
  await page.waitForURL(`${BASE}/prepare`);
  step("registered");

  await page.goto(`${BASE}/jobs`);
  for (const jd of ["jds/cv-intern-a.txt", "jds/cv-intern-b.txt"]) {
    await page.goto(`${BASE}/jobs`);
    await page.fill("textarea[aria-label='Job description']", await fixture(jd));
    await page.click("button:has-text('Add job and read requirements')");
    await page.waitForSelector("text=What this job asks for");
  }
  step("pasted two job descriptions");

  await page.goto(`${BASE}/prepare`);
  await page.fill("#role", "Computer Vision Intern");
  await page.click("summary:has-text('Choose sources')");
  await page.check("text=Only use job descriptions I've saved or pasted");
  await page.click("button:has-text('Build my plan')");
  await page.waitForSelector("text=Add your resume");
  await page.click("text=Paste text");
  await page.fill("textarea[aria-label='Resume text']", await fixture("resumes/cv-student.txt"));
  await page.click("button:has-text('Read my resume')");
  await page.waitForSelector("text=Is this what your resume shows?");
  step("agent paused for resume, then for evidence review");

  await page.fill("input[aria-label='What you did']", "Fine-tuned YOLOv8 in PyTorch on 1,200 shelf images, 0.81 mAP");
  await page.click("button:has-text('Add line')");
  await page.click("button:has-text('Looks right, build my plan')");
  await page.waitForSelector("text=Your plan is ready", { timeout: 60_000 });
  step("pipeline finished");

  await page.click("text=See what the market asks for");
  await page.waitForSelector("text=Close these first");
  step("market map rendered");

  await page.goto(`${BASE}/plan`);
  await page.waitForSelector("text=Week 1");
  step("plan rendered");

  await page.goto(`${BASE}/jobs`);
  await page.click("a:has-text('Computer Vision Intern')");
  await page.click("button:has-text('Match my resume')");
  await page.waitForSelector("text=Requirement by requirement");
  step("match ledger rendered");

  await page.click("button:has-text('Tailor my resume')");
  await page.waitForSelector("text=What changed and why");
  step("tailored version created");

  await page.goto(`${BASE}/practice`);
  await page.click("button:has-text('Start a mock interview')");
  await page.waitForSelector("#answer");
  await page.fill("#answer", "Intersection over union compares overlap of predicted and true boxes; NMS removes duplicates above an IoU threshold.");
  await page.click("button:has-text('Submit answer')");
  await page.waitForSelector("text=Your last answer");
  step("mock interview graded an answer");

  if (errors.length) throw new Error(`page errors:\n${errors.join("\n")}`);
  console.log("\nSmoke test passed.");
} catch (e) {
  await page.screenshot({ path: "e2e-failure.png", fullPage: true });
  console.error(`\n✗ ${e.message}\n(screenshot: e2e-failure.png)`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
