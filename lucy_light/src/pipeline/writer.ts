import type { BrandVoice } from "../inputs";
import { loadEnv } from "../llm/env";
import { createChatCompletion } from "../llm/openai";
import type {
  ChannelDrafts,
  LlmCall,
  Plan,
  Policy,
  ResearchSummary,
  ReviewHistory,
  ReviewResult
} from "./types";

function pickAudience(audience: string[]): string {
  return audience[0] || "e-commerce operators";
}

function pickProof(proofPoints: string[]): string {
  return proofPoints[0] || "Results grounded in operational pilots.";
}

function formatValueProps(valueProps: string[]): string {
  if (valueProps.length === 0) return "Streamline inventory operations with real-time insights.";
  return valueProps.join("; ");
}

function stripTrailingPunct(value: string): string {
  return value.trim().replace(/[.!?]+$/, "");
}

function formatToneLine(brand: BrandVoice): string {
  if (brand.attributes.length === 0) return "Professional, playful, and enterprise-ready.";
  const first = brand.attributes[0].split(":")[0].trim();
  const second = brand.attributes[1]?.split(":")[0].trim();
  const third = brand.attributes[2]?.split(":")[0].trim();
  return [first, second, third].filter(Boolean).join(". ") + ".";
}

function writeDraftsDeterministic(
  plan: Plan,
  research: ResearchSummary,
  brand: BrandVoice,
  _review?: ReviewResult | ReviewHistory
): ChannelDrafts {
  const audience = pickAudience(research.audience);
  const proof = stripTrailingPunct(pickProof(research.proofPoints));
  const valueProps = stripTrailingPunct(formatValueProps(research.valueProps));
  const summary = stripTrailingPunct(research.summary);
  const toneLine = formatToneLine(brand);

  const email = [
    `Subject: ${research.product} inventory alerts for ${audience}`,
    `Preview: ${summary}.`,
    "Body:",
    `- ${research.product} helps ${audience} avoid stockouts and overstock with real-time alerts and forecasting.`,
    `- ${valueProps}.`,
    `- ${proof}.`,
    `- ${toneLine}`,
    `CTA: ${research.primaryCta || "Book a demo"}`
  ].join("\n");

  const paidSocial = [
    "LinkedIn Variations:",
    `1) ${research.product} for ${audience}: ${summary}. ${valueProps}. CTA: ${research.primaryCta || "Book a demo"}`,
    `2) ${audience} teams use ${research.product} to stay ahead of stockouts. ${proof}. CTA: ${research.primaryCta || "Book a demo"}`,
    `3) Forecasting plus alerts in one: ${research.product}. ${valueProps}. CTA: ${research.primaryCta || "Book a demo"}`,
    "",
    "Meta Variations:",
    `1) Keep inventory in sync with ${research.product}. ${valueProps}. CTA: ${research.secondaryCta || "Download the playbook"}`,
    `2) Avoid stockouts with real-time alerts. ${research.product} for ${audience}. CTA: ${research.secondaryCta || "Download the playbook"}`,
    `3) ${research.product} makes inventory planning faster. ${proof}. CTA: ${research.secondaryCta || "Download the playbook"}`
  ].join("\n");

  const searchAds = [
    "Headlines:",
    `1) ${research.product} Inventory Alerts`,
    `2) Prevent Stockouts for ${audience}`,
    `3) Real-Time Demand Forecasting`,
    `4) Inventory Insights in Minutes`,
    `5) ${research.product} for Faster Reorders`,
    "",
    "Descriptions:",
    `1) ${valueProps}.`,
    `2) ${proof}.`,
    `3) Real-time alerts across stores. Book a demo.`,
    `4) Forecast demand and reorder with confidence.`
  ].join("\n");

  const orderedChannels = plan.channels;
  const drafts: ChannelDrafts = {
    "email": email,
    "paid-social": paidSocial,
    "search-ads": searchAds
  };

  for (const channel of orderedChannels) {
    if (!drafts[channel]) {
      throw new Error(`Missing draft for channel: ${channel}`);
    }
  }

  return drafts;
}

function shouldUseLLM(): boolean {
  const flag = (process.env.LLM_WRITER || "").toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }
  return trimmed;
}

function extractSectionBlock(text: string, label: string): string {
  const cleaned = stripCodeFences(text);
  const markers = ["EMAIL", "PAID-SOCIAL", "SEARCH-ADS"];
  const headerRegex = new RegExp(`^\\[${label}\\]\\s*$`, "mi");
  const match = headerRegex.exec(cleaned);
  if (!match) {
    throw new Error(`Missing [${label}] section in LLM output.`);
  }
  const start = match.index + match[0].length;
  const tail = cleaned.slice(start);
  const nextRegex = new RegExp(`^\\[(?:${markers.join("|")})\\]\\s*$`, "mi");
  const nextMatch = nextRegex.exec(tail);
  const block = nextMatch ? tail.slice(0, nextMatch.index) : tail;
  return block.trim();
}

function formatReviewFeedback(review?: ReviewResult | ReviewHistory): string | null {
  if (!review) return null;
  const reviews = Array.isArray(review) ? review : [review];
  const failed = reviews.filter((entry) => !entry.pass && entry.issues.length > 0);
  if (failed.length === 0) return null;

  const seen = new Set<string>();
  const lines: string[] = [];
  for (const entry of failed) {
    for (const issue of entry.issues) {
      const key = `${issue.channel}|${issue.type}|${issue.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`- [${issue.channel}][${issue.type}] ${issue.message}`);
    }
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

async function writeDraftsWithLLM(
  plan: Plan,
  research: ResearchSummary,
  brand: BrandVoice,
  review?: ReviewResult | ReviewHistory,
  onLog?: (message: string) => void | Promise<void>,
  policy?: Policy,
  onUsage?: (call: LlmCall) => void | Promise<void>
): Promise<ChannelDrafts> {
  loadEnv();
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set.");
  }

  const model =
    policy?.models?.writer || process.env.OPENAI_MODEL || "gpt-3.5-turbo";
  const systemPrompt =
    "You are a marketing copywriter. Return ONLY plain text. Do not include markdown or JSON.";

  const feedback = formatReviewFeedback(review);
  const planNotes = plan.notes && plan.notes.length > 0 ? plan.notes : [];
  const userPrompt = [
    "Generate channel-specific marketing drafts using ONLY the facts provided.",
    "",
    "FACTS (grounded):",
    `Product: ${research.product}`,
    `Summary: ${research.summary}`,
    `Audience: ${research.audience.join("; ")}`,
    `Value props: ${research.valueProps.join("; ")}`,
    `Proof points: ${research.proofPoints.join("; ")}`,
    `Primary CTA: ${research.primaryCta}`,
    `Secondary CTA: ${research.secondaryCta}`,
    "",
    "BRAND TONE:",
    `Attributes: ${brand.attributes.join("; ")}`,
    `Do: ${brand.doList.join("; ")}`,
    `Do not: ${brand.doNotList.join("; ")}`,
    ...(planNotes.length > 0 ? ["", "PLAN NOTES (priorities):", ...planNotes.map((note) => `- ${note}`)] : []),
    ...(feedback ? ["", "PREVIOUS REVIEW FEEDBACK (must fix):", feedback] : []),
    "",
    "REQUIREMENTS:",
    "- Output plain text with three labeled sections: [EMAIL], [PAID-SOCIAL], [SEARCH-ADS].",
    "- Email section must include: Subject, Preview, Body, CTA.",
    "- Paid social section must include: LinkedIn Variations (3) and Meta Variations (3).",
    "- Search ads section must include: 5 headlines and 4 descriptions.",
    "- Use the tone: professional + playful + enterprise.",
    "- Do not add facts not in the brief.",
    "",
    "OUTPUT FORMAT EXAMPLE (structure only):",
    "[EMAIL]",
    "Subject: ...",
    "Preview: ...",
    "Body:",
    "- ...",
    "CTA: ...",
    "",
    "[PAID-SOCIAL]",
    "LinkedIn Variations:",
    "1) ...",
    "2) ...",
    "3) ...",
    "",
    "Meta Variations:",
    "1) ...",
    "2) ...",
    "3) ...",
    "",
    "[SEARCH-ADS]",
    "Headlines:",
    "1) ...",
    "2) ...",
    "3) ...",
    "4) ...",
    "5) ...",
    "",
    "Descriptions:",
    "1) ...",
    "2) ...",
    "3) ...",
    "4) ..."
  ].join("\n");

  if (onLog) {
    await onLog(`[LLM writer] model=${model} starting`);
  }
  const startedAt = Date.now();
  const response = await createChatCompletion(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    { apiKey, model, temperature: 0.7, timeoutMs: 60000 }
  );
  if (onUsage) {
    await onUsage({
      stage: "writer",
      model,
      durationMs: Date.now() - startedAt,
      usage: response.usage
    });
  }
  if (onLog) {
    await onLog(`[LLM writer] completed in ${Date.now() - startedAt}ms`);
  }

  const email = extractSectionBlock(response.text, "EMAIL");
  const paidSocial = extractSectionBlock(response.text, "PAID-SOCIAL");
  const searchAds = extractSectionBlock(response.text, "SEARCH-ADS");

  const drafts: ChannelDrafts = {
    "email": email,
    "paid-social": paidSocial,
    "search-ads": searchAds
  };

  for (const channel of plan.channels) {
    if (!drafts[channel]) {
      throw new Error(`Missing draft for channel: ${channel}`);
    }
  }

  return drafts;
}

export async function writeDrafts(
  plan: Plan,
  research: ResearchSummary,
  brand: BrandVoice,
  review?: ReviewResult | ReviewHistory,
  onLog?: (message: string) => void | Promise<void>,
  policy?: Policy,
  onUsage?: (call: LlmCall) => void | Promise<void>
): Promise<ChannelDrafts> {
  loadEnv();
  if (!shouldUseLLM()) {
    return writeDraftsDeterministic(plan, research, brand, review);
  }
  try {
    return await writeDraftsWithLLM(plan, research, brand, review, onLog, policy, onUsage);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`LLM writer failed, falling back to deterministic writer: ${message}`);
    if (onLog) {
      await onLog(`[LLM writer] failed: ${message}`);
    }
    return writeDraftsDeterministic(plan, research, brand, review);
  }
}


