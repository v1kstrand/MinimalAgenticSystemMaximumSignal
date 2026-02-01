import fs from "fs";
import path from "path";
import { runEvalSuite } from "./runner";

function findRepoRoot(startDir: string): string {
  const candidate = path.join(startDir, "data");
  if (fs.existsSync(candidate)) return startDir;
  const parent = path.dirname(startDir);
  const parentCandidate = path.join(parent, "data");
  if (fs.existsSync(parentCandidate)) return parent;
  return startDir;
}

async function main(): Promise<void> {
  const repoRoot = findRepoRoot(process.cwd());
  await runEvalSuite(repoRoot, undefined, undefined, undefined, undefined, undefined, false);
  console.log("Eval suite complete. Outputs: data/outputs/evals.json, evals.csv");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
