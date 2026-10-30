import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config.js";
import { one, query } from "../db/pool.js";
import type { WeeklyReport } from "./reports.js";

/**
 * Weekly report email over plain SMTP, so any provider works (Resend, SES, Postmark, Gmail app
 * password): SMTP_URL=smtps://user:pass@smtp.example.com:465. Users opt in on the Account page.
 */
let transport: Transporter | null = null;

export const emailEnabled = () => Boolean(config.SMTP_URL);

function getTransport() {
  transport ??= nodemailer.createTransport(config.SMTP_URL!);
  return transport;
}

/** Test hook: point the mailer at a different SMTP URL. */
export function resetTransport() {
  transport = null;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const fmt = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

export function renderWeeklyEmail(r: WeeklyReport, name: string | null) {
  const url = config.APP_URL;
  const readiness = r.readiness != null ? `${Math.round(r.readiness * 100)}%` : "not measured yet";
  const subject = `Your CareerPilot week: ${r.headline.split(".")[0]}`;

  const lines = [
    `Hi${name ? ` ${name.split(" ")[0]}` : ""},`,
    "",
    r.headline,
    "",
    `Market readiness: ${readiness}`,
    r.tasksDone.length ? `\nDone this week:\n${r.tasksDone.map((t) => `- ${t.title}`).join("\n")}` : "",
    r.evidenceAdded.length ? `\nNew evidence:\n${r.evidenceAdded.map((e) => `- ${e.text}`).join("\n")}` : "",
    r.followUpsDue.length ? `\nFollow up on:\n${r.followUpsDue.map((f) => `- ${f.title}${f.company ? ` at ${f.company}` : ""}`).join("\n")}` : "",
    r.nextWeek.length ? `\nNext week:\n${r.nextWeek.map((t) => `- ${t.title} (${t.estHours} h)`).join("\n")}` : "",
    "",
    `Full report: ${url}/report`,
    `Stop these emails: ${url}/account`,
  ];
  const text = lines.filter((l) => l !== "").join("\n").replace(/\n(?=[A-Z][a-z ]+:\n)/g, "\n\n");

  const list = (title: string, items: string[]) =>
    items.length
      ? `<h2 style="font:600 15px system-ui,sans-serif;margin:24px 0 6px">${esc(title)}</h2><ul style="margin:0;padding-left:18px;font:14px/1.6 Georgia,serif;color:#1c2733">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`
      : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f2f4f1;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #d9ded8;border-radius:8px;padding:28px;color:#1c2733;font:15px/1.55 system-ui,sans-serif">
<p style="margin:0 0 4px;color:#4a5866;font-size:13px">Week of ${fmt(r.weekStart)}</p>
<p style="margin:0 0 16px;font-size:18px;font-weight:600">${esc(r.headline)}</p>
<p style="margin:0"><span style="font-size:32px;font-weight:600">${esc(readiness)}</span> <span style="color:#4a5866">market readiness</span></p>
${list("Done this week", r.tasksDone.map((t) => t.title))}
${list("New evidence", r.evidenceAdded.map((e) => e.text))}
${list("Follow up on", r.followUpsDue.map((f) => `${f.title}${f.company ? ` at ${f.company}` : ""}`))}
${list("Next week", r.nextWeek.map((t) => `${t.title} (${t.estHours} h)`))}
<p style="margin:28px 0 0"><a href="${url}/report" style="background:#2c3d8f;color:#fff;padding:9px 14px;border-radius:6px;text-decoration:none;font-weight:500">Open the full report</a></p>
<p style="margin:24px 0 0;color:#7d8a96;font-size:12px">You get this because weekly emails are on. <a href="${url}/account" style="color:#7d8a96">Turn them off</a>.</p>
</div></body></html>`;
  return { subject, text, html };
}

/** Sends a stored weekly report once (emailed_at guards against duplicates). Returns whether it sent. */
export async function sendWeeklyReport(userId: string, weekStart: string, opts: { force?: boolean } = {}): Promise<boolean> {
  if (!emailEnabled()) return false;
  const row = await one<{ email: string; name: string | null; email_reports: boolean; content: WeeklyReport; emailed_at: string | null }>(
    `SELECT u.email, u.name, u.email_reports, w.content, w.emailed_at
     FROM weekly_reports w JOIN users u ON u.id = w.user_id WHERE w.user_id = $1 AND w.week_start = $2`,
    [userId, weekStart],
  );
  if (!row || (!opts.force && (!row.email_reports || row.emailed_at))) return false;
  const msg = renderWeeklyEmail(row.content, row.name);
  await getTransport().sendMail({ from: config.EMAIL_FROM, to: row.email, ...msg });
  await query("UPDATE weekly_reports SET emailed_at = now() WHERE user_id = $1 AND week_start = $2", [userId, weekStart]);
  return true;
}
