import fs from "fs";
import path from "path";
import type { LlmCall, LlmUsage, Policy, RunLog } from "./pipeline/types";

export type BenchmarkRecord = {
  runId: string;
  startedAt: string;
  finishedAt?: string;
  policy: Policy;
  usageTotals: LlmUsage;
  status?: RunLog["status"];
  stopReason?: string;
  retries: number;
  durationsMs: {
    total: number;
    planner: number;
    writer: number;
    reviewer: number;
  };
  llmCalls: LlmCall[];
};

function ensureOutputsDir(repoRoot: string): string {
  const outputsDir = path.join(repoRoot, "data", "outputs");
  fs.mkdirSync(outputsDir, { recursive: true });
  return outputsDir;
}

function sumDurations(calls: LlmCall[], stage: LlmCall["stage"]): number {
  return calls
    .filter((call) => call.stage === stage)
    .reduce((sum, call) => sum + (call.durationMs || 0), 0);
}

function safeUsageTotals(runLog: RunLog): LlmUsage {
  return {
    inputTokens: runLog.usageTotals?.inputTokens ?? 0,
    outputTokens: runLog.usageTotals?.outputTokens ?? 0,
    totalTokens: runLog.usageTotals?.totalTokens ?? 0,
    reasoningTokens: runLog.usageTotals?.reasoningTokens
  };
}

export function buildBenchmarkRecord(runLog: RunLog): BenchmarkRecord {
  const llmCalls = runLog.llmCalls || [];
  const total = llmCalls.reduce((sum, call) => sum + (call.durationMs || 0), 0);
  return {
    runId: runLog.runId,
    startedAt: runLog.startedAt,
    finishedAt: runLog.finishedAt,
    policy: runLog.policy,
    usageTotals: safeUsageTotals(runLog),
    status: runLog.status,
    stopReason: runLog.stopReason,
    retries: runLog.retries ?? 0,
    durationsMs: {
      total,
      planner: sumDurations(llmCalls, "planner"),
      writer: sumDurations(llmCalls, "writer"),
      reviewer: sumDurations(llmCalls, "reviewer")
    },
    llmCalls
  };
}

export function appendBenchmark(repoRoot: string, runLog: RunLog): BenchmarkRecord {
  const outputsDir = ensureOutputsDir(repoRoot);
  const record = buildBenchmarkRecord(runLog);
  const jsonlPath = path.join(outputsDir, "benchmarks.jsonl");
  fs.appendFileSync(jsonlPath, `${JSON.stringify(record)}\n`);
  fs.writeFileSync(
    path.join(outputsDir, "benchmarks-latest.json"),
    JSON.stringify(record, null, 2)
  );
  return record;
}

export function readBenchmarks(repoRoot: string): BenchmarkRecord[] {
  const outputsDir = ensureOutputsDir(repoRoot);
  const jsonlPath = path.join(outputsDir, "benchmarks.jsonl");
  if (!fs.existsSync(jsonlPath)) return [];
  const lines = fs.readFileSync(jsonlPath, "utf8").split(/\r?\n/).filter(Boolean);
  const records: BenchmarkRecord[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as BenchmarkRecord;
      if (parsed && parsed.runId) records.push(parsed);
    } catch {
      // Skip malformed lines.
    }
  }
  return records;
}
