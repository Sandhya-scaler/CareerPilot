import type { Tier } from "@/lib/types";

export const TIER_LABEL: Record<Tier, string> = { 0: "no evidence", 1: "claimed", 2: "applied", 3: "demonstrated", 4: "verified" };
const FILL = ["var(--color-proof-1)", "var(--color-proof-2)", "var(--color-proof-3)", "var(--color-proof-4)"];

/**
 * The proof ladder: four rising steps for evidence tiers (claimed → applied → demonstrated → verified).
 * Solid steps are direct evidence; outlined steps are credit through a related/specific skill;
 * an empty ladder on a must-have is marked in mulberry.
 */
export function ProofLadder({
  tier,
  via = "direct",
  missingMust = false,
  size = "md",
}: {
  tier: Tier | null;
  via?: "direct" | "implied" | "adjacent" | "none" | string;
  missingMust?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const t = (tier ?? 0) as Tier;
  const dims = { sm: { w: 4, gap: 2, h: 14 }, md: { w: 6, gap: 2, h: 20 }, lg: { w: 10, gap: 3, h: 32 } }[size];
  const indirect = via === "implied" || via === "adjacent";
  const label = t === 0 ? (missingMust ? "missing must-have" : "no evidence") : `${TIER_LABEL[t]}${indirect ? ` via a ${via === "implied" ? "more specific" : "related"} skill` : ""}`;
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex items-end shrink-0" style={{ gap: dims.gap, height: dims.h }}>
      {[0, 1, 2, 3].map((i) => {
        const on = i < t;
        const h = Math.round(dims.h * (0.4 + 0.2 * i));
        const color = FILL[i]!;
        return (
          <span
            key={i}
            style={{
              width: dims.w,
              height: h,
              borderRadius: 1.5,
              background: on && !indirect ? color : "transparent",
              boxShadow: on
                ? indirect
                  ? `inset 0 0 0 1.5px ${FILL[Math.max(i, 2)]}`
                  : "none"
                : `inset 0 0 0 1px ${missingMust ? "var(--color-gap)" : "var(--color-rule-strong)"}`,
            }}
          />
        );
      })}
    </span>
  );
}

/** Small meter for 0..1 scores (coverage, readiness). */
export function Meter({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm text-ink-soft">{label}</span>
        <span className="font-semibold tabular-nums">{Math.round(v * 100)}%</span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-rule" aria-hidden>
        <div className="h-full rounded-full bg-proof-3" style={{ width: `${v * 100}%` }} />
      </div>
    </div>
  );
}
