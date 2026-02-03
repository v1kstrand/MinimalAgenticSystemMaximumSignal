Compact Agentic System for Marketing Ops

MASM (MinimalAgenticSystemMaximumSignal) turns a product brief into multi-channel marketing assets, then evaluates, guards, and iterates the output with a lightweight agent loop, HITL gates, and safety guardrails. It is deliberately small, so the full workflow is easy to understand, explain, and demo.

## What It Demonstrates

Agentic orchestration
- Planner -> Writer -> Reviewer -> Analyst pipeline
- Iterative loop with retries and reviewer feedback

Evaluation and monitoring
- Baseline comparison (regression)
- Pairwise LLM judge (run vs baseline)
- Benchmark logs for cost/latency analysis

Guardrails and safety
- Deterministic PII detection
- LLM safety classifier for prompt injection
- Warn vs block modes

Human-in-the-loop
- Approval gate after reviewer
- Human feedback injected back into planning loop

In short: MASM hits the fundamentals (planning, review/reflection, safety, evaluation, HITL) without heavy infrastructure.

---

# Technical Overview

## Architecture (Core Loop)

```
Planner -> Writer -> Reviewer -> Analyst -> Done
         ^                 |
         +-----(retry)-----+
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

1) Agent pipeline
- Planner produces plan + research summary
- Writer generates drafts (email, paid social, search ads)
- Reviewer enforces grounding/denylist/tone
- Analyst scores outputs

2) Eval system
- Regression against baselines
- Pairwise LLM judge (run vs baseline)
- Eval history + comparison in UI

3) Guardrails
- PII scan (deterministic)
- Safety/jailbreak classifier (LLM)
- Warn vs block modes

4) HITL gate
- Human approval before finalizing outputs
- Feedback injected into the next iteration

---

# Quick Start

Install and build
```
npm --prefix lucy_light install
npm --prefix lucy_light run build
```

Run CLI
```
npm --prefix lucy_light run start -- --brief data/brief.md --brand data/brand.md --denylist data/do-not-say.txt
```

Run UI
```
npm --prefix lucy_light run ui
```
Open: http://localhost:8787

---

# Demo Script

1) Open UI -> Inputs tab
2) Enable HITL gate
3) Run pipeline
4) Approve or reject drafts in the HITL panel
5) Run eval vs baseline (pairwise + regression)
6) Show benchmark tab (tokens + latency)

