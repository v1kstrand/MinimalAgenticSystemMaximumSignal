#!/usr/bin/env bash
set -euo pipefail

max_iterations_override=0
config_path=".plans/loop.config.json"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--max-iterations)
      max_iterations_override="$2"
      shift 2
      ;;
    -c|--config)
      config_path="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

mapfile -t cfg_lines < <(python3 - "$config_path" <<'PY'
import json
import os
import sys

path = sys.argv[1]

defaults = {
    "agentCommand": "codex",
    "agentArgs": ["exec", "--profile", "default", "{prompt_text}"],
    "maxIterations": 8,
    "completionRegex": "<promise>COMPLETE</promise>",
    "logDir": ".plans/logs",
    "stopOnError": True,
}

cfg = {}
if os.path.exists(path):
    with open(path, "r", encoding="utf-8") as f:
        cfg = json.load(f)

def get(name):
    return cfg.get(name, defaults[name])

print(get("agentCommand"))
print(get("maxIterations"))
print(get("completionRegex"))
print(get("logDir"))
print("true" if get("stopOnError") else "false")
for arg in get("agentArgs"):
    print(arg)
PY
)

agent_command="${cfg_lines[0]}"
max_iterations="${cfg_lines[1]}"
completion_regex="${cfg_lines[2]}"
log_dir="${cfg_lines[3]}"
stop_on_error="${cfg_lines[4]}"
agent_args=("${cfg_lines[@]:5}")

if [[ "$max_iterations_override" -gt 0 ]]; then
  max_iterations="$max_iterations_override"
fi

if ! command -v "$agent_command" >/dev/null 2>&1; then
  echo "Agent command not found: $agent_command" >&2
  exit 1
fi

mkdir -p "$log_dir"

for ((i=1; i<=max_iterations; i++)); do
  timestamp=$(date +%Y%m%d-%H%M%S)
  prompt_path="$log_dir/iter-$i-$timestamp.prompt.md"
  log_path="$log_dir/iter-$i-$timestamp.log"

  cp .plans/PROMPT.md "$prompt_path"

  echo "=== Ralph loop iteration $i ==="
  echo "Prompt: $prompt_path"
  echo "Log:    $log_path"

  final_args=()
  used_placeholder=false
  prompt_text="$(cat "$prompt_path")"
  for arg in "${agent_args[@]}"; do
    if [[ "$arg" == "{prompt}" ]]; then
      final_args+=("$prompt_path")
      used_placeholder=true
    elif [[ "$arg" == "{prompt_text}" ]]; then
      final_args+=("$prompt_text")
      used_placeholder=true
    else
      final_args+=("$arg")
    fi
  done
  if [[ "$used_placeholder" == "false" ]]; then
    final_args+=("$prompt_path")
  fi

  set +e
  "$agent_command" "${final_args[@]}" 2>&1 | tee "$log_path"
  exit_code=${PIPESTATUS[0]}
  set -e

  if [[ "$exit_code" -ne 0 && "$stop_on_error" == "true" ]]; then
    echo "Agent exited with code $exit_code" >&2
    exit "$exit_code"
  fi

  if python3 - "$log_path" "$completion_regex" <<'PY'
import re
import sys

log_path = sys.argv[1]
pattern = sys.argv[2]

with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
    lines = f.read().splitlines()

start = 0
for i in range(len(lines) - 1, -1, -1):
    if lines[i].strip() == "codex":
        start = i + 1
        break

segment = "\n".join(lines[start:])
sys.exit(0 if re.search(pattern, segment) else 1)
PY
  then
    echo "Loop complete: completion marker found."
    exit 0
  fi

done

echo "Max iterations reached without completion." >&2
exit 2
