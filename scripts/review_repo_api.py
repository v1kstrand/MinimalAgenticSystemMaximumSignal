#!/usr/bin/env python3
"""
Review a generated repo against the MAE prompt using the OpenAI API.

Usage (do not run automatically):
  python scripts/review_repo_api.py \
    --repo-dir experiments/mae_vit_medium \
    --prompt-file experiments/mae_prompt.txt \
    --effort high
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
from typing import Any, Dict, List

from openai import OpenAI


REVIEW_FILES = [
    "README.md",
    "config.yaml",
    "model.py",
    "dataset.py",
    "train.py",
    "losses.py",
    "metrics.py",
    "utils.py",
    "requirements.txt",
]


def load_env_file(start_dir: pathlib.Path) -> None:
    for candidate in (start_dir / ".env", start_dir.parent / ".env"):
        if not candidate.exists():
            continue
        for line in candidate.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("\"'")
            if key and key not in os.environ:
                os.environ[key] = value
        break


def read_prompt(prompt_file: pathlib.Path) -> str:
    if not prompt_file.exists():
        raise FileNotFoundError(f"Prompt file not found: {prompt_file}")
    return prompt_file.read_text(encoding="utf-8")


def read_repo_files(repo_dir: pathlib.Path) -> str:
    chunks: List[str] = []
    for rel in REVIEW_FILES:
        path = repo_dir / rel
        if not path.exists():
            chunks.append(f"## {rel}\n<missing>\n")
            continue
        content = path.read_text(encoding="utf-8")
        chunks.append(f"## {rel}\n{content}\n")
    return "\n".join(chunks)


def response_schema() -> Dict[str, Any]:
    return {
        "type": "json_schema",
        "name": "repo_review",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "score": {"type": "integer", "minimum": 1, "maximum": 10},
                "critical_issues": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "message": {"type": "string"},
                            "file": {"type": "string"},
                        },
                        "required": ["message", "file"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["score", "critical_issues"],
            "additionalProperties": False,
        },
    }


def extract_usage(usage: Any) -> Dict[str, Any]:
    if usage is None:
        return {}
    if hasattr(usage, "model_dump"):
        return usage.model_dump()
    if hasattr(usage, "__dict__"):
        return dict(usage.__dict__)
    if isinstance(usage, dict):
        return usage
    return {}


def extract_output_text(response: Any) -> str:
    if hasattr(response, "output_text") and response.output_text:
        return response.output_text
    data = response.model_dump() if hasattr(response, "model_dump") else {}
    if isinstance(data, dict):
        output_text = data.get("output_text")
        if isinstance(output_text, str) and output_text.strip():
            return output_text
        output = data.get("output")
        if isinstance(output, list):
            for item in output:
                content = item.get("content") if isinstance(item, dict) else None
                if not isinstance(content, list):
                    continue
                for part in content:
                    if not isinstance(part, dict):
                        continue
                    text = part.get("text")
                    if isinstance(text, str) and text.strip():
                        return text
    return ""


def run_review(
    repo_dir: pathlib.Path,
    prompt_text: str,
    review_prompt_text: str,
    effort: str,
    model: str,
    max_output_tokens: int,
) -> Dict[str, Any]:
    client = OpenAI()
    repo_blob = read_repo_files(repo_dir)
    system = "You are a strict reviewer."
    user = (
        review_prompt_text.replace("<<PROMPT>>", prompt_text)
        .replace("<<REPO>>", repo_blob)
    )

    response = client.responses.create(
        model=model,
        input=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        reasoning={"effort": effort},
        text={"format": response_schema()},
        max_output_tokens=max_output_tokens,
    )

    output_text = extract_output_text(response)
    if not output_text:
        debug_path = repo_dir / "review_response_debug.json"
        if hasattr(response, "model_dump"):
            debug_path.write_text(json.dumps(response.model_dump(), indent=2), encoding="utf-8")
        raise RuntimeError("Model returned empty output.")
    review = json.loads(output_text)
    return {"review": review, "usage": extract_usage(response.usage)}


def main() -> None:
    parser = argparse.ArgumentParser(description="Review repo via OpenAI API")
    parser.add_argument("--repo-dir", required=True, help="Repo directory to review")
    parser.add_argument("--prompt-file", required=True, help="Prompt file for evaluation")
    parser.add_argument(
        "--review-prompt-file",
        default="experiments/mae_review_prompt.txt",
        help="Review prompt template file",
    )
    parser.add_argument("--effort", default="high", help="Reasoning effort")
    parser.add_argument("--model", default=os.getenv("OPENAI_MODEL", "gpt-5.1"))
    parser.add_argument("--max-output-tokens", type=int, default=1200)
    parser.add_argument("--out-file", default="review.json", help="Output review JSON path")
    parser.add_argument("--usage-out", default="review_usage.json", help="Output usage JSON path")
    args = parser.parse_args()

    repo_dir = pathlib.Path(args.repo_dir)
    prompt_path = pathlib.Path(args.prompt_file)
    load_env_file(pathlib.Path.cwd())

    prompt_text = read_prompt(prompt_path)
    review_prompt_text = read_prompt(pathlib.Path(args.review_prompt_file))
    result = run_review(
        repo_dir, prompt_text, review_prompt_text, args.effort, args.model, args.max_output_tokens
    )

    out_path = repo_dir / args.out_file
    usage_path = repo_dir / args.usage_out

    out_path.write_text(json.dumps(result["review"], indent=2), encoding="utf-8")
    usage_path.write_text(json.dumps(result["usage"], indent=2), encoding="utf-8")

    print(f"Wrote review to {out_path}")
    print(f"Wrote usage to {usage_path}")


if __name__ == "__main__":
    main()
