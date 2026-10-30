"use client";

import Link from "next/link";
import { useMe } from "@/components/Shell";
import { Meter } from "@/components/ProofLadder";
import { Empty, Loading, PageHeader, Section } from "@/components/ui";
import { pct, relDate, useApi } from "@/lib/api";
import type { Application, MarketMap, Plan } from "@/lib/types";

const STAGES: { key: Application["status"]; label: string }[] = [
  { key: "saved", label: "Saved" },
  { key: "applied", label: "Applied" },
  { key: "oa", label: "Assessment" },
  { key: "interview", label: "Interview" },
  { key: "offer", label: "Offer" },
];

export default function Overview() {
  const { me } = useMe();
  const market = useApi<MarketMap | null>("/api/market-maps/latest");
  const plan = useApi<Plan | null>("/api/plans/active");
  const apps = useApi<Application[]>("/api/applications");

  if (market.loading || plan.loading || apps.loading) return <Loading />;
  const m = market.data;
  const p = plan.data;
  const followups = (apps.data ?? []).filter((a) => a.next_followup_at && new Date(a.next_followup_at) <= new Date());
  const currentWeek = p ? Math.min(p.weeks, Math.floor((Date.now() - new Date(p.start_date).getTime()) / (7 * 86_400_000)) + 1) : 1;
  const nextTasks = p?.tasks.filter((t) => t.status !== "done" && t.status !== "skipped").slice(0, 4) ?? [];

  return (
    <>
      <PageHeader
        title={`Hi${me.name ? `, ${me.name.split(" ")[0]}` : ""}`}
        intro={m ? `You're preparing for ${m.role}.` : "Start by telling us the role you want."}
      />

      {!m && (
        <Empty action={{ href: "/prepare", label: "Prepare for a role" }}>
          CareerPilot reads current job descriptions for your target role, checks them against your resume, and builds a weekly plan from
          the gaps.
        </Empty>
      )}

      {m && (
        <div className="grid gap-10 md:grid-cols-2">
          <div className="space-y-5">
            <Meter value={m.readiness} label="Market readiness" />
            {p && <Meter value={p.progress} label={`Plan progress, week ${currentWeek} of ${p.weeks}`} />}
            <p className="text-sm text-ink-soft">
              Biggest gaps:{" "}
              {m.gaps.slice(0, 3).map((g, i) => (
                <span key={g.skill}>
                  {i > 0 && ", "}
                  <span className="font-medium text-ink">{g.skill}</span>
                </span>
              ))}
              . <Link href="/market" className="text-action hover:underline">See the full map</Link>
            </p>
          </div>

          <div>
            <h2 className="mb-2 text-[17px] font-semibold">Up next</h2>
            {nextTasks.length === 0 ? (
              <p className="text-ink-soft">{p ? "Every task in this plan is done. Rebuild the plan from the market map." : "No plan yet."}</p>
            ) : (
              <ul className="divide-y divide-rule border-y border-rule">
                {nextTasks.map((t) => (
                  <li key={t.id} className="flex items-baseline justify-between gap-4 py-2.5">
                    <span>{t.title}</span>
                    <span className="shrink-0 text-[13px] text-ink-faint">Week {t.week}, {t.est_hours} h</span>
                  </li>
                ))}
              </ul>
            )}
            {p && <Link href="/plan" className="mt-3 inline-block text-action hover:underline">Open the plan</Link>}
          </div>
        </div>
      )}

      <Section title="Applications" aside={<Link href="/applications" className="text-action hover:underline">Open tracker</Link>}>
        {(apps.data ?? []).length === 0 ? (
          <p className="text-ink-soft">
            Nothing tracked yet. Open a job and choose <em>Track application</em> to follow it from saved to offer.
          </p>
        ) : (
          <>
            <ol className="flex flex-wrap gap-x-10 gap-y-3">
              {STAGES.map((s) => (
                <li key={s.key}>
                  <p className="text-[28px] font-semibold tabular-nums leading-none">{apps.data!.filter((a) => a.status === s.key).length}</p>
                  <p className="mt-1 text-sm text-ink-soft">{s.label}</p>
                </li>
              ))}
            </ol>
            {followups.length > 0 && (
              <div className="mt-6 rounded-[6px] bg-action-wash px-4 py-3">
                <p className="font-medium">Time to follow up</p>
                <ul className="mt-1 text-sm text-ink-soft">
                  {followups.map((a) => (
                    <li key={a.id}>
                      {a.title} at {a.company ?? "unknown company"}, applied {relDate(a.applied_at)}.{" "}
                      <Link href="/applications" className="text-action hover:underline">Draft a follow-up</Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </Section>

      {m && <p className="mt-10 text-[13px] text-ink-faint">Based on {m.jobCount} postings, analyzed {relDate(m.created_at)}.</p>}
    </>
  );
}
