"use client";

import { useMemo, useState } from "react";
import { ProofLadder, TIER_LABEL } from "@/components/ProofLadder";
import type { Evidence, Tier } from "@/lib/types";

export interface EvidenceEdits {
  update: { id: string; tier?: Tier; remove?: boolean }[];
  add: { text: string; context?: string | null }[];
}

const SECTION_ORDER = ["experience", "projects", "achievements", "certifications", "leadership", "publications", "skills", "summary", "education", "coursework", "manual", "other"];
const SECTION_LABEL: Record<string, string> = {
  experience: "Experience", projects: "Projects", achievements: "Achievements", certifications: "Certifications",
  leadership: "Leadership", publications: "Publications", skills: "Skills list", summary: "Summary", education: "Education",
  coursework: "Coursework", manual: "Added by you", other: "Other",
};

/**
 * Human-in-the-loop review of extracted evidence. Users can remove lines, lower a tier, or add a
 * line we missed. Raising a tier happens by adding proof (an outcome or a link), never by a dropdown.
 */
export function EvidenceReview({
  evidence,
  onSubmit,
  submitLabel = "Confirm evidence",
  busy = false,
}: {
  evidence: Evidence[];
  onSubmit: (edits: EvidenceEdits) => void | Promise<void>;
  submitLabel?: string;
  busy?: boolean;
}) {
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [tiers, setTiers] = useState<Record<string, Tier>>({});
  const [added, setAdded] = useState<{ text: string; context: string }[]>([]);
  const [draft, setDraft] = useState({ text: "", context: "" });

  const groups = useMemo(() => {
    const by = new Map<string, Evidence[]>();
    for (const e of evidence) {
      const k = SECTION_ORDER.includes(e.section) ? e.section : "other";
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push(e);
    }
    return SECTION_ORDER.filter((s) => by.has(s)).map((s) => ({ section: s, items: by.get(s)! }));
  }, [evidence]);

  const skillCount = new Set(evidence.filter((e) => !removed.has(e.id)).flatMap((e) => e.skills)).size;

  const submit = () =>
    onSubmit({
      update: [
        ...[...removed].map((id) => ({ id, remove: true })),
        ...Object.entries(tiers).filter(([id]) => !removed.has(id)).map(([id, tier]) => ({ id, tier })),
      ],
      add: added.map((a) => ({ text: a.text, context: a.context || null })),
    });

  return (
    <div>
      <p className="mb-6 max-w-2xl text-ink-soft">
        We found {evidence.length} lines showing {skillCount} skills. Remove anything that isn&apos;t accurate, and add work we
        missed. Lines with a result or a public link count as <strong className="font-medium text-ink">demonstrated</strong>.
      </p>

      {groups.map((g) => (
        <section key={g.section} className="mb-6">
          <h3 className="mb-1 text-sm font-semibold text-ink-soft">{SECTION_LABEL[g.section]}</h3>
          <ul className="divide-y divide-rule border-y border-rule bg-surface">
            {g.items.map((e) => {
              const gone = removed.has(e.id);
              const tier = tiers[e.id] ?? e.tier;
              return (
                <li key={e.id} className={`grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[auto_1fr_auto] ${gone ? "opacity-45" : ""}`}>
                  <span className="pt-1"><ProofLadder tier={gone ? 0 : tier} size="sm" /></span>
                  <div className="min-w-0">
                    <p className={`source ${gone ? "line-through" : ""}`}>{e.text}</p>
                    {e.context && <p className="mt-0.5 text-[13px] text-ink-faint">{e.context}</p>}
                    <p className="mt-1.5 flex flex-wrap gap-1.5">
                      {e.skills.map((s) => (
                        <span key={s} className="rounded-[4px] bg-proof-wash px-1.5 py-px text-[12.5px] text-proof-4">{s}</span>
                      ))}
                    </p>
                  </div>
                  <div className="col-span-2 flex items-center gap-2 sm:col-span-1 sm:flex-col sm:items-end">
                    <select
                      aria-label="Evidence strength"
                      className="field w-auto py-1 text-[13px]"
                      value={tier}
                      disabled={gone}
                      onChange={(ev) => setTiers({ ...tiers, [e.id]: Number(ev.target.value) as Tier })}
                    >
                      {([1, 2, 3] as Tier[]).filter((t) => t <= e.tier).map((t) => (
                        <option key={t} value={t}>{TIER_LABEL[t]}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="text-[13px] text-action hover:underline"
                      onClick={() => {
                        const next = new Set(removed);
                        if (gone) next.delete(e.id);
                        else next.add(e.id);
                        setRemoved(next);
                      }}
                    >
                      {gone ? "Keep" : "Remove"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <section className="mb-6">
        <h3 className="mb-1 text-sm font-semibold text-ink-soft">Add something we missed</h3>
        {added.length > 0 && (
          <ul className="mb-3 divide-y divide-rule border-y border-rule bg-surface">
            {added.map((a, i) => (
              <li key={i} className="flex items-start justify-between gap-4 px-4 py-3">
                <span className="source">{a.text}</span>
                <button type="button" className="text-[13px] text-action hover:underline" onClick={() => setAdded(added.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-2 sm:grid-cols-[1fr_220px_auto]">
          <input
            className="field"
            placeholder="e.g. Fine-tuned YOLOv8 on 1,200 shelf images, 0.81 mAP"
            aria-label="What you did"
            value={draft.text}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          />
          <input className="field" placeholder="Project or job (optional)" aria-label="Project or job" value={draft.context} onChange={(e) => setDraft({ ...draft, context: e.target.value })} />
          <button
            type="button"
            className="btn btn-quiet"
            disabled={draft.text.trim().length < 5}
            onClick={() => {
              setAdded([...added, { text: draft.text.trim(), context: draft.context.trim() }]);
              setDraft({ text: "", context: "" });
            }}
          >
            Add line
          </button>
        </div>
        <p className="mt-1.5 text-[13px] text-ink-faint">Name the tools you used. Add a number or a link and it counts as demonstrated.</p>
      </section>

      <button className="btn" onClick={submit} disabled={busy}>
        {busy ? "Saving…" : submitLabel}
      </button>
    </div>
  );
}
