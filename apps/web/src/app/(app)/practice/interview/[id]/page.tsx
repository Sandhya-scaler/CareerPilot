"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ErrorNote, Loading, PageHeader, Section } from "@/components/ui";
import { api, errorText, useApi } from "@/lib/api";

interface Grade {
  score: number;
  covered: string[];
  missed: string[];
  feedback: string;
  gradedBy: "llm" | "keywords";
  prompt: string;
}
interface Session {
  id: string;
  status: "active" | "done";
  job_id: string | null;
  question: { prompt: string; skill: string | null; isFollowup: boolean; number: number; total: number } | null;
  lastGrade: Grade | null;
  summary: { averageScore: number; bySkill: { skill: string; average: number }[]; weakSkills: string[]; addedTasks: number } | null;
}

function Score({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`size-2.5 rounded-full ${i <= value ? (value >= 4 ? "bg-proof-3" : value === 3 ? "bg-proof-2" : "bg-gap") : "bg-rule"}`} />
      ))}
      <span className="ml-1 text-sm font-medium tabular-nums">{value}/5</span>
    </span>
  );
}

function GradeView({ g }: { g: Grade }) {
  return (
    <div className="rounded-[6px] border border-rule bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-soft">Your last answer</p>
        <Score value={g.score} />
      </div>
      <p className="mt-2">{g.feedback}</p>
      {g.covered.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[14px] text-proof-4">{g.covered.map((c) => <li key={c}>Covered: {c}</li>)}</ul>
      )}
      {g.missed.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[14px] text-gap">{g.missed.map((c) => <li key={c}>Missing: {c}</li>)}</ul>
      )}
      {g.gradedBy === "keywords" && (
        <p className="mt-2 text-[12.5px] text-ink-faint">Scored by matching rubric keywords. Add an Anthropic API key for AI grading that judges substance.</p>
      )}
    </div>
  );
}

export default function InterviewPage() {
  const { id } = useParams<{ id: string }>();
  const { data: s, loading, error, setData } = useApi<Session>(`/api/interviews/${id}`);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (error || !s) return <ErrorNote>{error ?? "Interview not found"}</ErrorNote>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      setData(await api<Session>(`/api/interviews/${id}/answer`, { method: "POST", json: { answer } }));
      setAnswer("");
    } catch (x) {
      setErr(errorText(x));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Mock interview"
        intro={s.question ? `Question ${s.question.number} of ${s.question.total}. Answer as you would out loud: the reasoning, an example, the trade-offs.` : undefined}
        actions={<Link href="/practice" className="btn btn-quiet">Leave</Link>}
      />

      {s.lastGrade && <div className="mb-8 max-w-3xl"><GradeView g={s.lastGrade} /></div>}

      {s.question && (
        <form onSubmit={submit} className="max-w-3xl">
          {s.question.skill && <p className="mb-1 text-[13px] font-medium text-proof-4">{s.question.skill}{s.question.isFollowup ? ", follow-up" : ""}</p>}
          <p className="text-[20px] leading-snug">{s.question.prompt}</p>
          <label className="sr-only" htmlFor="answer">Your answer</label>
          <textarea
            id="answer"
            className="field mt-4 min-h-48 font-serif text-[16px]"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Type your answer"
            autoFocus
          />
          {err && <div className="mt-2"><ErrorNote>{err}</ErrorNote></div>}
          <div className="mt-3 flex items-center gap-3">
            <button className="btn" disabled={busy || answer.trim().length === 0}>{busy ? "Grading…" : "Submit answer"}</button>
            <span className="text-[13px] text-ink-faint">{answer.trim().split(/\s+/).filter(Boolean).length} words</span>
          </div>
        </form>
      )}

      {s.status === "done" && s.summary && (
        <Section title="How it went">
          <p className="text-[40px] font-semibold leading-none tabular-nums">{s.summary.averageScore.toFixed(1)}<span className="text-xl text-ink-faint"> / 5</span></p>
          <ul className="mt-4 divide-y divide-rule border-y border-rule">
            {s.summary.bySkill.map((b) => (
              <li key={b.skill} className="flex items-center justify-between py-2.5">
                <span>{b.skill}</span>
                <Score value={Math.round(b.average)} />
              </li>
            ))}
          </ul>
          <p className="mt-4 text-ink-soft">
            {s.summary.addedTasks > 0
              ? `Added ${s.summary.addedTasks} practice task${s.summary.addedTasks > 1 ? "s" : ""} to this week's plan for ${s.summary.weakSkills.join(", ")}.`
              : s.summary.weakSkills.length
                ? `Work on ${s.summary.weakSkills.join(", ")} next.`
                : "No weak areas this round."}
          </p>
          <div className="mt-4 flex gap-2">
            <Link href="/practice" className="btn">Back to practice</Link>
            <Link href="/plan" className="btn btn-quiet">Open the plan</Link>
          </div>
        </Section>
      )}
    </>
  );
}
