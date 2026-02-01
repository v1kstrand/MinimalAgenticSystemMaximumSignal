import type { InputsBundle } from "../inputs";
import { loadEnv } from "../llm/env";
import { createChatCompletion } from "../llm/openai";
import { researchInputs } from "./researcher";
import type { LlmCall, Plan, PlanBundle, Policy, ReviewHistory, ReviewResult } from "./types";

const DEFAULT_CHANNELS: Plan["channels"] = ["email", "paid-social", "search-ads"];

function shouldUseLLMPlanner(): boolean {
  const flag = (process.env.LLM_PLANNER || "").toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

function extractJsonPayload(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("No JSON object found in LLM planner output.");
  }
  return match[0];
}

function defaultPlan(channels: Plan["channels"]): Plan {
  return {
    channels,
    steps: [
      { id: "draft-email", description: "Draft email channel", channel: "email" },
      { id: "draft-paid-social", description: "Draft paid social channel", channel: "paid-social" },
      { id: "draft-search-ads", description: "Draft search ads channel", channel: "search-ads" },
      { id: "review", description: "Review drafts for denylist and tone" },
      { id: "analyze", description: "Analyze drafts and score" }
    ]
  };
}

function normalizePlanChannels(channels: string[] | undefined): Plan["channels"] {
  const allowed = new Set(DEFAULT_CHANNELS);
  const filtered = (channels || []).filter((entry) => allowed.has(entry as Plan["channels"][number]));
  return filtered.length > 0 ? (filtered as Plan["channels"]) : DEFAULT_CHANNELS;
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter((item) => item.trim().length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(/[\n;,]+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return fallback;
}

function formatReviewFeedback(reviewHistory?: ReviewHistory | ReviewResult): string | null {
  if (!reviewHistory) return null;
  const reviews = Array.isArray(reviewHistory) ? reviewHistory : [reviewHistory];
  const failed = reviews.filter((entry) => !entry.pass && entry.issues.length > 0);
  if (failed.length === 0) return null;
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const entry of failed) {
    for (const issue of entry.issues) {
      const key = `${issue.channel}|${issue.type}|${issue.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`- [${issue.channel}][${issue.type}] ${issue.message}`);
    }
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

function deterministicPlanBundle(inputs: InputsBundle): PlanBundle {
  const research = researchInputs(inputs);
  return {
    plan: defaultPlan(DEFAULT_CHANNELS),
    research
  };
}

async function planWithLLM(
  inputs: InputsBundle,
  reviewHistory?: ReviewHistory | ReviewResult,
  onLog?: (message: string) => void | Promise<void>,
  policy?: Policy,
  onUsage?: (call: LlmCall) => void | Promise<void>
): Promise<PlanBundle> {
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set.");
  }

  const model =
    policy?.models?.planner ||
    process.env.OPENAI_PLANNER_MODEL ||
    process.env.OPENAI_MODEL ||
    "gpt-3.5-turbo";
  const systemPrompt =
    "You are a marketing strategist. Return ONLY valid JSON. Do not include markdown.";

  const feedback = formatReviewFeedback(reviewHistory);
  const minModel = policy?.modelRange?.min || "gpt-4.1-nano";
  const maxModel = policy?.modelRange?.max || "gpt-4o";
  const userPrompt = [
    "Create a plan and grounded research summary using ONLY the facts provided.",
    "Return JSON with keys: plan, research, recommendedWriterModel.",
    "plan: { channels: [\"email\",\"paid-social\",\"search-ads\"], steps: [{id, description, channel?}], notes?: [string] }",
    "research: { product, summary, audience, valueProps, proofPoints, primaryCta, secondaryCta, facts }",
    `recommendedWriterModel: choose ONE model in [${minModel}, ${maxModel}]`,
    "",
    "FACTS (grounded inputs):",
    `Product: ${inputs.brief.product}`,
    `Category: ${inputs.brief.category}`,
    `Summary: ${inputs.brief.summary}`,
    `Audience: ${inputs.brief.audience.join("; ")}`,
    `Value props: ${inputs.brief.valueProps.join("; ")}`,
    `Proof points: ${inputs.brief.proofPoints.join("; ")}`,
    `Primary CTA: ${inputs.brief.primaryCta}`,
    `Secondary CTA: ${inputs.brief.secondaryCta}`,
    "",
    "BRAND TONE:",
    `Attributes: ${inputs.brand.attributes.join("; ")}`,
    `Do: ${inputs.brand.doList.join("; ")}`,
    `Do not: ${inputs.brand.doNotList.join("; ")}`,
    ...(feedback ? ["", "REVIEW FEEDBACK TO ADDRESS:", feedback] : []),
    "",
    "RULES:",
    "- Do not invent facts or numbers.",
    "- Keep channels to: email, paid-social, search-ads.",
    "- Include a short plan note if review feedback is provided.",
    "- If review feedback indicates issues, consider a stronger recommendedWriterModel."
  ].join("\n");

  if (onLog) {
    await onLog(`[LLM planner] model=${model} starting`);
  }
  const startedAt = Date.now();
  const response = await createChatCompletion(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    { apiKey, model, temperature: 0.4, timeoutMs: 60000 }
  );
  if (onUsage) {
    await onUsage({
      stage: "planner",
      model,
      durationMs: Date.now() - startedAt,
      usage: response.usage
    });
  }
  if (onLog) {
    await onLog(`[LLM planner] completed in ${Date.now() - startedAt}ms`);
  }

  const payload = extractJsonPayload(response.text);
  const parsed = JSON.parse(payload) as {
    plan?: Partial<Plan>;
    research?: Partial<PlanBundle["research"]>;
    recommendedWriterModel?: string;
  };

  const channels = normalizePlanChannels(parsed.plan?.channels as string[] | undefined);
  const plan: Plan = {
    channels,
    steps: Array.isArray(parsed.plan?.steps) && parsed.plan?.steps.length > 0
      ? (parsed.plan.steps as Plan["steps"])
      : defaultPlan(channels).steps,
    notes: Array.isArray(parsed.plan?.notes) ? parsed.plan?.notes : undefined
  };

  const fallbackFacts = [
    inputs.brief.product,
    inputs.brief.category,
    inputs.brief.summary,
    ...inputs.brief.audience,
    ...inputs.brief.valueProps,
    ...inputs.brief.proofPoints,
    inputs.brief.primaryCta,
    inputs.brief.secondaryCta
  ].filter(Boolean);

  const research = {
    product: parsed.research?.product || inputs.brief.product,
    summary: parsed.research?.summary || inputs.brief.summary,
    audience: normalizeStringArray(parsed.research?.audience, inputs.brief.audience),
    valueProps: normalizeStringArray(parsed.research?.valueProps, inputs.brief.valueProps),
    proofPoints: normalizeStringArray(parsed.research?.proofPoints, inputs.brief.proofPoints),
    primaryCta: parsed.research?.primaryCta || inputs.brief.primaryCta,
    secondaryCta: parsed.research?.secondaryCta || inputs.brief.secondaryCta,
    facts: normalizeStringArray(parsed.research?.facts, fallbackFacts)
  };

  return {
    plan,
    research,
    recommendedWriterModel: parsed.recommendedWriterModel
  };
}

export async function planCampaign(
  inputs: InputsBundle,
  reviewHistory?: ReviewHistory | ReviewResult,
  onLog?: (message: string) => void | Promise<void>,
  policy?: Policy,
  onUsage?: (call: LlmCall) => void | Promise<void>
): Promise<PlanBundle> {
  loadEnv();
  if (!shouldUseLLMPlanner()) {
    return deterministicPlanBundle(inputs);
  }
  try {
    return await planWithLLM(inputs, reviewHistory, onLog, policy, onUsage);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`LLM planner failed, falling back to deterministic planner: ${message}`);
    if (onLog) {
      await onLog(`[LLM planner] failed: ${message}`);
    }
    return deterministicPlanBundle(inputs);
  }
}
