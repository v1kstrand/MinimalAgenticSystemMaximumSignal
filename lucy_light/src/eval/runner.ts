import fs from "fs";
import path from "path";

import { normalizeInputs, findDenylistHits } from "../inputs";
import { loadEnv } from "../llm/env";
import { createChatCompletion } from "../llm/openai";
import { runGraph } from "../pipeline/graph";
import { loadPolicy } from "../policy";
import type { ChannelDrafts, EvalCaseResult, Policy } from "../pipeline/types";
import type { RunBundle } from "../run_store";

type EvalCase = {
  id: string;
  brief: string;
  brand: string;
  denylist: string;
};

type EvalManifest = {
  cases: EvalCase[];
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

export type EvalSuiteResult = {
  generatedAt: string;
  cases: EvalCaseResult[];
  averages: {
    factuality: number;
    denylist: number;
    consistency: number;
    safety: number;
  };
  baselineId?: string;
  regressionEnabled?: boolean;
  gate?: {
    pass: boolean;
    threshold: number;
    deltas: Record<string, number>;
  };
  runId?: string;
  outputLabel?: string;
  policy?: Policy;
  useLlmJudge?: boolean;
  alwaysUseLlmJudge?: boolean;
  evalModel?: string;
  evalLabel?: string;
  pairwise?: {
    mode: "run_vs_baseline";
    votes: number;
  };
  pairwiseSummary?: {
    winRate: number;
    confidence: number;
  };
};

function readFile(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function normalizePath(repoRoot: string, filePath: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.join(repoRoot, filePath);
}

function loadManifest(repoRoot: string): EvalManifest {
  const manifestPath = path.join(repoRoot, "data", "eval", "manifest.json");
  const raw = readFile(manifestPath);
  return JSON.parse(raw) as EvalManifest;
}

function loadBaselines(repoRoot: string): BaselineConfig {
  const baselinePath = path.join(repoRoot, "data", "eval", "baselines.json");
  if (!fs.existsSync(baselinePath)) {
    return { baselines: [] };
  }
  const raw = readFile(baselinePath);
  return JSON.parse(raw) as BaselineConfig;
}

function extractNumbers(text: string): string[] {
  return (text.match(/\d+/g) || []).map((value) => value.trim());
}

function stripListNumbering(text: string): string {
  return text.replace(/^\s*\d+\)\s*/gm, "");
}

function buildAllowedNumbers(briefText: string): Set<string> {
  const set = new Set<string>();
  for (const number of extractNumbers(briefText)) {
    set.add(number);
  }
  return set;
}

function factualityScore(briefText: string, drafts: ChannelDrafts): { score: number; notes: string[] } {
  const allowed = buildAllowedNumbers(briefText);
  const combined = Object.values(drafts).join("\n");
  const sanitized = stripListNumbering(combined);
  const numbers = extractNumbers(sanitized);
  const invalid = numbers.filter((value) => !allowed.has(value));
  if (invalid.length === 0) {
    return { score: 1, notes: [] };
  }
  return {
    score: 0,
    notes: [`Ungrounded numbers: ${Array.from(new Set(invalid)).join(", ")}`]
  };
}

function denylistScore(denylist: string[], drafts: ChannelDrafts): { score: number; notes: string[] } {
  const combined = Object.values(drafts).join("\n");
  const hits = findDenylistHits(combined, denylist);
  if (hits.length === 0) {
    return { score: 1, notes: [] };
  }
  return { score: 0, notes: [`Denylist hits: ${hits.join(", ")}`] };
}

function containsPhrase(text: string, phrase: string): boolean {
  return text.toLowerCase().includes(phrase.toLowerCase());
}

const STOPWORDS = new Set([
  "with",
  "and",
  "for",
  "the",
  "your",
  "from",
  "that",
  "this",
  "into",
  "across",
  "over",
  "under",
  "into",
  "within",
  "using",
  "based",
  "week",
  "weeks",
  "day",
  "days",
  "hour",
  "hours"
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));
}

function containsAnyKeyword(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return false;
  const lowered = text.toLowerCase();
  return keywords.some((keyword) => lowered.includes(keyword));
}

function consistencyScore(
  product: string,
  summary: string,
  valueProps: string[],
  drafts: ChannelDrafts
): { score: number; notes: string[] } {
  const channels = Object.values(drafts);
  const productMatches = channels.filter((draft) => containsPhrase(draft, product)).length;
  const anchorSource = valueProps[0] || summary;
  const anchorKeywords = extractKeywords(anchorSource);
  const anchorMatches = channels.filter((draft) => containsAnyKeyword(draft, anchorKeywords)).length;
  const score = (productMatches + anchorMatches) / (channels.length * 2);
  const notes: string[] = [];
  if (productMatches < channels.length) notes.push("Product name missing in some channels.");
  if (anchorKeywords.length > 0 && anchorMatches < channels.length) {
    notes.push("Anchor keywords missing in some channels.");
  }
  return { score: Number(score.toFixed(2)), notes };
}

function safetyScore(
  reviewIssues: Array<{ type: string; message: string }>
): { score: number; notes: string[] } {
  const safetyIssues = reviewIssues.filter((issue) => issue.type === "safety");
  if (safetyIssues.length === 0) {
    return { score: 1, notes: [] };
  }
  return {
    score: 0,
    notes: safetyIssues.map((issue) => issue.message)
  };
}

function overallScore(scores: EvalCaseResult["scores"]): number {
  const values = Object.values(scores);
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Number(avg.toFixed(2));
}

function renderPairwisePrompt(template: string, brief: string, draftA: string, draftB: string): string {
  return template
    .replace(/{{BRIEF}}/g, brief)
    .replace(/{{DRAFT_A}}/g, draftA)
    .replace(/{{DRAFT_B}}/g, draftB);
}

async function runPairwiseJudge(
  brief: string,
  draftA: string,
  draftB: string,
  model: string,
  apiKey: string,
  template: string
): Promise<{ winner: "A" | "B"; confidence: number }> {
  const systemPrompt = "You are a strict evaluator. Return ONLY JSON.";
  const userPrompt = renderPairwisePrompt(template, brief, draftA, draftB);
  const response = await createChatCompletion(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    { apiKey, model, temperature: 0.2, timeoutMs: 60000 }
  );
  const match = response.text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("Pairwise judge returned no JSON.");
  }
  const parsed = JSON.parse(match[0]) as { winner?: string; confidence?: number };
  const winner = parsed.winner === "B" ? "B" : "A";
  const confidence =
    typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5;
  return { winner, confidence };
}

async function runCase(
  repoRoot: string,
  evalCase: EvalCase,
  policyOverride?: Policy,
  onLog?: (message: string) => void | Promise<void>,
  baseline?: BaselineEntry,
  gateThreshold?: number,
  useLlmJudge?: boolean,
  alwaysUseLlmJudge?: boolean,
  runBundle?: RunBundle,
  baselineBundle?: RunBundle,
  pairwiseTemplate?: string,
  evalModel?: string,
  pairwiseVotes?: number,
  regressionEnabled?: boolean
): Promise<EvalCaseResult> {
  const llmEnabled = Boolean(useLlmJudge || alwaysUseLlmJudge);
  const caseStart = Date.now();
  const briefPath = normalizePath(repoRoot, evalCase.brief);
  const brandPath = normalizePath(repoRoot, evalCase.brand);
  const denylistPath = normalizePath(repoRoot, evalCase.denylist);

  const briefText = runBundle?.inputs?.brief ?? readFile(briefPath);
  const brandText = runBundle?.inputs?.brand ?? readFile(brandPath);
  const denylistText = runBundle ? runBundle.inputs.denylist.join("\n") : readFile(denylistPath);
  const inputs = normalizeInputs(briefText, brandText, denylistText);

  let drafts: ChannelDrafts;
  let reviewIssues: Array<{ type: string; message: string }> = [];
  if (runBundle) {
    drafts = runBundle.outputs.drafts;
    reviewIssues = runBundle.runLog.reviews.at(-1)?.issues ?? [];
  } else {
    const { policy: filePolicy } = loadPolicy(repoRoot);
    const policy = policyOverride ?? filePolicy;
    const graphPath = path.join(repoRoot, "lucy_light", "graph.json");
    const state = await runGraph(inputs, {
      graphPath,
      policy,
      onLog: onLog ? (message) => onLog(`[${evalCase.id}] ${message}`) : undefined
    });

    if (!state.drafts || !state.review) {
      throw new Error(`Case ${evalCase.id} did not produce drafts or review.`);
    }
    drafts = state.drafts;
    reviewIssues = state.review.issues;
  }

  const factuality = factualityScore(briefText, drafts);
  const denylist = denylistScore(inputs.denylist, drafts);
  const consistency = consistencyScore(
    inputs.brief.product,
    inputs.brief.summary,
    inputs.brief.valueProps,
    drafts
  );
  const safety = safetyScore(reviewIssues);

  const scores = {
    factuality: factuality.score,
    denylist: denylist.score,
    consistency: consistency.score,
    safety: safety.score
  };
  const score = overallScore(scores);

  const notes = [
    ...factuality.notes,
    ...denylist.notes,
    ...consistency.notes,
    ...safety.notes
  ];

  const pass = score >= 0.75 && notes.length === 0;
  const result: EvalCaseResult = {
    id: evalCase.id,
    scores,
    pass,
    score,
    notes
  };

  if (baseline && regressionEnabled !== false) {
    const baselineScore = baseline.score;
    const delta = Number((score - baselineScore).toFixed(2));
    result.baselineScore = baselineScore;
    result.delta = delta;
    if (typeof gateThreshold === "number") {
      result.gatePass = delta >= gateThreshold;
    }
  }

  if (llmEnabled) {
    if (!pass && !alwaysUseLlmJudge) {
      result.llmScore = 0;
      result.llmScores = {
        factuality: 0,
        denylist: 0,
        consistency: 0,
        safety: 0
      };
    } else {
      try {
        loadEnv();
        const apiKey = process.env.OPENAI_API_KEY || "";
        if (!apiKey) throw new Error("OPENAI_API_KEY not set.");
        const model =
          evalModel ||
          policyOverride?.models?.reviewer ||
          process.env.OPENAI_EVAL_MODEL ||
          process.env.OPENAI_MODEL ||
          "gpt-3.5-turbo";
        if (onLog) {
          await onLog(`[eval] LLM judge starting (${evalCase.id}) model=${model}`);
        }
        const llmStart = Date.now();
        const systemPrompt =
          "You are a strict evaluator. Return ONLY JSON with keys: factuality, denylist, consistency, safety, score.";
        const userPrompt = [
          "Score each dimension between 0 and 1. Be conservative.",
          "Return JSON: {\"factuality\":0-1,\"denylist\":0-1,\"consistency\":0-1,\"safety\":0-1,\"score\":0-1}",
          "",
          "BRIEF SUMMARY:",
          inputs.brief.summary,
          "",
          "VALUE PROPS:",
          inputs.brief.valueProps.join("; "),
          "",
          "DRAFTS:",
          "[EMAIL]",
          drafts["email"],
          "",
          "[PAID-SOCIAL]",
          drafts["paid-social"],
          "",
          "[SEARCH-ADS]",
          drafts["search-ads"]
        ].join("\n");
        const response = await createChatCompletion(
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          { apiKey, model, temperature: 0.2, timeoutMs: 60000 }
        );
        if (onLog) {
          await onLog(`[eval] LLM judge completed (${evalCase.id}) in ${Date.now() - llmStart}ms`);
        }
        const match = response.text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]) as {
            factuality?: number;
            denylist?: number;
            consistency?: number;
            safety?: number;
            score?: number;
          };
          if (
            typeof parsed.factuality === "number" &&
            typeof parsed.denylist === "number" &&
            typeof parsed.consistency === "number" &&
            typeof parsed.safety === "number"
          ) {
            result.llmScores = {
              factuality: Number(parsed.factuality.toFixed(2)),
              denylist: Number(parsed.denylist.toFixed(2)),
              consistency: Number(parsed.consistency.toFixed(2)),
              safety: Number(parsed.safety.toFixed(2))
            };
          }
          if (typeof parsed.score === "number") {
            result.llmScore = Number(parsed.score.toFixed(2));
          } else if (result.llmScores) {
            const avg =
              (result.llmScores.factuality +
                result.llmScores.denylist +
                result.llmScores.consistency +
                result.llmScores.safety) /
              4;
            result.llmScore = Number(avg.toFixed(2));
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (onLog) {
          await onLog(`[eval] LLM judge failed for ${evalCase.id}: ${message}`);
        }
      }
    }
  }

  if (llmEnabled && result.llmScores) {
    const avg =
      (result.llmScores.factuality +
        result.llmScores.denylist +
        result.llmScores.consistency +
        result.llmScores.safety) /
      4;
    const llmAvg = Number(avg.toFixed(2));
    result.score = llmAvg;
    if (alwaysUseLlmJudge) {
      result.scores = result.llmScores;
      result.pass = result.score >= 0.75;
    }
  }

  if (
    baseline &&
    typeof baseline.llmScore === "number" &&
    typeof result.llmScore === "number" &&
    regressionEnabled !== false
  ) {
    result.baselineLlmScore = baseline.llmScore;
    result.llmDelta = Number((result.llmScore - baseline.llmScore).toFixed(2));
    if (llmEnabled) {
      result.baselineScore = baseline.llmScore;
      result.delta = Number((result.score - baseline.llmScore).toFixed(2));
      if (typeof gateThreshold === "number") {
        result.gatePass = result.delta >= gateThreshold;
      }
    }
  }

  if (pairwiseTemplate && baselineBundle) {
    try {
      loadEnv();
      const apiKey = process.env.OPENAI_API_KEY || "";
      if (!apiKey) throw new Error("OPENAI_API_KEY not set.");
      const model =
        evalModel ||
        policyOverride?.models?.reviewer ||
        process.env.OPENAI_EVAL_MODEL ||
        process.env.OPENAI_MODEL ||
        "gpt-3.5-turbo";
      const votes = Math.max(1, pairwiseVotes || 3);
      let wins = 0;
      let confidenceSum = 0;
      for (let i = 0; i < votes; i += 1) {
        const flip = Math.random() < 0.5;
        const a = flip ? baselineBundle.outputs.drafts : drafts;
        const b = flip ? drafts : baselineBundle.outputs.drafts;
        const resultVote = await runPairwiseJudge(
          inputs.brief.summary,
          `${a["email"]}\n\n${a["paid-social"]}\n\n${a["search-ads"]}`,
          `${b["email"]}\n\n${b["paid-social"]}\n\n${b["search-ads"]}`,
          model,
          apiKey,
          pairwiseTemplate
        );
        const winnerIsRun = (resultVote.winner === "A" && !flip) || (resultVote.winner === "B" && flip);
        if (winnerIsRun) wins += 1;
        confidenceSum += resultVote.confidence;
      }
      result.pairwiseWinRate = Number((wins / votes).toFixed(2));
      result.pairwiseConfidence = Number((confidenceSum / votes).toFixed(2));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (onLog) {
        await onLog(`[eval] Pairwise judge failed for ${evalCase.id}: ${message}`);
      }
    }
  }

  return result;
}

function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function writeCsv(filePath: string, rows: EvalCaseResult[]): void {
  const header = [
    "id",
    "factuality",
    "denylist",
    "consistency",
    "safety",
    "score",
    "pass"
  ];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.scores.factuality.toFixed(2),
        row.scores.denylist.toFixed(2),
        row.scores.consistency.toFixed(2),
        row.scores.safety.toFixed(2),
        row.score.toFixed(2),
        row.pass ? "true" : "false"
      ].join(",")
    );
  }
  fs.writeFileSync(filePath, lines.join("\n"));
}

export type EvalProgressEvent =
  | {
      type: "case_start";
      caseId: string;
      index: number;
      total: number;
    }
  | {
      type: "case_complete";
      caseId: string;
      index: number;
      total: number;
      result: EvalCaseResult;
    }
  | {
      type: "complete";
      payload: EvalSuiteResult;
    };

export async function runEvalSuite(
  repoRoot: string,
  policyOverride?: Policy,
  onProgress?: (event: EvalProgressEvent) => void | Promise<void>,
  onLog?: (message: string) => void | Promise<void>,
  baselineId?: string,
  useLlmJudge?: boolean,
  alwaysUseLlmJudge?: boolean,
  runBundle?: RunBundle,
  baselineBundle?: RunBundle,
  pairwiseTemplate?: string,
  evalModel?: string,
  pairwiseVotes?: number,
  regressionEnabled?: boolean,
  evalLabel?: string
): Promise<EvalSuiteResult> {
  const manifest = loadManifest(repoRoot);
  const baselineConfig = loadBaselines(repoRoot);
  const gateThreshold = baselineConfig.thresholds?.scoreDrop ?? -0.05;
  const outputsDir = path.join(repoRoot, "data", "outputs");
  fs.mkdirSync(outputsDir, { recursive: true });

  const results: EvalCaseResult[] = [];
  const cases = runBundle
    ? [
        {
          id: runBundle.runId,
          brief: "",
          brand: "",
          denylist: ""
        }
      ]
    : manifest.cases;
  const total = cases.length;
  const deltas: Record<string, number> = {};
  for (let index = 0; index < cases.length; index += 1) {
    const evalCase = cases[index];
    if (onProgress) {
      await onProgress({ type: "case_start", caseId: evalCase.id, index: index + 1, total });
    }
    if (onLog) {
      await onLog(`[eval] case ${evalCase.id} starting`);
    }
    const baseline = baselineId
      ? baselineConfig.baselines.find(
          (entry) => entry.id === baselineId && (!runBundle ? entry.caseId === evalCase.id : true)
        )
      : undefined;
    // eslint-disable-next-line no-await-in-loop
    const result = await runCase(
      repoRoot,
      evalCase,
      policyOverride,
      onLog,
      baseline,
      gateThreshold,
      useLlmJudge,
      alwaysUseLlmJudge,
      runBundle,
      baselineBundle,
      pairwiseTemplate,
      evalModel,
      pairwiseVotes,
      regressionEnabled
    );
    if (onLog) {
      await onLog(`[eval] case ${evalCase.id} complete`);
    }
    results.push(result);
    if (typeof result.delta === "number") {
      deltas[result.id] = result.delta;
    }
    if (onProgress) {
      await onProgress({
        type: "case_complete",
        caseId: evalCase.id,
        index: index + 1,
        total,
        result
      });
    }
  }

  let pairwiseSummary: EvalSuiteResult["pairwiseSummary"];
  if (pairwiseTemplate) {
    const withPairwise = results.filter(
      (row) =>
        typeof row.pairwiseWinRate === "number" && typeof row.pairwiseConfidence === "number"
    );
    if (withPairwise.length > 0) {
      const avgWin =
        withPairwise.reduce((sum, row) => sum + (row.pairwiseWinRate || 0), 0) /
        withPairwise.length;
      const avgConf =
        withPairwise.reduce((sum, row) => sum + (row.pairwiseConfidence || 0), 0) /
        withPairwise.length;
      const roundedWin = Number(avgWin.toFixed(2));
      const roundedConf = Number(avgConf.toFixed(2));
      pairwiseSummary = { winRate: roundedWin, confidence: roundedConf };
      for (const row of results) {
        row.pairwiseWinRate = roundedWin;
        row.pairwiseConfidence = roundedConf;
      }
    }
  }

  const averages = {
    factuality: Number(
      (results.reduce((sum, row) => sum + row.scores.factuality, 0) / results.length).toFixed(2)
    ),
    denylist: Number(
      (results.reduce((sum, row) => sum + row.scores.denylist, 0) / results.length).toFixed(2)
    ),
    consistency: Number(
      (results.reduce((sum, row) => sum + row.scores.consistency, 0) / results.length).toFixed(2)
    ),
    safety: Number(
      (results.reduce((sum, row) => sum + row.scores.safety, 0) / results.length).toFixed(2)
    )
  };

  const runId = `eval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const payload: EvalSuiteResult = {
    runId,
    generatedAt: new Date().toISOString(),
    cases: results,
    averages,
    baselineId,
    regressionEnabled: regressionEnabled !== false,
    policy: runBundle?.policy ?? policyOverride,
    useLlmJudge: Boolean(useLlmJudge || alwaysUseLlmJudge),
    alwaysUseLlmJudge: Boolean(alwaysUseLlmJudge),
    evalModel,
    evalLabel,
    outputLabel: runBundle?.outputLabel,
    pairwise: pairwiseTemplate
      ? { mode: "run_vs_baseline", votes: Math.max(1, pairwiseVotes || 3) }
      : undefined,
    pairwiseSummary,
    gate: baselineId && regressionEnabled !== false
      ? {
          pass: results.every(
            (row) => row.gatePass !== false
          ),
          threshold: gateThreshold,
          deltas
        }
      : undefined
  };

  writeJson(path.join(outputsDir, "evals.json"), payload);
  writeCsv(path.join(outputsDir, "evals.csv"), results);
  const historyPath = path.join(outputsDir, "eval-runs.jsonl");
  fs.appendFileSync(historyPath, `${JSON.stringify(payload)}\n`);
  writeJson(path.join(outputsDir, "evals-latest.json"), payload);

  if (onProgress) {
    await onProgress({ type: "complete", payload });
  }

  return payload;
}
