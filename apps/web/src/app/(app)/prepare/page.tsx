"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { EvidenceReview, type EvidenceEdits } from "@/components/EvidenceReview";
import { ResumeUpload } from "@/components/ResumeUpload";
import { useMe } from "@/components/Shell";
import { ErrorNote, PageHeader } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import type { Run } from "@/lib/types";

const STEPS = [
  { key: "research", label: "Find job descriptions" },
  { key: "resume", label: "Check your evidence" },
  { key: "match", label: "Map the market and your gaps" },
  { key: "coach", label: "Write your plan and practice questions" },
] as const;

function stepState(run: Run, key: string, index: number): "done" | "active" | "todo" {
  const seen = run.events.map((e) => e.step);
  const lastIdx = Math.max(-1, ...seen.map((s) => STEPS.findIndex((st) => st.key === s)));
  if (run.status === "done" || index < lastIdx) return "done";
  if (index === lastIdx || (lastIdx === -1 && index === 0)) return run.status === "failed" ? "todo" : "active";
  return "todo";
}

function RunView({ runId }: { runId: string }) {
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await api<Run>(`/api/runs/${runId}`);
        if (!alive) return;
        setRun(r);
        if (r.status === "running") timer.current = setTimeout(poll, 1200);
      } catch (e) {
        setError(errorText(e));
      }
    };
    void poll();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [runId, busy]);

  const resume = async (value: unknown) => {
    setBusy(true);
    try {
      await api(`/api/runs/${runId}/resume`, { method: "POST", json: { value } });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!run) return <p className="text-ink-faint">Starting…</p>;
  const last = run.events.at(-1);

  return (
    <div className="grid gap-10 lg:grid-cols-[280px_1fr]">
      <ol className="space-y-4" aria-label="Progress">
        {STEPS.map((s, i) => {
          const st = stepState(run, s.key, i);
          return (
            <li key={s.key} className="flex gap-3">
              <span
                className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold ${
                  st === "done" ? "bg-proof-3 text-white" : st === "active" ? "bg-action text-white" : "bg-rule text-ink-faint"
                }`}
              >
                {st === "done" ? "✓" : i + 1}
              </span>
              <span className={st === "todo" ? "text-ink-faint" : ""}>{s.label}</span>
            </li>
          );
        })}
      </ol>

      <div aria-live="polite">
        {run.status === "running" && (
          <div>
            <p className="text-lg">{last?.message ?? "Working…"}</p>
            <ul className="mt-4 space-y-1 text-sm text-ink-faint">
              {run.events.slice(0, -1).slice(-5).map((e) => <li key={e.id}>{e.message}</li>)}
            </ul>
          </div>
        )}

        {run.status === "waiting" && run.pending?.type === "need_resume" && (
          <div>
            <h2 className="mb-1 text-lg font-semibold">Add your resume</h2>
            <p className="mb-4 text-ink-soft">The job descriptions are ready. Upload your resume so we can compare.</p>
            <ResumeUpload onUploaded={() => resume({})} />
          </div>
        )}

        {run.status === "waiting" && run.pending?.type === "confirm_evidence" && (
          <div>
            <h2 className="mb-1 text-lg font-semibold">Is this what your resume shows?</h2>
            <EvidenceReview evidence={run.pending.evidence} busy={busy} submitLabel="Looks right, build my plan" onSubmit={(edits: EvidenceEdits) => resume(edits)} />
          </div>
        )}

        {run.status === "done" && run.result && (
          <div>
            <h2 className="text-lg font-semibold">Your plan is ready</h2>
            {run.result.researchStats && (
              <p className="mt-1 text-ink-soft">
                Read {run.result.jobIds.length} job descriptions, picked from {run.result.researchStats.scanned.toLocaleString("en-IN")} open roles.
              </p>
            )}
            <div className="mt-5 flex flex-wrap gap-2">
              <Link className="btn" href="/market">See what the market asks for</Link>
              <Link className="btn btn-quiet" href="/plan">Open your weekly plan</Link>
            </div>
          </div>
        )}

        {run.status === "failed" && (
          <div className="space-y-4">
            <ErrorNote>{run.error}</ErrorNote>
            <div className="flex gap-2">
              <Link className="btn btn-quiet" href="/jobs">Add job descriptions</Link>
              <Link className="btn btn-quiet" href="/prepare">Start over</Link>
            </div>
          </div>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </div>
  );
}

function PrepareForm() {
  const { me } = useMe();
  const router = useRouter();
  const [form, setForm] = useState({
    role: me.target_role ?? "",
    location: me.location ?? "",
    hoursPerWeek: me.hours_per_week ?? 8,
    weeks: 6,
    companies: "",
    skipResearch: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const companies = form.companies
    .split(/[\n,]+/)
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const [ats, token] = c.includes(":") ? c.split(":") : ["greenhouse", c];
      return { ats: ats!.trim().toLowerCase(), token: token!.trim() };
    });

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { runId } = await api<{ runId: string }>("/api/careers/prepare", {
        method: "POST",
        json: { role: form.role, location: form.location || null, hoursPerWeek: form.hoursPerWeek, weeks: form.weeks, companies, skipResearch: form.skipResearch },
      });
      router.push(`/prepare?run=${runId}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={start} className="max-w-2xl space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="role">Role you&apos;re aiming for</label>
          <input id="role" required className="field text-lg" placeholder="e.g. Computer Vision Intern" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="loc">Where</label>
          <input id="loc" className="field" placeholder="e.g. Bengaluru, India or Remote" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="hours">Hours a week</label>
            <input id="hours" type="number" min={1} max={60} className="field" value={form.hoursPerWeek} onChange={(e) => setForm({ ...form, hoursPerWeek: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label" htmlFor="weeks">For how many weeks</label>
            <input id="weeks" type="number" min={1} max={26} className="field" value={form.weeks} onChange={(e) => setForm({ ...form, weeks: Number(e.target.value) })} />
          </div>
        </div>
      </div>
      <details className="rounded-[6px] border border-rule bg-surface px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">Choose sources</summary>
        <div className="mt-3 space-y-3 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={form.skipResearch} onChange={(e) => setForm({ ...form, skipResearch: e.target.checked })} />
            <span>Only use job descriptions I&apos;ve saved or pasted (no search)</span>
          </label>
          <div>
            <label className="label" htmlFor="companies">Also check these companies&apos; job boards</label>
            <textarea
              id="companies"
              className="field min-h-20 font-mono text-[13px]"
              placeholder={"greenhouse:groww\nlever:cred\nashby:sarvam"}
              value={form.companies}
              onChange={(e) => setForm({ ...form, companies: e.target.value })}
            />
            <p className="mt-1 text-ink-faint">
              One per line as ats:board. The board name is in the company&apos;s careers URL (boards.greenhouse.io/<em>groww</em>). We only
              read public job board APIs.
            </p>
          </div>
        </div>
      </details>
      {error && <ErrorNote>{error}</ErrorNote>}
      <button className="btn" disabled={busy || form.role.trim().length < 2}>{busy ? "Starting…" : "Build my plan"}</button>
    </form>
  );
}

function PreparePage() {
  const runId = useSearchParams().get("run");
  return (
    <>
      <PageHeader
        title="Prepare for a role"
        intro="We read current job descriptions for the role, check them against your resume, and turn the gaps into a plan that fits your week."
      />
      {runId ? <RunView runId={runId} /> : <PrepareForm />}
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <PreparePage />
    </Suspense>
  );
}
