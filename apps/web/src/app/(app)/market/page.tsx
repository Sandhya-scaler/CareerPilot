"use client";

import Link from "next/link";
import { ProofLadder } from "@/components/ProofLadder";
import { Empty, ErrorNote, Loading, PageHeader, Quote, Section } from "@/components/ui";
import { pct, relDate, useApi } from "@/lib/api";
import type { MarketMap } from "@/lib/types";

const LEARN = { days: "days to learn", weeks: "weeks to learn", months: "months to learn" } as Record<string, string>;

export default function MarketPage() {
  const { data: m, error, loading } = useApi<MarketMap | null>("/api/market-maps/latest");
  if (loading) return <Loading />;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!m) {
    return (
      <>
        <PageHeader title="Market & gaps" />
        <Empty action={{ href: "/prepare", label: "Prepare for a role" }}>
          No market map yet. Tell us the role you want and we&apos;ll read current job descriptions for it.
        </Empty>
      </>
    );
  }

  const bestWeight = m.skills[0]?.weight ?? 1;
  const gapSet = new Map(m.gaps.map((g) => [g.skill, g]));

  return (
    <>
      <PageHeader
        title={m.role}
        intro={
          <>
            What {m.jobCount} current job descriptions{m.location ? ` around ${m.location}` : ""} ask for, and how your evidence holds up.
            Built {relDate(m.created_at)}; your standing updates as you add proof.
          </>
        }
        actions={<Link href="/prepare" className="btn btn-quiet">Refresh with new postings</Link>}
      />

      <div className="flex flex-wrap items-end gap-x-12 gap-y-4">
        <div>
          <p className="text-[56px] font-semibold leading-none tracking-tight tabular-nums">{pct(m.readiness)}</p>
          <p className="mt-2 max-w-xs text-sm text-ink-soft">
            of what these employers ask for is backed by your evidence, weighted by how often they ask.
          </p>
        </div>
        <p className="max-w-md text-sm text-ink-soft">
          Top gap: <strong className="font-medium text-ink">{m.gaps[0]?.skill ?? "none"}</strong>
          {m.gaps[0] ? `, asked for in ${pct(m.gaps[0].frequency)} of postings.` : "."} Your plan works through gaps in this order.
        </p>
      </div>

      <Section title="Close these first" aside="Ranked by demand × gap × how quickly it can be learned">
        {m.gaps.length === 0 ? (
          <Empty>No significant gaps. Every skill these postings ask for often is already demonstrated.</Empty>
        ) : (
          <ol className="divide-y divide-rule border-b border-rule">
            {m.gaps.slice(0, 8).map((g, i) => (
              <li key={g.skill} className="grid gap-x-6 gap-y-2 py-4 md:grid-cols-[2rem_200px_1fr_1fr]">
                <span className="text-ink-faint tabular-nums">{i + 1}</span>
                <div>
                  <p className="font-medium">{g.skill}</p>
                  <p className="text-[13px] text-ink-faint">
                    {pct(g.frequency)} of postings, {LEARN[g.learnability]}
                  </p>
                </div>
                <div>{g.sampleSentence ? <Quote>{g.sampleSentence}</Quote> : <span className="text-ink-faint">—</span>}</div>
                <div className="flex gap-3">
                  <span className="pt-1"><ProofLadder tier={g.evidenceTier} via={g.via} missingMust={g.mustRate > 0.5 && !g.evidenceTier} /></span>
                  {g.evidenceText ? (
                    <div>
                      <Quote muted>{g.evidenceText}</Quote>
                      {g.via !== "direct" && g.viaSkill && <p className="mt-0.5 text-[13px] text-ink-faint">Partial credit through {g.viaSkill}</p>}
                    </div>
                  ) : (
                    <span className="text-sm text-gap">Not on your resume</span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
        <div className="mt-4">
          <Link href="/plan" className="btn">Work through these in your plan</Link>
        </div>
      </Section>

      <Section title="What the market asks for" aside={`${m.skills.length} skills across ${m.jobCount} postings`}>
        <ul className="space-y-2.5">
          {m.skills.slice(0, 24).map((s) => {
            const gap = gapSet.get(s.skill);
            return (
              <li key={s.skill} className="grid grid-cols-[minmax(96px,180px)_1fr_3rem_auto] items-center gap-3 sm:gap-4">
                <span className="truncate text-[14.5px]" title={s.skill}>{s.skill}</span>
                <span className="relative h-3" title={`${pct(s.frequency)} of postings; must-have in ${pct(s.mustRate)} of those`}>
                  <span className="absolute inset-y-0 left-0 rounded-[2px] bg-rule-strong/60" style={{ width: `${(s.weight / bestWeight) * 100}%` }} />
                  <span className="absolute inset-y-0 left-0 rounded-[2px] bg-ink-soft" style={{ width: `${(s.weight / bestWeight) * 100 * s.mustRate}%` }} />
                </span>
                <span className="text-right text-[13px] text-ink-soft tabular-nums">{pct(s.frequency)}</span>
                <span>{gap ? <ProofLadder tier={gap.evidenceTier} via={gap.via} size="sm" missingMust={s.mustRate > 0.5 && !gap.evidenceTier} /> : <ProofLadder tier={3} size="sm" />}</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-[13px] text-ink-faint">Bar length is demand; the darker part is how often it&apos;s a must-have. The number is the share of postings that mention it. The ladder is your evidence.</p>
      </Section>

      <Section title="Postings in this analysis">
        <ul className="grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
          {m.jobs.map((j) => (
            <li key={j.id} className="truncate">
              <Link href={`/jobs/${j.id}`} className="text-action hover:underline">{j.title}</Link>
              <span className="text-ink-faint">, {j.company ?? "Unknown"}{j.location ? `, ${j.location}` : ""}</span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
