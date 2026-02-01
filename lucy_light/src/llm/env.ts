import fs from "fs";
import path from "path";

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const equalsIndex = trimmed.indexOf("=");
  if (equalsIndex <= 0) return null;
  const key = trimmed.slice(0, equalsIndex).trim();
  let value = trimmed.slice(equalsIndex + 1).trim();
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

function findEnvFile(startDir: string): string | null {
  const direct = path.join(startDir, ".env");
  if (fs.existsSync(direct)) return direct;
  const parent = path.dirname(startDir);
  if (parent && parent !== startDir) {
    const parentEnv = path.join(parent, ".env");
    if (fs.existsSync(parentEnv)) return parentEnv;
  }
  return null;
}

export function loadEnv(startDir: string = process.cwd()): void {
  const envPath = findEnvFile(startDir);
  if (!envPath) return;
  const contents = fs.readFileSync(envPath, "utf8");
  const lines = contents.split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    if (process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value;
    }
  }
}
