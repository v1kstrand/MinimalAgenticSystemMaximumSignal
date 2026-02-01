import http from "http";
import fs from "fs";
import path from "path";
import { URL } from "url";

import { normalizeInputs } from "../inputs";
import { runGraph, type PipelineState } from "../pipeline/graph";
import { buildCampaignBrief } from "../pipeline/brief";
import { loadPolicy, normalizePolicyInput } from "../policy";
import { runEvalSuite } from "../eval/runner";
import { analyzeDrafts } from "../pipeline/analyst";
import { appendBenchmark, readBenchmarks } from "../benchmark";
import { buildRunBundle, loadRunIndex, saveRunBundle } from "../run_store";
import type { Policy, RunLog, ReviewIssue, ReviewResult, Channel } from "../pipeline/types";

type RunPayload = {
  brief: string;
  brand: string;
  denylist: string;
  policy?: Partial<Policy>;
  outputLabel?: string;
};

type RunResponse = {
  outputs: {
    campaignBrief: string;
    email: string;
    paidSocial: string;
    searchAds: string;
  };
  report: unknown;
  trace: string[];
  runLog: unknown;
  policy: Policy;
};

type EvalResponse = {
  payload: unknown;
};

const PORT = Number(process.env.PORT || process.env.LL_UI_PORT || 8787);
const pendingHitlRuns = new Map<string, { state: PipelineState; outputLabel: string }>();

function findRepoRoot(startDir: string): string {
  const candidate = path.join(startDir, "data");
  if (fs.existsSync(candidate)) return startDir;
  const parent = path.dirname(startDir);
  const parentCandidate = path.join(parent, "data");
  if (fs.existsSync(parentCandidate)) return parent;
  return startDir;
}

function readFileIfExists(filePath: string): string {
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8");
}

function readJsonl(filePath: string): unknown[] {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  const records: unknown[] = [];
  for (const line of lines) {
    try {
      records.push(JSON.parse(line));
    } catch {
      // ignore malformed
    }
  }
  return records;
}

function writeJsonl(filePath: string, records: unknown[]): void {
  const lines = records.map((record) => JSON.stringify(record)).join("\n");
  fs.writeFileSync(filePath, lines ? `${lines}\n` : "");
}

function loadRunBundle(repoRoot: string, runId: string): unknown | null {
  const runPath = path.join(repoRoot, "data", "outputs", "runs", runId, "run.json");
  if (!fs.existsSync(runPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(runPath, "utf8"));
  } catch {
    return null;
  }
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function streamEvent(res: http.ServerResponse, event: string, data: string): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${data}\n\n`);
}

function notFound(res: http.ServerResponse): void {
  res.statusCode = 404;
  res.end("Not Found");
}

function serveFile(res: http.ServerResponse, filePath: string): void {
  if (!fs.existsSync(filePath)) {
    notFound(res);
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const type =
    ext === ".css"
      ? "text/css"
      : ext === ".js"
        ? "application/javascript"
        : "text/html";
  res.statusCode = 200;
  res.setHeader("Content-Type", `${type}; charset=utf-8`);
  res.end(fs.readFileSync(filePath));
}

function ensureOutputsDir(repoRoot: string): string {
  const outputsDir = path.join(repoRoot, "data", "outputs");
  fs.mkdirSync(outputsDir, { recursive: true });
  return outputsDir;
}

function finalizeRun(
  repoRoot: string,
  state: PipelineState,
  outputLabel: string
): RunResponse {
  const outputsDir = ensureOutputsDir(repoRoot);
  const label = outputLabel ? outputLabel.trim() : "";
  const prefix = label ? `${label}.` : "";
  const campaignBrief = buildCampaignBrief(state.research!, state.inputs.brand);
  fs.writeFileSync(path.join(outputsDir, `${prefix}campaign-brief.md`), campaignBrief);
  fs.writeFileSync(path.join(outputsDir, `${prefix}email.md`), state.drafts!["email"]);
  fs.writeFileSync(path.join(outputsDir, `${prefix}paid-social.md`), state.drafts!["paid-social"]);
  fs.writeFileSync(path.join(outputsDir, `${prefix}search-ads.md`), state.drafts!["search-ads"]);
  if (state.report) {
    fs.writeFileSync(
      path.join(outputsDir, "eval-report.json"),
      JSON.stringify(state.report, null, 2)
    );
  }
  fs.writeFileSync(path.join(outputsDir, "graph-trace.json"), JSON.stringify(state.trace, null, 2));
  fs.writeFileSync(path.join(outputsDir, "run-log.json"), JSON.stringify(state.runLog, null, 2));
  appendBenchmark(repoRoot, state.runLog);
  saveRunBundle(
    repoRoot,
    buildRunBundle(state.runLog, state.inputs, state.policy, {
      campaignBrief,
      drafts: {
        email: state.drafts!["email"],
        "paid-social": state.drafts!["paid-social"],
        "search-ads": state.drafts!["search-ads"]
      },
      report: state.report ?? null,
      trace: state.trace
    }, label)
  );

  return {
    outputs: {
      campaignBrief,
      email: state.drafts!["email"],
      paidSocial: state.drafts!["paid-social"],
      searchAds: state.drafts!["search-ads"]
    },
    report: state.report ?? null,
    trace: state.trace,
    runLog: state.runLog,
    policy: state.policy
  };
}

async function handleRun(
  repoRoot: string,
  payload: RunPayload,
  res: http.ServerResponse
): Promise<void> {
  const inputs = normalizeInputs(payload.brief, payload.brand, payload.denylist);
  const { policy: filePolicy } = loadPolicy(repoRoot);
  const policy = normalizePolicyInput(payload.policy ?? filePolicy);
  const state = await runGraph(inputs, { policy });

  if (!state.research || !state.drafts) {
    json(res, 500, { error: "Pipeline did not produce drafts or research summary." });
    return;
  }
  if (state.runLog.status === "needs_approval") {
    pendingHitlRuns.set(state.runLog.runId, {
      state,
      outputLabel: payload.outputLabel || ""
    });
    json(res, 409, { error: "HITL approval required. Use the UI to approve." });
    return;
  }

  const response = finalizeRun(repoRoot, state, payload.outputLabel || "");
  json(res, 200, response);
}

async function handleRunStream(
  repoRoot: string,
  payload: RunPayload,
  res: http.ServerResponse
): Promise<void> {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const inputs = normalizeInputs(payload.brief, payload.brand, payload.denylist);
  const { policy: filePolicy } = loadPolicy(repoRoot);
  const policy = normalizePolicyInput(payload.policy ?? filePolicy);
  const state = await runGraph(inputs, {
    policy,
    onLog: (message, currentState) => {
      currentState.runLog.logs.push({ at: new Date().toISOString(), message });
      streamEvent(res, "log", message);
    },
    onStep: (node) => {
      streamEvent(res, "step", node);
    }
  });

  if (!state.research || !state.drafts) {
    streamEvent(res, "error", "Pipeline did not produce drafts or research summary.");
    res.end();
    return;
  }

  if (state.runLog.status === "needs_approval") {
    pendingHitlRuns.set(state.runLog.runId, {
      state,
      outputLabel: payload.outputLabel || ""
    });
    streamEvent(
      res,
      "hitl_pending",
      JSON.stringify({
        runLog: state.runLog,
        review: state.review,
        drafts: state.drafts,
        outputLabel: payload.outputLabel || ""
      })
    );
    res.end();
    return;
  }

  const response = finalizeRun(repoRoot, state, payload.outputLabel || "");
  streamEvent(res, "complete", JSON.stringify(response));
  res.end();
}

function collectBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5_000_000) {
        reject(new Error("Payload too large."));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const repoRoot = findRepoRoot(process.cwd());
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const publicCandidates = [
    path.join(repoRoot, "lucy_light", "dist", "ui", "public"),
    path.join(repoRoot, "lucy_light", "src", "ui", "public")
  ];
  const publicDir =
    publicCandidates.find((candidate) => fs.existsSync(candidate)) ?? publicCandidates[1];

  if (req.method === "GET" && url.pathname === "/") {
    return serveFile(res, path.join(publicDir, "index.html"));
  }
  if (req.method === "GET" && url.pathname === "/style.css") {
    return serveFile(res, path.join(publicDir, "style.css"));
  }
  if (req.method === "GET" && url.pathname === "/app.js") {
    return serveFile(res, path.join(publicDir, "app.js"));
  }
  if (req.method === "GET" && url.pathname === "/ping") {
    return serveFile(res, path.join(publicDir, "ping.html"));
  }

  if (req.method === "GET" && url.pathname === "/api/eval-ping") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    streamEvent(res, "message", "[ping] stream opened");
    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      streamEvent(res, "message", `[ping] tick ${count}`);
      if (count >= 5) {
        clearInterval(timer);
        res.end();
      }
    }, 1000);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/defaults") {
    const briefPath = path.join(repoRoot, "data", "brief.md");
    const brandPath = path.join(repoRoot, "data", "brand.md");
    const denylistPath = path.join(repoRoot, "data", "do-not-say.txt");
    const { policy } = loadPolicy(repoRoot);
    const baselinesPath = path.join(repoRoot, "data", "eval", "baselines.json");
    const pairwisePromptPath = path.join(repoRoot, "data", "eval", "pairwise_prompt.txt");
    let baselineIds: string[] = [];
    if (fs.existsSync(baselinesPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(baselinesPath, "utf8")) as { baselines?: Array<{ id: string }> };
        baselineIds = (parsed.baselines || []).map((entry) => entry.id).filter(Boolean);
      } catch {
        baselineIds = [];
      }
    }
    return json(res, 200, {
      briefPath,
      brandPath,
      denylistPath,
      policyPath: path.join(repoRoot, "data", "policy.json"),
      baselineIds,
      pairwisePrompt: readFileIfExists(pairwisePromptPath),
      brief: readFileIfExists(briefPath),
      brand: readFileIfExists(brandPath),
      denylist: readFileIfExists(denylistPath),
      policy
    });
  }

  if (req.method === "GET" && url.pathname === "/api/benchmarks") {
    const records = readBenchmarks(repoRoot);
    return json(res, 200, { records });
  }

  if (req.method === "GET" && url.pathname === "/api/runs") {
    const records = loadRunIndex(repoRoot).filter((entry) => entry.outputLabel);
    return json(res, 200, { records });
  }

  if (req.method === "GET" && url.pathname === "/api/runs/detail") {
    const runId = url.searchParams.get("runId");
    if (!runId) return json(res, 400, { error: "runId required" });
    const bundle = loadRunBundle(repoRoot, runId);
    if (!bundle) return json(res, 404, { error: "run not found" });
    return json(res, 200, { bundle });
  }

  if (req.method === "GET" && url.pathname === "/api/eval-runs") {
    const historyPath = path.join(repoRoot, "data", "outputs", "eval-runs.jsonl");
    const records = readJsonl(historyPath);
    return json(res, 200, { records });
  }

  if (req.method === "POST" && url.pathname === "/api/eval-runs/remove") {
    try {
      const raw = await collectBody(req);
      const payload = JSON.parse(raw) as { runIds?: string[] };
      const runIds = Array.isArray(payload.runIds)
        ? payload.runIds.filter((id) => typeof id === "string" && id.length > 0)
        : [];
      if (runIds.length === 0) {
        return json(res, 400, { error: "No eval run IDs provided." });
      }
      const historyPath = path.join(repoRoot, "data", "outputs", "eval-runs.jsonl");
      const records = readJsonl(historyPath) as Array<{ runId?: string }>;
      const keep = records.filter((record) => !record.runId || !runIds.includes(record.runId));
      const removed = records.length - keep.length;
      writeJsonl(historyPath, keep);

      const outputsDir = path.join(repoRoot, "data", "outputs");
      const knownEvalFiles = ["evals.json", "evals.csv", "evals-latest.json"];
      for (const file of knownEvalFiles) {
        const filePath = path.join(outputsDir, file);
        if (fs.existsSync(filePath)) {
          try {
            const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
            if (content && runIds.includes(content.runId)) {
              fs.unlinkSync(filePath);
            }
          } catch {
            // ignore parse errors
          }
        }
      }
      return json(res, 200, { removed });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json(res, 400, { error: message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/hitl/approve") {
    try {
      const raw = await collectBody(req);
      const payload = JSON.parse(raw) as { runId?: string };
      const runId = payload.runId || "";
      const entry = pendingHitlRuns.get(runId);
      if (!entry) {
        return json(res, 404, { error: "Pending HITL run not found." });
      }
      const { state, outputLabel } = entry;
      if (!state.drafts || !state.review) {
        return json(res, 400, { error: "Missing drafts or review for HITL approval." });
      }
      state.report = analyzeDrafts(state.drafts, state.review);
      state.runLog.status = "complete";
      state.runLog.stopReason = undefined;
      state.runLog.finishedAt = new Date().toISOString();
      pendingHitlRuns.delete(runId);
      const response = finalizeRun(repoRoot, state, outputLabel);
      return json(res, 200, { payload: response });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json(res, 400, { error: message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/hitl/reject") {
    try {
      const raw = await collectBody(req);
      const payload = JSON.parse(raw) as { runId?: string; feedback?: string };
      const runId = payload.runId || "";
      const entry = pendingHitlRuns.get(runId);
      if (!entry) {
        return json(res, 404, { error: "Pending HITL run not found." });
      }
      const { state, outputLabel } = entry;
      const feedback = (payload.feedback || "").trim() || "HITL requested changes.";
      const channels: Channel[] = ["email", "paid-social", "search-ads"];
      const issues: ReviewIssue[] = channels.map((channel) => ({
        channel,
        type: "llm",
        message: feedback
      }));
      const humanReview: ReviewResult = {
        pass: false,
        missingFacts: false,
        issues
      };
      const reviewHistory: ReviewResult[] = [...(state.reviewHistory || []), humanReview];
      const runLog: RunLog = {
        ...state.runLog,
        status: "stopped",
        stopReason: undefined,
        finishedAt: undefined
      };
      runLog.reviews.push({
        at: new Date().toISOString(),
        pass: false,
        missingFacts: false,
        issues: humanReview.issues
      });
      runLog.logs.push({
        at: new Date().toISOString(),
        message: `[hitl] feedback: ${feedback}`
      });

      const nextState = await runGraph(state.inputs, {
        policy: state.policy,
        startNode: "planner",
        seedState: {
          reviewHistory,
          runLog,
          policy: state.policy,
          trace: state.trace
        }
      });

      if (nextState.runLog.status === "needs_approval") {
        pendingHitlRuns.set(nextState.runLog.runId, {
          state: nextState,
          outputLabel
        });
        return json(res, 200, {
          hitlPending: true,
          payload: {
            runLog: nextState.runLog,
            review: nextState.review,
            drafts: nextState.drafts,
            outputLabel
          }
        });
      }

      const response = finalizeRun(repoRoot, nextState, outputLabel);
      pendingHitlRuns.delete(runId);
      return json(res, 200, { payload: response });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json(res, 400, { error: message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/run") {
    try {
      const raw = await collectBody(req);
      const payload = JSON.parse(raw) as RunPayload;
      return handleRun(repoRoot, payload, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json(res, 400, { error: message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/run-stream") {
    try {
      const raw = await collectBody(req);
      const payload = JSON.parse(raw) as RunPayload;
      return handleRunStream(repoRoot, payload, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json(res, 400, { error: message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/eval") {
    try {
      const raw = await collectBody(req);
      const payload = JSON.parse(raw) as {
        policy?: Partial<Policy>;
        baselineId?: string;
        useLlmJudge?: boolean;
        alwaysUseLlmJudge?: boolean;
        runId?: string;
        evalLabel?: string;
        evalModel?: string;
        pairwisePrompt?: string;
        pairwiseVotes?: number;
        regressionEnabled?: boolean;
      };
      const { policy: filePolicy } = loadPolicy(repoRoot);
      const policy = normalizePolicyInput(payload.policy ?? filePolicy);
      const alwaysUseLlmJudge =
        payload.alwaysUseLlmJudge ?? policy.alwaysUseLlmJudge;
      const runBundle = payload.runId ? loadRunBundle(repoRoot, payload.runId) : undefined;
      const baselineBundle = payload.baselineId
        ? (() => {
            const baselinesPath = path.join(repoRoot, "data", "eval", "baselines.json");
            if (!fs.existsSync(baselinesPath)) return undefined;
            try {
              const parsed = JSON.parse(fs.readFileSync(baselinesPath, "utf8")) as { baselines?: Array<{ id: string; runId?: string }> };
              const entry = parsed.baselines?.find((item) => item.id === payload.baselineId);
              return entry?.runId ? loadRunBundle(repoRoot, entry.runId) : undefined;
            } catch {
              return undefined;
            }
          })()
        : undefined;
      const result = await runEvalSuite(
        repoRoot,
        policy,
        undefined,
        undefined,
        payload.baselineId,
        payload.useLlmJudge,
        alwaysUseLlmJudge,
        runBundle as never,
        baselineBundle as never,
        payload.pairwisePrompt,
        payload.evalModel,
        payload.pairwiseVotes,
        payload.regressionEnabled,
        payload.evalLabel
      );
      const response: EvalResponse = { payload: result };
      return json(res, 200, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json(res, 400, { error: message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/eval-stream") {
    try {
      const raw = await collectBody(req);
      const payload = JSON.parse(raw) as {
        policy?: Partial<Policy>;
        baselineId?: string;
        useLlmJudge?: boolean;
        alwaysUseLlmJudge?: boolean;
        runId?: string;
        evalLabel?: string;
        evalModel?: string;
        pairwisePrompt?: string;
        pairwiseVotes?: number;
        regressionEnabled?: boolean;
      };
      const { policy: filePolicy } = loadPolicy(repoRoot);
      const policy = normalizePolicyInput(payload.policy ?? filePolicy);
      const alwaysUseLlmJudge =
        payload.alwaysUseLlmJudge ?? policy.alwaysUseLlmJudge;
      const runBundle = payload.runId ? loadRunBundle(repoRoot, payload.runId) : undefined;
      const baselineBundle = payload.baselineId
        ? (() => {
            const baselinesPath = path.join(repoRoot, "data", "eval", "baselines.json");
            if (!fs.existsSync(baselinesPath)) return undefined;
            try {
              const parsed = JSON.parse(fs.readFileSync(baselinesPath, "utf8")) as { baselines?: Array<{ id: string; runId?: string }> };
              const entry = parsed.baselines?.find((item) => item.id === payload.baselineId);
              return entry?.runId ? loadRunBundle(repoRoot, entry.runId) : undefined;
            } catch {
              return undefined;
            }
          })()
        : undefined;

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      streamEvent(res, "log", "[eval] stream opened");
      streamEvent(res, "log", `[eval] payload runId=${payload.runId || "none"} baseline=${payload.baselineId || "none"} llm=${payload.useLlmJudge ? "on" : "off"} force=${alwaysUseLlmJudge ? "on" : "off"} pairwise=${payload.pairwisePrompt ? "on" : "off"}`);

      const heartbeat = setInterval(() => {
        streamEvent(res, "log", "[eval] still running...");
      }, 5000);

      await runEvalSuite(repoRoot, policy, (event) => {
        streamEvent(res, "log", `[eval] event=${event.type}`);
        if (event.type === "case_start") {
          streamEvent(res, "log", `Starting case ${event.caseId} (${event.index}/${event.total})`);
        }
        if (event.type === "case_complete") {
          streamEvent(
            res,
            "log",
            `Completed case ${event.caseId} (${event.index}/${event.total}) score=${event.result.score.toFixed(2)}`
          );
        }
        if (event.type === "complete") {
          streamEvent(res, "log", "Eval suite complete.");
        }
        streamEvent(res, event.type, JSON.stringify(event));
      }, (message) => {
        streamEvent(res, "log", message);
      }, payload.baselineId, payload.useLlmJudge, alwaysUseLlmJudge, runBundle as never, baselineBundle as never, payload.pairwisePrompt, payload.evalModel, payload.pairwiseVotes, payload.regressionEnabled, payload.evalLabel);

      clearInterval(heartbeat);
      res.end();
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json(res, 400, { error: message });
    }
  }

  return notFound(res);
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    json(res, 500, { error: message });
  });
});

server.listen(PORT, () => {
  console.log(`Lucy Light UI running at http://localhost:${PORT}`);
});
