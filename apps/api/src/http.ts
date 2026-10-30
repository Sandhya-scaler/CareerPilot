import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const notFound = (what = "resource") => new HttpError(404, `${what} not found`);

/** Parses `data` with a zod schema or throws a 400 with readable issues. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new HttpError(400, "invalid request", r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`));
  }
  return r.data;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  // multer / body-parser errors carry a status
  const status = (err as { status?: number }).status;
  if (status && status >= 400 && status < 500) {
    res.status(status).json({ error: (err as Error).message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "internal error" });
}

export const Uuid = z.string().uuid();
