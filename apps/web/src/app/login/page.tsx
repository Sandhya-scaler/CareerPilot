"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ProofLadder } from "@/components/ProofLadder";
import { Logo } from "@/components/Shell";
import { api, errorText } from "@/lib/api";
import type { Tier } from "@/lib/types";

const EXAMPLE: { asks: string; proof: string | null; tier: Tier; must: boolean }[] = [
  { asks: "Hands-on experience with PyTorch.", proof: "Libraries: OpenCV, NumPy, PyTorch (basic)", tier: 1, must: true },
  { asks: "Experience with OpenCV.", proof: "Lane detection on 2,000 dashcam frames, 18% fewer false detections (code on GitHub)", tier: 3, must: true },
  { asks: "Train and evaluate object detection models (YOLO, DETR).", proof: null, tier: 0, must: true },
];

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/";
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ email: "", password: "", name: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/auth/${mode}`, { method: "POST", json: mode === "login" ? { email: form.email, password: form.password } : form });
      router.replace(mode === "register" ? "/prepare" : next);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="w-full max-w-sm space-y-4">
      <div className="flex gap-1 rounded-[6px] bg-paper p-1 text-sm" role="tablist">
        {(["login", "register"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`flex-1 rounded-[5px] py-1.5 font-medium ${mode === m ? "bg-surface shadow-sm" : "text-ink-soft"}`}
          >
            {m === "login" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>
      {mode === "register" && (
        <div>
          <label className="label" htmlFor="name">Name</label>
          <input id="name" className="field" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
      )}
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" type="email" required className="field" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          required
          minLength={8}
          className="field"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        {mode === "register" && <p className="mt-1 text-xs text-ink-faint">At least 8 characters.</p>}
      </div>
      {error && <p role="alert" className="text-sm text-gap">{error}</p>}
      <button className="btn w-full justify-center" disabled={busy}>
        {busy ? "One moment…" : mode === "login" ? "Sign in" : "Create account"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(380px,1fr)_1.25fr]">
      <div className="flex flex-col justify-center bg-surface px-6 py-12 sm:px-12">
        <div className="mb-10 flex items-center gap-2.5 text-lg font-semibold">
          <Logo /> CareerPilot
        </div>
        <h1 className="max-w-md text-[32px] font-semibold leading-tight tracking-tight">
          Know exactly what to prove for the role you want.
        </h1>
        <p className="mt-3 max-w-md text-ink-soft">
          CareerPilot reads real job descriptions, checks every requirement against what your resume actually shows, and
          turns the gaps into a weekly plan. It never invents experience for you.
        </p>
        <div className="mt-8">
          <Suspense>
            <LoginForm />
          </Suspense>
          <p className="mt-6 text-[13px] text-ink-faint">
            <a href="/privacy" className="hover:underline">How we handle your data</a>
          </p>
        </div>
      </div>

      <div className="flex items-center px-6 py-12 sm:px-12" aria-label="Example of a match report">
        <figure className="w-full max-w-2xl">
          <figcaption className="mb-4 text-sm text-ink-soft">
            Computer Vision Intern, Bengaluru: how one resume holds up, line by line
          </figcaption>
          <ol className="divide-y divide-rule border-y border-rule">
            {EXAMPLE.map((r) => (
              <li key={r.asks} className="grid grid-cols-[1fr_auto_1fr] items-start gap-4 py-4">
                <q className="source before:content-none after:content-none">{r.asks}</q>
                <span className="pt-1">
                  <ProofLadder tier={r.tier} missingMust={r.must && r.tier === 0} />
                </span>
                {r.proof ? (
                  <q className="source text-ink-soft before:content-none after:content-none">{r.proof}</q>
                ) : (
                  <span className="text-sm font-medium text-gap">Nothing on your resume yet: week 2 of your plan</span>
                )}
              </li>
            ))}
          </ol>
          <p className="mt-4 text-sm text-ink-faint">
            Steps fill as proof gets stronger: listed, used in a project, shown with a result or link, verified.
          </p>
        </figure>
      </div>
    </div>
  );
}
