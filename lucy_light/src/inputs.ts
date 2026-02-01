export type NormalizedBrief = {
  product: string;
  category: string;
  summary: string;
  audience: string[];
  valueProps: string[];
  proofPoints: string[];
  primaryCta: string;
  secondaryCta: string;
  raw: string;
};

export type BrandVoice = {
  attributes: string[];
  doList: string[];
  doNotList: string[];
  formatting: string[];
  raw: string;
};

export type InputsBundle = {
  brief: NormalizedBrief;
  brand: BrandVoice;
  denylist: string[];
};

type SectionKey = "audience" | "valueProps" | "proofPoints";

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

function takeListItem(line: string): string | null {
  const match = line.match(/^[-*]\s+(.+)$/);
  if (!match) return null;
  return normalizeLine(match[1]);
}

export function parseBriefMarkdown(contents: string): NormalizedBrief {
  const lines = contents.split(/\r?\n/);
  let currentSection: SectionKey | null = null;

  const brief: NormalizedBrief = {
    product: "",
    category: "",
    summary: "",
    audience: [],
    valueProps: [],
    proofPoints: [],
    primaryCta: "",
    secondaryCta: "",
    raw: contents
  };

  for (const rawLine of lines) {
    const line = normalizeLine(rawLine);
    if (!line) {
      currentSection = null;
      continue;
    }

    const productMatch = line.match(/^Product:\s*(.+)$/i);
    if (productMatch) {
      brief.product = normalizeLine(productMatch[1]);
      currentSection = null;
      continue;
    }
    const categoryMatch = line.match(/^Category:\s*(.+)$/i);
    if (categoryMatch) {
      brief.category = normalizeLine(categoryMatch[1]);
      currentSection = null;
      continue;
    }
    const summaryMatch = line.match(/^Summary:\s*(.+)$/i);
    if (summaryMatch) {
      brief.summary = normalizeLine(summaryMatch[1]);
      currentSection = null;
      continue;
    }
    const primaryCtaMatch = line.match(/^Primary CTA:\s*(.+)$/i);
    if (primaryCtaMatch) {
      brief.primaryCta = normalizeLine(primaryCtaMatch[1]);
      currentSection = null;
      continue;
    }
    const secondaryCtaMatch = line.match(/^Secondary CTA:\s*(.+)$/i);
    if (secondaryCtaMatch) {
      brief.secondaryCta = normalizeLine(secondaryCtaMatch[1]);
      currentSection = null;
      continue;
    }

    if (/^Audience:$/i.test(line)) {
      currentSection = "audience";
      continue;
    }
    if (/^Value Props:$/i.test(line)) {
      currentSection = "valueProps";
      continue;
    }
    if (/^Proof Points:$/i.test(line)) {
      currentSection = "proofPoints";
      continue;
    }

    const listItem = takeListItem(line);
    if (listItem && currentSection) {
      brief[currentSection].push(listItem);
      continue;
    }
  }

  return brief;
}

export function parseBrandMarkdown(contents: string): BrandVoice {
  const lines = contents.split(/\r?\n/);
  let currentSection: "attributes" | "doList" | "doNotList" | "formatting" | null = null;

  const brand: BrandVoice = {
    attributes: [],
    doList: [],
    doNotList: [],
    formatting: [],
    raw: contents
  };

  for (const rawLine of lines) {
    const line = normalizeLine(rawLine);
    if (!line) {
      currentSection = null;
      continue;
    }

    if (/^Voice attributes:$/i.test(line)) {
      currentSection = "attributes";
      continue;
    }
    if (/^Do:$/i.test(line)) {
      currentSection = "doList";
      continue;
    }
    if (/^Do not:$/i.test(line)) {
      currentSection = "doNotList";
      continue;
    }
    if (/^Formatting:$/i.test(line)) {
      currentSection = "formatting";
      continue;
    }

    const listItem = takeListItem(line);
    if (listItem && currentSection) {
      brand[currentSection].push(listItem);
    }
  }

  return brand;
}

export function loadDenylist(contents: string): string[] {
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("#"))
    .map((line) => line.toLowerCase());
}

export function findDenylistHits(text: string, denylist: string[]): string[] {
  const haystack = text.toLowerCase();
  const hits: string[] = [];
  for (const phrase of denylist) {
    if (phrase && haystack.includes(phrase)) {
      hits.push(phrase);
    }
  }
  return hits;
}

export function assertNoDenylist(texts: string[], denylist: string[]): void {
  const combined = texts.join("\n");
  const hits = findDenylistHits(combined, denylist);
  if (hits.length > 0) {
    throw new Error(`Denylist hit(s) detected: ${hits.join(", ")}`);
  }
}

export function normalizeInputs(
  briefContents: string,
  brandContents: string,
  denylistContents: string
): InputsBundle {
  const brief = parseBriefMarkdown(briefContents);
  const brand = parseBrandMarkdown(brandContents);
  const denylist = loadDenylist(denylistContents);

  return {
    brief,
    brand,
    denylist
  };
}
