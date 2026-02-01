import type { InputsBundle } from "../inputs";
import type { ResearchSummary } from "./types";

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

export function researchInputs(inputs: InputsBundle): ResearchSummary {
  const { brief } = inputs;
  const facts = unique([
    brief.product,
    brief.category,
    brief.summary,
    ...brief.audience,
    ...brief.valueProps,
    ...brief.proofPoints,
    brief.primaryCta,
    brief.secondaryCta
  ]);

  return {
    product: brief.product,
    summary: brief.summary,
    audience: [...brief.audience],
    valueProps: [...brief.valueProps],
    proofPoints: [...brief.proofPoints],
    primaryCta: brief.primaryCta,
    secondaryCta: brief.secondaryCta,
    facts
  };
}
