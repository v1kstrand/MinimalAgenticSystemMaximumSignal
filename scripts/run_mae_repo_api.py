#!/usr/bin/env python3
"""
Generate a repo manifest from the OpenAI API and optionally materialize it on disk.

Usage (do not run automatically):
  python scripts/run_mae_repo_api.py \
    --prompt-file experiments/mae_prompt.txt \
    --out-dir experiments/mae_vit_medium \
    --effort medium \
    --apply
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
from typing import Any, Dict, List, Optional, Tuple

from openai import OpenAI


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
            value = value.strip().strip("\"'")  # remove optional quotes
            if key and key not in os.environ:
                os.environ[key] = value
        break


def read_prompt(prompt_file: pathlib.Path) -> str:
    if not prompt_file.exists():
        raise FileNotFoundError(f"Prompt file not found: {prompt_file}")
    return prompt_file.read_text(encoding="utf-8")


def build_messages(prompt_text: str) -> List[Dict[str, str]]:
    system = (
        "You are a precise code generator. "
        "Return ONLY valid JSON that matches the provided schema. "
        "Do not include markdown or explanations."
    )
    user = (
        f"{prompt_text}\n\n"
        "Return a JSON object with a single key: files. "
        "Each entry must have: path, content."
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def response_schema() -> Dict[str, Any]:
    return {
        "type": "json_schema",
        "name": "repo_manifest",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "files": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "path": {"type": "string"},
                            "content": {"type": "string"},
                        },
                        "required": ["path", "content"],
                        "additionalProperties": False,
                    },
                }
            },
            "required": ["files"],
            "additionalProperties": False,
        },
    }



def parse_manifest(text: str) -> Dict[str, Any]:
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Model output was not valid JSON: {exc}") from exc


def validate_manifest(manifest: Dict[str, Any]) -> List[Dict[str, str]]:
    files = manifest.get("files")
    if not isinstance(files, list):
        raise ValueError("Manifest must contain a 'files' list.")
    cleaned: List[Dict[str, str]] = []
    for item in files:
        if not isinstance(item, dict):
            raise ValueError("Each file entry must be an object.")
        path = item.get("path")
        content = item.get("content")
        if not isinstance(path, str) or not isinstance(content, str):
            raise ValueError("Each file entry must include string path and content.")
        cleaned.append({"path": path, "content": content})
    return cleaned


def safe_write_files(out_dir: pathlib.Path, files: List[Dict[str, str]]) -> None:
    for entry in files:
        rel_path = entry["path"].lstrip("/\\")
        if ".." in pathlib.Path(rel_path).parts:
            raise ValueError(f"Unsafe path in manifest: {entry['path']}")
        target = out_dir / rel_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(entry["content"], encoding="utf-8")


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


def run(
    prompt_file: pathlib.Path,
    out_dir: pathlib.Path,
    effort: str,
    model: str,
    max_output_tokens: int,
    temperature: float,
    apply: bool,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    client = OpenAI()
    prompt_text = read_prompt(prompt_file)
    response = client.responses.create(
        model=model,
        input=build_messages(prompt_text),
        reasoning={"effort": effort},
        text={"format": response_schema()},
        max_output_tokens=max_output_tokens,
    )

    output_text = extract_output_text(response)
    if not output_text:
        debug_path = out_dir / "response_debug.json"
        if hasattr(response, "model_dump"):
            debug_path.write_text(json.dumps(response.model_dump(), indent=2), encoding="utf-8")
        raise RuntimeError("Model returned empty output.")

    manifest = parse_manifest(output_text)
    files = validate_manifest(manifest)

    if apply:
        safe_write_files(out_dir, files)

    usage = extract_usage(response.usage)
    return manifest, usage


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate MAE repo via OpenAI API")
    parser.add_argument("--prompt-file", required=True, help="Path to prompt file")
    parser.add_argument("--out-dir", required=True, help="Output directory for files")
    parser.add_argument("--effort", default="medium", help="Reasoning effort (low/medium/high)")
    parser.add_argument("--model", default=os.getenv("OPENAI_MODEL", "gpt-5.1"))
    parser.add_argument("--max-output-tokens", type=int, default=8000)
    parser.add_argument("--temperature", type=float, default=0.0)
    parser.add_argument("--apply", action="store_true", help="Write files to disk")
    parser.add_argument("--manifest-out", default="manifest.json", help="Manifest output filename")
    parser.add_argument("--usage-out", default="usage.json", help="Usage output filename")
    args = parser.parse_args()

    prompt_path = pathlib.Path(args.prompt_file)
    out_dir = pathlib.Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    load_env_file(pathlib.Path.cwd())

    manifest, usage = run(
        prompt_file=prompt_path,
        out_dir=out_dir,
        effort=args.effort,
        model=args.model,
        max_output_tokens=args.max_output_tokens,
        temperature=args.temperature,
        apply=args.apply,
    )

    (out_dir / args.manifest_out).write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (out_dir / args.usage_out).write_text(json.dumps(usage, indent=2), encoding="utf-8")

    print(f"Wrote manifest to {out_dir / args.manifest_out}")
    print(f"Wrote usage to {out_dir / args.usage_out}")
    if args.apply:
        print("Applied manifest to output directory.")


if __name__ == "__main__":
    main()
