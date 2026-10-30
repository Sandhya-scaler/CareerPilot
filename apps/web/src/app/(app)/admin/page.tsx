"use client";

import { ErrorNote, Loading, PageHeader, Section } from "@/components/ui";
import { pct, relDate, useApi } from "@/lib/api";

interface Metrics {
  users: number;
  activeLast7Days: number;
  activationRate: number | null;
  coreValueRate: number | null;
  planners: number;
  interviewRate: { tailored: number | null; notTailored: number | null; applications: number };
  mockInterviews: { sessions: number; avg: number | null };
  llm: { usd: number | null; calls: number };
  feedback: { page: string; rating: number | null; message: string; created_at: string; email: string | null }[];
}

function Stat({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <div>
      <p className="text-[36px] font-semibold leading-none tabular-nums">{value}</p>
      <p className="mt-1.5 text-sm text-ink-soft">{label}</p>
      {note && <p className="text-[12.5px] text-ink-faint">{note}</p>}
    </div>
  );
}

export default function AdminPage() {
  const { data: m, loading, error } = useApi<Metrics>("/api/admin/metrics");
  if (loading) return <Loading />;
  if (error || !m) return <ErrorNote>{error ?? "No data"}</ErrorNote>;
  return (
    <>
      <PageHeader title="Beta metrics" intro="The success metrics from the product spec, computed from live data." />
      <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        <Stat value={String(m.users)} label="accounts" note={`${m.activeLast7Days} active in the last 7 days`} />
        <Stat value={pct(m.activationRate)} label="activation" note="match report or market map within a day of signing up" />
        <Stat value={pct(m.coreValueRate)} label="evidence growth" note={`of ${m.planners} planners added 2+ new proofs within 4 weeks`} />
        <Stat value={m.llm.usd != null ? `$${m.llm.usd.toFixed(2)}` : "$0"} label="AI spend" note={`${m.llm.calls} calls`} />
      </div>

      <Section title="Outcomes">
        <p className="mb-3 max-w-2xl text-ink-soft">
          Interview rate: share of applications that reached an assessment, interview or offer, compared by whether the application used a
          tailored resume. Small samples mean little; read this once you have 30+ applications.
        </p>
        <div className="grid gap-8 sm:grid-cols-3">
          <Stat value={pct(m.interviewRate.tailored)} label="with a tailored resume" />
          <Stat value={pct(m.interviewRate.notTailored)} label="without" />
          <Stat value={String(m.interviewRate.applications)} label="applications sent" />
        </div>
        <p className="mt-4 text-sm text-ink-soft">
          Mock interviews completed: {m.mockInterviews.sessions}
          {m.mockInterviews.avg != null ? `, average ${m.mockInterviews.avg.toFixed(1)}/5` : ""}.
        </p>
      </Section>

      <Section title="Feedback" aside={`${m.feedback.length} latest`}>
        {m.feedback.length === 0 ? (
          <p className="text-ink-soft">No feedback yet.</p>
        ) : (
          <ul className="divide-y divide-rule border-y border-rule">
            {m.feedback.map((f, i) => (
              <li key={i} className="py-3">
                <p className="text-[13px] text-ink-faint">
                  {f.email ?? "deleted account"}, on {f.page}, {relDate(f.created_at)}{f.rating ? `, rated ${f.rating}/5` : ""}
                </p>
                <p className="mt-0.5">{f.message}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
