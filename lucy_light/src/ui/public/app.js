const tabs = Array.from(document.querySelectorAll(".tab"));
const panels = Array.from(document.querySelectorAll(".panel"));

const briefEl = document.getElementById("brief");
const brandEl = document.getElementById("brand");
const denylistEl = document.getElementById("denylist");
const statusEl = document.getElementById("status");
const pathsEl = document.getElementById("paths");
const traceEl = document.getElementById("trace");
const logEl = document.getElementById("log");
const policyMaxRetriesEl = document.getElementById("policy-max-retries");
const policyToneEl = document.getElementById("policy-tone");
const policyBudgetEl = document.getElementById("policy-budget");
const policyDynamicModelsEl = document.getElementById("policy-dynamic-models");
const policyModelMinEl = document.getElementById("policy-model-min");
const policyModelMaxEl = document.getElementById("policy-model-max");
const policyModelPlannerEl = document.getElementById("policy-model-planner");
const policyModelWriterEl = document.getElementById("policy-model-writer");
const policyModelReviewerEl = document.getElementById("policy-model-reviewer");
const policyHitlEl = document.getElementById("policy-hitl");
const policyGuardPiiEl = document.getElementById("policy-guard-pii");
const policyGuardSafetyEl = document.getElementById("policy-guard-safety");
const policyGuardModelEl = document.getElementById("policy-guard-model");
const evalStatusEl = document.getElementById("eval-status");
const evalAveragesEl = document.getElementById("eval-averages");
const evalTableBody = document.querySelector("#eval-table tbody");
const evalProgressTextEl = document.getElementById("eval-progress-text");
const evalProgressListEl = document.getElementById("eval-progress-list");
const evalProgressPanelEl = document.getElementById("eval-progress-panel");
const includeEvalEl = document.getElementById("include-eval");
const evalLogEl = document.getElementById("eval-log");
const evalBaselineEl = document.getElementById("eval-baseline");
const evalRunListEl = document.getElementById("eval-run-list");
const evalRunMetaEl = document.getElementById("eval-run-meta");
const evalRunTargetListEl = document.getElementById("eval-run-target-list");
const evalRunTargetMetaEl = document.getElementById("eval-run-target-meta");
const evalModelEl = document.getElementById("eval-model");
const evalRegressionEl = document.getElementById("eval-regression");
const evalPairwiseEl = document.getElementById("eval-pairwise");
const evalPairwisePromptEl = document.getElementById("eval-pairwise-prompt");
const evalPairwiseFileEl = document.getElementById("eval-pairwise-file");
const evalPairwiseEditorEl = document.getElementById("eval-pairwise-editor");
const evalPairwiseEditEl = document.getElementById("eval-pairwise-edit");
const evalPairwiseSectionEl = document.querySelector(".eval-pairwise");
const evalLabelEl = document.getElementById("eval-label");
const outputLabelEl = document.getElementById("output-label");
const hitlPanelEl = document.getElementById("hitl-panel");
const hitlStatusEl = document.getElementById("hitl-status");
const hitlIssuesEl = document.getElementById("hitl-issues");
const hitlFeedbackEl = document.getElementById("hitl-feedback");
const hitlApproveEl = document.getElementById("hitl-approve");
const hitlRejectEl = document.getElementById("hitl-reject");
const hitlTabs = Array.from(document.querySelectorAll(".hitl-tab"));
const hitlDraftEls = Array.from(document.querySelectorAll(".hitl-draft"));
const evalIncludeFailedEl = document.getElementById("eval-include-failed");
const benchIncludeFailedEl = document.getElementById("bench-include-failed");
const benchmarkStatusEl = document.getElementById("benchmark-status");
const benchmarkLatestEl = document.getElementById("benchmark-latest");
const benchmarkCardsEl = document.getElementById("benchmark-cards");
const benchmarkBarsEl = document.getElementById("benchmark-bars");
const benchmarkListEl = document.getElementById("benchmark-list");
const benchmarkCompareBarsEl = document.getElementById("benchmark-compare-bars");
const benchmarkTableBody = document.querySelector("#benchmark-table tbody");

const outputs = {
  campaignBrief: document.getElementById("campaign-brief"),
  email: document.getElementById("email"),
  paidSocial: document.getElementById("paid-social"),
  searchAds: document.getElementById("search-ads"),
  report: document.getElementById("report"),
  runLog: document.getElementById("run-log")
};

let lastTrace = [];
let evalRunning = false;
let defaultPairwisePrompt = "";
let pendingHitlRunId = "";

function setStatus(text) {
  statusEl.textContent = text;
}

function switchHitlTab(channel) {
  hitlTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.hitl === channel);
  });
  hitlDraftEls.forEach((draft) => {
    draft.classList.toggle("active", draft.dataset.hitl === channel);
  });
}

function setHitlDrafts(drafts) {
  hitlDraftEls.forEach((draft) => {
    const key = draft.dataset.hitl;
    draft.textContent = drafts?.[key] || "";
  });
  switchHitlTab("email");
}

function showHitlPanel(payload) {
  pendingHitlRunId = payload.runLog?.runId || payload.runId || "";
  if (!hitlPanelEl) return;
  const issues = payload.review?.issues || [];
  const lines = issues.length
    ? issues.map((issue) => `- [${issue.channel}][${issue.type}] ${issue.message}`).join("\n")
    : "No issues reported.";
  hitlIssuesEl.textContent = lines;
  hitlStatusEl.textContent = `Awaiting approval for ${pendingHitlRunId}`;
  setHitlDrafts(payload.drafts || {});
  hitlPanelEl.classList.remove("inactive");
  selectTab("graph");
}

function hideHitlPanel() {
  pendingHitlRunId = "";
  if (!hitlPanelEl) return;
  hitlPanelEl.classList.add("inactive");
  hitlStatusEl.textContent = "";
  hitlIssuesEl.textContent = "";
  setHitlDrafts({});
  if (hitlFeedbackEl) hitlFeedbackEl.value = "";
}

function syncDynamicModelUI() {
  const enabled = policyDynamicModelsEl.checked;
  policyModelWriterEl.disabled = enabled;
  policyModelMinEl.disabled = !enabled;
  policyModelMaxEl.disabled = !enabled;
  const range = document.getElementById("policy-model-range");
  if (range) {
    range.classList.toggle("hidden", !enabled);
  }
}

function syncPairwiseUI() {
  const enabled = Boolean(evalPairwiseEl.checked);
  evalPairwiseEditEl.disabled = !enabled;
  if (evalPairwiseSectionEl) {
    evalPairwiseSectionEl.classList.toggle("hidden", !enabled);
  }
  if (!enabled) {
    evalPairwiseEditorEl.classList.remove("active");
  }
}

function syncPolicyToggles() {
  document.querySelectorAll(".policy-toggle").forEach((button) => {
    const targetId = button.getAttribute("data-target");
    if (!targetId) return;
    const target = document.getElementById(targetId);
    if (!target) return;
    const label = button.getAttribute("data-label") || "Advanced";
    const labelOpen = button.getAttribute("data-label-open") || "Hide";
    button.textContent = target.classList.contains("hidden") ? label : labelOpen;
  });
}

function selectTab(name) {
  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
  panels.forEach((panel) => panel.classList.toggle("active", panel.id === name));
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => selectTab(tab.dataset.tab));
});

document.querySelectorAll(".policy-toggle").forEach((button) => {
  button.addEventListener("click", () => {
    const targetId = button.getAttribute("data-target");
    if (!targetId) return;
    const target = document.getElementById(targetId);
    if (!target) return;
    target.classList.toggle("hidden");
    syncPolicyToggles();
  });
});

async function loadDefaults() {
  setStatus("Loading defaults...");
  const res = await fetch("/api/defaults");
  const data = await res.json();
  briefEl.value = data.brief || "";
  brandEl.value = data.brand || "";
  denylistEl.value = data.denylist || "";
  policyMaxRetriesEl.value = data.policy?.maxRetries ?? 2;
  policyToneEl.value = data.policy?.toneStrictness ?? "medium";
  policyBudgetEl.value = data.policy?.budgetHint ?? "low";
  policyDynamicModelsEl.checked = Boolean(data.policy?.dynamicModelSelection);
  policyHitlEl.checked = Boolean(data.policy?.hitlEnabled);
  policyGuardPiiEl.value = data.policy?.guardrails?.pii?.mode ?? "warn";
  policyGuardSafetyEl.value = data.policy?.guardrails?.safety?.mode ?? "warn";
  policyGuardModelEl.value = data.policy?.guardrails?.safety?.model ?? "gpt-4.1-mini";
  policyModelMinEl.value = data.policy?.modelRange?.min ?? "gpt-4o-mini";
  policyModelMaxEl.value = data.policy?.modelRange?.max ?? "gpt-4o-mini";
  policyModelPlannerEl.value = data.policy?.models?.planner ?? "gpt-4o-mini";
  policyModelWriterEl.value = data.policy?.models?.writer ?? "gpt-4o-mini";
  policyModelReviewerEl.value = data.policy?.models?.reviewer ?? "gpt-4o-mini";
  syncDynamicModelUI();
  syncPolicyToggles();
  const baselineIds = Array.isArray(data.baselineIds) ? data.baselineIds : [];
  evalBaselineEl.innerHTML = "";
  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "none";
  evalBaselineEl.appendChild(emptyOption);
  for (const id of baselineIds) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id;
    evalBaselineEl.appendChild(option);
  }
  if (data.pairwisePrompt) {
    evalPairwisePromptEl.value = data.pairwisePrompt;
    defaultPairwisePrompt = data.pairwisePrompt;
  }
  evalRegressionEl.checked = true;
  evalPairwiseEl.checked = false;
  syncPairwiseUI();
  pathsEl.textContent = `Brief: ${data.briefPath} | Brand: ${data.brandPath} | Denylist: ${data.denylistPath} | Policy: ${data.policyPath}`;
  setStatus("Defaults loaded.");
}


function renderOutputs(data) {
  outputs.campaignBrief.textContent = data.outputs.campaignBrief || "";
  outputs.email.textContent = data.outputs.email || "";
  outputs.paidSocial.textContent = data.outputs.paidSocial || "";
  outputs.searchAds.textContent = data.outputs.searchAds || "";
  outputs.report.textContent = JSON.stringify(data.report, null, 2);
  outputs.runLog.textContent = JSON.stringify(data.runLog, null, 2);
  traceEl.textContent = JSON.stringify(data.trace, null, 2);
  lastTrace = data.trace || [];
  if (data.runLog?.logs) {
    const lines = data.runLog.logs.map((entry) => `[${entry.at}] ${entry.message}`);
    logEl.textContent = lines.join("\n");
  }
}

function renderEval(payload) {
  if (evalAveragesEl) {
    evalAveragesEl.textContent = "";
  }
  evalTableBody.innerHTML = "";
  for (const row of payload.cases) {
    const tr = document.createElement("tr");
    tr.className = row.pass ? "pass" : "fail";
    const useLlm = Boolean(payload.useLlmJudge) && row.llmScores;
    const scores = useLlm ? row.llmScores : row.scores;
    const runLabelBase = payload.outputLabel || payload.runId || "-";
    const runLabel = payload.evalLabel ? `${runLabelBase} \u2022 ${payload.evalLabel}` : runLabelBase;
    tr.innerHTML = `
      <td>${runLabel}</td>
      <td>${row.id}</td>
      <td>${scores.factuality.toFixed(2)}</td>
      <td>${scores.denylist.toFixed(2)}</td>
      <td>${scores.consistency.toFixed(2)}</td>
      <td>${scores.safety.toFixed(2)}</td>
      <td>${typeof row.pairwiseWinRate === "number" ? row.pairwiseWinRate.toFixed(2) : "-"}</td>
      <td>${typeof row.pairwiseConfidence === "number" ? row.pairwiseConfidence.toFixed(2) : "-"}</td>
      <td>${typeof row.delta === "number" ? row.delta.toFixed(2) : "-"}</td>
      <td>${row.score.toFixed(2)}</td>
      <td>${row.pass ? "PASS" : "FAIL"}</td>
    `;
    evalTableBody.appendChild(tr);
  }
  setRowOrder(Array.from(evalTableBody.querySelectorAll("tr")));
  updateEvalSortIndicators();
}

function renderEvalHistory(records) {
  evalRunListEl.innerHTML = "";
  if (!Array.isArray(records)) return;
  const sorted = [...records].sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1));
  for (const record of sorted) {
    const item = document.createElement("label");
    item.className = "compare-item";
    const labelBase = record.outputLabel || record.runId;
    const label = record.evalLabel ? `${labelBase} \u2022 ${record.evalLabel}` : labelBase;
    item.innerHTML = `<input type="checkbox" name="eval-run" value="${record.runId}"/><span>${label}</span>`;
    evalRunListEl.appendChild(item);
  }
  evalRunListEl.dataset.records = JSON.stringify(sorted);
}

let evalSort = { key: "score", dir: "desc" };

function setRowOrder(rows) {
  rows.forEach((row, index) => {
    row.dataset.order = String(index);
  });
}

function updateEvalSortIndicators() {
  document.querySelectorAll("#eval-table th[data-sort]").forEach((th) => {
    const key = th.getAttribute("data-sort");
    if (!key) return;
    if (evalSort.key === key) {
      th.dataset.sortState = evalSort.dir;
    } else {
      th.dataset.sortState = "none";
    }
  });
}

function sortEvalTableBy(key) {
  const tbody = evalTableBody;
  const rows = Array.from(tbody.querySelectorAll("tr"));
  if (evalSort.dir === "none") {
    rows.sort((a, b) => {
      const ao = Number(a.dataset.order || 0);
      const bo = Number(b.dataset.order || 0);
      return ao - bo;
    });
    tbody.innerHTML = "";
    for (const row of rows) tbody.appendChild(row);
    updateEvalSortIndicators();
    return;
  }
  const getValue = (row) => {
    const cells = row.querySelectorAll("td");
    const map = {
      runId: 0,
      case: 1,
      factuality: 2,
      denylist: 3,
      consistency: 4,
      safety: 5,
      pairwiseWin: 6,
      pairwiseConf: 7,
      delta: 8,
      score: 9,
      pass: 10
    };
    const idx = map[key];
    if (idx === undefined) return "";
    return cells[idx]?.textContent || "";
  };
  rows.sort((a, b) => {
    const av = getValue(a);
    const bv = getValue(b);
    const an = Number(av);
    const bn = Number(bv);
    let cmp = 0;
    if (!Number.isNaN(an) && !Number.isNaN(bn)) {
      cmp = an - bn;
    } else {
      cmp = av.localeCompare(bv);
    }
    return evalSort.dir === "asc" ? cmp : -cmp;
  });
  tbody.innerHTML = "";
  for (const row of rows) tbody.appendChild(row);
  updateEvalSortIndicators();
}

document.querySelectorAll("#eval-table th[data-sort]").forEach((th) => {
  th.addEventListener("click", () => {
    const key = th.getAttribute("data-sort");
    if (!key) return;
    if (evalSort.key !== key) {
      evalSort = { key, dir: "asc" };
    } else if (evalSort.dir === "asc") {
      evalSort = { key, dir: "desc" };
    } else if (evalSort.dir === "desc") {
      evalSort = { key, dir: "none" };
    } else {
      evalSort = { key, dir: "asc" };
    }
    sortEvalTableBy(key);
  });
});

function showSelectedEvalRun() {
  const raw = evalRunListEl.dataset.records;
  if (!raw) return;
  const records = JSON.parse(raw);
  const selectedIds = Array.from(evalRunListEl.querySelectorAll("input:checked")).map(
    (input) => input.value
  );
  const selected = records.filter((item) => selectedIds.includes(item.runId));
  if (selected.length === 0) return;
  evalTableBody.innerHTML = "";
  for (const record of selected) {
    for (const row of record.cases || []) {
      const tr = document.createElement("tr");
      tr.className = row.pass ? "pass" : "fail";
      const useLlm = Boolean(record.useLlmJudge) && row.llmScores;
      const scores = useLlm ? row.llmScores : row.scores;
      const runLabelBase = record.outputLabel || record.runId || "-";
      const runLabel = record.evalLabel ? `${runLabelBase} \u2022 ${record.evalLabel}` : runLabelBase;
      tr.innerHTML = `
        <td>${runLabel}</td>
        <td>${row.id}</td>
        <td>${scores.factuality.toFixed(2)}</td>
        <td>${scores.denylist.toFixed(2)}</td>
        <td>${scores.consistency.toFixed(2)}</td>
        <td>${scores.safety.toFixed(2)}</td>
        <td>${typeof row.pairwiseWinRate === "number" ? row.pairwiseWinRate.toFixed(2) : "-"}</td>
        <td>${typeof row.pairwiseConfidence === "number" ? row.pairwiseConfidence.toFixed(2) : "-"}</td>
        <td>${typeof row.delta === "number" ? row.delta.toFixed(2) : "-"}</td>
        <td>${row.score.toFixed(2)}</td>
        <td>${row.pass ? "PASS" : "FAIL"}</td>
      `;
      evalTableBody.appendChild(tr);
    }
  }
  setRowOrder(Array.from(evalTableBody.querySelectorAll("tr")));
  updateEvalSortIndicators();
  evalRunMetaEl.textContent = `Selected ${selected.length} eval runs.`;
  selectTab("eval");
}

async function removeSelectedEvalRuns() {
  const raw = evalRunListEl.dataset.records;
  if (!raw) return;
  const records = JSON.parse(raw);
  const selectedIds = Array.from(evalRunListEl.querySelectorAll("input:checked")).map(
    (input) => input.value
  );
  if (selectedIds.length === 0) {
    evalRunMetaEl.textContent = "Select at least one eval run to remove.";
    return;
  }
  const labels = records
    .filter((item) => selectedIds.includes(item.runId))
    .map((item) => item.outputLabel || item.runId);
  const confirmText = `Remove ${selectedIds.length} eval run(s)?\n\n${labels.join("\n")}\n\nThis cannot be undone.`;
  if (!window.confirm(confirmText)) return;

  const res = await fetch("/api/eval-runs/remove", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runIds: selectedIds })
  });
  if (!res.ok) {
    const data = await res.json();
    evalRunMetaEl.textContent = `Remove failed: ${data.error || "Unknown error"}`;
    return;
  }
  const data = await res.json();
  evalRunMetaEl.textContent = `Removed ${data.removed || 0} eval run(s).`;
  evalTableBody.innerHTML = "";
  await loadEvalRuns();
}

async function loadEvalRuns() {
  const res = await fetch("/api/eval-runs");
  if (!res.ok) {
    evalRunMetaEl.textContent = "Failed to load eval history.";
    return;
  }
  const data = await res.json();
  renderEvalHistory(data.records || []);
  evalRunMetaEl.textContent = `Loaded ${data.records?.length || 0} eval runs.`;
}

async function loadRunTargets() {
  const res = await fetch("/api/runs");
  if (!res.ok) {
    evalRunTargetMetaEl.textContent = "Failed to load runs.";
    return;
  }
  const data = await res.json();
  const records = Array.isArray(data.records) ? data.records : [];
  const filtered = evalIncludeFailedEl?.checked
    ? records
    : records.filter((record) => record.status === "complete");
  const sorted = [...filtered]
    .filter((record) => !String(record.outputLabel || "").startsWith("golden."))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  evalRunTargetListEl.innerHTML = "";
  for (const record of sorted) {
    const item = document.createElement("label");
    item.className = "compare-item";
    const label = record.outputLabel || record.runId;
    const suffix =
      record.status === "complete"
        ? ""
        : ` (${record.status}${record.stopReason ? `: ${record.stopReason}` : ""})`;
    item.innerHTML = `<input type="radio" name="run-target" value="${record.runId}"/><span>${label}${suffix}</span>`;
    evalRunTargetListEl.appendChild(item);
  }
  evalRunTargetListEl.dataset.records = JSON.stringify(sorted);
  evalRunTargetMetaEl.textContent = `Loaded ${records.length} pipeline runs.`;
}

function renderBenchmarks(records) {
  if (!Array.isArray(records)) return;
  benchmarkTableBody.innerHTML = "";
  const filtered = benchIncludeFailedEl?.checked
    ? records
    : records.filter((record) => record.status === "complete");
  const sorted = [...filtered].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  const latest = sorted[0];
  const allTotals = sorted.map((record) => record.usageTotals || {});
  const allDurations = sorted.map((record) => record.durationsMs || {});
  const maxTotals = {
    totalTokens: Math.max(...allTotals.map((t) => Number(t.totalTokens ?? 0)), 1),
    inputTokens: Math.max(...allTotals.map((t) => Number(t.inputTokens ?? 0)), 1),
    outputTokens: Math.max(...allTotals.map((t) => Number(t.outputTokens ?? 0)), 1),
    reasoningTokens: Math.max(...allTotals.map((t) => Number(t.reasoningTokens ?? 0)), 1)
  };
  const maxDurations = {
    total: Math.max(...allDurations.map((d) => Number(d.total ?? 0)), 1)
  };
  benchmarkLatestEl.textContent = latest ? JSON.stringify(latest, null, 2) : "";
  benchmarkCardsEl.innerHTML = "";
  benchmarkBarsEl.innerHTML = "";
  benchmarkCompareBarsEl.innerHTML = "";
  if (latest) {
    const totals = latest.usageTotals || {};
    const durations = latest.durationsMs || {};
    const models = latest.policy?.models || {};
    const cards = [
      { title: "Total Tokens", value: totals.totalTokens ?? 0 },
      { title: "Input Tokens", value: totals.inputTokens ?? 0 },
      { title: "Output Tokens", value: totals.outputTokens ?? 0 },
      { title: "Reasoning", value: totals.reasoningTokens ?? 0 },
      { title: "Total ms", value: durations.total ?? 0 },
      { title: "Planner", value: models.planner || "-" },
      { title: "Writer", value: models.writer || "-" },
      { title: "Reviewer", value: models.reviewer || "-" }
    ];
    for (const card of cards) {
      const div = document.createElement("div");
      div.className = "benchmark-card";
      div.innerHTML = `<h4>${card.title}</h4><div class="value">${card.value}</div>`;
      benchmarkCardsEl.appendChild(div);
    }

    const barMetrics = [
      { label: "Total tokens", value: Number(totals.totalTokens ?? 0), max: maxTotals.totalTokens },
      { label: "Input tokens", value: Number(totals.inputTokens ?? 0), max: maxTotals.inputTokens },
      { label: "Output tokens", value: Number(totals.outputTokens ?? 0), max: maxTotals.outputTokens },
      { label: "Reasoning", value: Number(totals.reasoningTokens ?? 0), max: maxTotals.reasoningTokens },
      { label: "Total ms", value: Number(durations.total ?? 0), max: maxDurations.total }
    ];
    for (const metric of barMetrics) {
      const row = document.createElement("div");
      row.className = "bar-row";
      row.innerHTML = `
        <div>${metric.label}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.round(
          (metric.value / metric.max) * 100
        )}%"></div></div>
        <div class="bar-value">${metric.value}</div>
      `;
      benchmarkBarsEl.appendChild(row);
    }
  }

  benchmarkListEl.innerHTML = "";
  for (const record of sorted) {
    const item = document.createElement("label");
    item.className = "compare-item";
    item.innerHTML = `<input type="checkbox" value="${record.runId}"/><span>${record.runId}</span>`;
    benchmarkListEl.appendChild(item);
  }
  benchmarkListEl.dataset.records = JSON.stringify(sorted);

  for (const record of sorted) {
    const tr = document.createElement("tr");
    const policy = record.policy || {};
    const models = policy.models || {};
    const totals = record.usageTotals || {};
    const durations = record.durationsMs || {};
    tr.innerHTML = `
      <td>${record.runId}</td>
      <td>${models.planner || "-"}</td>
      <td>${models.writer || "-"}</td>
      <td>${models.reviewer || "-"}</td>
      <td>${totals.totalTokens ?? 0}</td>
      <td>${totals.reasoningTokens ?? 0}</td>
      <td>${durations.total ?? 0}</td>
      <td>${record.retries ?? 0}</td>
    `;
    benchmarkTableBody.appendChild(tr);
  }
}

function plotSelectedBenchmarks() {
  benchmarkCompareBarsEl.innerHTML = "";
  const raw = benchmarkListEl.dataset.records;
  if (!raw) return;
  const records = JSON.parse(raw);
  const selectedIds = Array.from(benchmarkListEl.querySelectorAll("input:checked")).map(
    (input) => input.value
  );
  const selected = records.filter((record) => selectedIds.includes(record.runId));
  if (selected.length === 0) return;
  const maxTokens = Math.max(
    ...selected.map((record) => Number(record.usageTotals?.totalTokens ?? 0)),
    1
  );
  const maxMs = Math.max(
    ...selected.map((record) => Number(record.durationsMs?.total ?? 0)),
    1
  );
  const tokenGroup = document.createElement("div");
  tokenGroup.className = "compare-group";
  tokenGroup.innerHTML = `<div class="compare-group-title">Total tokens</div>`;

  for (const record of selected) {
    const tokens = Number(record.usageTotals?.totalTokens ?? 0);
    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `
      <div>${record.runId}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.round(
        (tokens / maxTokens) * 100
      )}%"></div></div>
      <div class="bar-value">${tokens}</div>
    `;
    tokenGroup.appendChild(row);
  }
  benchmarkCompareBarsEl.appendChild(tokenGroup);

  const msGroup = document.createElement("div");
  msGroup.className = "compare-group";
  msGroup.innerHTML = `<div class="compare-group-title">Total time (ms)</div>`;

  for (const record of selected) {
    const ms = Number(record.durationsMs?.total ?? 0);
    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `
      <div>${record.runId}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.round(
        (ms / maxMs) * 100
      )}%"></div></div>
      <div class="bar-value">${ms}</div>
    `;
    msGroup.appendChild(row);
  }
  benchmarkCompareBarsEl.appendChild(msGroup);
}

async function loadBenchmarks() {
  benchmarkStatusEl.textContent = "Loading benchmarks...";
  const res = await fetch("/api/benchmarks");
  if (!res.ok) {
    benchmarkStatusEl.textContent = "Failed to load benchmarks.";
    return;
  }
  const data = await res.json();
  renderBenchmarks(data.records || []);
  benchmarkStatusEl.textContent = `Loaded ${data.records?.length || 0} benchmark runs.`;
}

function setEvalProgress(total, message) {
  evalProgressTextEl.textContent = message;
  if (evalProgressListEl.children.length === 0 && total > 0) {
    for (let i = 0; i < total; i += 1) {
      const li = document.createElement("li");
      li.className = "eval-progress-item";
      li.textContent = `Case ${i + 1}`;
      evalProgressListEl.appendChild(li);
    }
  }
}

function markEvalProgress(index, text, status) {
  const item = evalProgressListEl.children[index - 1];
  if (!item) return;
  item.textContent = text;
  item.classList.remove("running", "done");
  if (status) item.classList.add(status);
}

async function runPipeline() {
  setStatus("Running pipeline...");
  resetGraph();
  lastTrace = [];
  traceEl.textContent = "[]";
  logEl.textContent = "";
  hideHitlPanel();
  const guardPii = policyGuardPiiEl?.value || "warn";
  const guardSafety = policyGuardSafetyEl?.value || "warn";
  const guardModel = policyGuardModelEl?.value || "gpt-4.1-mini";

  const res = await fetch("/api/run-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      brief: briefEl.value,
      brand: brandEl.value,
      denylist: denylistEl.value,
      outputLabel: outputLabelEl?.value || "",
      policy: {
        maxRetries: Number(policyMaxRetriesEl.value || 0),
        toneStrictness: policyToneEl.value,
        budgetHint: policyBudgetEl.value,
        hitlEnabled: Boolean(policyHitlEl?.checked),
        guardrails: {
          pii: { mode: guardPii },
          safety: {
            mode: guardSafety,
            model: guardModel
          }
        },
        dynamicModelSelection: policyDynamicModelsEl.checked,
        modelRange: {
          min: policyModelMinEl.value,
          max: policyModelMaxEl.value
        },
        models: {
          planner: policyModelPlannerEl.value,
          writer: policyModelWriterEl.value,
          reviewer: policyModelReviewerEl.value
        }
      },
      baselineId: evalBaselineEl.value || undefined,
      useLlmJudge: true
    })
  });

  if (!res.ok || !res.body) {
    const data = await res.json();
    setStatus(`Error: ${data.error || "Unknown error"}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      const lines = part.split("\n").filter(Boolean);
      let event = "message";
      let data = "";
      for (const line of lines) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          data += line.slice(5).trim();
        }
      }
      if (event === "step") {
        lastTrace.push(data);
        traceEl.textContent = JSON.stringify(lastTrace, null, 2);
        resetGraph();
        const el = document.querySelector(`.node[data-node="${data}"]`);
        if (el) el.classList.add("active");
      }
      if (event === "log") {
        logEl.textContent += `${data}\n`;
        logEl.scrollTop = logEl.scrollHeight;
      }
      if (event === "complete") {
        const payload = JSON.parse(data);
        renderOutputs(payload);
        setStatus("Pipeline complete.");
        selectTab("outputs");
        loadBenchmarks();
        if (includeEvalEl.checked) {
          const reviews = payload.runLog?.reviews || [];
          const lastReview = reviews[reviews.length - 1];
          if (lastReview && lastReview.pass) {
            evalStatusEl.textContent = "Auto eval queued...";
            runEvalForRun(payload.runLog?.runId);
          } else {
            evalStatusEl.textContent = "Auto eval skipped (review failed).";
          }
        }
      }
      if (event === "hitl_pending") {
        const payload = JSON.parse(data);
        setStatus("Waiting for HITL approval.");
        showHitlPanel(payload);
      }
      if (event === "error") {
        setStatus(`Error: ${data}`);
      }
    }
  }
}

function resetGraph() {
  document.querySelectorAll(".node").forEach((node) => node.classList.remove("active"));
}

function playTrace() {
  if (!lastTrace.length) return;
  resetGraph();
  let idx = 0;
  const interval = setInterval(() => {
    resetGraph();
    const step = lastTrace[idx];
    const el = document.querySelector(`.node[data-node="${step}"]`);
    if (el) el.classList.add("active");
    idx += 1;
    if (idx >= lastTrace.length) {
      clearInterval(interval);
    }
  }, 600);
}

document.getElementById("load-defaults").addEventListener("click", loadDefaults);
document.getElementById("run").addEventListener("click", runPipeline);
document.getElementById("play-trace").addEventListener("click", playTrace);
policyDynamicModelsEl.addEventListener("change", syncDynamicModelUI);
document.getElementById("refresh-benchmarks").addEventListener("click", loadBenchmarks);
document.getElementById("benchmark-plot").addEventListener("click", plotSelectedBenchmarks);
evalPairwiseEl.addEventListener("change", syncPairwiseUI);
evalPairwiseEditEl.addEventListener("click", () => {
  if (!evalPairwiseEl.checked) return;
  evalPairwiseEditorEl.classList.toggle("active");
});

async function runEvalSuite() {
  if (evalRunning) return;
  const runId = getSelectedRunId();
  await runEvalForRun(runId);
}

function getSelectedRunId() {
  const selected = evalRunTargetListEl.querySelector("input:checked");
  if (selected) return selected.value;
  const raw = evalRunTargetListEl.dataset.records;
  if (!raw) return undefined;
  const records = JSON.parse(raw);
  return records[0]?.runId;
}

async function runEvalForRun(runId) {
  if (evalRunning) return;
  if (evalPairwiseEl.checked && !evalBaselineEl.value) {
    evalStatusEl.textContent = "Pairwise eval requires a baseline selection.";
    return;
  }
  const evalLabel = evalLabelEl?.value?.trim();
  let pairwisePrompt = undefined;
  if (evalPairwiseEl.checked) {
    const rawPrompt = evalPairwisePromptEl.value.trim();
    pairwisePrompt = rawPrompt || defaultPairwisePrompt || "";
    if (!pairwisePrompt) {
      evalStatusEl.textContent = "Pairwise eval requires a prompt.";
      return;
    }
  }
  evalRunning = true;
  evalStatusEl.textContent = runId
    ? `Running eval for ${runId}...`
    : "Running eval...";
  if (evalAveragesEl) {
    evalAveragesEl.textContent = "";
  }
  evalTableBody.innerHTML = "";
  evalProgressTextEl.textContent = "";
  evalProgressListEl.innerHTML = "";
  evalProgressPanelEl?.classList.remove("hidden");
  evalLogEl.textContent = "Starting eval...\n";
  const res = await fetch("/api/eval-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      policy: {
        maxRetries: Number(policyMaxRetriesEl.value || 0),
        toneStrictness: policyToneEl.value,
        budgetHint: policyBudgetEl.value,
        dynamicModelSelection: policyDynamicModelsEl.checked,
        modelRange: {
          min: policyModelMinEl.value,
          max: policyModelMaxEl.value
        },
        models: {
          planner: policyModelPlannerEl.value,
          writer: policyModelWriterEl.value,
          reviewer: policyModelReviewerEl.value
        }
      },
      baselineId: evalBaselineEl.value || undefined,
      useLlmJudge: true,
      alwaysUseLlmJudge: true,
      runId,
      evalLabel: evalLabel || undefined,
      evalModel: evalModelEl.value || undefined,
      regressionEnabled: Boolean(evalRegressionEl.checked),
      pairwisePrompt,
      pairwiseVotes: evalPairwiseEl.checked ? 3 : undefined
    })
  });
  if (!res.ok || !res.body) {
    const data = await res.json();
    evalStatusEl.textContent = `Error: ${data.error || "Unknown error"}`;
    evalRunning = false;
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      const lines = part.split("\n").filter(Boolean);
      let event = "message";
      let data = "";
      for (const line of lines) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          data += line.slice(5).trim();
        }
      }
      if (!data) continue;
      if (event === "log") {
        evalStatusEl.textContent = data;
        evalLogEl.textContent += `${data}\n`;
        evalLogEl.scrollTop = evalLogEl.scrollHeight;
        continue;
      }
      const payload = JSON.parse(data);
      if (event === "case_start") {
        setEvalProgress(payload.total, `Running case ${payload.index}/${payload.total}...`);
        markEvalProgress(payload.index, `${payload.caseId} (running)`, "running");
      }
      if (event === "case_complete") {
        setEvalProgress(payload.total, `Completed case ${payload.index}/${payload.total}.`);
        markEvalProgress(
          payload.index,
          `${payload.caseId} (score ${payload.result.score.toFixed(2)})`,
          "done"
        );
      }
      if (event === "complete") {
        evalStatusEl.textContent = "Eval complete.";
        renderEval(payload.payload);
        loadEvalRuns();
        selectTab("eval");
        evalProgressPanelEl?.classList.add("hidden");
      }
    }
  }
  evalRunning = false;
}

document.getElementById("run-eval").addEventListener("click", runEvalSuite);
document.getElementById("eval-show").addEventListener("click", showSelectedEvalRun);
document.getElementById("eval-remove").addEventListener("click", removeSelectedEvalRuns);
hitlTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const channel = tab.dataset.hitl;
    if (!channel) return;
    switchHitlTab(channel);
  });
});
hitlApproveEl?.addEventListener("click", async () => {
  if (!pendingHitlRunId) return;
  hitlStatusEl.textContent = "Approving...";
  const res = await fetch("/api/hitl/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId: pendingHitlRunId })
  });
  if (!res.ok) {
    const data = await res.json();
    hitlStatusEl.textContent = `Approve failed: ${data.error || "Unknown error"}`;
    return;
  }
  const data = await res.json();
  if (data.payload) {
    renderOutputs(data.payload);
    setStatus("Pipeline complete.");
    hideHitlPanel();
    loadBenchmarks();
    if (includeEvalEl.checked) {
      evalStatusEl.textContent = "Auto eval queued...";
      runEvalForRun(data.payload.runLog?.runId);
    }
  }
});

hitlRejectEl?.addEventListener("click", async () => {
  if (!pendingHitlRunId) return;
  const feedback = hitlFeedbackEl?.value || "";
  hitlStatusEl.textContent = "Requesting changes...";
  const res = await fetch("/api/hitl/reject", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId: pendingHitlRunId, feedback })
  });
  if (!res.ok) {
    const data = await res.json();
    hitlStatusEl.textContent = `Request failed: ${data.error || "Unknown error"}`;
    return;
  }
  const data = await res.json();
  if (data.hitlPending) {
    showHitlPanel(data.payload);
    return;
  }
  if (data.payload) {
    renderOutputs(data.payload);
    setStatus("Pipeline complete.");
    hideHitlPanel();
    loadBenchmarks();
  }
});

hideHitlPanel();
syncDynamicModelUI();
syncPolicyToggles();
evalPairwiseFileEl.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  evalPairwisePromptEl.value = text;
});
evalIncludeFailedEl?.addEventListener("change", loadRunTargets);
benchIncludeFailedEl?.addEventListener("change", loadBenchmarks);

loadDefaults().catch((err) => setStatus(`Error: ${err.message}`));
loadBenchmarks().catch((err) => {
  benchmarkStatusEl.textContent = `Error: ${err.message}`;
});
loadEvalRuns().catch((err) => {
  evalRunMetaEl.textContent = `Error: ${err.message}`;
});
loadRunTargets().catch((err) => {
  evalRunTargetMetaEl.textContent = `Error: ${err.message}`;
});
