import "server-only";
import { httpJson, IntegrationHttpError } from "../http";
import { getGoogleAccessToken } from "./oauth";

const ADMIN_BETA = "https://analyticsadmin.googleapis.com/v1beta";
const ADMIN_ALPHA = "https://analyticsadmin.googleapis.com/v1alpha";
const DATA_BASE = "https://analyticsdata.googleapis.com/v1beta";

export type Ga4PropertySummary = {
  propertyId: string; // "properties/123"
  displayName: string;
  accountDisplayName: string;
};

export type Ga4PropertyDetails = {
  name: string;
  displayName: string;
  timeZone: string;
  currencyCode: string;
};

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** Numeric id from "properties/123" or "123". */
export function ga4PropertyNumber(propertyId: string): string {
  const m = propertyId.match(/(\d+)$/);
  if (!m) throw new Error("Invalid GA4 property id");
  return m[1]!;
}

export async function ga4ListProperties(accessToken: string): Promise<Ga4PropertySummary[]> {
  const out: Ga4PropertySummary[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 100; i++) {
    const qs = new URLSearchParams({ pageSize: "200" });
    if (pageToken) qs.set("pageToken", pageToken);
    const res = await httpJson<{
      accountSummaries?: {
        displayName?: string;
        propertySummaries?: { property: string; displayName?: string }[];
      }[];
      nextPageToken?: string;
    }>(`${ADMIN_BETA}/accountSummaries?${qs}`, { headers: bearer(accessToken) });
    for (const acc of res.accountSummaries ?? []) {
      for (const prop of acc.propertySummaries ?? []) {
        out.push({ propertyId: prop.property, displayName: prop.displayName ?? prop.property, accountDisplayName: acc.displayName ?? "" });
      }
    }
    if (!res.nextPageToken) break;
    pageToken = res.nextPageToken;
  }
  return out;
}

export async function ga4GetProperty(accessToken: string, propertyId: string): Promise<Ga4PropertyDetails> {
  const res = await httpJson<Partial<Ga4PropertyDetails>>(`${ADMIN_BETA}/properties/${ga4PropertyNumber(propertyId)}`, {
    headers: bearer(accessToken),
  });
  return {
    name: res.name ?? propertyId,
    displayName: res.displayName ?? propertyId,
    timeZone: res.timeZone ?? "UTC",
    currencyCode: res.currencyCode ?? "USD",
  };
}

async function listPaged<T>(accessToken: string, url: string, key: string): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 20; i++) {
    const sep = url.includes("?") ? "&" : "?";
    const res = await httpJson<Record<string, unknown>>(`${url}${sep}pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, {
      headers: bearer(accessToken),
    });
    out.push(...((res[key] as T[] | undefined) ?? []));
    pageToken = res.nextPageToken as string | undefined;
    if (!pageToken) break;
  }
  return out;
}

export type Ga4DataStream = {
  name: string;
  type: string;
  displayName?: string;
  createTime?: string;
  updateTime?: string;
  webStreamData?: { measurementId?: string; defaultUri?: string };
};

export async function ga4ListDataStreams(accessToken: string, propertyId: string) {
  return listPaged<Ga4DataStream>(accessToken, `${ADMIN_BETA}/properties/${ga4PropertyNumber(propertyId)}/dataStreams`, "dataStreams");
}

export type Ga4EnhancedMeasurement = {
  streamEnabled?: boolean;
  scrollsEnabled?: boolean;
  outboundClicksEnabled?: boolean;
  siteSearchEnabled?: boolean;
  videoEngagementEnabled?: boolean;
  fileDownloadsEnabled?: boolean;
  pageChangesEnabled?: boolean;
  formInteractionsEnabled?: boolean;
  searchQueryParameter?: string;
  uriQueryParameter?: string;
};

export async function ga4GetEnhancedMeasurement(accessToken: string, streamName: string): Promise<Ga4EnhancedMeasurement | null> {
  try {
    return await httpJson<Ga4EnhancedMeasurement>(`${ADMIN_ALPHA}/${streamName}/enhancedMeasurementSettings`, {
      headers: bearer(accessToken),
    });
  } catch (err) {
    if (err instanceof IntegrationHttpError && (err.status === 403 || err.status === 404)) return null;
    throw err;
  }
}

export async function ga4ListKeyEvents(accessToken: string, propertyId: string) {
  return listPaged<{ name: string; eventName: string; countingMethod?: string; createTime?: string }>(
    accessToken,
    `${ADMIN_BETA}/properties/${ga4PropertyNumber(propertyId)}/keyEvents`,
    "keyEvents",
  );
}

export async function ga4ListCustomDefinitions(accessToken: string, propertyId: string) {
  const n = ga4PropertyNumber(propertyId);
  const [dimensions, metrics] = await Promise.all([
    listPaged<{ parameterName: string; displayName: string; scope?: string }>(accessToken, `${ADMIN_BETA}/properties/${n}/customDimensions`, "customDimensions"),
    listPaged<{ parameterName: string; displayName: string; measurementUnit?: string; scope?: string }>(
      accessToken,
      `${ADMIN_BETA}/properties/${n}/customMetrics`,
      "customMetrics",
    ),
  ]);
  return { dimensions, metrics };
}

/* ───────────────────────────── Data API ───────────────────────────── */

export type Ga4Filter =
  | { filter: { fieldName: string; stringFilter?: { matchType: string; value: string; caseSensitive?: boolean }; inListFilter?: { values: string[]; caseSensitive?: boolean }; numericFilter?: { operation: string; value: { int64Value?: string; doubleValue?: number } } } }
  | { andGroup: { expressions: Ga4Filter[] } }
  | { orGroup: { expressions: Ga4Filter[] } }
  | { notExpression: Ga4Filter };

export type Ga4ReportRequest = {
  dateRanges: { startDate: string; endDate: string }[];
  dimensions?: string[];
  metrics: string[];
  dimensionFilter?: Ga4Filter;
  metricFilter?: Ga4Filter;
  orderBys?: ({ metric: { metricName: string }; desc?: boolean } | { dimension: { dimensionName: string }; desc?: boolean })[];
  limit?: number;
  offset?: number;
  keepEmptyRows?: boolean;
};

export type Ga4ReportMetadata = {
  dataLossFromOtherRow: boolean;
  subjectToThresholding: boolean;
  sampling: { samplesReadCount?: string; samplingSpaceSize?: string }[];
  restrictedMetrics: string[];
  emptyReason: string | null;
  currencyCode: string | null;
  timeZone: string | null;
  hasLimitedData: boolean;
};

export type Ga4Quota = Record<string, { consumed?: number; remaining?: number }>;

export type Ga4Report = {
  rows: Record<string, string | number | null>[];
  rowCount: number;
  metadata: Ga4ReportMetadata;
  quota: Ga4Quota | null;
};

type RawReport = {
  dimensionHeaders?: { name: string }[];
  metricHeaders?: { name: string; type?: string }[];
  rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[];
  rowCount?: number;
  metadata?: {
    dataLossFromOtherRow?: boolean;
    subjectToThresholding?: boolean;
    samplingMetadatas?: { samplesReadCount?: string; samplingSpaceSize?: string }[];
    schemaRestrictionResponse?: { activeMetricRestrictions?: { metricName?: string }[] };
    emptyReason?: string;
    currencyCode?: string;
    timeZone?: string;
  };
  propertyQuota?: Ga4Quota;
};

export class Ga4MalformedResponseError extends Error {}

/** Normalizes a runReport response (open-seo `normalizeGa4Response`). Restricted metrics become null. */
export function normalizeGa4Report(req: Ga4ReportRequest, raw: RawReport): Ga4Report {
  const dims = req.dimensions ?? [];
  const dimHeaders = (raw.dimensionHeaders ?? []).map((h) => h.name);
  const metHeaders = (raw.metricHeaders ?? []).map((h) => h.name);
  const headerless = !raw.dimensionHeaders && !raw.metricHeaders && !raw.rows?.length;
  if (!headerless) {
    if (dimHeaders.join("|") !== dims.join("|") || metHeaders.join("|") !== req.metrics.join("|")) {
      throw new Ga4MalformedResponseError("Google Analytics returned unexpected report headers.");
    }
  }
  const restricted = new Set(
    (raw.metadata?.schemaRestrictionResponse?.activeMetricRestrictions ?? []).map((r) => r.metricName ?? "").filter(Boolean),
  );
  const rows = (raw.rows ?? []).map((r) => {
    const out: Record<string, string | number | null> = {};
    dims.forEach((d, i) => (out[d] = r.dimensionValues?.[i]?.value ?? ""));
    req.metrics.forEach((m, i) => {
      if (restricted.has(m)) {
        out[m] = null;
        return;
      }
      const n = Number(r.metricValues?.[i]?.value ?? "");
      out[m] = Number.isFinite(n) ? n : null;
    });
    return out;
  });
  const sampling = raw.metadata?.samplingMetadatas ?? [];
  const metadata: Ga4ReportMetadata = {
    dataLossFromOtherRow: !!raw.metadata?.dataLossFromOtherRow,
    subjectToThresholding: !!raw.metadata?.subjectToThresholding,
    sampling,
    restrictedMetrics: [...restricted],
    emptyReason: raw.metadata?.emptyReason ?? null,
    currencyCode: raw.metadata?.currencyCode ?? null,
    timeZone: raw.metadata?.timeZone ?? null,
    hasLimitedData: !!raw.metadata?.dataLossFromOtherRow || !!raw.metadata?.subjectToThresholding || sampling.length > 0 || restricted.size > 0,
  };
  return { rows, rowCount: raw.rowCount ?? rows.length, metadata, quota: raw.propertyQuota ?? null };
}

export async function ga4RunReport(accessToken: string, propertyId: string, req: Ga4ReportRequest): Promise<Ga4Report> {
  const body: Record<string, unknown> = {
    dateRanges: req.dateRanges,
    dimensions: (req.dimensions ?? []).map((name) => ({ name })),
    metrics: req.metrics.map((name) => ({ name })),
    limit: String(Math.max(1, Math.min(250_000, req.limit ?? 10_000))),
    offset: String(Math.max(0, req.offset ?? 0)),
    keepEmptyRows: req.keepEmptyRows ?? false,
    returnPropertyQuota: true,
  };
  if (req.dimensionFilter) body.dimensionFilter = req.dimensionFilter;
  if (req.metricFilter) body.metricFilter = req.metricFilter;
  if (req.orderBys) body.orderBys = req.orderBys;
  const raw = await httpJson<RawReport>(`${DATA_BASE}/properties/${ga4PropertyNumber(propertyId)}:runReport`, {
    method: "POST",
    headers: bearer(accessToken),
    body,
    timeoutMs: 60_000,
  });
  return normalizeGa4Report(req, raw);
}

/** Runs a report and pages through all rows (up to maxRows). */
export async function ga4RunReportAll(
  accessToken: string,
  propertyId: string,
  req: Ga4ReportRequest,
  maxRows = 100_000,
): Promise<Ga4Report> {
  const pageSize = Math.min(req.limit ?? 10_000, 100_000);
  const first = await ga4RunReport(accessToken, propertyId, { ...req, limit: pageSize, offset: 0 });
  const rows = [...first.rows];
  let offset = pageSize;
  while (rows.length < first.rowCount && rows.length < maxRows) {
    const next = await ga4RunReport(accessToken, propertyId, { ...req, limit: pageSize, offset });
    if (!next.rows.length) break;
    rows.push(...next.rows);
    offset += pageSize;
  }
  return { ...first, rows: rows.slice(0, maxRows) };
}

export async function ga4ListPropertiesForProject(projectId: string) {
  const token = await getGoogleAccessToken(projectId, "ga4");
  return ga4ListProperties(token);
}
