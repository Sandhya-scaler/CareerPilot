import { randomUUID } from "node:crypto";
import { Command } from "@langchain/langgraph";
import { one, query } from "../db/pool.js";
import { prepareGraph, setProgressSink, type PrepareInput } from "../graph/pipeline.js";
import { HttpError, notFound } from "../http.js";

export type RunStatus = "running" | "waiting" | "done" | "failed";

setProgressSink(async (key, message) => {
  const [runId, step] = key.split("|") as [string, string];
  await logEvent(runId, step, message);
});

export async function logEvent(runId: string, step: string, message: string) {
  await query("INSERT INTO run_events (run_id, step, message) VALUES ($1, $2, $3)", [runId, step, message]);
}

const inFlight = new Map<string, Promise<void>>();

/** Drives the graph until it finishes, fails or pauses at an interrupt, mirroring status into `runs`. */
function drive(runId: string, step: () => Promise<unknown>): Promise<void> {
  const p = (async () => {
    const graph = await prepareGraph();
    const config = { configurable: { thread_id: runId } };
    try {
      await step();
      const snapshot = await graph.getState(config);
      const interrupts = snapshot.tasks.flatMap((t) => t.interrupts ?? []);
      if (snapshot.next.length > 0 && interrupts.length > 0) {
        await query("UPDATE runs SET status = 'waiting', pending = $2, updated_at = now() WHERE id = $1", [runId, JSON.stringify(interrupts[0]!.value)]);
      } else {
        const v = snapshot.values as Record<string, unknown>;
        const result = { jobIds: v.jobIds, marketMapId: v.marketMapId, planId: v.planId, researchStats: v.researchStats };
        await query("UPDATE runs SET status = 'done', result = $2, pending = NULL, updated_at = now() WHERE id = $1", [runId, JSON.stringify(result)]);
        await logEvent(runId, "done", "Done.");
      }
    } catch (e) {
      const message = (e as Error).message ?? String(e);
      console.error(`[run ${runId}]`, e);
      await query("UPDATE runs SET status = 'failed', error = $2, updated_at = now() WHERE id = $1", [runId, message]);
      await logEvent(runId, "error", message);
    } finally {
      inFlight.delete(runId);
    }
  })();
  inFlight.set(runId, p);
  return p;
}

export async function startPrepareRun(input: PrepareInput): Promise<string> {
  const id = randomUUID();
  await query("INSERT INTO runs (id, user_id, kind, status, input) VALUES ($1, $2, 'prepare', 'running', $3)", [id, input.userId, JSON.stringify(input)]);
  await logEvent(id, "start", `Preparing for "${input.role}"${input.location ? ` in ${input.location}` : ""}.`);
  const graph = await prepareGraph();
  void drive(id, () => graph.invoke(input, { configurable: { thread_id: id } }));
  return id;
}

export async function resumeRun(userId: string, runId: string, value: unknown) {
  const run = await one<{ status: RunStatus }>("SELECT status FROM runs WHERE id = $1 AND user_id = $2", [runId, userId]);
  if (!run) throw notFound("run");
  if (run.status !== "waiting") throw new HttpError(409, `run is ${run.status}, not waiting for input`);
  await query("UPDATE runs SET status = 'running', pending = NULL, updated_at = now() WHERE id = $1", [runId]);
  const graph = await prepareGraph();
  void drive(runId, () => graph.invoke(new Command({ resume: value ?? {} }), { configurable: { thread_id: runId } }));
}

export async function getRun(userId: string, runId: string, afterEventId = 0) {
  const run = await one(
    "SELECT id, kind, status, input, result, pending, error, created_at, updated_at FROM runs WHERE id = $1 AND user_id = $2",
    [runId, userId],
  );
  if (!run) throw notFound("run");
  const events = await query(
    "SELECT id::int, at, step, message FROM run_events WHERE run_id = $1 AND id > $2 ORDER BY id",
    [runId, afterEventId],
  );
  return { ...run, events };
}

export async function listRuns(userId: string) {
  return query(
    "SELECT id, kind, status, input->>'role' AS role, error, created_at, updated_at FROM runs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20",
    [userId],
  );
}

/** Test/shutdown helper: wait for a run's current drive to settle. */
export const settle = (runId: string) => inFlight.get(runId) ?? Promise.resolve();

/**
 * After a restart, runs that were mid-flight continue from their last LangGraph checkpoint
 * (invoke with null input resumes the thread).
 */
export async function resumeOrphanedRuns() {
  const rows = await query<{ id: string }>("SELECT id FROM runs WHERE status = 'running' AND updated_at > now() - interval '1 day'");
  if (!rows.length) return;
  const graph = await prepareGraph();
  for (const r of rows) {
    if (inFlight.has(r.id)) continue;
    await logEvent(r.id, "restart", "Server restarted; resuming from the last checkpoint.");
    void drive(r.id, () => graph.invoke(null, { configurable: { thread_id: r.id } }));
  }
}
