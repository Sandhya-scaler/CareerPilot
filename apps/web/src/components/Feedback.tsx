"use client";

import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { api, errorText } from "@/lib/api";

/** "Send feedback" link + dialog. Beta feedback lands on the admin metrics page. */
export function Feedback() {
  const dialog = useRef<HTMLDialogElement>(null);
  const page = usePathname();
  const [message, setMessage] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    setError(null);
    try {
      await api("/api/feedback", { method: "POST", json: { page, message, rating: rating ?? undefined } });
      setState("sent");
      setMessage("");
      setRating(null);
    } catch (x) {
      setError(errorText(x));
      setState("idle");
    }
  };

  return (
    <>
      <button className="text-action hover:underline" onClick={() => (setState("idle"), dialog.current?.showModal())}>Send feedback</button>
      <dialog
        ref={dialog}
        aria-labelledby="fb-title"
        className="m-auto w-[min(520px,calc(100vw-32px))] rounded-[8px] bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/40"
        onClick={(e) => e.target === dialog.current && dialog.current?.close()}
      >
        {state === "sent" ? (
          <div className="space-y-4 p-5">
            <h2 id="fb-title" className="text-lg font-semibold">Thanks, that helps</h2>
            <p className="text-ink-soft">Every message is read. If something was broken, it&apos;s being looked at.</p>
            <button className="btn" onClick={() => dialog.current?.close()}>Close</button>
          </div>
        ) : (
          <form onSubmit={send} className="space-y-4 p-5">
            <h2 id="fb-title" className="text-lg font-semibold">What should be better?</h2>
            <fieldset>
              <legend className="label">How useful is CareerPilot so far?</legend>
              <div className="flex gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    type="button"
                    key={n}
                    aria-pressed={rating === n}
                    onClick={() => setRating(n)}
                    className={`size-9 rounded-[6px] text-sm font-medium ring-1 ${rating === n ? "bg-action text-white ring-action" : "ring-rule-strong hover:bg-paper"}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </fieldset>
            <div>
              <label className="label" htmlFor="fb-msg">Tell us what happened or what you wish it did</label>
              <textarea id="fb-msg" className="field min-h-28" value={message} onChange={(e) => setMessage(e.target.value)} />
            </div>
            {error && <p className="text-sm text-gap">{error}</p>}
            <div className="flex gap-2">
              <button className="btn" disabled={state === "sending" || message.trim().length < 3}>{state === "sending" ? "Sending…" : "Send feedback"}</button>
              <button type="button" className="btn btn-quiet" onClick={() => dialog.current?.close()}>Cancel</button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
