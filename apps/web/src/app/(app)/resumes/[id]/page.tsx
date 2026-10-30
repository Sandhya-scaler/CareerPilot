"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ErrorNote, Loading, PageHeader, Section } from "@/components/ui";
import { relDate, useApi } from "@/lib/api";

interface Edit {
  op: string;
  section: string;
  before: string;
  after: string;
  reason: string;
}
interface VersionView {
  id: string;
  label: string;
  job_id: string | null;
  parent_version_id: string | null;
  created_at: string;
}
interface Diff {
  parentId: string | null;
  lines: { op: "same" | "add" | "del"; text: string }[];
  changeLog: Edit[];
}

const OP_LABEL: Record<string, string> = {
  move_section: "Moved a section",
  reorder_projects: "Reordered projects",
  reorder_bullets: "Reordered bullets",
  reorder_skills: "Reordered skills",
  rephrase: "Reworded a bullet",
  rejected_rephrase: "Rejected a rewording",
};

export default function VersionPage() {
  const { id } = useParams<{ id: string }>();
  const v = useApi<VersionView>(`/api/resume-versions/${id}`);
  const d = useApi<Diff>(`/api/resume-versions/${id}/diff`);
  if (v.loading || d.loading) return <Loading />;
  if (v.error || !v.data || !d.data) return <ErrorNote>{v.error ?? d.error ?? "Not found"}</ErrorNote>;
  const kept = d.data.changeLog.filter((e) => e.op !== "rejected_rephrase");
  const rejected = d.data.changeLog.filter((e) => e.op === "rejected_rephrase");

  return (
    <>
      <PageHeader
        title={v.data.label}
        intro={`Created ${relDate(v.data.created_at)}.${v.data.parent_version_id ? " Compared with your base resume below: same facts, different order and emphasis." : ""}`}
        actions={
          <>
            <Link href={`/print/resume/${id}`} target="_blank" className="btn">Save as PDF</Link>
            {v.data.job_id && <Link href={`/jobs/${v.data.job_id}`} className="btn btn-quiet">Back to the job</Link>}
          </>
        }
      />

      {d.data.parentId && (
        <Section title="What changed and why" aside={`${kept.length} changes`}>
          {kept.length === 0 ? (
            <p className="text-ink-soft">Your resume already puts the most relevant work first for this job; nothing needed to move.</p>
          ) : (
            <ul className="divide-y divide-rule border-b border-rule">
              {kept.map((e, i) => (
                <li key={i} className="py-3">
                  <p className="font-medium">{OP_LABEL[e.op] ?? e.op} <span className="font-normal text-ink-faint">in {e.section}</span></p>
                  <p className="text-[14.5px] text-ink-soft">{e.reason}</p>
                  {e.op === "rephrase" && (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <p className="source rounded-[4px] bg-gap-wash/60 px-2 py-1 text-ink-soft line-through decoration-gap/40">{e.before}</p>
                      <p className="source rounded-[4px] bg-proof-wash px-2 py-1">{e.after}</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {rejected.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-ink-soft">
                {rejected.length} suggested rewording{rejected.length > 1 ? "s were" : " was"} rejected for adding facts you haven&apos;t shown
              </summary>
              <ul className="mt-2 space-y-2 text-[14px]">
                {rejected.map((e, i) => (
                  <li key={i}>
                    <p className="source text-ink-soft line-through">{e.after}</p>
                    <p className="text-gap">{e.reason}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Section>
      )}

      <Section title={d.data.parentId ? "Line by line" : "Resume text"}>
        <div className="source overflow-x-auto rounded-[6px] border border-rule bg-surface p-4 text-[14.5px]">
          {d.data.lines.map((l, i) => (
            <div
              key={i}
              className={`whitespace-pre-wrap px-2 ${l.op === "add" ? "bg-proof-wash" : l.op === "del" ? "bg-gap-wash/60 text-ink-faint line-through" : ""}`}
            >
              <span className="mr-2 inline-block w-3 select-none text-ink-faint" aria-hidden>{l.op === "add" ? "+" : l.op === "del" ? "−" : ""}</span>
              {l.text || " "}
            </div>
          ))}
        </div>
        {d.data.parentId && <p className="mt-2 text-[13px] text-ink-faint">Green lines moved here; struck lines moved away. Reordering shows as a pair.</p>}
      </Section>
    </>
  );
}
