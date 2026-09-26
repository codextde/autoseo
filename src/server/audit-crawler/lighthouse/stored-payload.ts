/**
 * Compact stored Lighthouse payload v2 (port of open-seo `lighthouseStoredPayload.ts` +
 * `dataforseoLighthousePayload.ts`). Works for both PageSpeed Insights (`lighthouseResult`) and
 * DataForSEO On-Page Lighthouse (`tasks[0].result[0]`) since both return a Lighthouse report.
 */
import { z } from "zod";
import { LIGHTHOUSE_CATEGORIES, type LighthouseCategory } from "../registry";

export type RawLighthouseAudit = {
  title?: string;
  description?: string;
  score?: number | null;
  scoreDisplayMode?: string;
  displayValue?: string;
  numericValue?: number;
  details?: {
    overallSavingsMs?: number;
    overallSavingsBytes?: number;
    items?: Array<Record<string, unknown>> | Record<string, unknown>;
  };
};

export type RawLighthouseCategory = {
  score?: number | null;
  auditRefs?: Array<{ id?: string }>;
};

export type RawLighthouseReport = {
  requestedUrl?: string;
  finalUrl?: string;
  finalDisplayedUrl?: string;
  lighthouseVersion?: string;
  categories?: Record<string, RawLighthouseCategory>;
  audits?: Record<string, RawLighthouseAudit>;
  runtimeError?: { code?: string; message?: string };
};

const storedLighthouseMetricSchema = z.object({
  score: z.number().nullable(),
  displayValue: z.string().nullable(),
  numericValue: z.number().nullable(),
});

const storedLighthouseMetricsSchema = z.object({
  firstContentfulPaint: storedLighthouseMetricSchema,
  largestContentfulPaint: storedLighthouseMetricSchema,
  totalBlockingTime: storedLighthouseMetricSchema,
  cumulativeLayoutShift: storedLighthouseMetricSchema,
  speedIndex: storedLighthouseMetricSchema,
  timeToInteractive: storedLighthouseMetricSchema,
  interactionToNextPaint: storedLighthouseMetricSchema,
  serverResponseTime: storedLighthouseMetricSchema,
});

export const storedLighthouseIssueSchema = z.object({
  category: z.enum(LIGHTHOUSE_CATEGORIES),
  auditKey: z.string(),
  title: z.string(),
  description: z.string(),
  score: z.number().nullable(),
  scoreDisplayMode: z.string().nullable(),
  displayValue: z.string().nullable(),
  impactMs: z.number().nullable(),
  impactBytes: z.number().nullable(),
  severity: z.enum(["critical", "warning", "info"]),
  items: z.array(z.string()),
});

export const storedLighthousePayloadSchema = z.object({
  version: z.literal(2),
  source: z.enum(["dataforseo-lighthouse", "pagespeed-insights"]),
  hasIssueDetails: z.boolean(),
  metadata: z.object({
    requestedUrl: z.string(),
    finalUrl: z.string(),
    strategy: z.enum(["mobile", "desktop"]),
    fetchedAt: z.string(),
    lighthouseVersion: z.string().nullable(),
    taskId: z.string().nullable(),
    cost: z.number().nullable(),
  }),
  scores: z.object({
    performance: z.number().nullable(),
    accessibility: z.number().nullable(),
    "best-practices": z.number().nullable(),
    seo: z.number().nullable(),
  }),
  metrics: storedLighthouseMetricsSchema,
  issues: z.array(storedLighthouseIssueSchema),
});

export type StoredLighthouseMetric = z.infer<typeof storedLighthouseMetricSchema>;
export type StoredLighthouseMetrics = z.infer<typeof storedLighthouseMetricsSchema>;
export type StoredLighthouseIssue = z.infer<typeof storedLighthouseIssueSchema>;
export type StoredLighthousePayload = z.infer<typeof storedLighthousePayloadSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function scoreToPercent(score: number | null | undefined): number | null {
  if (typeof score !== "number" || Number.isNaN(score)) return null;
  return Math.round(score * 100);
}

function buildStoredMetric(audit: RawLighthouseAudit | undefined): StoredLighthouseMetric {
  return {
    score: scoreToPercent(audit?.score),
    displayValue: audit?.displayValue ?? null,
    numericValue: typeof audit?.numericValue === "number" ? audit.numericValue : null,
  };
}

const DIAGNOSTIC_AUDIT_KEYS = new Set([
  "largest-contentful-paint-element",
  "layout-shifts",
  "diagnostics",
  "metrics",
  "network-requests",
  "network-rtt",
  "network-server-latency",
  "main-thread-tasks",
  "screenshot-thumbnails",
  "final-screenshot",
  "script-treemap-data",
  "resource-summary",
]);

function compactItem(item: Record<string, unknown>): string {
  const preferredKeys = ["url", "source", "nodeLabel", "snippet", "totalBytes", "wastedBytes", "wastedMs", "label", "value"];
  const output: Record<string, unknown> = {};
  for (const key of preferredKeys) if (item[key] != null) output[key] = item[key];
  if (Object.keys(output).length === 0) for (const [key, value] of Object.entries(item).slice(0, 6)) output[key] = value;
  const json = JSON.stringify(output);
  return json.length > 2000 ? `${json.slice(0, 1997)}...` : json;
}

export function getLighthouseSeverity(input: {
  score: number | null;
  impactMs: number | null;
  impactBytes: number | null;
}): "critical" | "warning" | "info" {
  if ((input.impactMs ?? 0) >= 300 || (input.impactBytes ?? 0) >= 150_000) return "critical";
  if (input.score != null && input.score < 50) return "critical";
  if ((input.impactMs ?? 0) >= 100 || (input.impactBytes ?? 0) >= 50_000) return "warning";
  if (input.score != null && input.score < 90) return "warning";
  return "info";
}

export function buildStoredLighthouseIssues(input: {
  audits: Record<string, RawLighthouseAudit>;
  categories: Record<string, RawLighthouseCategory>;
}): { hasIssueDetails: boolean; issues: StoredLighthouseIssue[] } {
  const hasIssueDetails = LIGHTHOUSE_CATEGORIES.some((category) => (input.categories[category]?.auditRefs?.length ?? 0) > 0);
  const issues: StoredLighthouseIssue[] = [];
  for (const category of LIGHTHOUSE_CATEGORIES) {
    const rawRefs = input.categories[category]?.auditRefs;
    const refs = Array.isArray(rawRefs) ? rawRefs : [];
    for (const ref of refs) {
      const auditKey = ref?.id;
      if (!auditKey) continue;
      const audit = input.audits[auditKey];
      if (!audit) continue;
      const score = scoreToPercent(audit.score);
      const scoreDisplayMode = audit.scoreDisplayMode ?? null;
      if (scoreDisplayMode === "numeric") continue;
      if (DIAGNOSTIC_AUDIT_KEYS.has(auditKey)) continue;
      const isPass =
        score == null ||
        score >= 90 ||
        scoreDisplayMode === "notApplicable" ||
        scoreDisplayMode === "informative" ||
        scoreDisplayMode === "manual" ||
        scoreDisplayMode === "error";
      if (isPass) continue;
      const impactMs = typeof audit.details?.overallSavingsMs === "number" ? audit.details.overallSavingsMs : null;
      const impactBytes = typeof audit.details?.overallSavingsBytes === "number" ? audit.details.overallSavingsBytes : null;
      const rawItems = audit.details?.items;
      const itemList = Array.isArray(rawItems) ? rawItems : isRecord(rawItems) ? [rawItems] : [];
      const items = itemList.filter(isRecord).slice(0, 10).map(compactItem);
      issues.push({
        category,
        auditKey,
        title: String(audit.title ?? auditKey),
        description: String(audit.description ?? ""),
        score,
        scoreDisplayMode,
        displayValue: audit.displayValue != null ? String(audit.displayValue) : null,
        impactMs,
        impactBytes,
        severity: getLighthouseSeverity({ score, impactMs, impactBytes }),
        items,
      });
    }
  }
  return { hasIssueDetails, issues };
}

export function buildStoredLighthouseMetrics(input: { audits: Record<string, RawLighthouseAudit> }): StoredLighthouseMetrics {
  return {
    firstContentfulPaint: buildStoredMetric(input.audits["first-contentful-paint"]),
    largestContentfulPaint: buildStoredMetric(input.audits["largest-contentful-paint"]),
    totalBlockingTime: buildStoredMetric(input.audits["total-blocking-time"]),
    cumulativeLayoutShift: buildStoredMetric(input.audits["cumulative-layout-shift"]),
    speedIndex: buildStoredMetric(input.audits["speed-index"]),
    timeToInteractive: buildStoredMetric(input.audits.interactive),
    interactionToNextPaint: buildStoredMetric(input.audits["interaction-to-next-paint"]),
    serverResponseTime: buildStoredMetric(input.audits["server-response-time"]),
  };
}

/** Reduces a raw Lighthouse report into the compact stored payload (throws when unusable). */
export function buildStoredPayloadFromReport(
  report: RawLighthouseReport,
  input: {
    url: string;
    strategy: "mobile" | "desktop";
    source: StoredLighthousePayload["source"];
    taskId?: string | null;
    cost?: number | null;
  },
): StoredLighthousePayload {
  if (report.runtimeError?.code && report.runtimeError.code !== "NO_ERROR") {
    throw new Error(
      `Lighthouse encountered an error with the following code: ${report.runtimeError.code}${report.runtimeError.message ? ` — ${report.runtimeError.message}` : ""}`,
    );
  }
  const categories = report.categories ?? {};
  const audits = report.audits ?? {};
  const issueReport = buildStoredLighthouseIssues({ audits, categories });
  const payload: StoredLighthousePayload = {
    version: 2,
    source: input.source,
    hasIssueDetails: issueReport.hasIssueDetails,
    metadata: {
      requestedUrl: report.requestedUrl ?? input.url,
      finalUrl: report.finalDisplayedUrl ?? report.finalUrl ?? input.url,
      strategy: input.strategy,
      fetchedAt: new Date().toISOString(),
      lighthouseVersion: report.lighthouseVersion ?? null,
      taskId: input.taskId ?? null,
      cost: input.cost ?? null,
    },
    scores: {
      performance: scoreToPercent(categories.performance?.score),
      accessibility: scoreToPercent(categories.accessibility?.score),
      "best-practices": scoreToPercent(categories["best-practices"]?.score),
      seo: scoreToPercent(categories.seo?.score),
    },
    metrics: buildStoredLighthouseMetrics({ audits }),
    issues: issueReport.issues,
  };
  if (Object.values(payload.scores).every((s) => s == null)) {
    throw new Error(`Lighthouse returned no category scores for ${payload.metadata.finalUrl}`);
  }
  const validated = storedLighthousePayloadSchema.safeParse(payload);
  if (!validated.success) {
    throw new Error(
      `Lighthouse returned an invalid report: ${validated.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; ")}`,
    );
  }
  return validated.data;
}

/** Display sort: impact desc (ms weighted), then score asc. */
export function sortLighthouseIssues(issues: StoredLighthouseIssue[]): StoredLighthouseIssue[] {
  return [...issues].sort((a, b) => {
    const ia = (a.impactMs ?? 0) * 1000 + (a.impactBytes ?? 0);
    const ib = (b.impactMs ?? 0) * 1000 + (b.impactBytes ?? 0);
    if (ib !== ia) return ib - ia;
    return (a.score ?? 100) - (b.score ?? 100);
  });
}

export function parseStoredLighthousePayload(value: unknown): StoredLighthousePayload | null {
  const parsed = storedLighthousePayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function filterIssuesByCategory(issues: StoredLighthouseIssue[], category?: LighthouseCategory | "all") {
  return !category || category === "all" ? issues : issues.filter((i) => i.category === category);
}
