# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

Ralph is an AI agent loop orchestrator. It repeatedly invokes an agent (e.g. `codex`) with a prompt file, allowing the agent to incrementally complete a set of tasks defined in a PRD.

**Lucy Light** is the current project being built: a TypeScript CLI tool that generates marketing content (email, paid social, search ads) from brand/product briefs.

## Process Rules

1) Plan-first before implementation
Before making any code changes, provide a concise implementation plan. Follow-up questions are optional (but preferred); ask when they materially affect the solution or there is multiple paths for a implementation.

PA = Plan Approved: if you reply with "PA", proceed directly to implementation without waiting for follow-ups. If some followup Qs are unanswered; PA -> feel free to pick the answer to the follow ups if .

2) Bullet keys for clarity
When you provide Findings, Questions, Lists, or any multi-item bullets, prefix each item with a unique key in that message.
Example:

Findings
a1) ...
a2) ...

Questions
b1) ...
b2) ...

Rules:
- Keys only need to be unique within the current message.
- Keys may be reused in later messages.

## Key Commands

```powershell
# Run the agent loop (default 8 iterations)
.\scripts\ralph-loop.ps1

# Run with custom max iterations
.\scripts\ralph-loop.ps1 -MaxIterations 5

# Run with custom config
.\scripts\ralph-loop.ps1 -ConfigPath ".plans/loop.config.json"
```

In WSL (bash):
```bash
# Run the agent loop (default 8 iterations)
./scripts/ralph-loop.sh

# Run with custom max iterations
./scripts/ralph-loop.sh -m 5

# Run with custom config
./scripts/ralph-loop.sh -c .plans/loop.config.json
```

When working inside `lucy_light/` (TypeScript):
```powershell
npm run build    # Compile TypeScript
npm run start    # Run CLI
npm test         # Run tests (if configured)
```

## Architecture

```
ralph/
|-- .plans/
|   |-- PROMPT.md          # Agent prompt for each iteration
|   |-- prd.json           # Task list with passes=true/false status
|   |-- progress.txt       # Append-only log of completed work
|   |-- loop.config.json   # Loop runner configuration
|   `-- logs/              # Per-iteration logs
|-- data/
|   |-- brief.md           # Product/marketing brief input
|   |-- brand.md           # Brand voice guidelines
|   |-- do-not-say.txt     # Denylist of banned phrases
|   `-- outputs/           # Generated content artifacts
|-- scripts/
|   `-- ralph-loop.ps1     # PowerShell loop orchestrator
`-- lucy_light/            # TypeScript implementation (to be built)
```

## Loop Mechanics

1. `ralph-loop.ps1` copies `.plans/PROMPT.md` to `logs/` and invokes the agent
2. Agent reads `prd.json`, picks the highest-priority task with `passes=false`
3. Agent completes that task, sets `passes=true`, appends to `progress.txt`
4. Loop repeats until agent outputs `<promise>COMPLETE</promise>` or max iterations

## Implementation Constraints

- **TypeScript only** for Lucy Light code
- **No network access** - use local files only
- **Denylist enforcement** - content must not contain phrases from `data/do-not-say.txt`
- **Claims must be grounded** - only use facts from the input brief
- **One task per iteration** - complete and update progress before moving on

## Loop Configuration (loop.config.json)

- `agentCommand`: CLI to invoke (default: `codex`)
- `agentArgs`: Arguments passed to agent
- `maxIterations`: Loop limit (default: 8)
- `completionRegex`: Pattern that signals all tasks done
- `stopOnError`: Halt on non-zero exit codes

