"use client";

import { useState } from "react";
import { api, errorText } from "@/lib/api";
import type { Evidence } from "@/lib/types";
import { ErrorNote } from "./ui";

export interface UploadResult {
  resumeId: string;
  versionId: string;
  name: string | null;
  evidence: Evidence[];
}

export function ResumeUpload({ onUploaded }: { onUploaded: (r: UploadResult) => void }) {
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let r: UploadResult;
      if (mode === "file" && file) {
        const fd = new FormData();
        fd.append("file", file);
        r = await api<UploadResult>("/api/resumes", { method: "POST", body: fd });
      } else {
        r = await api<UploadResult>("/api/resumes", { method: "POST", json: { text } });
      }
      onUploaded(r);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="max-w-xl space-y-3">
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={mode === "file"} onChange={() => setMode("file")} /> Upload a file
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={mode === "paste"} onChange={() => setMode("paste")} /> Paste text
        </label>
      </div>
      {mode === "file" ? (
        <div>
          <input
            type="file"
            accept=".pdf,.docx,.txt,.md"
            aria-label="Resume file"
            className="field file:mr-3 file:rounded-[4px] file:border-0 file:bg-action-wash file:px-2 file:py-1 file:text-action"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <p className="mt-1 text-[13px] text-ink-faint">PDF, DOCX or TXT, up to 5 MB. Text-based PDFs work best; scanned images can&apos;t be read.</p>
        </div>
      ) : (
        <textarea className="field min-h-56 font-serif" aria-label="Resume text" placeholder="Paste your full resume" value={text} onChange={(e) => setText(e.target.value)} />
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      <button className="btn" disabled={busy || (mode === "file" ? !file : text.trim().length < 50)}>
        {busy ? "Reading your resume…" : "Read my resume"}
      </button>
    </form>
  );
}
