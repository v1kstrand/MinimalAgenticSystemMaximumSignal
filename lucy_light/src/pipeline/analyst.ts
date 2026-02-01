import type { Channel, ChannelDrafts, EvalReport, ReviewResult } from "./types";

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function countSentences(text: string): number {
  const sentences = text
    .replace(/\r/g, "")
    .split(/[\n.!?]+\s*/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
  return sentences.length;
}

function countListItems(lines: string[]): number {
  let count = 0;
  for (const line of lines) {
    if (/^\s*\d+\)/.test(line) || /^\s*[-*]\s+/.test(line)) {
      count += 1;
    }
  }
  return count;
}

function extractSection(lines: string[], startLabel: string, endLabel?: string): string[] {
  const startIndex = lines.findIndex((line) => line.toLowerCase().startsWith(startLabel.toLowerCase()));
  if (startIndex === -1) return [];
  const sectionLines = lines.slice(startIndex + 1);
  if (!endLabel) return sectionLines;
  const endIndex = sectionLines.findIndex((line) => line.toLowerCase().startsWith(endLabel.toLowerCase()));
  if (endIndex === -1) return sectionLines;
  return sectionLines.slice(0, endIndex);
}

function checkEmail(text: string): Record<string, boolean | number> {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const hasSubject = lines.some((line) => line.toLowerCase().startsWith("subject:"));
  const hasPreview = lines.some((line) => line.toLowerCase().startsWith("preview:"));
  const hasBody = lines.some((line) => line.toLowerCase().startsWith("body:"));
  const hasCta = lines.some((line) => line.toLowerCase().startsWith("cta:"));
  return { hasSubject, hasPreview, hasBody, hasCta };
}

function checkPaidSocial(text: string): Record<string, boolean | number> {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const linkedInLines = extractSection(lines, "LinkedIn Variations:", "Meta Variations:");
  const metaLines = extractSection(lines, "Meta Variations:");
  const linkedInCount = countListItems(linkedInLines);
  const metaCount = countListItems(metaLines);
  return {
    hasLinkedInSection: linkedInLines.length > 0,
    hasMetaSection: metaLines.length > 0,
    linkedInVariations: linkedInCount,
    metaVariations: metaCount
  };
}

function checkSearchAds(text: string): Record<string, boolean | number> {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const headlineLines = extractSection(lines, "Headlines:", "Descriptions:");
  const descriptionLines = extractSection(lines, "Descriptions:");
  const headlineCount = countListItems(headlineLines);
  const descriptionCount = countListItems(descriptionLines);
  return {
    headlineCount,
    descriptionCount
  };
}

function computeScore(checks: Record<string, boolean | number>, issues: number): number {
  let score = 10;
  for (const [key, value] of Object.entries(checks)) {
    if (typeof value === "boolean" && !value) {
      score -= 2;
    }
    if (key.endsWith("Variations") && typeof value === "number" && value < 3) {
      score -= 2;
    }
    if (key === "headlineCount" && typeof value === "number" && value < 5) {
      score -= 2;
    }
    if (key === "descriptionCount" && typeof value === "number" && value < 4) {
      score -= 2;
    }
  }
  score -= Math.min(issues, 5);
  if (score < 0) score = 0;
  return score;
}

function channelPass(channel: Channel, checks: Record<string, boolean | number>, issues: number): boolean {
  if (issues > 0) return false;
  if (channel === "email") {
    return Boolean(checks.hasSubject && checks.hasPreview && checks.hasBody && checks.hasCta);
  }
  if (channel === "paid-social") {
    return (
      Boolean(checks.hasLinkedInSection && checks.hasMetaSection) &&
      Number(checks.linkedInVariations) >= 3 &&
      Number(checks.metaVariations) >= 3
    );
  }
  if (channel === "search-ads") {
    return Number(checks.headlineCount) >= 5 && Number(checks.descriptionCount) >= 4;
  }
  return false;
}

export function analyzeDrafts(drafts: ChannelDrafts, review: ReviewResult): EvalReport {
  const channels = Object.keys(drafts) as Channel[];
  const reportChannels: EvalReport["channels"] = {
    "email": { wordCount: 0, sentenceCount: 0, issues: 0, score: 0, checks: {}, pass: true },
    "paid-social": { wordCount: 0, sentenceCount: 0, issues: 0, score: 0, checks: {}, pass: true },
    "search-ads": { wordCount: 0, sentenceCount: 0, issues: 0, score: 0, checks: {}, pass: true }
  };

  for (const channel of channels) {
    const text = drafts[channel];
    const channelIssues = review.issues.filter((issue) => issue.channel === channel).length;
    const wordCount = countWords(text);
    const sentenceCount = countSentences(text);
    const checks =
      channel === "email"
        ? checkEmail(text)
        : channel === "paid-social"
          ? checkPaidSocial(text)
          : checkSearchAds(text);
    const score = computeScore(checks, channelIssues);
    const pass = channelPass(channel, checks, channelIssues);

    reportChannels[channel] = {
      wordCount,
      sentenceCount,
      issues: channelIssues,
      score,
      checks,
      pass
    };
  }

  const pass = review.pass && Object.values(reportChannels).every((channel) => channel.pass);

  return {
    generatedAt: new Date().toISOString(),
    channels: reportChannels,
    pass
  };
}
