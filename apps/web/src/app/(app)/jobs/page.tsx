"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Empty, ErrorNote, Loading, PageHeader, Section } from "@/components/ui";
import { api, errorText, pct, relDate, useApi } from "@/lib/api";
import type { Job } from "@/lib/types";

function AddJob() {
  const router = useRouter();
  const [form, setForm] = useState({ text: "", title: "", company: "", url: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const job = await api<Job>("/api/jobs/ingest", {
        method: "POST",
        json: { text: form.text, title: form.title || undefined, company: form.company || undefined, url: form.url || undefined },
      });
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <input className="field" placeholder="Job title (optional)" aria-label="Job title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <input className="field" placeholder="Company (optional)" aria-label="Company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
        <input className="field" type="url" placeholder="Link to posting (optional)" aria-label="Posting link" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
      </div>
      <textarea
        className="field min-h-44 font-serif"
        aria-label="Job description"
        placeholder="Paste the full job description, from LinkedIn, Naukri, a careers page, anywhere."
        value={form.text}
        onChange={(e) => setForm({ ...form, text: e.target.value })}
      />
      {error && <ErrorNote>{error}</ErrorNote>}
      <button className="btn" disabled={busy || form.text.trim().length < 80}>{busy ? "Reading…" : "Add job and read requirements"}</button>
    </form>
  );
}

export default function JobsPage() {
  const { data: jobs, loading, error } = useApi<Job[]>("/api/jobs");
  return (
    <>
      <PageHeader title="Jobs" intro="Postings you've saved or that research found. Open one to see requirement-by-requirement how your evidence holds up." />
      <Section title="Add a job description">
        <AddJob />
      </Section>
      <Section title="Saved postings" aside={jobs ? `${jobs.length}` : undefined}>
        {loading && <Loading />}
        {error && <ErrorNote>{error}</ErrorNote>}
        {jobs && jobs.length === 0 && <Empty>No jobs yet. Paste one above, or run Prepare for a role to search company job boards.</Empty>}
        {jobs && jobs.length > 0 && (
          <ul className="divide-y divide-rule border-y border-rule">
            {jobs.map((j) => (
              <li key={j.id} className="grid gap-x-6 gap-y-1 py-3 sm:grid-cols-[1fr_auto]">
                <div className="min-w-0">
                  <Link href={`/jobs/${j.id}`} className="font-medium text-action hover:underline">{j.title}</Link>
                  <p className="text-[13.5px] text-ink-soft">
                    {j.company ?? "Unknown company"}
                    {j.location ? `, ${j.location}` : ""}
                    {j.posted_at ? `, posted ${relDate(j.posted_at)}` : ""}
                    {j.source !== "pasted" ? `, via ${j.source}` : ""}
                  </p>
                </div>
                <div className="text-sm text-ink-soft sm:text-right">
                  {j.last_coverage != null ? <span className="font-semibold text-ink tabular-nums">{pct(j.last_coverage)}</span> : <span>not matched yet</span>}
                  <p className="text-[13px] text-ink-faint">{j.requirement_count} requirements</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
