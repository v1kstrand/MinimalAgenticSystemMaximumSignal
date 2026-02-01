import type { InputsBundle } from "../inputs";
import { findDenylistHits } from "../inputs";
import { loadEnv } from "../llm/env";
import { createChatCompletion } from "../llm/openai";
import type {
  Channel,
  ChannelDrafts,
  LlmCall,
  Policy,
  ResearchSummary,
  ReviewIssue,
  ReviewResult
} from "./types";

const MAX_WORDS_PER_SENTENCE = 24;
const URGENCY_PHRASES = [
  "act now",
  "limited time",
  "don't miss",
  "dont miss",
  "book now",
  "today only",
  "last chance",
  "now"
];
const MISLEADING_CLAIMS = [
  "guaranteed",
  "risk-free",
  "instant results",
  "instant",
  "zero risk",
  "no risk"
];

function countWords(sentence: string): number {
  const cleaned = sentence.trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).length;
}

function extractSentences(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split(/[\n.!?]+\s*/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function hasNumeric(text: string): boolean {
  return /\d/.test(text);
}

function lowerList(items: string[]): string[] {
  return items.map((item) => item.toLowerCase());
}

function extractNumbers(text: string): string[] {
  return (text.match(/\d+/g) || []).map((value) => value.trim());
}

function stripListNumbering(text: string): string {
  return text.replace(/^\s*\d+\)\s*/gm, "");
}

function shouldUseLLMReviewer(): boolean {
  const flag = (process.env.LLM_REVIEWER || "").toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

function extractJsonPayload(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("No JSON object found in LLM reviewer output.");
  }
  return match[0];
}

async function reviewWithLLM(
  drafts: ChannelDrafts,
  inputs: InputsBundle,
  research?: ResearchSummary,
  policy?: Policy,
  onLog?: (message: string) => void | Promise<void>,
  onUsage?: (call: LlmCall) => void | Promise<void>
): Promise<ReviewIssue[]> {
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set.");
  }

  const model =
    policy?.models?.reviewer ||
    process.env.OPENAI_REVIEW_MODEL ||
    process.env.OPENAI_MODEL ||
    "gpt-3.5-turbo";
  const systemPrompt =
    "You are a strict QA reviewer for marketing copy. Return ONLY valid JSON. Do not include markdown.";

  const userPrompt = [
    "Review the drafts for policy/tone issues, denylist hits, and ungrounded claims.",
    "Return JSON ONLY in this format:",
    "{\"issues\": [{\"channel\":\"email|paid-social|search-ads\",\"type\":\"denylist|tone|format|grounding|safety|llm\",\"message\":\"...\"}]}",
    "If there are no issues, return: {\"issues\": []}",
    "",
    "FACTS (grounded):",
    `Product: ${inputs.brief.product}`,
    `Summary: ${inputs.brief.summary}`,
    `Audience: ${inputs.brief.audience.join("; ")}`,
    `Value props: ${inputs.brief.valueProps.join("; ")}`,
    `Proof points: ${inputs.brief.proofPoints.join("; ")}`,
    `Primary CTA: ${inputs.brief.primaryCta}`,
    `Secondary CTA: ${inputs.brief.secondaryCta}`,
    "",
    "BRAND DO NOT:",
    inputs.brand.doNotList.join("; ") || "(none)",
    "",
    "DENYLIST:",
    inputs.denylist.join("; ") || "(none)",
    "",
    "POLICY:",
    `Tone strictness: ${policy?.toneStrictness ?? "medium"}`,
    `Budget hint: ${policy?.budgetHint ?? "low"}`,
    "",
    "DRAFTS:",
    "[EMAIL]",
    drafts["email"],
    "",
    "[PAID-SOCIAL]",
    drafts["paid-social"],
    "",
    "[SEARCH-ADS]",
    drafts["search-ads"]
  ].join("\n");

  if (onLog) {
    await onLog(`[LLM reviewer] model=${model} starting`);
  }
  const startedAt = Date.now();
  const response = await createChatCompletion(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    { apiKey, model, temperature: 0.2, timeoutMs: 60000 }
  );
  if (onUsage) {
    await onUsage({
      stage: "reviewer",
      model,
      durationMs: Date.now() - startedAt,
      usage: response.usage
    });
  }
  if (onLog) {
    await onLog(`[LLM reviewer] completed in ${Date.now() - startedAt}ms`);
  }

  const payload = extractJsonPayload(response.text);
  const parsed = JSON.parse(payload) as { issues?: ReviewIssue[] };
  const issues = Array.isArray(parsed.issues) ? parsed.issues : [];

  return issues.filter(
    (issue) =>
      issue &&
      (issue.channel === "email" || issue.channel === "paid-social" || issue.channel === "search-ads") &&
      typeof issue.message === "string"
  );
}

function hasMissingCoreFacts(inputs: InputsBundle): boolean {
  if (!inputs.brief.product) return true;
  if (!inputs.brief.summary) return true;
  if (inputs.brief.valueProps.length === 0) return true;
  return false;
}

function reviewGrounding(
  channel: Channel,
  text: string,
  research?: ResearchSummary
): ReviewIssue[] {
  if (!research) return [];
  const allowedNumbers = new Set<string>();
  for (const entry of research.proofPoints) {
    for (const number of extractNumbers(entry)) {
      allowedNumbers.add(number);
    }
  }
  const normalized = stripListNumbering(text);
  const numbersInDraft = extractNumbers(normalized);
  const issues: ReviewIssue[] = [];
  for (const number of numbersInDraft) {
    if (!allowedNumbers.has(number)) {
      issues.push({
        channel,
        type: "grounding",
        message: `Number ${number} not found in proof points`
      });
    }
  }
  return issues;
}

function reviewTone(channel: Channel, text: string, inputs: InputsBundle): ReviewIssue[] {
  return reviewToneWithPolicy(channel, text, inputs);
}

function reviewToneWithPolicy(
  channel: Channel,
  text: string,
  inputs: InputsBundle,
  policy?: Policy
): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const doNot = lowerList(inputs.brand.doNotList);
  const lowered = text.toLowerCase();

  for (const phrase of doNot) {
    if (!phrase) continue;
    if (lowered.includes(phrase)) {
      issues.push({
        channel,
        type: "tone",
        message: `Contains disallowed phrase from brand do-not list: ${phrase}`
      });
    }
  }

  const sentences = extractSentences(text);
  for (const sentence of sentences) {
    const wordCount = countWords(sentence);
    if (wordCount > MAX_WORDS_PER_SENTENCE) {
      issues.push({
        channel,
        type: "format",
        message: `Sentence exceeds ${MAX_WORDS_PER_SENTENCE} words (${wordCount} words)`
      });
      break;
    }
  }

  const briefHasNumbers = inputs.brief.proofPoints.some((point) => /\d/.test(point));
  if (briefHasNumbers && !hasNumeric(text)) {
    issues.push({
      channel,
      type: "tone",
      message: "Missing numeric proof point despite available numbers in brief"
    });
  }

  const strictness = policy?.toneStrictness ?? "medium";
  const urgencyList =
    strictness === "high"
      ? URGENCY_PHRASES
      : strictness === "medium"
        ? URGENCY_PHRASES.filter((phrase) => phrase !== "now")
        : [];

  for (const phrase of urgencyList) {
    if (lowered.includes(phrase)) {
      issues.push({
        channel,
        type: "safety",
        message: `Uses urgency language: ${phrase}`
      });
    }
  }

  if (strictness !== "low") {
    for (const phrase of MISLEADING_CLAIMS) {
      if (lowered.includes(phrase)) {
        issues.push({
          channel,
          type: "safety",
          message: `Uses misleading claim language: ${phrase}`
        });
      }
    }
  }

  return issues;
}

function reviewChannel(
  channel: Channel,
  text: string,
  inputs: InputsBundle,
  research?: ResearchSummary,
  policy?: Policy
): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const denylistHits = findDenylistHits(text, inputs.denylist);
  if (denylistHits.length > 0) {
    issues.push({
      channel,
      type: "denylist",
      message: `Denylist hits: ${denylistHits.join(", ")}`
    });
  }

  issues.push(...reviewGrounding(channel, text, research));
  issues.push(...reviewToneWithPolicy(channel, text, inputs, policy));
  return issues;
}

export async function reviewDrafts(
  drafts: ChannelDrafts,
  inputs: InputsBundle,
  research?: ResearchSummary,
  policy?: Policy,
  onLog?: (message: string) => void | Promise<void>,
  onUsage?: (call: LlmCall) => void | Promise<void>
): Promise<ReviewResult> {
  loadEnv();
  if (onLog) {
    await onLog("[reviewer] deterministic checks starting");
  }
  const issues: ReviewIssue[] = [];
  const channels = Object.keys(drafts) as Channel[];
  for (const channel of channels) {
    issues.push(...reviewChannel(channel, drafts[channel], inputs, research, policy));
  }

  if (shouldUseLLMReviewer()) {
    try {
      const llmIssues = await reviewWithLLM(drafts, inputs, research, policy, onLog, onUsage);
      for (const issue of llmIssues) {
        issues.push({
          channel: issue.channel,
          type: issue.type ?? "llm",
          message: issue.message
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`LLM reviewer failed, continuing with deterministic review: ${message}`);
      if (onLog) {
        await onLog(`[LLM reviewer] failed: ${message}`);
      }
    }
  }

  const missingFacts = hasMissingCoreFacts(inputs) || issues.some((issue) => issue.type === "grounding");
  const pass = issues.length === 0 && !missingFacts;

  return {
    issues,
    pass,
    missingFacts
  };
}
