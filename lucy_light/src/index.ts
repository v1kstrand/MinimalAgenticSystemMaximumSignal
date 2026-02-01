#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { assertNoDenylist, normalizeInputs } from "./inputs";
import { runGraph } from "./pipeline/graph";
import { buildCampaignBrief } from "./pipeline/brief";
import { loadPolicy } from "./policy";
import { appendBenchmark } from "./benchmark";
import { buildRunBundle, saveRunBundle } from "./run_store";

const HELP_TEXT = `Lucy Light CLI

Usage:
  lucy-light --brief <path> --brand <path> --denylist <path>

Options:
  --brief     Path to product/marketing brief (default: data/brief.md)
  --brand     Path to brand voice guidelines (default: data/brand.md)
  --denylist  Path to banned phrases list (default: data/do-not-say.txt)
  --label     Output filename prefix (optional)
  --help      Show this help
`;

type CliArgs = {
  briefPath: string;
  brandPath: string;
  denylistPath: string;
  outputLabel?: string;
};

function findRepoRoot(startDir: string): string {
  const candidate = path.join(startDir, "data");
  if (fs.existsSync(candidate)) {
    return startDir;
  }
  const parent = path.dirname(startDir);
  const parentCandidate = path.join(parent, "data");
  if (fs.existsSync(parentCandidate)) {
    return parent;
  }
  return startDir;
}

function resolveDefaultPath(repoRoot: string, relPath: string): string {
  return path.join(repoRoot, relPath);
}

function parseArgs(argv: string[], repoRoot: string): CliArgs {
  const defaults = {
    briefPath: resolveDefaultPath(repoRoot, "data/brief.md"),
    brandPath: resolveDefaultPath(repoRoot, "data/brand.md"),
    denylistPath: resolveDefaultPath(repoRoot, "data/do-not-say.txt"),
    outputLabel: undefined as string | undefined
  };

  const args = [...argv];
  while (args.length > 0) {
    const current = args.shift();
    if (!current) continue;
    if (current === "--help") {
      console.log(HELP_TEXT);
      process.exit(0);
    }
    if (current === "--brief") {
      const next = args.shift();
      if (!next) throw new Error("--brief requires a path");
      defaults.briefPath = next;
      continue;
    }
    if (current === "--brand") {
      const next = args.shift();
      if (!next) throw new Error("--brand requires a path");
      defaults.brandPath = next;
      continue;
    }
    if (current === "--denylist") {
      const next = args.shift();
      if (!next) throw new Error("--denylist requires a path");
      defaults.denylistPath = next;
      continue;
    }
    if (current === "--label") {
      const next = args.shift();
      if (!next) throw new Error("--label requires a value");
      defaults.outputLabel = next;
      continue;
    }
    throw new Error(`Unknown argument: ${current}`);
  }

  return defaults;
}

function readRequiredFile(filePath: string, label: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found at ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function ensureOutputsDir(repoRoot: string): string {
  const outputsDir = path.join(repoRoot, "data", "outputs");
  fs.mkdirSync(outputsDir, { recursive: true });
  return outputsDir;
}

async function main(): Promise<void> {
  const repoRoot = findRepoRoot(process.cwd());
  const args = parseArgs(process.argv.slice(2), repoRoot);

  const briefContents = readRequiredFile(args.briefPath, "Brief");
  const brandContents = readRequiredFile(args.brandPath, "Brand");
  const denylistContents = readRequiredFile(args.denylistPath, "Denylist");

  const inputs = normalizeInputs(briefContents, brandContents, denylistContents);
  assertNoDenylist([inputs.brief.raw, inputs.brand.raw], inputs.denylist);

  const outputsDir = ensureOutputsDir(repoRoot);
  const graphPath = path.resolve(__dirname, "..", "graph.json");
  const { policy } = loadPolicy(repoRoot);
  const state = await runGraph(inputs, { graphPath, policy });

  if (!state.research || !state.drafts) {
    throw new Error("Pipeline did not produce drafts or research summary.");
  }

  const campaignBrief = buildCampaignBrief(state.research, inputs.brand);
  const label = args.outputLabel ? args.outputLabel.trim() : "";
  const prefix = label ? `${label}.` : "";
  fs.writeFileSync(path.join(outputsDir, `${prefix}campaign-brief.md`), campaignBrief);
  fs.writeFileSync(path.join(outputsDir, `${prefix}email.md`), state.drafts["email"]);
  fs.writeFileSync(path.join(outputsDir, `${prefix}paid-social.md`), state.drafts["paid-social"]);
  fs.writeFileSync(path.join(outputsDir, `${prefix}search-ads.md`), state.drafts["search-ads"]);

  if (state.report) {
    fs.writeFileSync(path.join(outputsDir, "eval-report.json"), JSON.stringify(state.report, null, 2));
  }
  fs.writeFileSync(path.join(outputsDir, "graph-trace.json"), JSON.stringify(state.trace, null, 2));
  fs.writeFileSync(path.join(outputsDir, "run-log.json"), JSON.stringify(state.runLog, null, 2));
  appendBenchmark(repoRoot, state.runLog);
  saveRunBundle(
    repoRoot,
    buildRunBundle(state.runLog, inputs, state.runLog.policy, {
      campaignBrief,
      drafts: {
        email: state.drafts["email"],
        "paid-social": state.drafts["paid-social"],
        "search-ads": state.drafts["search-ads"]
      },
      report: state.report ?? null,
      trace: state.trace
    }, label)
  );

  console.log(
    `Pipeline complete. Outputs ready at ${outputsDir}. Parsed: ${inputs.brief.product || "unknown"}`
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
