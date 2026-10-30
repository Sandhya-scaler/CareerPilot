"use client";

import Link from "next/link";
import { useState } from "react";
import { EvidenceReview, type EvidenceEdits } from "@/components/EvidenceReview";
import { ProofLadder } from "@/components/ProofLadder";
import { ResumeUpload } from "@/components/ResumeUpload";
import { Empty, ErrorNote, Loading, PageHeader, Quote, Section } from "@/components/ui";
import { api, errorText, relDate, useApi } from "@/lib/api";
import type { Evidence } from "@/lib/types";

interface ResumeRow {
  id: string;
  title: string;
  created_at: string;
  versions: { id: string; label: string; job_id: string | null; created_at: string }[];
}
interface Version {
  id: string;
  label: string;
  evidence: Evidence[];
}

export default function ResumePage() {
  const resumes = useApi<ResumeRow[]>("/api/resumes");
  const base = resumes.data?.[0]?.versions.filter((v) => !v.job_id).at(-1);
  const version = useApi<Version>(base ? `/api/resume-versions/${base.id}` : null);
  const [uploading, setUploading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (resumes.loading) return <Loading />;
  const ev = version.data?.evidence ?? [];
  const unconfirmed = ev.some((e) => !e.confirmed);

  const confirm = async (edits: EvidenceEdits) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/resume-versions/${base!.id}/confirm`, { method: "POST", json: edits });
      setReviewing(false);
      await version.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // Strongest line per skill, for the summary list.
  const best = new Map<string, Evidence>();
  for (const e of ev) for (const s of e.skills) if (!best.has(s) || e.tier > best.get(s)!.tier) best.set(s, e);
  const skills = [...best.entries()].sort((a, b) => b[1].tier - a[1].tier || a[0].localeCompare(b[0]));

  return (
    <>
      <PageHeader
        title="Resume"
        intro="Your evidence comes from your resume, plus the plan tasks you complete. Tailored versions change the order and wording, never the facts."
        actions={base && !uploading ? <button className="btn btn-quiet" onClick={() => setUploading(true)}>Upload a new resume</button> : undefined}
      />

      {(!base || uploading) && (
        <Section title="Upload your resume">
          <ResumeUpload
            onUploaded={async () => {
              setUploading(false);
              setReviewing(true);
              await resumes.reload();
            }}
          />
        </Section>
      )}

      {base && !uploading && version.data && (
        <>
          {(reviewing || unconfirmed) ? (
            <Section title="Check what we extracted">
              <EvidenceReview evidence={ev} busy={busy} onSubmit={confirm} />
              {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
            </Section>
          ) : (
            <Section title="What your resume proves" aside={<button className="text-action hover:underline" onClick={() => setReviewing(true)}>Review lines</button>}>
              {skills.length === 0 ? (
                <Empty>We couldn&apos;t find skills on this resume. Try uploading a text-based PDF or pasting the text.</Empty>
              ) : (
                <ul className="divide-y divide-rule border-b border-rule">
                  {skills.map(([skill, e]) => (
                    <li key={skill} className="grid gap-x-5 gap-y-1 py-2.5 sm:grid-cols-[180px_auto_1fr]">
                      <span className="font-medium">{skill}</span>
                      <span className="pt-0.5"><ProofLadder tier={e.tier} size="sm" /></span>
                      <Quote muted>{e.text}</Quote>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          <Section title="Versions">
            <ul className="divide-y divide-rule border-y border-rule">
              {resumes.data![0]!.versions.slice().reverse().map((v) => (
                <li key={v.id} className="flex items-baseline justify-between gap-4 py-2.5">
                  <Link href={`/resumes/${v.id}`} className="text-action hover:underline">{v.label}</Link>
                  <span className="text-[13px] text-ink-faint">{relDate(v.created_at)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[13px] text-ink-faint">Create a tailored version from any job page.</p>
          </Section>
        </>
      )}
    </>
  );
}
