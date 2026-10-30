import { z } from "zod";
import { structured, withFallback } from "../llm.js";
import { taxonomy } from "../skills/taxonomy.js";

export type QuestionKind = "concept" | "applied" | "project" | "behavioral" | "jd";

export interface QuestionDraft {
  skill: string | null;
  kind: QuestionKind;
  prompt: string;
  rubric: string[];
  grounding: string | null;
}

/** Hand-written concept questions with rubrics for high-frequency skills. */
const BANK: Record<string, { prompt: string; rubric: string[] }[]> = {
  "Object Detection": [
    { prompt: "Explain IoU and non-maximum suppression. Why does a detector need NMS?", rubric: ["IoU = intersection / union of boxes", "NMS keeps the highest-scoring box and suppresses overlapping ones above an IoU threshold", "Detectors emit many overlapping candidates per object", "Mentions threshold trade-off (missed vs duplicate detections)"] },
    { prompt: "What does mAP@0.5 measure, and why can a model have high mAP@0.5 but low mAP@0.5:0.95?", rubric: ["Mean of per-class average precision at IoU 0.5", "0.5:0.95 averages over stricter IoU thresholds", "High @0.5 / low @0.5:0.95 means boxes are roughly right but poorly localized", "Mentions precision-recall curve"] },
  ],
  CNNs: [
    { prompt: "Why do CNNs use convolutions and pooling instead of fully connected layers on images?", rubric: ["Weight sharing → far fewer parameters", "Local receptive fields capture spatial structure", "Translation equivariance (pooling adds some invariance)", "Hierarchical features from edges to objects"] },
    { prompt: "What problem does batch normalization address and how does it behave differently at train vs inference time?", rubric: ["Normalizes activations per mini-batch, stabilizing/speeding training", "Learnable scale and shift", "Train uses batch statistics; inference uses running averages", "Small batch sizes make it unstable"] },
  ],
  PyTorch: [
    { prompt: "Walk through a minimal PyTorch training loop. What do zero_grad, backward and step each do?", rubric: ["Forward pass → loss", "optimizer.zero_grad clears accumulated gradients", "loss.backward computes gradients via autograd", "optimizer.step updates parameters", "Mentions model.train()/eval() and torch.no_grad for evaluation"] },
  ],
  "Computer Vision": [
    { prompt: "Your model works on the validation set but fails on real camera images. How do you debug it?", rubric: ["Checks for distribution shift (lighting, resolution, camera)", "Inspects failure cases visually", "Verifies preprocessing matches training", "Collects/labels targeted data or uses augmentation", "Defines a metric on the real-world set"] },
  ],
  OpenCV: [
    { prompt: "How would you find lane lines in a dashcam frame with classical OpenCV (no deep learning)?", rubric: ["Grayscale + blur", "Edge detection (Canny)", "Region of interest mask", "Hough transform to find lines", "Fit/average lines and smooth across frames"] },
  ],
  "Machine Learning": [
    { prompt: "Explain the bias-variance trade-off and how you'd tell which one is hurting your model.", rubric: ["Bias = underfitting, variance = overfitting", "Compare train vs validation error", "High both → bias; low train/high val → variance", "Remedies: more capacity/features vs regularization/more data"] },
    { prompt: "When would you optimize for precision vs recall? Give a concrete example.", rubric: ["Defines precision and recall", "Precision when false positives are costly (e.g. spam filter)", "Recall when misses are costly (e.g. fraud/disease screening)", "Mentions threshold tuning / PR curve"] },
  ],
  Statistics: [
    { prompt: "An A/B test shows a 2% lift with p = 0.04. What do you check before recommending a launch?", rubric: ["Correct interpretation of p-value", "Sample size / power and test duration", "Practical vs statistical significance (effect size, CI)", "Multiple comparisons / peeking", "Guardrail metrics and segment effects"] },
  ],
  SQL: [
    { prompt: "Write a query to get each user's most recent order. Explain your approach.", rubric: ["Uses a window function (ROW_NUMBER over partition by user order by date desc) or a correlated subquery / DISTINCT ON", "Filters to rank 1", "Handles ties deliberately", "Mentions an index on (user_id, created_at)"] },
    { prompt: "Explain the difference between INNER, LEFT and FULL OUTER joins with an example where LEFT JOIN matters.", rubric: ["INNER keeps matches only", "LEFT keeps all left rows with NULLs for missing matches", "FULL keeps both sides", "Example such as users with zero orders"] },
  ],
  Python: [
    { prompt: "What are generators in Python and when would you use one?", rubric: ["Functions using yield produce values lazily", "Constant memory for large/streaming data", "Iterator protocol", "Example: reading a large file line by line"] },
  ],
  Pandas: [
    { prompt: "How would you find the top 3 products by revenue in each region with pandas?", rubric: ["Compute revenue column", "groupby region + product, sum", "sort and groupby().head(3) or nlargest", "Mentions handling missing values/dtypes"] },
  ],
  Docker: [
    { prompt: "What's the difference between an image and a container, and how do you keep images small?", rubric: ["Image = immutable layered template; container = running instance", "Multi-stage builds", "Slim base images, .dockerignore", "Layer ordering for cache efficiency"] },
  ],
  Kubernetes: [
    { prompt: "Explain Pods, Deployments and Services. How does a Service find its Pods?", rubric: ["Pod = smallest deployable unit", "Deployment manages replicas/rollouts", "Service gives a stable network endpoint", "Label selectors connect Service to Pods"] },
  ],
  "REST APIs": [
    { prompt: "What does it mean for an API endpoint to be idempotent, and how would you make a payment POST safe to retry?", rubric: ["Same request repeated has the same effect", "GET/PUT/DELETE are idempotent by spec; POST is not", "Idempotency key stored server-side", "Return the original result for duplicates"] },
  ],
  "System Design": [
    { prompt: "Design a URL shortener. Walk through the API, data model and how it scales reads.", rubric: ["API: create + redirect", "Key generation strategy (hash/base62 counter) and collisions", "Datastore choice and schema", "Caching hot redirects", "Rough capacity estimates"] },
  ],
  PostgreSQL: [
    { prompt: "A query on a large table got slow. How do you investigate and fix it?", rubric: ["EXPLAIN ANALYZE", "Look for sequential scans / bad row estimates", "Add or adjust indexes (composite order matters)", "Check VACUUM/ANALYZE statistics", "Consider query rewrite"] },
  ],
  React: [
    { prompt: "When does a React component re-render, and how do you avoid unnecessary re-renders?", rubric: ["State/props/context change or parent re-render", "React.memo for components", "useMemo/useCallback for stable references", "Avoid creating objects in render / lift state appropriately"] },
    { prompt: "Explain the useEffect dependency array and a common bug it causes.", rubric: ["Effect runs after render when deps change", "Empty array = on mount", "Stale closures from missing deps", "Cleanup function for subscriptions"] },
  ],
  "Node.js": [
    { prompt: "Explain the Node.js event loop. What happens if you run a CPU-heavy loop in a request handler?", rubric: ["Single-threaded event loop with async I/O", "Callbacks/promises queued (microtasks vs macrotasks)", "CPU work blocks all other requests", "Fix: worker threads, offload, or chunk the work"] },
  ],
  TypeScript: [
    { prompt: "What are generics in TypeScript? Show an example where they prevent a bug.", rubric: ["Type parameters preserve type relationships", "Example like identity<T> or a typed fetch helper", "Constraints with extends", "Contrast with any"] },
  ],
  "Data Structures": [
    { prompt: "When would you choose a hash map over a balanced BST? What are the complexities?", rubric: ["Hash map O(1) average lookup/insert", "BST O(log n) but keeps order", "Range queries/ordered iteration favor BST", "Hash worst case and memory overhead"] },
  ],
  Algorithms: [
    { prompt: "Given an array and a target, find two numbers that sum to the target. Give an O(n) solution.", rubric: ["Hash map from value to index", "Single pass checking complement", "O(n) time, O(n) space", "Mentions edge cases (duplicates, no solution)"] },
  ],
  "Object-Oriented Programming": [
    { prompt: "Explain polymorphism with an example from a project, and when you'd prefer composition over inheritance.", rubric: ["Same interface, different implementations", "Concrete example", "Composition avoids fragile hierarchies", "Mentions interfaces/abstract classes"] },
  ],
  "Apache Kafka": [
    { prompt: "How do partitions and consumer groups let Kafka scale consumption, and what ordering guarantees remain?", rubric: ["Topic split into partitions", "Each partition consumed by one consumer per group", "Ordering only within a partition", "Key-based partitioning for per-entity order"] },
  ],
  LLMs: [
    { prompt: "How would you reduce hallucinations in an LLM feature that answers questions about company documents?", rubric: ["Ground answers with retrieval (RAG)", "Ask for citations / quote sources", "Allow 'I don't know'", "Evaluate with a labeled question set", "Structured outputs / validation"] },
  ],
  RAG: [
    { prompt: "Your RAG system retrieves the wrong chunks. What would you try, and how would you measure improvement?", rubric: ["Chunk size/overlap tuning", "Better embeddings or hybrid (BM25 + vector) search", "Re-ranking", "Metadata filters", "Retrieval eval: hit rate / MRR on labeled questions"] },
  ],
  "Data Analysis": [
    { prompt: "Weekly active users dropped 10% last week. How do you investigate?", rubric: ["Check data/tracking issues first", "Segment by platform, region, cohort, acquisition channel", "Look for releases/external events", "Quantify contribution of each segment", "Communicate findings with a clear recommendation"] },
  ],
  Excel: [
    { prompt: "How would you reconcile two spreadsheets of transactions with different formats?", rubric: ["Normalize keys/formats", "Lookup (XLOOKUP/VLOOKUP/INDEX-MATCH) or Power Query merge", "Flag unmatched rows", "Pivot to summarize differences"] },
  ],
};

const GENERIC = (skill: string): { prompt: string; rubric: string[] } => ({
  prompt: `What problem does ${skill} solve, and when would you choose not to use it?`,
  rubric: [`States the core purpose of ${skill}`, "Gives a concrete example from experience or a project", "Names a limitation or alternative", "Uses correct terminology"],
});

const BEHAVIORAL: QuestionDraft[] = [
  {
    skill: null, kind: "behavioral", grounding: null,
    prompt: "Tell me about a project that didn't go as planned. What did you change?",
    rubric: ["Situation and goal are clear", "Specific actions the candidate took", "Measurable or concrete result", "Reflection on what they'd do differently"],
  },
  {
    skill: null, kind: "behavioral", grounding: null,
    prompt: "Describe a time you had to learn a new tool quickly to deliver something.",
    rubric: ["Names the tool and constraint", "How they learned (docs, prototypes, asking)", "What they delivered", "What they'd keep doing"],
  },
];

export interface QuestionContext {
  role: string;
  /** Gap skills in priority order, with the JD sentence that asks for them. */
  gaps: { skill: string; sampleSentence: string | null }[];
  /** User's strongest evidence lines, for project deep-dives. */
  evidence: { text: string; context: string | null; skills: string[]; tier: number }[];
}

/** Rule-based question set: bank/generic concept Qs for gaps, JD-grounded Qs, project probes, behavioral. */
export function ruleQuestions(ctx: QuestionContext, max = 15): QuestionDraft[] {
  const out: QuestionDraft[] = [];
  const gaps = ctx.gaps.filter((g) => taxonomy.category(g.skill) !== "soft").slice(0, 6);
  for (const g of gaps) {
    const bank = BANK[g.skill] ?? [GENERIC(g.skill)];
    for (const q of bank.slice(0, 2)) out.push({ skill: g.skill, kind: "concept", grounding: null, ...q });
    if (g.sampleSentence) {
      out.push({
        skill: g.skill,
        kind: "jd",
        grounding: g.sampleSentence,
        prompt: `A ${ctx.role} posting says: "${g.sampleSentence}" Describe how you have done this, or exactly how you would approach it in your first month.`,
        rubric: ["Addresses the specific requirement, not generalities", "Concrete steps or a past example", `Correct use of ${g.skill} concepts`, "Mentions how success would be measured"],
      });
    }
  }
  const projects = ctx.evidence.filter((e) => e.tier >= 2 && e.skills.some((s) => taxonomy.category(s) !== "soft"))
    .sort((a, b) => b.tier - a.tier)
    .slice(0, 3);
  for (const e of projects) {
    out.push({
      skill: e.skills[0] ?? null,
      kind: "project",
      grounding: e.text,
      prompt: `On your resume: "${e.text}"${e.context ? ` (${e.context})` : ""}. Walk me through the hardest technical decision, what alternatives you considered, and how you measured the result.`,
      rubric: ["Explains the problem and constraints", "Names at least one alternative and why it was rejected", "Gives a concrete number or observable result", "Owns their individual contribution"],
    });
  }
  out.push(...BEHAVIORAL);
  return out.slice(0, max);
}

const LlmQuestions = z.object({
  questions: z.array(z.object({
    skill: z.string().nullable(),
    kind: z.enum(["concept", "applied", "project", "behavioral", "jd"]),
    prompt: z.string(),
    rubric: z.array(z.string()).describe("3-5 points a strong answer covers"),
    grounding: z.string().nullable().describe("The JD sentence or resume line the question is based on, verbatim, or null"),
  })),
});

const Q_SYSTEM = `You write interview practice questions for a specific candidate and target role.

Mix: concept questions on the gap skills, applied/scenario questions phrased like real interviews, deep-dive questions on the candidate's own resume lines, and 1-2 behavioral questions.
- Ground "jd" and "project" questions in the provided sentences, copying them verbatim into "grounding".
- Each rubric lists 3-5 specific points a strong answer covers (not generic advice).
- Difficulty: realistic for the role level. No trick questions.`;

/** Claude-generated questions (grounding verified) with the rule-based set as fallback. */
export async function generateQuestions(ctx: QuestionContext, max = 15): Promise<{ questions: QuestionDraft[]; generatedBy: "llm" | "rules" }> {
  const { value, usedLlm } = await withFallback(
    "questions",
    async () => {
      const out = await structured({
        tier: "reasoning",
        system: Q_SYSTEM,
        input: JSON.stringify({
          role: ctx.role,
          gap_skills: ctx.gaps.slice(0, 6).map((g) => ({ skill: g.skill, employer_wording: g.sampleSentence })),
          resume_lines: ctx.evidence.filter((e) => e.tier >= 2).slice(0, 6).map((e) => e.text),
          count: max,
        }),
        schema: LlmQuestions,
        effort: "medium",
      });
      const sources = new Set([...ctx.gaps.map((g) => g.sampleSentence), ...ctx.evidence.map((e) => e.text)].filter(Boolean));
      const qs = out.questions
        .map((q) => ({
          ...q,
          skill: q.skill ? (taxonomy.normalize(q.skill) ?? null) : null,
          grounding: q.grounding && sources.has(q.grounding) ? q.grounding : null,
          rubric: q.rubric.slice(0, 6),
        }))
        // A JD/project question whose grounding we can't verify is dropped, not trusted.
        .filter((q) => !((q.kind === "jd" || q.kind === "project") && !q.grounding));
      if (qs.length < 5) throw new Error("too few valid questions");
      return qs.slice(0, max);
    },
    () => ruleQuestions(ctx, max),
  );
  return { questions: value, generatedBy: usedLlm ? "llm" : "rules" };
}

export { BANK };
