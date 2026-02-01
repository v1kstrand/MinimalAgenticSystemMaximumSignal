import fs from "fs";
import path from "path";

import { normalizeInputs } from "../inputs";
import { loadPolicy, normalizePolicyInput } from "../policy";
import { buildCampaignBrief } from "../pipeline/brief";
import { runGraph } from "../pipeline/graph";
import type { Policy } from "../pipeline/types";
import { buildRunBundle, saveRunBundle } from "../run_store";
import { runEvalSuite } from "./runner";

type GoldenSpec = {
  id: string;
  profile: string;
  label: string;
  style: {
    attributes: string[];
    do: string[];
    doNot: string[];
  };
  notes: string;
};

type BaselineEntry = {
  id: string;
  caseId: string;
  profile?: string;
  runId?: string;
  score: number;
  llmScore?: number;
  metrics?: {
    factuality: number;
    denylist: number;
    consistency: number;
    safety: number;
  };
  notes?: string;
};

type BaselineConfig = {
  thresholds?: {
    scoreDrop?: number;
  };
  baselines: BaselineEntry[];
};

function findRepoRoot(startDir: string): string {
  const candidate = path.join(startDir, "data");
  if (fs.existsSync(candidate)) return startDir;
  const parent = path.dirname(startDir);
  const parentCandidate = path.join(parent, "data");
  if (fs.existsSync(parentCandidate)) return parent;
  return startDir;
}

function readFile(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function buildGoldenBrand(baseBrand: string, spec: GoldenSpec): string {
  return [
    baseBrand.trim(),
    "",
    "Golden profile (appended instructions):",
    `Profile: ${spec.id}`,
    "",
    "Voice attributes:",
    ...spec.style.attributes.map((item) => `- ${item}`),
    "",
    "Do:",
    ...spec.style.do.map((item) => `- ${item}`),
    "",
    "Do not:",
    ...spec.style.doNot.map((item) => `- ${item}`)
  ].join("\n");
}

function parseArg(args: string[], name: string): string | undefined {
  const direct = args.find((arg) => arg.startsWith(`--${name}=`));
  if (direct) return direct.split("=", 2)[1];
  const idx = args.findIndex((arg) => arg === `--${name}`);
  if (idx >= 0) return args[idx + 1];
  return undefined;
}

async function generateGolden(spec: GoldenSpec, repoRoot: string, policy: Policy, evalModel: string) {
  const briefPath = path.join(repoRoot, "data", "brief.md");
  const brandPath = path.join(repoRoot, "data", "brand.md");
  const denyPath = path.join(repoRoot, "data", "do-not-say.txt");
  const brief = readFile(briefPath);
  const brand = readFile(brandPath);
  const deny = readFile(denyPath);
  const goldenBrand = buildGoldenBrand(brand, spec);
  const inputs = normalizeInputs(brief, goldenBrand, deny);

  const state = await runGraph(inputs, { policy });
  if (!state.drafts || !state.research) {
    throw new Error(`Golden run failed for ${spec.id}: drafts missing.`);
  }

  const campaignBrief = buildCampaignBrief(state.research, inputs.brand);
  const bundle = buildRunBundle(
    state.runLog,
    inputs,
    policy,
    {
      campaignBrief,
      drafts: {
        email: state.drafts["email"],
        "paid-social": state.drafts["paid-social"],
        "search-ads": state.drafts["search-ads"]
      },
      report: state.report ?? null,
      trace: state.trace
    },
    spec.label
  );
  saveRunBundle(repoRoot, bundle);

  const deterministic = await runEvalSuite(
    repoRoot,
    policy,
    undefined,
    undefined,
    undefined,
    false,
    false,
    bundle,
    undefined,
    undefined,
    undefined,
    undefined,
    false,
    undefined
  );
  const detCase = deterministic.cases[0];

  const llmResult = await runEvalSuite(
    repoRoot,
    policy,
    undefined,
    undefined,
    undefined,
    true,
    true,
    bundle,
    undefined,
    undefined,
    evalModel,
    undefined,
    false,
    undefined
  );
  const llmCase = llmResult.cases[0];

  const baseline: BaselineEntry = {
    id: spec.id,
    caseId: "signalship",
    profile: spec.profile,
    runId: bundle.runId,
    score: detCase.score,
    llmScore: llmCase.llmScore,
    metrics: {
      factuality: detCase.scores.factuality,
      denylist: detCase.scores.denylist,
      consistency: detCase.scores.consistency,
      safety: detCase.scores.safety
    },
    notes: spec.notes
  };

  return baseline;
}

async function main(): Promise<void> {
  const repoRoot = findRepoRoot(process.cwd());
  const args = process.argv.slice(2);
  const modelArg = parseArg(args, "model");
  const evalModelArg = parseArg(args, "eval-model");
  const model = modelArg || process.env.OPENAI_MODEL || "gpt-5.2-codex";
  const evalModel = evalModelArg || process.env.OPENAI_EVAL_MODEL || model;

  process.env.LLM_PLANNER = "true";
  process.env.LLM_WRITER = "true";
  process.env.LLM_REVIEWER = "true";
  if (!process.env.OPENAI_MODEL) {
    process.env.OPENAI_MODEL = model;
  }

  const { policy: filePolicy } = loadPolicy(repoRoot);
  const policy = normalizePolicyInput({
    ...filePolicy,
    dynamicModelSelection: false,
    modelRange: { min: model, max: model },
    models: {
      planner: model,
      writer: model,
      reviewer: model
    }
  });

  const specs: GoldenSpec[] = [
    {
      id: "baseline.executive.signalship",
      profile: "executive",
      label: "golden.executive.signalship",
      style: {
        attributes: ["executive", "confident", "concise", "data-backed"],
        do: [
          "Lead with the core benefit in the first line",
          "Use concrete, grounded proof points",
          "Keep sentences short and decisive"
        ],
        doNot: ["Use slang", "Overpromise", "Use excessive punctuation"]
      },
      notes: "Executive golden baseline for SignalShip. Crisp, outcomes-focused tone."
    },
    {
      id: "baseline.playful.signalship",
      profile: "playful",
      label: "golden.playful.signalship",
      style: {
        attributes: ["playful", "approachable", "energetic", "concise"],
        do: [
          "Use light, friendly phrasing",
          "Keep copy skimmable",
          "Stay grounded in provided facts"
        ],
        doNot: ["Use heavy jargon", "Invent numbers", "Use sarcasm"]
      },
      notes: "Playful golden baseline for SignalShip. Friendly, upbeat tone."
    }
  ];

  const baselines: BaselineEntry[] = [];
  for (const spec of specs) {
    // eslint-disable-next-line no-await-in-loop
    const baseline = await generateGolden(spec, repoRoot, policy, evalModel);
    baselines.push(baseline);
  }

  const config: BaselineConfig = {
    thresholds: {
      scoreDrop: -0.05
    },
    baselines
  };

  const outPath = path.join(repoRoot, "data", "eval", "baselines.json");
  fs.writeFileSync(outPath, JSON.stringify(config, null, 2));
  console.log(`Golden baselines generated: ${baselines.map((b) => b.id).join(", ")}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
