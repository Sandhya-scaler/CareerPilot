"use client";

import { useCallback, useEffect, useState } from "react";

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: string[]) {
    super(message);
  }
}

/** Same-origin call to the Express API (proxied by next.config rewrites). */
export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    credentials: "include",
    ...rest,
    headers: json !== undefined ? { "content-type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/")) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`, body.details);
  }
  return body as T;
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.details?.length ? `${e.message}: ${e.details.join("; ")}` : e.message;
  return e instanceof Error ? e.message : String(e);
}

/** Minimal data hook: loads on mount / when `path` changes, exposes reload. `path = null` skips. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

export const pct = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}%`);

export function relDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const days = Math.round((Date.now() - d.getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days > 1 && days < 30) return `${days} days ago`;
  if (days < 0 && days > -30) return `in ${-days} days`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
