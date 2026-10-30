"use client";

import Link from "next/link";
import { useState } from "react";
import { ProofLadder } from "@/components/ProofLadder";
import { ErrorNote, Loading, PageHeader, Quote, Section } from "@/components/ui";
import { pct, useApi } from "@/lib/api";
import type { Tier } from "@/lib/types";

interface Report {
  weekStart: string;
  headline: string;
  readiness: number | null;
  readinessDelta: number | null;
  tasksDone: { title: string; skill: string | null }[];
  evidenceAdded: { text: string; skills: string[]; tier: Tier; source: string }[];
  interviews: { sessions: number; averageScore: number | null; weakSkills: string[] };
  applications: { events: { type: string; title: string }[]; funnel: Record<string, number> };
  followUpsDue: { title: string; company: string | null; appliedAt: string | null }[];
  nextWeek: { title: string; estHours: number }[];
}

const STATUS: Record<string, string> = { saved: "saved", applied: "applied to", oa: "got an assessment from", interview: "got an interview at", offer: "got an offer from", rejected: "heard no from", withdrawn: "withdrew from" };
const fmt = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export default function ReportPage() {
  const [week, setWeek] = useState<string | null>(null);
  const r = useApi<Report>(`/api/reports/weekly${week ? `?week=${week}` : ""}`);
  const list = useApi<{ week_start: string; headline: string }[]>("/api/reports");
  if (r.loading && !r.data) return <Loading />;
  if (r.error || !r.data) return <ErrorNote>{r.error ?? "No report"}</ErrorNote>;
  const d = r.data;
  const end = new Date(new Date(d.weekStart).getTime() + 6 * 86_400_000).toISOString();

  return (
    <>
      <PageHeader title={`Week of ${fmt(d.weekStart)} to ${fmt(end)}`} intro={d.headline} />

      <div className="flex flex-wrap gap-x-12 gap-y-4">
        <div>
          <p className="text-[40px] font-semibold leading-none tabular-nums">{pct(d.readiness)}</p>
          <p className="mt-1 text-sm text-ink-soft">
            market readiness
            {d.readinessDelta != null && ` (${d.readinessDelta >= 0 ? "+" : "−"}${Math.abs(Math.round(d.readinessDelta * 100))} since last report)`}
          </p>
        </div>
        <div>
          <p className="text-[40px] font-semibold leading-none tabular-nums">{d.tasksDone.length}</p>
          <p className="mt-1 text-sm text-ink-soft">plan tasks done</p>
        </div>
        <div>
          <p className="text-[40px] font-semibold leading-none tabular-nums">{d.interviews.averageScore != null ? d.interviews.averageScore.toFixed(1) : "—"}</p>
          <p className="mt-1 text-sm text-ink-soft">mock interview average ({d.interviews.sessions} session{d.interviews.sessions === 1 ? "" : "s"})</p>
        </div>
      </div>

      <Section title="New evidence">
        {d.evidenceAdded.length === 0 ? (
          <p className="text-ink-soft">No new proof this week. Finishing a build task with a link adds some.</p>
        ) : (
          <ul className="divide-y divide-rule border-b border-rule">
            {d.evidenceAdded.map((e, i) => (
              <li key={i} className="flex gap-4 py-3">
                <span className="pt-1"><ProofLadder tier={e.tier} size="sm" /></span>
                <div>
                  <Quote>{e.text}</Quote>
                  <p className="mt-0.5 text-[13px] text-ink-faint">{e.skills.join(", ")}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Applications">
        {d.applications.events.length === 0 ? (
          <p className="text-ink-soft">No application changes this week.</p>
        ) : (
          <ul className="space-y-1">
            {d.applications.events.map((e, i) => (
              <li key={i}>You {STATUS[e.type.replace("status:", "")] ?? e.type} {e.title}.</li>
            ))}
          </ul>
        )}
        {d.followUpsDue.length > 0 && (
          <p className="mt-3 text-action">
            Follow up on {d.followUpsDue.map((f) => `${f.title}${f.company ? ` at ${f.company}` : ""}`).join(", ")}.{" "}
            <Link href="/applications" className="underline">Open applications</Link>
          </p>
        )}
      </Section>

      <Section title="Next week">
        {d.nextWeek.length === 0 ? (
          <p className="text-ink-soft">Nothing scheduled. Rebuild your plan from the market map.</p>
        ) : (
          <ul className="divide-y divide-rule border-b border-rule">
            {d.nextWeek.map((t) => (
              <li key={t.title} className="flex justify-between gap-4 py-2.5">
                <span>{t.title}</span>
                <span className="text-[13px] text-ink-faint">{t.estHours} h</span>
              </li>
            ))}
          </ul>
        )}
        {d.interviews.weakSkills.length > 0 && <p className="mt-3 text-ink-soft">Interview answers to revisit: {d.interviews.weakSkills.join(", ")}.</p>}
      </Section>

      {(list.data ?? []).length > 1 && (
        <Section title="Earlier weeks">
          <ul className="space-y-1.5">
            {list.data!.map((w) => (
              <li key={w.week_start}>
                <button className="text-action hover:underline" onClick={() => setWeek(w.week_start.slice(0, 10))}>
                  Week of {fmt(w.week_start)}
                </button>
                <span className="text-ink-faint">: {w.headline}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <p className="mt-10 text-[13px] text-ink-faint">A report is saved each Monday for the week before. This week&apos;s report updates as you work.</p>
    </>
  );
}
