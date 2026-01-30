# Ralph Loop Prompt - Lucy Light

You are running in a loop. Each iteration must be small, deterministic, and testable.

## Required context
- .plans/prd.json
- .plans/progress.txt
- data/brief.md
- data/brand.md
- data/do-not-say.txt

## Task selection
- Pick the highest-priority task in prd.json with passes=false.
- Complete ONLY that task in this iteration.

## Implementation rules
- Use TypeScript.
- Prefer small, composable modules.
- Use local files only. Do not access the network.
- If you add dependencies, use npm and update package.json.
- Run tests if package.json exists AND a test script is defined; otherwise skip and note.

## Progress rules
- Update ONLY the task you completed: set passes=true in prd.json.
- Append a short entry to .plans/progress.txt including:
  - date/time
  - task id + title
  - summary
  - commands run

## Completion
- If all tasks have passes=true, output exactly:
  <promise>COMPLETE</promise>

## Output locations
- Write generated artifacts to data/outputs/ (create if missing).
