"use client";

import Link from "next/link";
import { useState } from "react";
import { Empty, ErrorNote, Loading, PageHeader } from "@/components/ui";
import { api, errorText, pct, useApi } from "@/lib/api";
import type { Plan, PlanTask } from "@/lib/types";

const TYPE_LABEL: Record<PlanTask["type"], string> = { learn: "Learn", build: "Build", prove: "Prove", practice: "Practice" };

function TaskRow({ task, onChange }: { task: PlanTask; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [proof, setProof] = useState(task.proof ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = task.status === "done";
  const needsProof = task.type === "build" || task.type === "prove";

  const set = async (status: PlanTask["status"], withProof?: string) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/plan-tasks/${task.id}`, { method: "PATCH", json: { status, proof: withProof } });
      setOpen(false);
      onChange();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="py-4">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1.5 size-4 accent-[var(--color-proof-3)]"
          checked={done}
          disabled={busy}
          aria-label={`Mark "${task.title}" ${done ? "not done" : "done"}`}
          onChange={() => (done ? set("todo") : needsProof ? setOpen(true) : set("done"))}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <p className={`font-medium ${done ? "text-ink-faint line-through" : ""}`}>{task.title}</p>
            <p className="text-[13px] text-ink-faint">{TYPE_LABEL[task.type]}, {task.est_hours} h</p>
          </div>
          <p className="mt-1 max-w-[70ch] text-[14.5px] text-ink-soft">{task.detail}</p>
          {task.resource_url && (
            <a href={task.resource_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[14px] text-action hover:underline">
              Open the resource
            </a>
          )}
          {needsProof && !done && task.proof_artifact && <p className="mt-1 text-[13px] text-ink-faint">Proof to produce: {task.proof_artifact}</p>}
          {done && task.proof && (
            <p className="mt-2 text-[13.5px] text-proof-4">
              Added to your evidence: <span className="source">{task.proof}</span>
            </p>
          )}
          {open && (
            <form
              className="mt-3 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void set("done", proof);
              }}
            >
              <label className="label" htmlFor={`proof-${task.id}`}>What did you make? A link, or one line with the result</label>
              <textarea id={`proof-${task.id}`} className="field min-h-20 font-serif" value={proof} onChange={(e) => setProof(e.target.value)} placeholder="e.g. YOLOv8 helmet detector, 0.78 mAP on 300 images: github.com/you/helmets" />
              <div className="flex gap-2">
                <button className="btn" disabled={busy || proof.trim().length < 5}>Mark done and add to evidence</button>
                <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>Cancel</button>
              </div>
            </form>
          )}
          {error && <div className="mt-2"><ErrorNote>{error}</ErrorNote></div>}
        </div>
      </div>
    </li>
  );
}

export default function PlanPage() {
  const { data: plan, loading, error, reload } = useApi<Plan | null>("/api/plans/active");
  if (loading) return <Loading />;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!plan) {
    return (
      <>
        <PageHeader title="Weekly plan" />
        <Empty action={{ href: "/prepare", label: "Prepare for a role" }}>No plan yet. We build one from the gaps between job descriptions and your resume.</Empty>
      </>
    );
  }
  const weeks = Array.from({ length: plan.weeks }, (_, i) => i + 1);
  const start = new Date(plan.start_date);
  const thisWeek = Math.floor((Date.now() - start.getTime()) / (7 * 86_400_000)) + 1;

  return (
    <>
      <PageHeader
        title="Weekly plan"
        intro={`${plan.role}: ${plan.weeks} weeks at ${plan.hours_per_week} hours a week. ${pct(plan.progress)} done. Finishing a build task with proof adds it to your evidence.`}
        actions={<Link href="/practice" className="btn btn-quiet">Practice questions</Link>}
      />
      <div className="space-y-10">
        {weeks.map((w) => {
          const tasks = plan.tasks.filter((t) => t.week === w);
          if (tasks.length === 0) return null;
          const from = new Date(start.getTime() + (w - 1) * 7 * 86_400_000);
          const hours = tasks.reduce((s, t) => s + t.est_hours, 0);
          return (
            <section key={w} aria-labelledby={`week-${w}`}>
              <div className="flex items-baseline justify-between border-b border-rule pb-2">
                <h2 id={`week-${w}`} className={`text-[17px] font-semibold ${w === thisWeek ? "text-proof-4" : ""}`}>
                  Week {w}{w === thisWeek ? ", this week" : ""}
                </h2>
                <p className="text-sm text-ink-faint">
                  from {from.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}, {hours} of {plan.hours_per_week} h
                </p>
              </div>
              <ul className="divide-y divide-rule">
                {tasks.map((t) => <TaskRow key={t.id} task={t} onChange={reload} />)}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
