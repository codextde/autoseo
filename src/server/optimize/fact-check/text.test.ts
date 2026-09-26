import { describe, expect, it } from "vitest";
import {
  claimHash,
  extractCandidateStatements,
  extractNumbers,
  findQuote,
  lexicalJudge,
  mentionsAsset,
  normalizeClaim,
  relevantSections,
  splitSections,
  splitSentences,
  type JudgeSection,
} from "./text";

const LABEL = `SUMMARY OF PRODUCT CHARACTERISTICS

1. Name of the medicinal product
Examplol 500 mg film-coated tablets

4.1 Therapeutic indications
Examplol is indicated for the short-term treatment of mild to moderate pain and fever in adults.

4.2 Posology and method of administration
Adults take 1 tablet up to 3 times daily. The maximum daily dose is 1500 mg.
Do not use in children under 12 years.

4.3 Contraindications
Hypersensitivity to the active substance. Severe hepatic impairment.`;

function sectionsOf(text: string, opts: { superseded?: boolean; id?: string } = {}): JudgeSection[] {
  return splitSections(text).map((s) => ({ ...s, documentId: opts.id ?? "doc1", documentTitle: "SmPC", superseded: opts.superseded }));
}

describe("splitSections", () => {
  it("splits numbered and ALL-CAPS label headings", () => {
    const s = splitSections(LABEL);
    const headings = s.map((x) => x.heading);
    expect(headings).toContain("4.1 Therapeutic indications");
    expect(headings).toContain("4.2 Posology and method of administration");
    expect(headings).toContain("4.3 Contraindications");
    const posology = s.find((x) => x.heading.startsWith("4.2"))!;
    expect(posology.text).toContain("maximum daily dose is 1500 mg");
    expect(s.every((x) => x.text.length > 0)).toBe(true);
  });

  it("supports markdown headings", () => {
    const s = splitSections("# Usage\nTake twice daily.\n\n## Storage\nKeep below 25 °C.");
    expect(s.map((x) => x.heading)).toEqual(["Usage", "Storage"]);
  });

  it("chunks text without headings into parts", () => {
    const text = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} ${"lorem ipsum ".repeat(40)}`).join("\n\n");
    const s = splitSections(text, 1000);
    expect(s.length).toBeGreaterThan(1);
    expect(s[0]!.heading).toBe("Part 1");
  });
});

describe("sentences & numbers", () => {
  it("does not split on common abbreviations", () => {
    expect(splitSentences("Take 2 tablets, e.g. after meals. Then rest.")).toEqual(["Take 2 tablets, e.g. after meals.", "Then rest."]);
  });
  it("normalizes decimal commas", () => {
    expect(extractNumbers("2,5 mg and 10 ml")).toEqual(["2.5", "10"]);
  });
});

describe("claim normalization & hashing", () => {
  it("is insensitive to case, markdown and trailing punctuation", () => {
    expect(normalizeClaim("**Examplol** is indicated for PAIN.")).toBe(normalizeClaim("examplol is indicated for pain"));
  });
  it("hashes per asset, engine and market", () => {
    const a = claimHash("fca_1", "Examplol treats pain.", "chatgpt", "de");
    expect(a).toBe(claimHash("fca_1", "examplol treats pain", "chatgpt", "DE"));
    expect(a).not.toBe(claimHash("fca_1", "examplol treats pain", "perplexity", "DE"));
    expect(a).not.toBe(claimHash("fca_2", "examplol treats pain", "chatgpt", "DE"));
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("mentions & fallback extraction", () => {
  it("matches names on word boundaries", () => {
    expect(mentionsAsset("I recommend Examplol for headaches", ["Examplol"])).toBe(true);
    expect(mentionsAsset("Examplolix is different", ["Examplol"])).toBe(false);
    expect(mentionsAsset("Try examplol-500", ["Examplol"])).toBe(true);
  });
  it("keeps factual sentences that mention the asset", () => {
    const answer =
      "## Options\n- **Examplol** is indicated for mild to moderate pain in adults.\n- What about Examplol?\nIbuprofen is also common. Examplol has a maximum daily dose of 1500 mg.";
    const out = extractCandidateStatements(answer, ["Examplol"]);
    expect(out.map((o) => o.claim)).toEqual([
      "Examplol is indicated for mild to moderate pain in adults.",
      "Examplol has a maximum daily dose of 1500 mg.",
    ]);
  });
});

describe("lexicalJudge", () => {
  const sections = sectionsOf(LABEL);

  it("matches statements that appear word-for-word in the label", () => {
    const r = lexicalJudge("The maximum daily dose of Examplol is 1500 mg.", sections);
    expect(r.verdict).toBe("matched");
    expect(r.labelSection).toBe("4.2 Posology and method of administration");
    expect(r.labelQuote).toContain("1500 mg");
  });

  it("flags different figures as contradicted (critical for dosing)", () => {
    const r = lexicalJudge("The maximum daily dose of Examplol is 4000 mg.", sections);
    expect(r.verdict).toBe("contradicted");
    expect(r.severity).toBe("critical");
  });

  it("detects statements that only match a superseded label", () => {
    const old = sectionsOf("4.2 Posology\nThe maximum daily dose is 4000 mg.", { superseded: true, id: "old" });
    const r = lexicalJudge("The maximum daily dose of Examplol is 4000 mg.", [...sections, ...old]);
    expect(r.verdict).toBe("outdated");
  });

  it("leaves unrelated claims for human review", () => {
    const r = lexicalJudge("Examplol is the best-selling brand in Brazil.", sections);
    expect(r.verdict).toBe("needs_review");
  });
});

describe("relevance & quote validation", () => {
  it("ranks sections by overlap", () => {
    const s = splitSections(LABEL);
    const top = relevantSections(s, ["contraindications hepatic impairment"], 1);
    expect(top[0]!.heading).toBe("4.3 Contraindications");
  });
  it("finds verbatim quotes modulo punctuation", () => {
    expect(findQuote("maximum daily dose is 1500 mg", LABEL).found).toBe(true);
    expect(findQuote("Examplol cures cancer", LABEL).found).toBe(false);
  });
});
