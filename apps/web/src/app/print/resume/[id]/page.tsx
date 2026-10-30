"use client";

import { useParams } from "next/navigation";
import { useApi } from "@/lib/api";

interface Content {
  name: string | null;
  email: string | null;
  links: string[];
  sections: { name: string; heading: string; lines: string[] }[];
}

const BULLET = /^\s*(?:[•●▪◦‣∙·*\-–—►>✓✔➢➤]|\d{1,2}[.)])\s+/;

/** Print layout: the browser's "Save as PDF" produces the resume PDF. */
export default function PrintResume() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = useApi<{ content: Content; label: string }>(`/api/resume-versions/${id}`);
  if (error) return <p className="p-8 text-gap">{error}</p>;
  if (!data) return <p className="p-8 text-ink-faint">Loading…</p>;
  const { content } = data;
  const header = content.sections.find((s) => s.name === "header");

  return (
    <div className="bg-white">
      <style>{`@page { size: A4; margin: 14mm 16mm; } @media print { .no-print { display: none !important; } body { background: white; } }`}</style>
      <div className="no-print flex items-center justify-between gap-4 border-b border-rule bg-paper px-6 py-3 text-sm">
        <span className="text-ink-soft">{data.label}. In the print dialog, choose Save as PDF.</span>
        <button className="btn" onClick={() => window.print()}>Print or save as PDF</button>
      </div>
      <article className="mx-auto max-w-[180mm] px-6 py-8 font-serif text-[10.5pt] leading-[1.45] text-black print:px-0 print:py-0">
        <header className="mb-4 border-b border-black/70 pb-2">
          <h1 className="font-sans text-[20pt] font-semibold tracking-tight">{content.name ?? header?.lines[0]}</h1>
          <p className="font-sans text-[9.5pt] text-black/70">{(header?.lines ?? []).filter((l) => l !== content.name).join("  |  ")}</p>
        </header>
        {content.sections
          .filter((s) => s.name !== "header")
          .map((s) => (
            <section key={s.heading} className="mb-3 break-inside-avoid-page">
              <h2 className="mb-1 border-b border-black/25 font-sans text-[10.5pt] font-semibold">{s.heading.replace(/:$/, "")}</h2>
              <ul>
                {s.lines.map((l, i) =>
                  BULLET.test(l) ? (
                    <li key={i} className="ml-4 list-disc">{l.replace(BULLET, "")}</li>
                  ) : (
                    <li key={i} className="mt-1 list-none font-sans text-[10pt] font-medium first:mt-0">{l}</li>
                  ),
                )}
              </ul>
            </section>
          ))}
      </article>
    </div>
  );
}
