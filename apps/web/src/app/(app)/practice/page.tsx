"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Empty, ErrorNote, Loading, PageHeader, Section } from "@/components/ui";
import { api, errorText, relDate, useApi } from "@/lib/api";
import type { Question } from "@/lib/types";

const KIND_LABEL: Record<string, string> = {
  concept: "Concepts for your gap skills",
  jd: "What employers asked for",
  project: "Questions about your own projects",
  applied: "Scenarios",
  behavioral: "Behavioral",
};

function QuestionItem({ q }: { q: Question }) {
  const [show, setShow] = useState(false);
  return (
    <li className="py-4">
      {q.skill && <p className="mb-1 text-[13px] font-medium text-proof-4">{q.skill}</p>}
      <p className="max-w-[70ch] text-[15.5px]">{q.prompt}</p>
      {q.grounding && q.kind === "jd" && <p className="mt-1 text-[13px] text-ink-faint">From a real posting.</p>}
      <button className="mt-2 text-[13.5px] text-action hover:underline" aria-expanded={show} onClick={() => setShow(!show)}>
        {show ? "Hide what a strong answer covers" : "What a strong answer covers"}
      </button>
      {show && (
        <ul className="mt-2 max-w-[70ch] list-disc space-y-0.5 pl-5 text-[14.5px] text-ink-soft">
          {q.rubric.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}
    </li>
  );
}

interface Past {
  id: string;
  status: string;
  job_title: string | null;
  started_at: string;
  summary: { averageScore: number } | null;
}

function StartInterview() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const past = useApi<Past[]>("/api/interviews");
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await api<{ id: string }>("/api/interviews", { method: "POST", json: { count: 5 } });
      router.push(`/practice/interview/${s.id}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <div className="mb-10 flex flex-wrap items-start justify-between gap-6 rounded-[6px] bg-surface px-5 py-4 ring-1 ring-rule">
      <div className="max-w-xl">
        <p className="font-medium">Mock interview</p>
        <p className="text-[14.5px] text-ink-soft">
          Five questions mixed from below. Each answer is scored against its rubric; weak answers get a follow-up, and skills that score low
          become practice tasks in your plan.
        </p>
        {error && <div className="mt-2"><ErrorNote>{error}</ErrorNote></div>}
        {(past.data ?? []).length > 0 && (
          <ul className="mt-3 space-y-0.5 text-[13.5px] text-ink-soft">
            {past.data!.slice(0, 3).map((p) => (
              <li key={p.id}>
                <Link href={`/practice/interview/${p.id}`} className="text-action hover:underline">
                  {p.job_title ?? "Plan questions"}, {relDate(p.started_at)}
                </Link>
                {p.summary ? `: ${p.summary.averageScore.toFixed(1)}/5` : p.status === "active" ? ": unfinished" : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button className="btn" onClick={start} disabled={busy}>{busy ? "Starting…" : "Start a mock interview"}</button>
    </div>
  );
}

export default function PracticePage() {
  const { data, loading, error } = useApi<Question[]>("/api/questions?limit=60");
  if (loading) return <Loading />;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  const qs = data ?? [];
  const kinds = ["jd", "concept", "project", "applied", "behavioral"].filter((k) => qs.some((q) => q.kind === k));

  return (
    <>
      <PageHeader title="Practice" intro="Questions built from your gaps, real job descriptions and your own resume. Answer out loud first, then check the rubric." />
      {qs.length > 0 && <StartInterview />}
      {qs.length === 0 ? (
        <Empty action={{ href: "/prepare", label: "Prepare for a role" }}>Practice questions are written with your plan.</Empty>
      ) : (
        kinds.map((k) => (
          <Section key={k} title={KIND_LABEL[k] ?? k}>
            <ul className="divide-y divide-rule">
              {qs.filter((q) => q.kind === k).map((q) => <QuestionItem key={q.id} q={q} />)}
            </ul>
          </Section>
        ))
      )}
    </>
  );
}
