import fs from "fs";
import path from "path";
import type { Policy } from "./pipeline/types";

const DEFAULT_POLICY: Policy = {
  maxRetries: 2,
  toneStrictness: "medium",
  budgetHint: "low",
  alwaysUseLlmJudge: true,
  hitlEnabled: false,
  guardrails: {
    pii: { mode: "warn" },
    safety: { mode: "warn", model: "gpt-4.1-mini" }
  },
  models: {
    planner: "gpt-4o-mini",
    writer: "gpt-4o-mini",
    reviewer: "gpt-4o-mini"
  },
  dynamicModelSelection: false,
  modelRange: {
    min: "gpt-4.1-nano",
    max: "gpt-4o-mini"
  }
};

function normalizePolicy(input?: Partial<Policy>): Policy {
  const maxRetries = Number.isFinite(input?.maxRetries)
    ? Math.max(0, Math.min(5, Math.floor(input!.maxRetries as number)))
    : DEFAULT_POLICY.maxRetries;

  const toneStrictness =
    input?.toneStrictness === "low" || input?.toneStrictness === "high"
      ? input.toneStrictness
      : "medium";

  const budgetHint =
    input?.budgetHint === "medium" || input?.budgetHint === "high"
      ? input.budgetHint
      : "low";

  const alwaysUseLlmJudge = Boolean(input?.alwaysUseLlmJudge);
  const hitlEnabled = Boolean(input?.hitlEnabled);
  const guardrails: Policy["guardrails"] = {
    pii: {
      mode:
        input?.guardrails?.pii?.mode === "block"
          ? "block"
          : "warn"
    },
    safety: {
      mode:
        input?.guardrails?.safety?.mode === "block"
          ? "block"
          : "warn",
      model: input?.guardrails?.safety?.model || DEFAULT_POLICY.guardrails?.safety?.model
    }
  };

  const models = {
    planner: input?.models?.planner || DEFAULT_POLICY.models?.planner,
    writer: input?.models?.writer || DEFAULT_POLICY.models?.writer,
    reviewer: input?.models?.reviewer || DEFAULT_POLICY.models?.reviewer
  };

  const dynamicModelSelection = Boolean(input?.dynamicModelSelection);
  const modelRange = {
    min: input?.modelRange?.min || DEFAULT_POLICY.modelRange?.min,
    max: input?.modelRange?.max || DEFAULT_POLICY.modelRange?.max
  };

  return {
    maxRetries,
    toneStrictness,
    budgetHint,
    alwaysUseLlmJudge,
    hitlEnabled,
    guardrails,
    models,
    dynamicModelSelection,
    modelRange
  };
}

function parseJsonFile(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

export function loadPolicy(repoRoot: string): { policy: Policy; path: string } {
  const policyPath = path.join(repoRoot, "data", "policy.json");
  if (!fs.existsSync(policyPath)) {
    return { policy: DEFAULT_POLICY, path: policyPath };
  }
  try {
    const parsed = parseJsonFile(policyPath) as Partial<Policy>;
    return { policy: normalizePolicy(parsed), path: policyPath };
  } catch {
    return { policy: DEFAULT_POLICY, path: policyPath };
  }
}

export function normalizePolicyInput(input?: Partial<Policy>): Policy {
  return normalizePolicy(input);
}

export function defaultPolicy(): Policy {
  return { ...DEFAULT_POLICY };
}
