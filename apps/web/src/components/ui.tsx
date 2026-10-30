import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, intro, actions }: { title: string; intro?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <h1 className="text-[28px] font-semibold tracking-tight">{title}</h1>
        {intro && <p className="mt-2 text-ink-soft">{intro}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Section({ title, aside, children, className = "" }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`mt-10 first:mt-0 ${className}`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule pb-2">
        <h2 className="text-[17px] font-semibold">{title}</h2>
        {aside && <div className="text-sm text-ink-soft">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="rounded-[6px] border border-dashed border-rule-strong bg-surface/60 px-5 py-6 text-ink-soft">
      <p>{children}</p>
      {action && (
        <Link href={action.href} className="btn mt-4">
          {action.label}
        </Link>
      )}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p role="alert" className="rounded-[6px] bg-gap-wash px-3 py-2 text-sm text-gap">{children}</p>;
}

export function Loading({ what = "Loading" }: { what?: string }) {
  return <p className="text-ink-faint" aria-live="polite">{what}…</p>;
}

/** Must / nice marker. Must-haves are the ones that count double. */
export function Kind({ kind }: { kind: "must" | "nice" }) {
  return kind === "must" ? (
    <span className="rounded-[4px] bg-ink px-1.5 py-px text-[11px] font-medium text-white">must</span>
  ) : (
    <span className="rounded-[4px] px-1.5 py-px text-[11px] font-medium text-ink-soft ring-1 ring-rule-strong">nice</span>
  );
}

/** A quotation from a source document (JD or resume): set in the serif. */
export function Quote({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <q className={`source block before:content-none after:content-none ${muted ? "text-ink-soft" : ""}`}>{children}</q>;
}
