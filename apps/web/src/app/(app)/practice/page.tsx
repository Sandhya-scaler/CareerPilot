"use client";

import { useState } from "react";
import { Empty, ErrorNote, Loading, PageHeader, Section } from "@/components/ui";
import { useApi } from "@/lib/api";
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

export default function PracticePage() {
  const { data, loading, error } = useApi<Question[]>("/api/questions?limit=60");
  if (loading) return <Loading />;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  const qs = data ?? [];
  const kinds = ["jd", "concept", "project", "applied", "behavioral"].filter((k) => qs.some((q) => q.kind === k));

  return (
    <>
      <PageHeader title="Practice" intro="Questions built from your gaps, real job descriptions and your own resume. Answer out loud first, then check the rubric." />
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
