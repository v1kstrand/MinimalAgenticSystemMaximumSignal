import type { InputsBundle } from "../inputs";
import type { Plan } from "./types";

const MODEL_RANKING = ["gpt-4.1-nano", "gpt-4.1-mini", "gpt-4o-mini", "gpt-4o"];

function clampRange(min: string | undefined, max: string | undefined): { min: number; max: number } {
  const rawMin = MODEL_RANKING.indexOf(min || "");
  const rawMax = MODEL_RANKING.indexOf(max || "");
  const minIdx = rawMin >= 0 ? rawMin : 0;
  const maxIdx = rawMax >= 0 ? rawMax : MODEL_RANKING.length - 1;
  const low = Math.min(minIdx, maxIdx);
  const high = Math.max(minIdx, maxIdx);
  return {
    min: Number.isFinite(low) ? low : 0,
    max: Number.isFinite(high) ? high : MODEL_RANKING.length - 1
  };
}

function estimateBaseModel(
  plan: Plan,
  inputs: InputsBundle,
  recommended: string | undefined,
  minModel: string | undefined,
  maxModel: string | undefined
): { baseModel: string; minIndex: number; maxIndex: number } {
  const channelCount = plan.channels.length;
  const stepCount = plan.steps.length;
  const proofPoints = inputs.brief.proofPoints.length;
  const valueProps = inputs.brief.valueProps.length;
  const audience = inputs.brief.audience.length;
  const summaryLen = inputs.brief.summary?.length ?? 0;

  let score = channelCount * 2 + Math.ceil(stepCount / 2);
  score += Math.ceil((proofPoints + valueProps + audience) / 2);
  if (summaryLen > 160) score += 2;
  if (summaryLen > 300) score += 2;

  const { min, max } = clampRange(minModel, maxModel);
  let baseIndex = min;
  const recommendedIndex = MODEL_RANKING.indexOf(recommended || "");
  if (recommendedIndex >= 0) {
    baseIndex = Math.min(Math.max(recommendedIndex, min), max);
  } else {
    if (score <= 6) baseIndex = min;
    else if (score <= 10) baseIndex = Math.min(min + 1, max);
    else baseIndex = max;
  }

  return {
    baseModel: MODEL_RANKING[baseIndex] || MODEL_RANKING[min],
    minIndex: min,
    maxIndex: max
  };
}

export function selectWriterModel(
  plan: Plan,
  inputs: InputsBundle,
  recommended: string | undefined,
  failureCount: number,
  minModel?: string,
  maxModel?: string
): { model: string; baseModel: string } {
  const { baseModel, minIndex, maxIndex } = estimateBaseModel(
    plan,
    inputs,
    recommended,
    minModel,
    maxModel
  );
  const baseIndex = MODEL_RANKING.indexOf(baseModel);
  const stepUp = Math.max(0, failureCount);
  const targetIndex = Math.min(baseIndex + stepUp, maxIndex);
  const model = MODEL_RANKING[targetIndex] || MODEL_RANKING[minIndex];
  return { model, baseModel };
}
