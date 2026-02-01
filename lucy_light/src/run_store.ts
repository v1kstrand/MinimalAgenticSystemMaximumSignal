import fs from "fs";
import path from "path";
import type { InputsBundle } from "./inputs";
import type { Policy, RunLog } from "./pipeline/types";

export type RunBundle = {
  runId: string;
  createdAt: string;
  outputLabel?: string;
  inputs: {
    brief: string;
    brand: string;
    denylist: string[];
  };
  policy: Policy;
  outputs: {
    campaignBrief: string;
    drafts: {
      email: string;
      "paid-social": string;
      "search-ads": string;
    };
    report: unknown | null;
    trace: string[];
  };
  runLog: RunLog;
};

export type RunIndexEntry = {
  runId: string;
  createdAt: string;
  outputLabel?: string;
  policy: Policy;
  status: RunLog["status"];
  stopReason?: string;
  retries: number;
};

function ensureRunsDir(repoRoot: string): string {
  const runsDir = path.join(repoRoot, "data", "outputs", "runs");
  fs.mkdirSync(runsDir, { recursive: true });
  return runsDir;
}

export function saveRunBundle(
  repoRoot: string,
  bundle: RunBundle
): { runPath: string } {
  const runsDir = ensureRunsDir(repoRoot);
  const runDir = path.join(runsDir, bundle.runId);
  fs.mkdirSync(runDir, { recursive: true });
  const runPath = path.join(runDir, "run.json");
  fs.writeFileSync(runPath, JSON.stringify(bundle, null, 2));

  const indexEntry: RunIndexEntry = {
    runId: bundle.runId,
    createdAt: bundle.createdAt,
    outputLabel: bundle.outputLabel,
    policy: bundle.policy,
    status: bundle.runLog.status,
    stopReason: bundle.runLog.stopReason,
    retries: bundle.runLog.retries
  };
  const indexPath = path.join(runsDir, "index.jsonl");
  fs.appendFileSync(indexPath, `${JSON.stringify(indexEntry)}\n`);

  return { runPath };
}

export function loadRunIndex(repoRoot: string): RunIndexEntry[] {
  const runsDir = ensureRunsDir(repoRoot);
  const indexPath = path.join(runsDir, "index.jsonl");
  if (!fs.existsSync(indexPath)) return [];
  const lines = fs.readFileSync(indexPath, "utf8").split(/\r?\n/).filter(Boolean);
  const entries: RunIndexEntry[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as RunIndexEntry;
      if (parsed.runId) entries.push(parsed);
    } catch {
      // skip malformed
    }
  }
  return entries;
}

export function buildRunBundle(
  runLog: RunLog,
  inputs: InputsBundle,
  policy: Policy,
  outputs: {
    campaignBrief: string;
    drafts: {
      email: string;
      "paid-social": string;
      "search-ads": string;
    };
    report: unknown | null;
    trace: string[];
  },
  outputLabel?: string
): RunBundle {
  return {
    runId: runLog.runId,
    createdAt: new Date().toISOString(),
    outputLabel,
    inputs: {
      brief: inputs.brief.raw,
      brand: inputs.brand.raw,
      denylist: inputs.denylist
    },
    policy,
    outputs,
    runLog
  };
}
