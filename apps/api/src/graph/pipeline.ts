import { Annotation, END, START, StateGraph, interrupt, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { pool, query } from "../db/pool.js";
import type { Ats } from "../sources/connectors.js";
import { confirmEvidence, evidenceForVersion, latestVersionId, type EvidenceEdits } from "../services/evidence.js";
import { createMarketMap } from "../services/market.js";
import { createPlanFromMarket } from "../services/plans.js";
import { researchJobs } from "../services/research.js";

/**
 * The "prepare me for role X" golden path as a fixed LangGraph pipeline (docs/03-architecture.md):
 *
 *   research → ensure_resume ⏸ → confirm_evidence ⏸ → analyze → coach
 *
 * ⏸ = human-in-the-loop interrupt. Each interrupt lives in its own node because LangGraph replays a
 * node from the top on resume and matches resume values to interrupt() calls by position.
 * State holds IDs only; data lives in Postgres.
 */
export const PrepareState = Annotation.Root({
  userId: Annotation<string>(),
  role: Annotation<string>(),
  location: Annotation<string | null>(),
  hoursPerWeek: Annotation<number>(),
  weeks: Annotation<number>(),
  limit: Annotation<number>(),
  companies: Annotation<{ ats: Ats; token: string; company?: string }[]>(),
  /** Jobs the user already saved/pasted to include in the analysis. */
  includeSavedJobs: Annotation<boolean>(),
  skipResearch: Annotation<boolean>(),
  jobIds: Annotation<string[]>(),
  researchStats: Annotation<Record<string, unknown> | null>(),
  versionId: Annotation<string | null>(),
  marketMapId: Annotation<string | null>(),
  planId: Annotation<string | null>(),
});

export type PrepareInput = Pick<
  typeof PrepareState.State,
  "userId" | "role" | "location" | "hoursPerWeek" | "weeks" | "limit" | "companies" | "includeSavedJobs" | "skipResearch"
>;

export type Interrupt =
  | { type: "need_resume"; message: string }
  | { type: "confirm_evidence"; versionId: string; message: string; evidence: unknown[] };

type Progress = (step: string, message: string) => Promise<void>;
let progressSink: Progress = async () => {};
export const setProgressSink = (fn: Progress) => (progressSink = fn);

const runId = (config: LangGraphRunnableConfig) => config.configurable?.thread_id as string;
const say = (config: LangGraphRunnableConfig, step: string, message: string) => progressSink(`${runId(config)}|${step}`, message);

async function research(s: typeof PrepareState.State, config: LangGraphRunnableConfig) {
  let jobIds: string[] = [];
  let stats: Record<string, unknown> | null = null;
  if (!s.skipResearch) {
    const r = await researchJobs({
      userId: s.userId,
      role: s.role,
      location: s.location,
      limit: s.limit,
      companies: s.companies,
      onProgress: (m) => say(config, "research", m),
    });
    jobIds = r.jobIds;
    stats = { scanned: r.scanned, relevant: r.relevant, sources: r.sources, failedSources: r.failedSources };
  }
  if (s.includeSavedJobs || s.skipResearch) {
    const saved = await query<{ job_id: string }>("SELECT job_id FROM user_jobs WHERE user_id = $1", [s.userId]);
    jobIds = [...new Set([...jobIds, ...saved.map((r) => r.job_id)])];
  }
  if (jobIds.length === 0) {
    throw new Error("No relevant job descriptions found. Paste a few JDs for this role (Jobs → Add job) and run again.");
  }
  await say(config, "research", `Analyzing ${jobIds.length} job descriptions.`);
  return { jobIds, researchStats: stats };
}

async function ensureResume(s: typeof PrepareState.State, config: LangGraphRunnableConfig) {
  let versionId = await latestVersionId(s.userId);
  if (!versionId) {
    await say(config, "resume", "Waiting for your resume.");
    interrupt<Interrupt>({ type: "need_resume", message: "Upload your resume to continue." });
    versionId = await latestVersionId(s.userId);
    if (!versionId) throw new Error("Still no resume uploaded.");
  }
  return { versionId };
}

async function confirmStep(s: typeof PrepareState.State, config: LangGraphRunnableConfig) {
  const evidence = await evidenceForVersion(s.userId, s.versionId!);
  if (evidence.length > 0 && evidence.every((e) => e.confirmed)) return {};
  await say(config, "resume", "Please confirm what your resume shows before matching.");
  const edits = interrupt<Interrupt, EvidenceEdits | null>({
    type: "confirm_evidence",
    versionId: s.versionId!,
    message: "Check the skills and evidence we extracted. Remove anything wrong, add anything missing.",
    evidence,
  });
  await confirmEvidence(s.userId, s.versionId!, edits ?? {});
  await say(config, "resume", "Evidence confirmed.");
  return {};
}

async function analyze(s: typeof PrepareState.State, config: LangGraphRunnableConfig) {
  await say(config, "match", "Building the market skill map and scoring your evidence…");
  const marketMapId = await createMarketMap(s.userId, s.role, s.location, s.jobIds);
  return { marketMapId };
}

async function coach(s: typeof PrepareState.State, config: LangGraphRunnableConfig) {
  await say(config, "coach", `Writing a ${s.weeks}-week plan at ${s.hoursPerWeek} h/week and practice questions…`);
  const planId = await createPlanFromMarket(s.userId, s.marketMapId!, { hoursPerWeek: s.hoursPerWeek, weeks: s.weeks });
  await say(config, "coach", "Plan ready.");
  return { planId };
}

let compiled: ReturnType<typeof build> | null = null;
let checkpointer: PostgresSaver | null = null;
let ready: Promise<void> | null = null;

/** Shared Postgres checkpointer for every graph (tables created once). */
export async function getCheckpointer(): Promise<PostgresSaver> {
  if (!checkpointer) {
    checkpointer = new PostgresSaver(pool);
    ready = checkpointer.setup();
  }
  await ready;
  return checkpointer;
}

function build(checkpointer: PostgresSaver) {
  return new StateGraph(PrepareState)
    .addNode("research", research)
    .addNode("ensure_resume", ensureResume)
    .addNode("confirm_evidence", confirmStep)
    .addNode("analyze", analyze)
    .addNode("coach", coach)
    .addEdge(START, "research")
    .addEdge("research", "ensure_resume")
    .addEdge("ensure_resume", "confirm_evidence")
    .addEdge("confirm_evidence", "analyze")
    .addEdge("analyze", "coach")
    .addEdge("coach", END)
    .compile({ checkpointer });
}

/** Compiled graph with a Postgres checkpointer (tables created on first use). */
export async function prepareGraph() {
  compiled ??= build(await getCheckpointer());
  return compiled;
}
