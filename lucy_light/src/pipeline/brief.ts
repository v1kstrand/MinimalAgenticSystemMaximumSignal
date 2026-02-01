import type { BrandVoice } from "../inputs";
import type { ResearchSummary } from "./types";

function listSection(title: string, items: string[]): string {
  if (items.length === 0) {
    return `${title}\n- (none)\n`;
  }
  const lines = items.map((item) => `- ${item}`);
  return `${title}\n${lines.join("\n")}\n`;
}

export function buildCampaignBrief(research: ResearchSummary, brand: BrandVoice): string {
  const sections = [
    `# Campaign Brief`,
    ``,
    `Product: ${research.product}`,
    `Summary: ${research.summary}`,
    ``,
    listSection("Audience", research.audience),
    listSection("Value Props", research.valueProps),
    listSection("Proof Points", research.proofPoints),
    ``,
    `Primary CTA: ${research.primaryCta || "Book a demo"}`,
    `Secondary CTA: ${research.secondaryCta || "Download the playbook"}`,
    ``,
    listSection("Brand Attributes", brand.attributes),
    listSection("Brand Do", brand.doList),
    listSection("Brand Do Not", brand.doNotList)
  ];

  return sections.join("\n").trim() + "\n";
}
