import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./http.js";

/**
 * Fixed-window in-memory rate limiter (single instance). Keys by user when signed in, else by IP.
 * Swap for Redis if the API runs on more than one instance.
 */
export function rateLimit(opts: { windowMs: number; max: number; name: string }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    if (process.env.DISABLE_RATE_LIMIT === "1") return next();
    const key = `${opts.name}:${req.userId ?? req.ip}`;
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.resetAt <= now) {
      h = { count: 0, resetAt: now + opts.windowMs };
      hits.set(key, h);
    }
    h.count++;
    res.setHeader("RateLimit-Remaining", String(Math.max(0, opts.max - h.count)));
    if (h.count > opts.max) {
      res.setHeader("Retry-After", String(Math.ceil((h.resetAt - now) / 1000)));
      return next(new HttpError(429, `too many requests, try again in ${Math.ceil((h.resetAt - now) / 60000)} min`));
    }
    if (hits.size > 50_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    next();
  };
}
