import type { BrandVoice, InputsBundle, NormalizedBrief } from "../inputs";

export type Channel = "email" | "paid-social" | "search-ads";

export type PlanStep = {
  id: string;
  description: string;
  channel?: Channel;
};

export type Plan = {
  channels: Channel[];
  steps: PlanStep[];
  notes?: string[];
};

export type Policy = {
  maxRetries: number;
  toneStrictness: "low" | "medium" | "high";
  budgetHint: "low" | "medium" | "high";
  alwaysUseLlmJudge?: boolean;
  hitlEnabled?: boolean;
  guardrails?: {
    pii?: {
      mode?: "warn" | "block";
    };
    safety?: {
      mode?: "warn" | "block";
      model?: string;
    };
  };
  models?: {
    planner?: string;
    writer?: string;
    reviewer?: string;
  };
  dynamicModelSelection?: boolean;
  modelRange?: {
    min?: string;
    max?: string;
  };
};

export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
};

export type LlmCall = {
  stage: "planner" | "writer" | "reviewer" | "guardrail";
  model: string;
  durationMs: number;
  usage?: LlmUsage;
};

export type GuardrailResult = {
  name: "pii_input" | "safety_input";
  status: "pass" | "warn" | "block";
  findings: string[];
};

export type ResearchSummary = {
  product: string;
  summary: string;
  audience: string[];
  valueProps: string[];
  proofPoints: string[];
  primaryCta: string;
  secondaryCta: string;
  facts: string[];
};

export type ChannelDrafts = Record<Channel, string>;

export type ReviewIssue = {
  channel: Channel;
  type: "denylist" | "tone" | "format" | "grounding" | "llm" | "safety";
  message: string;
};

export type ReviewResult = {
  issues: ReviewIssue[];
  pass: boolean;
  missingFacts: boolean;
};

export type ReviewHistory = ReviewResult[];

export type PlanBundle = {
  plan: Plan;
  research: ResearchSummary;
  recommendedWriterModel?: string;
};

export type RunLog = {
  runId: string;
  startedAt: string;
  finishedAt?: string;
  status: "complete" | "stopped" | "error" | "needs_approval";
  stopReason?: string;
  policy: Policy;
  guardrails?: GuardrailResult[];
  steps: Array<{ node: string; at: string }>;
  plans: Array<{ at: string; channels: Channel[]; notes?: string[] }>;
  reviews: Array<{
    at: string;
    pass: boolean;
    missingFacts: boolean;
    issues: ReviewIssue[];
  }>;
  llmCalls: LlmCall[];
  usageTotals: LlmUsage;
  logs: Array<{ at: string; message: string }>;
  retries: number;
};

export type EvalCaseResult = {
  id: string;
  scores: {
    factuality: number;
    denylist: number;
    consistency: number;
    safety: number;
  };
  llmScores?: {
    factuality: number;
    denylist: number;
    consistency: number;
    safety: number;
  };
  pairwiseWinRate?: number;
  pairwiseConfidence?: number;
  pass: boolean;
  score: number;
  notes: string[];
  baselineScore?: number;
  delta?: number;
  gatePass?: boolean;
  llmScore?: number;
  baselineLlmScore?: number;
  llmDelta?: number;
};

export type ChannelScore = {
  wordCount: number;
  sentenceCount: number;
  issues: number;
  score: number;
  checks: Record<string, boolean | number>;
  pass: boolean;
};

export type EvalReport = {
  generatedAt: string;
  channels: Record<Channel, ChannelScore>;
  pass: boolean;
};

export type PipelineContext = {
  inputs: InputsBundle;
  brief: NormalizedBrief;
  brand: BrandVoice;
};
