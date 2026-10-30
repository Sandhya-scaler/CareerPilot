"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMe } from "@/components/Shell";
import { ErrorNote, PageHeader, Section } from "@/components/ui";
import { api, errorText, useApi } from "@/lib/api";

interface UsageRow {
  week: string;
  label: string;
  calls: number;
  cost_usd: number;
}

export default function AccountPage() {
  const { me, refresh } = useMe();
  const router = useRouter();
  const usage = useApi<UsageRow[]>("/auth/me/usage");
  const [form, setForm] = useState({ name: me.name ?? "", hours_per_week: me.hours_per_week, email_reports: me.email_reports });
  const emailStatus = useApi<{ enabled: boolean }>("/api/reports/email-status");
  const [saved, setSaved] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api("/auth/me", { method: "PATCH", json: { name: form.name || null, hours_per_week: form.hours_per_week, email_reports: form.email_reports } });
      await refresh();
      setSaved(true);
    } catch (x) {
      setError(errorText(x));
    }
  };

  const total = (usage.data ?? []).reduce((s, r) => s + r.cost_usd, 0);

  return (
    <>
      <PageHeader title="Account and data" intro={me.email} />

      <Section title="Profile">
        <form onSubmit={save} className="grid max-w-md gap-3">
          <div>
            <label className="label" htmlFor="name">Name</label>
            <input id="name" className="field" value={form.name} onChange={(e) => (setSaved(false), setForm({ ...form, name: e.target.value }))} />
          </div>
          <div>
            <label className="label" htmlFor="hours">Hours a week for preparation</label>
            <input id="hours" type="number" min={1} max={80} className="field w-32" value={form.hours_per_week} onChange={(e) => (setSaved(false), setForm({ ...form, hours_per_week: Number(e.target.value) }))} />
          </div>
          <label className="flex items-start gap-2 text-[14.5px]">
            <input type="checkbox" className="mt-1" checked={form.email_reports} onChange={(e) => (setSaved(false), setForm({ ...form, email_reports: e.target.checked }))} />
            <span>
              Email me my weekly report on Mondays
              {emailStatus.data && !emailStatus.data.enabled && (
                <span className="block text-[13px] text-ink-faint">Email isn&apos;t set up on this server yet, so nothing will be sent until it is.</span>
              )}
            </span>
          </label>
          <div className="flex items-center gap-3">
            <button className="btn">Save profile</button>
            {saved && <span className="text-sm text-proof-4">Saved</span>}
          </div>
        </form>
      </Section>

      <Section title="AI usage">
        {(usage.data ?? []).length === 0 ? (
          <p className="text-ink-soft">No AI calls on your account yet. Without an API key, CareerPilot uses its built-in rules, which cost nothing.</p>
        ) : (
          <>
            <p className="mb-3 text-ink-soft">Total so far: ${total.toFixed(4)}</p>
            <table className="w-full max-w-xl text-left text-[14px]">
              <thead className="text-ink-soft"><tr><th className="py-1 font-medium">Week</th><th className="font-medium">Feature</th><th className="text-right font-medium">Calls</th><th className="text-right font-medium">Cost</th></tr></thead>
              <tbody className="divide-y divide-rule">
                {usage.data!.map((r) => (
                  <tr key={`${r.week}-${r.label}`}><td className="py-1.5">{r.week}</td><td>{r.label}</td><td className="text-right tabular-nums">{r.calls}</td><td className="text-right tabular-nums">${r.cost_usd.toFixed(4)}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Section>

      <Section title="Your data">
        <p className="mb-3 max-w-2xl text-ink-soft">
          Download everything we store about you: resumes, evidence, saved jobs, applications, plans, interview answers and reports.{" "}
          <Link href="/privacy" className="text-action hover:underline">How we handle your data</Link>
        </p>
        <a href="/auth/me/export" className="btn btn-quiet">Download my data (JSON)</a>
      </Section>

      <Section title="Delete account">
        <p className="mb-3 max-w-2xl text-ink-soft">This permanently deletes your account and all of its data. It can&apos;t be undone.</p>
        <div className="flex max-w-md gap-2">
          <input className="field" placeholder='Type "delete" to confirm' aria-label="Confirm deletion" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <button
            className="btn shrink-0 bg-gap hover:!bg-gap/90"
            disabled={confirm !== "delete"}
            onClick={async () => {
              try {
                await api("/auth/me", { method: "DELETE" });
                router.replace("/login");
              } catch (x) {
                setError(errorText(x));
              }
            }}
          >
            Delete account
          </button>
        </div>
      </Section>
      {error && <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>}
    </>
  );
}
