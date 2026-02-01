# Lucy Light (LL) — Minimal Agentic System, Maximum Signal

Lucy Light is a compact, interview‑ready agentic system that demonstrates the core ideas of modern AI agents without the overhead of a full production stack. It turns a product brief into multi‑channel marketing assets, then evaluates, guards, and iterates the output with a lightweight agent loop, HITL gates, and safety guardrails.

If you want to show “senior‑level” agentic thinking in a small footprint, LL is the proof: it is deliberately minimal while still demonstrating orchestration, evaluation, safety, and human approvals.

## Why This Is Interview‑Ready

**Agentic orchestration**
- Planner → Writer → Reviewer → Analyst pipeline
- Iterative loop with retries and reviewer feedback

**Evaluation & monitoring**
- Baseline comparison (regression)
- Pairwise LLM judge (run vs baseline)
- Benchmark logs for cost/latency analysis

**Guardrails & safety**
- Deterministic PII detection
- LLM safety classifier for prompt injection
- Warn vs block modes

**Human‑in‑the‑loop**
- Approval gate after reviewer
- Human feedback injected back into planning loop

In short: LL hits the fundamentals—**planning, review/reflection, safety, evaluation, and HITL**—while remaining easy to understand and demo.

---

# Technical Overview

## Architecture (Core Loop)

```
Planner → Writer → Reviewer → Analyst → Done
         ↑                 |
         └───────(retry)───┘
```

Optional HITL gate pauses after Reviewer for human approval.

## Repo Layout

```
ralph/
|-- data/
|   |-- brief.md
|   |-- brand.md
|   |-- do-not-say.txt
|   |-- outputs/
|   `-- eval/
|-- lucy_light/
|   |-- src/
|   |-- dist/
|   |-- package.json
|   `-- tsconfig.json
`-- scripts/
```

## Key Features

### 1) Agent pipeline
- Planner produces plan + research summary
- Writer generates drafts (email, paid social, search ads)
- Reviewer enforces grounding/denylist/tone
- Analyst scores outputs

### 2) Eval system
- Regression against baselines
- Pairwise LLM judge (run vs baseline)
- Eval history + comparison in UI

### 3) Guardrails
- PII scan (deterministic)
- Safety/jailbreak classifier (LLM)
- Warn vs block modes

### 4) HITL gate
- Human approval before finalizing outputs
- Feedback is injected into the next iteration

---

# Quick Start

## Install & Build
```
npm --prefix lucy_light install
npm --prefix lucy_light run build
```

## Run CLI
```
npm --prefix lucy_light run start -- --brief data/brief.md --brand data/brand.md --denylist data/do-not-say.txt
```

## Run UI
```
npm --prefix lucy_light run ui
```
Open: http://localhost:8787

---

# Demo Script (Interview‑Friendly)

1) Open UI → Inputs tab  
2) Enable HITL gate  
3) Run pipeline  
4) Approve or reject drafts in the HITL panel  
5) Run eval vs baseline (pairwise + regression)  
6) Show benchmark tab (tokens + latency)  

---

# Interview Framing (Senior Lens)

**Agent Development & Orchestration**
- Explicit plan‑execute‑review‑analyze loop  
- Feedback loop with retries + human overrides  

**Evaluation & Safety**
- Regression guardrails for output quality  
- Pairwise LLM judge for subjective comparison  
- Input guardrails (PII + injection detection)  

**Monitoring & Observability**
- Token usage and latency logging  
- Benchmark history for cost/quality tradeoffs  

---

# Notes

This is a toy system by design. The value is in how many *agentic primitives* it exposes in a single, explainable app:
planning, routing, evaluation, safety, and HITL.

