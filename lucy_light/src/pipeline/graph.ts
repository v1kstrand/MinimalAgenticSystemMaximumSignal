import fs from "fs";
import path from "path";

import type { InputsBundle } from "../inputs";
import { planCampaign } from "./planner";
import { reviewDrafts } from "./reviewer";
import { analyzeDrafts } from "./analyst";
import { writeDrafts } from "./writer";
import { selectWriterModel } from "./model_router";
import { runInputGuardrails } from "./guardrails";
import type {
  ChannelDrafts,
  EvalReport,
  LlmCall,
  LlmUsage,
  Plan,
  PlanBundle,
  Policy,
  ResearchSummary,
  ReviewHistory,
  ReviewResult,
  RunLog
} from "./types";

type GraphNodeType = "planner" | "writer" | "reviewer" | "analyst" | "done";
type EdgeCondition = "always" | "review_failed" | "review_passed" | "missing_facts";

type GraphNode = {
  type: GraphNodeType;
};

type GraphEdge = {
  from: string;
  to: string;
  when?: EdgeCondition;
};

type GraphConfig = {
  start: string;
  nodes: Record<string, GraphNode>;
  edges: GraphEdge[];
};

export type PipelineState = {
  inputs: InputsBundle;
  plan?: Plan;
  research?: ResearchSummary;
  planBundle?: PlanBundle;
  drafts?: ChannelDrafts;
  review?: ReviewResult;
  reviewHistory?: ReviewHistory;
  report?: EvalReport;
  policy: Policy;
  runLog: RunLog;
  trace: string[];
};

type RunOptions = {
  graphPath: string;
  maxSteps?: number;
  onStep?: (node: string, state: PipelineState) => void | Promise<void>;
  onLog?: (message: string, state: PipelineState) => void | Promise<void>;
  policy: Policy;
  startNode?: string;
  seedState?: Partial<PipelineState>;
};

function loadGraphConfig(graphPath: string): GraphConfig {
  if (!fs.existsSync(graphPath)) {
    throw new Error(`Graph config not found at ${graphPath}`);
  }
  const raw = fs.readFileSync(graphPath, "utf8");
  const parsed = JSON.parse(raw) as GraphConfig;
  return parsed;
}

function createRunLog(policy: Policy): RunLog {
  return {
    runId: `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    startedAt: new Date().toISOString(),
    status: "complete",
    policy,
    steps: [],
    plans: [],
    reviews: [],
    llmCalls: [],
    usageTotals: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      reasoningTokens: 0
    },
    logs: [],
    retries: 0
  };
}

function countFailedReviews(history?: ReviewHistory): number {
  if (!history) return 0;
  return history.filter((review) => !review.pass).length;
}

function conditionMet(state: PipelineState, condition?: EdgeCondition): boolean {
  if (!condition || condition === "always") {
    return true;
  }
  if (condition === "review_failed") {
    return Boolean(state.review && !state.review.pass);
  }
  if (condition === "review_passed") {
    return Boolean(state.review && state.review.pass);
  }
  if (condition === "missing_facts") {
    return Boolean(state.review && state.review.missingFacts);
  }
  return false;
}

function nextNode(graph: GraphConfig, state: PipelineState, current: string): string {
  const edges = graph.edges.filter((edge) => edge.from === current);
  for (const edge of edges) {
    if (conditionMet(state, edge.when)) {
      return edge.to;
    }
  }
  throw new Error(`No valid edge from node ${current}`);
}

async function runNode(
  state: PipelineState,
  nodeType: GraphNodeType,
  onLog?: (message: string) => void | Promise<void>,
  onUsage?: (call: LlmCall) => void | Promise<void>
): Promise<void> {
  switch (nodeType) {
    case "planner":
      state.planBundle = await planCampaign(
        state.inputs,
        state.reviewHistory,
        onLog,
        state.policy,
        onUsage
      );
      state.plan = state.planBundle.plan;
      state.research = state.planBundle.research;
      if (!state.research) {
        throw new Error("Planner did not return research summary.");
      }
      if (state.policy.dynamicModelSelection) {
        const selection = selectWriterModel(
          state.plan,
          state.inputs,
          state.planBundle?.recommendedWriterModel,
          countFailedReviews(state.reviewHistory),
          state.policy.modelRange?.min,
          state.policy.modelRange?.max
        );
        state.policy.models = state.policy.models || {};
        state.policy.models.writer = selection.model;
        state.runLog.policy = state.policy;
        if (onLog) {
          await onLog(
            `[router] writer_model=${selection.model} base=${selection.baseModel} failures=${countFailedReviews(state.reviewHistory)} range=${state.policy.modelRange?.min || "?"}-${state.policy.modelRange?.max || "?"}`
          );
        }
      }
      state.runLog.plans.push({
        at: new Date().toISOString(),
        channels: state.plan.channels,
        notes: state.plan.notes
      });
      return;
    case "writer":
      if (!state.plan) {
        state.planBundle = await planCampaign(
          state.inputs,
          state.reviewHistory,
          onLog,
          state.policy,
          onUsage
        );
        state.plan = state.planBundle.plan;
        state.research = state.planBundle.research;
        if (!state.research) {
          throw new Error("Planner did not return research summary.");
        }
      }
      const reviewFeedback =
        state.reviewHistory && state.reviewHistory.length > 0
          ? state.reviewHistory
          : state.review && !state.review.pass
            ? state.review
            : undefined;
      state.drafts = await writeDrafts(
        state.plan,
        state.research!,
        state.inputs.brand,
        reviewFeedback,
        onLog,
        state.policy,
        onUsage
      );
      return;
    case "reviewer":
      if (!state.drafts) {
        throw new Error("Cannot review drafts before writing them.");
      }
      state.review = await reviewDrafts(
        state.drafts,
        state.inputs,
        state.research,
        state.policy,
        onLog,
        onUsage
      );
      state.reviewHistory?.push(state.review);
      state.runLog.reviews.push({
        at: new Date().toISOString(),
        pass: state.review.pass,
        missingFacts: state.review.missingFacts,
        issues: state.review.issues
      });
      state.runLog.retries = countFailedReviews(state.reviewHistory);
      return;
    case "analyst":
      if (!state.drafts || !state.review) {
        throw new Error("Cannot analyze drafts before review.");
      }
      state.report = analyzeDrafts(state.drafts, state.review);
      return;
    case "done":
      return;
  }
}

export async function runGraph(
  inputs: InputsBundle,
  options?: Partial<RunOptions>
): Promise<PipelineState> {
  const graphPath =
    options?.graphPath ?? path.resolve(__dirname, "..", "..", "graph.json");
  const graph = loadGraphConfig(graphPath);
  const maxSteps = options?.maxSteps ?? 20;
  const policy = options?.policy ?? {
    maxRetries: 2,
    toneStrictness: "medium",
    budgetHint: "low"
  };

  const seeded = options?.seedState;
  const state: PipelineState = {
    inputs,
    reviewHistory: seeded?.reviewHistory ?? [],
    policy: seeded?.policy ?? policy,
    runLog: seeded?.runLog ?? createRunLog(policy),
    trace: seeded?.trace ?? []
  };
  if (seeded?.plan) state.plan = seeded.plan;
  if (seeded?.research) state.research = seeded.research;
  if (seeded?.planBundle) state.planBundle = seeded.planBundle;
  if (seeded?.drafts) state.drafts = seeded.drafts;
  if (seeded?.review) state.review = seeded.review;
  if (seeded?.report) state.report = seeded.report;

  const onLog = options?.onLog;
  const log = onLog
    ? (message: string) => onLog(message, state)
    : undefined;
  const recordUsage = async (call: LlmCall) => {
    state.runLog.llmCalls.push(call);
    if (call.usage) {
      state.runLog.usageTotals.inputTokens += call.usage.inputTokens;
      state.runLog.usageTotals.outputTokens += call.usage.outputTokens;
      state.runLog.usageTotals.totalTokens += call.usage.totalTokens;
      if (typeof call.usage.reasoningTokens === "number") {
        state.runLog.usageTotals.reasoningTokens =
          (state.runLog.usageTotals.reasoningTokens || 0) + call.usage.reasoningTokens;
      }
    }
    if (log && call.usage) {
      const reasoning =
        typeof call.usage.reasoningTokens === "number"
          ? ` reasoning=${call.usage.reasoningTokens}`
          : "";
      await log(
        `[usage] ${call.stage} model=${call.model} input=${call.usage.inputTokens} output=${call.usage.outputTokens} total=${call.usage.totalTokens}${reasoning} durationMs=${call.durationMs}`
      );
    }
  };
  const usage = options?.onLog ? recordUsage : recordUsage;
  let current = options?.startNode ?? graph.start;
  if (!options?.startNode) {
    const guardrails = await runInputGuardrails(state.inputs, state.policy, log, usage);
    state.runLog.guardrails = guardrails;
    const blocked = guardrails.find((result) => result.status === "block");
    if (blocked) {
      if (log) {
        await log(`[guardrail] blocked: ${blocked.name}`);
      }
      state.runLog.status = "stopped";
      state.runLog.stopReason = "guardrail_blocked";
      state.runLog.finishedAt = new Date().toISOString();
      return state;
    }
  }
  for (let step = 0; step < maxSteps; step += 1) {
    const node = graph.nodes[current];
    if (!node) {
      throw new Error(`Unknown node: ${current}`);
    }
    state.trace.push(current);
    state.runLog.steps.push({ node: current, at: new Date().toISOString() });
    if (log) {
      await log(`[graph] step ${current}`);
    }
    if (options?.onStep) {
      await options.onStep(current, state);
    }
    await runNode(state, node.type, log, usage);
    if (node.type === "reviewer" && state.policy.hitlEnabled) {
      state.runLog.status = "needs_approval";
      state.runLog.stopReason = "hitl_pending";
      state.runLog.finishedAt = new Date().toISOString();
      return state;
    }
    if (node.type === "done") {
      state.runLog.status = "complete";
      state.runLog.finishedAt = new Date().toISOString();
      return state;
    }
  if (
      node.type === "reviewer" &&
      state.review &&
      !state.review.pass &&
      countFailedReviews(state.reviewHistory) > policy.maxRetries
    ) {
      if (log) {
        await log("[graph] max_retries_exceeded");
      }
      if (state.drafts && state.review) {
        state.report = analyzeDrafts(state.drafts, state.review);
      }
      state.runLog.status = "stopped";
      state.runLog.stopReason = "max_retries_exceeded";
      state.runLog.finishedAt = new Date().toISOString();
      return state;
    }
    current = nextNode(graph, state, current);
  }

  throw new Error(`Graph exceeded max steps (${maxSteps}).`);
}
