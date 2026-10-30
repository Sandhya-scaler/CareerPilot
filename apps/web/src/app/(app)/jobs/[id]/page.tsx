"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ProofLadder } from "@/components/ProofLadder";
import { ErrorNote, Kind, Loading, PageHeader, Quote, Section } from "@/components/ui";
import { api, errorText, pct, relDate, useApi } from "@/lib/api";
import type { Job, MatchItem, MatchReport } from "@/lib/types";

function LedgerRow({ item }: { item: MatchItem }) {
  const missing = item.via === "none";
  return (
    <li className="grid gap-x-5 gap-y-2 py-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
      <div className="min-w-0">
        <p className="mb-1 flex items-center gap-2">
          <span className="font-medium">{item.skill}</span>
          <Kind kind={item.kind} />
        </p>
        <Quote>{item.requirement_text}</Quote>
      </div>
      <div className="flex items-start pt-7 md:justify-center">
        <ProofLadder tier={item.evidence_tier} via={item.via} missingMust={missing && item.kind === "must"} />
      </div>
      <div className="min-w-0 md:pt-7">
        {item.evidence_text ? (
          <>
            <Quote muted>{item.evidence_text}</Quote>
            {item.evidence_context && <p className="mt-0.5 text-[13px] text-ink-faint">{item.evidence_context}</p>}
          </>
        ) : (
          <p className={`text-sm font-medium ${item.kind === "must" ? "text-gap" : "text-ink-soft"}`}>Nothing on your resume</p>
        )}
        <p className="mt-1.5 text-[13.5px] text-ink-soft">{item.explanation}</p>
      </div>
    </li>
  );
}

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: job, loading, error, reload } = useApi<Job>(`/api/jobs/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const act = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <Loading />;
  if (error || !job) return <ErrorNote>{error ?? "Job not found"}</ErrorNote>;
  const report: MatchReport | null | undefined = job.latest_report;
  const scored = report?.items.filter((i) => i.scored) ?? [];
  const soft = report?.items.filter((i) => !i.scored) ?? [];

  return (
    <>
      <PageHeader
        title={job.title}
        intro={
          <>
            {job.company ?? "Unknown company"}
            {job.location ? `, ${job.location}` : ""}
            {job.posted_at ? `. Posted ${relDate(job.posted_at)}` : ""}
            {job.url && (
              <>
                {". "}
                <a href={job.url} target="_blank" rel="noreferrer" className="text-action hover:underline">Original posting</a>
              </>
            )}
          </>
        }
        actions={
          <>
            <button className="btn" disabled={!!busy} onClick={() => act("match", async () => {
              await api("/api/match", { method: "POST", json: { jobId: id } });
              await reload();
            })}>
              {busy === "match" ? "Matching…" : report ? "Match again" : "Match my resume"}
            </button>
            <button className="btn btn-quiet" disabled={!!busy} onClick={() => act("tailor", async () => {
              const resumes = await api<{ versions: { id: string; job_id: string | null }[] }[]>("/api/resumes");
              const base = resumes[0]?.versions.filter((v) => !v.job_id).at(-1);
              if (!base) throw new Error("Upload a resume first (Resume page).");
              const t = await api<{ versionId: string }>(`/api/resume-versions/${base.id}/tailor`, { method: "POST", json: { jobId: id } });
              router.push(`/resumes/${t.versionId}`);
            })}>
              {busy === "tailor" ? "Tailoring…" : "Tailor my resume"}
            </button>
            <button className="btn btn-quiet" disabled={!!busy} onClick={() => act("interview", async () => {
              const s = await api<{ id: string }>("/api/interviews", { method: "POST", json: { jobId: id, count: 5 } });
              router.push(`/practice/interview/${s.id}`);
            })}>
              {busy === "interview" ? "Writing questions…" : "Practice interview"}
            </button>
            <button className="btn btn-quiet" disabled={!!busy} onClick={() => act("track", async () => {
              await api("/api/applications", { method: "POST", json: { jobId: id } });
              router.push("/applications");
            })}>
              Track application
            </button>
          </>
        }
      />
      {actionError && <div className="mb-6"><ErrorNote>{actionError}</ErrorNote></div>}

      {(job.ghost_risk ?? 0) >= 0.5 && (
        <div className="mb-8 rounded-[6px] bg-gap-wash px-4 py-3 text-[14.5px]">
          <p className="font-medium text-gap">This posting may not be actively hiring</p>
          <p className="text-ink-soft">{job.ghost_reasons.join(" ")} Consider checking the company&apos;s careers page or asking a recruiter before investing time.</p>
        </div>
      )}

      {report ? (
        <>
          <div className="flex flex-wrap items-end gap-x-12 gap-y-3">
            <div>
              <p className="text-[48px] font-semibold leading-none tabular-nums tracking-tight">{pct(report.coverage)}</p>
              <p className="mt-1.5 text-sm text-ink-soft">coverage, must-haves count double</p>
            </div>
            <p className="max-w-xl text-ink-soft">{report.summary}</p>
          </div>

          <Section title="Requirement by requirement" aside="Left: what the job asks. Right: your proof.">
            <ul className="divide-y divide-rule border-b border-rule">
              {scored.map((i) => <LedgerRow key={i.skill} item={i} />)}
            </ul>
          </Section>
          {soft.length > 0 && (
            <p className="mt-4 text-sm text-ink-soft">
              Also mentioned, not scored: {soft.map((s) => s.skill).join(", ")}. Show these through how you describe your projects and in interviews.
            </p>
          )}
        </>
      ) : (
        <Section title="What this job asks for" aside={`${job.requirements?.length ?? 0} requirements`}>
          <ul className="divide-y divide-rule border-b border-rule">
            {job.requirements?.map((r) => (
              <li key={r.id} className="grid gap-x-6 gap-y-1 py-3 sm:grid-cols-[200px_1fr]">
                <p className="flex items-center gap-2"><span className="font-medium">{r.skill}</span><Kind kind={r.kind} /></p>
                <Quote>{r.sourceSentence}</Quote>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-ink-soft">Choose <em>Match my resume</em> to see your evidence next to each requirement.</p>
        </Section>
      )}

      <Section title="Full job description">
        <details>
          <summary className="cursor-pointer text-action">Show the posting text</summary>
          <div className="source mt-3 max-w-[72ch] whitespace-pre-line text-ink-soft">{job.description}</div>
        </details>
      </Section>

      <p className="mt-10 text-sm"><Link href="/jobs" className="text-action hover:underline">All jobs</Link></p>
    </>
  );
}
