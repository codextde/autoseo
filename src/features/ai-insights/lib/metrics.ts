/**
 * AI visibility KPI catalogue (finseo definitions). Isomorphic: used by the server query layer
 * and the client views.
 */
export type MetricKey =
  | "visibility"
  | "mentionRate"
  | "mentions"
  | "citationRate"
  | "citations"
  | "sentiment"
  | "avgPosition"
  | "mentionDepth"
  | "sov"
  | "firstShare"
  | "top3Share"
  | "citationShare";

export type MetricFormat = "percent" | "number" | "decimal" | "score";

export type MetricDef = {
  label: string;
  format: MetricFormat;
  /** Lower is better (position, depth). */
  invert?: boolean;
  hint: string;
};

export const METRICS: Record<MetricKey, MetricDef> = {
  visibility: { label: "Visibility", format: "percent", hint: "Answers that name or cite the brand ÷ all answers." },
  mentionRate: { label: "Mention Rate", format: "percent", hint: "Answers that name the brand ÷ all answers." },
  mentions: { label: "Mentions", format: "number", hint: "Number of answers that name the brand." },
  citationRate: { label: "Citation Rate", format: "percent", hint: "Answers citing the brand's own domain ÷ all answers." },
  citations: { label: "Citations", format: "number", hint: "Citations of pages on the brand's domain." },
  sentiment: { label: "Sentiment", format: "score", hint: "0–100. 80+ strongly positive, 60–79 positive, 40–59 neutral, below 40 critical." },
  avgPosition: { label: "Avg Position", format: "decimal", invert: true, hint: "Mean ordinal position among all brands named (1 = named first). Lower is better." },
  mentionDepth: { label: "Mention Depth", format: "percent", invert: true, hint: "How far into the answer the brand first appears (0% = top). Lower is better." },
  sov: { label: "Share of Voice", format: "percent", hint: "Brand's answer appearances ÷ answer appearances of all tracked brands." },
  firstShare: { label: "#1 Share", format: "percent", hint: "Answers where the brand is named first ÷ all answers." },
  top3Share: { label: "Top-3 Share", format: "percent", hint: "Answers where the brand is among the first three brands named ÷ all answers." },
  citationShare: { label: "Citation Share", format: "percent", hint: "Citations of the brand's domain ÷ citations of all tracked brands' domains." },
};

export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];

export type MetricValues = Record<MetricKey, number | null>;

export function emptyMetrics(): MetricValues {
  return Object.fromEntries(METRIC_KEYS.map((k) => [k, null])) as MetricValues;
}

export function formatMetric(key: MetricKey, v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  const def = METRICS[key];
  switch (def.format) {
    case "percent":
      return `${v.toFixed(1)}%`;
    case "decimal":
      return v.toFixed(1);
    case "score":
      return Math.round(v).toString();
    default:
      return Math.round(v).toLocaleString("en-US");
  }
}

export function sentimentLabel(score: number | null | undefined): { label: string; tone: "strong" | "positive" | "neutral" | "critical" | "none" } {
  if (score == null) return { label: "No data", tone: "none" };
  if (score >= 80) return { label: "Strongly positive", tone: "strong" };
  if (score >= 60) return { label: "Positive", tone: "positive" };
  if (score >= 40) return { label: "Neutral", tone: "neutral" };
  return { label: "Critical", tone: "critical" };
}
