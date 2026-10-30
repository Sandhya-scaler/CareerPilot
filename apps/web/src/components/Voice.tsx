"use client";

import { useEffect, useRef, useState } from "react";

/* Minimal typings for the Web Speech API (not in TS's DOM lib everywhere). */
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Reads text aloud with the browser's speech synthesis. */
export function SpeakButton({ text }: { text: string }) {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => setSupported(typeof window !== "undefined" && "speechSynthesis" in window), []);
  useEffect(() => () => window.speechSynthesis?.cancel(), [text]);
  if (!supported) return null;
  return (
    <button
      type="button"
      className="text-[13.5px] text-action hover:underline"
      onClick={() => {
        if (speaking) {
          window.speechSynthesis.cancel();
          setSpeaking(false);
          return;
        }
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "en-IN";
        u.rate = 0.98;
        u.onend = () => setSpeaking(false);
        setSpeaking(true);
        window.speechSynthesis.speak(u);
      }}
    >
      {speaking ? "Stop reading" : "Read the question aloud"}
    </button>
  );
}

/**
 * Dictation into an answer box. Final phrases are appended to `value`; the in-progress phrase is
 * shown separately so the user sees what's being heard.
 */
export function DictateButton({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => setSupported(recognitionCtor() !== null), []);
  useEffect(() => () => rec.current?.stop(), []);

  if (!supported) {
    return <p className="text-[12.5px] text-ink-faint">Voice answers need Chrome, Edge or Safari.</p>;
  }

  const start = () => {
    const Ctor = recognitionCtor()!;
    const r = new Ctor();
    r.lang = "en-IN";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let finalText = "";
      let pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) finalText += res[0].transcript;
        else pending += res[0].transcript;
      }
      if (finalText) onChange(`${latest.current}${latest.current && !latest.current.endsWith(" ") ? " " : ""}${finalText.trim()}`);
      setInterim(pending);
    };
    r.onerror = (e) => setError(e.error === "not-allowed" ? "Microphone access was blocked. Allow it in the browser's site settings." : `Voice input stopped (${e.error}).`);
    r.onend = () => {
      setListening(false);
      setInterim("");
    };
    rec.current = r;
    setError(null);
    r.start();
    setListening(true);
  };

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => (listening ? rec.current?.stop() : start())}
        className={`btn ${listening ? "bg-gap hover:!bg-gap/90" : "btn-quiet"}`}
        aria-pressed={listening}
      >
        <span aria-hidden className={`size-2 rounded-full ${listening ? "animate-pulse bg-white" : "bg-gap"}`} />
        {listening ? "Stop recording" : "Answer by voice"}
      </button>
      {listening && interim && <p className="source text-ink-faint" aria-live="polite">{interim}…</p>}
      {error && <p className="text-[13px] text-gap">{error}</p>}
      <p className="text-[12px] text-ink-faint">Your browser transcribes speech; in Chrome the audio is processed by Google&apos;s speech service.</p>
    </div>
  );
}
