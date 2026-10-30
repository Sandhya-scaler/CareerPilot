"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Empty, ErrorNote, Loading, PageHeader } from "@/components/ui";
import { api, errorText, pct, relDate, useApi } from "@/lib/api";
import type { Application, AppStatus } from "@/lib/types";

const COLUMNS: { key: AppStatus; label: string }[] = [
  { key: "saved", label: "Saved" },
  { key: "applied", label: "Applied" },
  { key: "oa", label: "Assessment" },
  { key: "interview", label: "Interview" },
  { key: "offer", label: "Offer" },
];
const CLOSED: { key: AppStatus; label: string }[] = [
  { key: "rejected", label: "Rejected" },
  { key: "withdrawn", label: "Withdrawn" },
];
const ALL = [...COLUMNS, ...CLOSED];

function followUpDraft(a: Application) {
  return `Hi,\n\nI applied for the ${a.title} role${a.company ? ` at ${a.company}` : ""} on ${new Date(a.applied_at ?? a.updated_at).toLocaleDateString("en-IN", { day: "numeric", month: "long" })} and wanted to check whether there's an update on next steps. I'm still very interested in the role and happy to share anything else that would help.\n\nThanks,\n`;
}

function AppCard({ a, onChange }: { a: Application; onChange: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [notes, setNotes] = useState(a.notes);
  const [error, setError] = useState<string | null>(null);
  const due = a.next_followup_at && new Date(a.next_followup_at) <= new Date();

  const patch = async (json: object) => {
    setError(null);
    try {
      await api(`/api/applications/${a.id}`, { method: "PATCH", json });
      onChange();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <li className="rounded-[6px] border border-rule bg-surface p-3">
      <Link href={`/jobs/${a.job_id}`} className="block font-medium leading-snug text-action hover:underline">{a.title}</Link>
      <p className="text-[13px] text-ink-soft">{a.company ?? "Unknown company"}</p>
      <p className="mt-1 text-[12.5px] text-ink-faint">
        {a.coverage != null ? `${pct(a.coverage)} match` : "Not matched"}
        {a.applied_at ? `, applied ${relDate(a.applied_at)}` : ""}
      </p>
      {due && <p className="mt-1.5 text-[12.5px] font-medium text-action">Follow-up due</p>}
      <div className="mt-2 flex items-center gap-2">
        <label className="sr-only" htmlFor={`st-${a.id}`}>Stage</label>
        <select id={`st-${a.id}`} className="field py-1 text-[13px]" value={a.status} onChange={(e) => patch({ status: e.target.value })}>
          {ALL.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <button className="shrink-0 text-[13px] text-action hover:underline" onClick={() => dialog.current?.showModal()}>
          Details
        </button>
      </div>
      <dialog
        ref={dialog}
        aria-labelledby={`dlg-${a.id}`}
        className="m-auto w-[min(640px,calc(100vw-32px))] rounded-[8px] bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/40"
        onClick={(e) => e.target === dialog.current && dialog.current?.close()}
      >
        <div className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id={`dlg-${a.id}`} className="text-lg font-semibold">{a.title}</h2>
              <p className="text-sm text-ink-soft">{a.company ?? "Unknown company"}</p>
            </div>
            <button className="btn btn-quiet" onClick={() => dialog.current?.close()}>Close</button>
          </div>
          <div>
            <label className="label" htmlFor={`n-${a.id}`}>Notes</label>
            <textarea id={`n-${a.id}`} className="field min-h-24 text-[14px]" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== a.notes && patch({ notes })} />
          </div>
          {a.resume_label && <p className="text-[13px] text-ink-faint">Sent with: {a.resume_label}</p>}
          {a.status === "applied" && (
            <div>
              <p className="label">Follow-up email</p>
              <textarea readOnly className="field min-h-44 font-serif text-[14px]" value={followUpDraft(a)} aria-label="Follow-up email draft" />
              <div className="mt-2 flex gap-2">
                <button className="btn btn-quiet" onClick={() => navigator.clipboard.writeText(followUpDraft(a))}>Copy</button>
                <button
                  className="btn btn-quiet"
                  onClick={() => patch({ nextFollowupAt: new Date(Date.now() + 7 * 86_400_000).toISOString() })}
                >
                  Sent, remind me in a week
                </button>
              </div>
            </div>
          )}
          <button
            className="text-[13px] text-gap hover:underline"
            onClick={async () => {
              dialog.current?.close();
              await api(`/api/applications/${a.id}`, { method: "DELETE" });
              onChange();
            }}
          >
            Stop tracking
          </button>
        </div>
      </dialog>
      {error && <div className="mt-2"><ErrorNote>{error}</ErrorNote></div>}
    </li>
  );
}

export default function ApplicationsPage() {
  const { data, loading, error, reload } = useApi<Application[]>("/api/applications");
  if (loading) return <Loading />;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  const apps = data ?? [];
  const closed = apps.filter((a) => a.status === "rejected" || a.status === "withdrawn");

  return (
    <>
      <PageHeader
        title="Applications"
        intro="Move each application as it progresses. We remind you to follow up a week after applying if you haven't heard back."
      />
      {apps.length === 0 ? (
        <Empty action={{ href: "/jobs", label: "Find a job to track" }}>You&apos;re not tracking any applications yet.</Empty>
      ) : (
        <>
          <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
            <div className="grid min-w-[880px] grid-cols-5 gap-3">
              {COLUMNS.map((c) => {
                const col = apps.filter((a) => a.status === c.key);
                return (
                  <section key={c.key} aria-labelledby={`col-${c.key}`} className="min-w-0">
                    <h2 id={`col-${c.key}`} className="mb-2 flex items-baseline justify-between text-sm font-semibold">
                      {c.label}
                      <span className="font-normal text-ink-faint tabular-nums">{col.length}</span>
                    </h2>
                    <ul className="space-y-2">{col.map((a) => <AppCard key={a.id} a={a} onChange={reload} />)}</ul>
                  </section>
                );
              })}
            </div>
          </div>
          {closed.length > 0 && (
            <details className="mt-8">
              <summary className="cursor-pointer text-sm text-ink-soft">Closed ({closed.length})</summary>
              <ul className="mt-3 grid gap-2 sm:grid-cols-3">{closed.map((a) => <AppCard key={a.id} a={a} onChange={reload} />)}</ul>
            </details>
          )}
        </>
      )}
    </>
  );
}
