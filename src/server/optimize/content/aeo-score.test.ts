import { describe, expect, it } from "vitest";
import { AEO_PILLARS, aeoBand, extractOutline, parseBlocks, scoreContent } from "./aeo-score";
import { buildJsonLdString } from "./schema-ld";

const faqs = [
  { question: "How much does a balcony power plant cost?", answer: "Complete kits cost between €300 and €900 in 2026, depending on panel output and storage." },
  { question: "Do I need to register it?", answer: "Yes. In Germany you register it in the Marktstammdatenregister within one month." },
  { question: "How much power does it produce?", answer: "An 800 W system produces roughly 600–850 kWh per year on a south-facing balcony." },
  { question: "Is a battery worth it?", answer: "A 2 kWh battery raises self-consumption from about 30% to 70% for typical households." },
  { question: "Which inverter limit applies?", answer: "Since 2024 the feed-in limit is 800 VA per household under VDE-AR-N 4105." },
];

const strongBody = `**Key takeaways:** An 800 W balcony power plant costs €300–€900, pays back in 3–6 years and must be registered with the Bundesnetzagentur.

A balcony power plant (Balkonkraftwerk) is a plug-in solar system of up to 800 W that feeds electricity directly into your home circuit. In 2026 a complete kit costs €300–€900 and typically saves €150–€250 per year, according to the [Verbraucherzentrale](https://www.verbraucherzentrale.de/balkonkraftwerk).

## How much does a balcony power plant cost?

Prices depend on panel output, inverter and storage. The table compares typical 2026 prices.

| Setup | Output | Price |
|---|---|---|
| Basic kit | 800 W | €350 |
| With battery 2 kWh | 800 W | €1,200 |

## What yield can you expect?

An 800 W system on a south-facing balcony in Berlin produces about 600–850 kWh per year ([HTW Berlin](https://solar.htw-berlin.de)). East or west orientation reduces the yield by roughly 20%.

- South: 100% reference yield
- East/West: about 80%
- North: under 50%

## Which rules apply in Germany?

Since the Solarpaket I (2024) the limit is 800 VA. You register the system in the Marktstammdatenregister of the Bundesnetzagentur ([BNetzA](https://www.marktstammdatenregister.de)).

> "Plug-in solar is the fastest way for tenants to cut electricity costs." — Dr. Anna Weber, Fraunhofer ISE

## How do you install it step by step?

1. Check the balcony load and mounting options.
2. Mount the panels at 30–40° tilt.
3. Plug the inverter into a Schuko or Wieland socket.
4. Register the system online.

## Is a battery storage worth it?

A 2 kWh battery such as the Anker Solix or Zendure SolarFlow raises self-consumption from about 30% to 70%. Payback extends from 4 to roughly 7 years ([Stiftung Warentest](https://www.test.de)).

## What are the most common mistakes?

Shading, wrong tilt and missing registration are the most frequent issues reported by the Deutsche Gesellschaft für Sonnenenergie.
`;

describe("scoreContent", () => {
  it("returns 0-100 with all six pillars", () => {
    const r = scoreContent({ body: "" });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(Object.keys(r.pillars).sort()).toEqual(AEO_PILLARS.map((p) => p.key).sort());
    expect(AEO_PILLARS.reduce((a, p) => a + p.weight, 0)).toBe(100);
  });

  it("scores an empty draft as weak and tells the author what to do", () => {
    const r = scoreContent({ body: "Some text." });
    expect(r.band.key).toBe("weak");
    expect(r.suggestions.length).toBeGreaterThan(5);
    expect(r.suggestions[0]!.impact).toBeGreaterThanOrEqual(r.suggestions.at(-1)!.impact);
    expect(r.pillars.schema).toBe(0);
  });

  it("scores a well-structured, fact-dense, marked-up article highly", () => {
    const jsonLd = buildJsonLdString({
      title: "Balcony power plant 2026: costs, yield & rules",
      description: "What a balcony power plant costs",
      authorName: "Anna Weber",
      publisherName: "Solakon",
      publisherUrl: "https://solakon.de",
      faqs,
      entities: [{ name: "Balkonkraftwerk" }, { name: "Bundesnetzagentur", type: "GovernmentOrganization" }, { name: "VDE" }, { name: "Photovoltaics" }],
    });
    const r = scoreContent({
      title: "Balcony power plant 2026: costs, yield & rules",
      body: strongBody,
      metaTitle: "Balcony power plant 2026: costs, yield and rules",
      metaDescription:
        "What does a balcony power plant cost in 2026? Prices, yield per year, battery storage and the rules for registering your plug-in solar system.",
      slug: "balcony-power-plant-costs",
      schemaJsonLd: jsonLd,
      faqs,
      targetKeyword: "balcony power plant",
      targetPrompt: "How much does a balcony power plant cost?",
    });
    expect(r.pillars.schema).toBeGreaterThanOrEqual(90);
    expect(r.pillars.metadata).toBe(100);
    expect(r.pillars.structure).toBeGreaterThanOrEqual(85);
    expect(r.pillars.extractability).toBeGreaterThanOrEqual(80);
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(["primary", "strong"]).toContain(r.band.key);
    expect(r.stats.tables).toBe(1);
    expect(r.stats.questionHeadings).toBeGreaterThanOrEqual(5);
  });

  it("improves when a fix is applied (real-time rescoring)", () => {
    const base = { body: strongBody, targetKeyword: "balcony power plant" };
    const without = scoreContent(base);
    const withMeta = scoreContent({ ...base, metaTitle: "Balcony power plant costs in 2026 — full guide", metaDescription: "x".repeat(130) + " balcony power plant" });
    expect(withMeta.pillars.metadata).toBeGreaterThan(without.pillars.metadata);
    expect(withMeta.score).toBeGreaterThan(without.score);
  });

  it("flags invalid JSON-LD", () => {
    const r = scoreContent({ body: strongBody, schemaJsonLd: "{not json" });
    expect(r.pillars.schema).toBe(0);
    expect(r.suggestions.some((s) => s.pillar === "schema" && /not valid/.test(s.message))).toBe(true);
  });

  it("penalizes skipped heading levels and walls of text", () => {
    const wall = "word ".repeat(400);
    const r = scoreContent({ body: `## A\n\n#### B\n\n${wall}` });
    expect(r.suggestions.some((s) => /hierarchy/.test(s.message))).toBe(true);
    expect(r.suggestions.some((s) => /Split long paragraphs/.test(s.message))).toBe(true);
  });
});

describe("helpers", () => {
  it("bands", () => {
    expect(aeoBand(87).label).toBe("Primary Source");
    expect(aeoBand(86).label).toBe("Strong");
    expect(aeoBand(50).key).toBe("needs_work");
    expect(aeoBand(49).key).toBe("weak");
  });
  it("parses markdown blocks and outline", () => {
    const blocks = parseBlocks("# T\n\nPara one.\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n> quote\n\n```\ncode\n```");
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "list", "table", "quote", "code"]);
    expect(extractOutline("## One\ntext\n### Two")).toEqual([
      { level: 2, text: "One", line: 0 },
      { level: 3, text: "Two", line: 2 },
    ]);
  });
});
