import type { NextFunction, Request, Response } from "express";
import { query } from "./db/pool.js";
import { HttpError } from "./http.js";

/**
 * Fixed-window rate limiter backed by Postgres (one atomic upsert per request), so limits hold
 * across any number of API instances. Keys by user when signed in, else by client IP.
 */
export function rateLimit(opts: { windowMs: number; max: number; name: string }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (process.env.DISABLE_RATE_LIMIT === "1") return next();
    try {
      const key = `${opts.name}:${req.userId ?? req.ip}`;
      const [row] = await query<{ count: number; reset_at: Date }>(
        `INSERT INTO rate_limits (key, count, reset_at) VALUES ($1, 1, now() + $2 * interval '1 millisecond')
         ON CONFLICT (key) DO UPDATE SET
           count = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.count + 1 END,
           reset_at = CASE WHEN rate_limits.reset_at <= now() THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END
         RETURNING count, reset_at`,
        [key, opts.windowMs],
      );
      const waitS = Math.max(1, Math.ceil((row!.reset_at.getTime() - Date.now()) / 1000));
      res.setHeader("RateLimit-Remaining", String(Math.max(0, opts.max - row!.count)));
      if (row!.count > opts.max) {
        res.setHeader("Retry-After", String(waitS));
        return next(new HttpError(429, `too many requests, try again in ${Math.ceil(waitS / 60)} min`));
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}
