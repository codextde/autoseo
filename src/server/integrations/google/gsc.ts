import "server-only";
import { httpJson } from "../http";
import { getGoogleAccessToken } from "./oauth";

const GSC_BASE = "https://www.googleapis.com/webmasters/v3";

export const GSC_DIMENSIONS = ["query", "page", "country", "device", "date", "searchAppearance"] as const;
export type GscDimension = (typeof GSC_DIMENSIONS)[number];
export type GscFilter = { dimension: GscDimension; operator?: "equals" | "notEquals" | "contains" | "notContains"; expression: string };
export type GscRow = { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number };

export type GscSite = { siteUrl: string; permissionLevel: string };

export type GscQueryBody = {
  startDate: string;
  endDate: string;
  dimensions?: GscDimension[];
  rowLimit?: number;
  startRow?: number;
  type?: "web" | "image" | "video" | "news" | "googleNews" | "discover";
  dataState?: "all" | "final";
  filters?: GscFilter[];
  aggregationType?: "auto" | "byPage" | "byProperty";
};

export async function gscListSites(accessToken: string): Promise<GscSite[]> {
  const res = await httpJson<{ siteEntry?: GscSite[] }>(`${GSC_BASE}/sites`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return (res.siteEntry ?? []).sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
}

/** Raw Search Analytics query. Filters are wrapped in dimensionFilterGroups (GSC ignores top-level filters). */
export async function gscQuery(accessToken: string, siteUrl: string, body: GscQueryBody): Promise<GscRow[]> {
  const payload: Record<string, unknown> = {
    startDate: body.startDate,
    endDate: body.endDate,
    dimensions: body.dimensions ?? ["query"],
    rowLimit: Math.max(1, Math.min(25_000, body.rowLimit ?? 1000)),
    type: body.type ?? "web",
    dataState: body.dataState ?? "all",
  };
  if (body.startRow && body.startRow > 0) payload.startRow = body.startRow;
  if (body.aggregationType) payload.aggregationType = body.aggregationType;
  if (body.filters?.length) {
    payload.dimensionFilterGroups = [
      {
        groupType: "and",
        filters: body.filters.map((f) => ({ dimension: f.dimension, operator: f.operator ?? "equals", expression: f.expression })),
      },
    ];
  }
  const res = await httpJson<{ rows?: GscRow[] }>(
    `${GSC_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body: payload, timeoutMs: 60_000 },
  );
  return res.rows ?? [];
}

/** Paginates a query up to `maxRows` (GSC returns ≤ 25 000 rows per request). */
export async function gscQueryAll(
  accessToken: string,
  siteUrl: string,
  body: GscQueryBody,
  maxRows = 50_000,
): Promise<GscRow[]> {
  const out: GscRow[] = [];
  const pageSize = Math.min(25_000, maxRows);
  for (let startRow = 0; startRow < maxRows; startRow += pageSize) {
    const rows = await gscQuery(accessToken, siteUrl, { ...body, rowLimit: pageSize, startRow });
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

/** Convenience: list sites for a project's connected account. */
export async function listGscSitesForProject(projectId: string): Promise<GscSite[]> {
  const token = await getGoogleAccessToken(projectId, "gsc");
  return gscListSites(token);
}

/** Convenience: query search analytics for the project's selected site. */
export async function queryGscForProject(projectId: string, siteUrl: string, body: GscQueryBody): Promise<GscRow[]> {
  const token = await getGoogleAccessToken(projectId, "gsc");
  return gscQuery(token, siteUrl, body);
}

/** GSC country codes are ISO 3166-1 alpha-3 lower case; convert to alpha-2 upper case. */
export function gscCountryToAlpha2(code: string): string {
  const c = code.trim().toUpperCase();
  return ALPHA3_TO_ALPHA2[c] ?? (c.length === 2 ? c : "");
}

const ALPHA3_TO_ALPHA2: Record<string, string> = {
  AFG: "AF", ALA: "AX", ALB: "AL", DZA: "DZ", ASM: "AS", AND: "AD", AGO: "AO", AIA: "AI", ATA: "AQ", ATG: "AG",
  ARG: "AR", ARM: "AM", ABW: "AW", AUS: "AU", AUT: "AT", AZE: "AZ", BHS: "BS", BHR: "BH", BGD: "BD", BRB: "BB",
  BLR: "BY", BEL: "BE", BLZ: "BZ", BEN: "BJ", BMU: "BM", BTN: "BT", BOL: "BO", BES: "BQ", BIH: "BA", BWA: "BW",
  BVT: "BV", BRA: "BR", IOT: "IO", BRN: "BN", BGR: "BG", BFA: "BF", BDI: "BI", CPV: "CV", KHM: "KH", CMR: "CM",
  CAN: "CA", CYM: "KY", CAF: "CF", TCD: "TD", CHL: "CL", CHN: "CN", CXR: "CX", CCK: "CC", COL: "CO", COM: "KM",
  COG: "CG", COD: "CD", COK: "CK", CRI: "CR", CIV: "CI", HRV: "HR", CUB: "CU", CUW: "CW", CYP: "CY", CZE: "CZ",
  DNK: "DK", DJI: "DJ", DMA: "DM", DOM: "DO", ECU: "EC", EGY: "EG", SLV: "SV", GNQ: "GQ", ERI: "ER", EST: "EE",
  SWZ: "SZ", ETH: "ET", FLK: "FK", FRO: "FO", FJI: "FJ", FIN: "FI", FRA: "FR", GUF: "GF", PYF: "PF", ATF: "TF",
  GAB: "GA", GMB: "GM", GEO: "GE", DEU: "DE", GHA: "GH", GIB: "GI", GRC: "GR", GRL: "GL", GRD: "GD", GLP: "GP",
  GUM: "GU", GTM: "GT", GGY: "GG", GIN: "GN", GNB: "GW", GUY: "GY", HTI: "HT", HMD: "HM", VAT: "VA", HND: "HN",
  HKG: "HK", HUN: "HU", ISL: "IS", IND: "IN", IDN: "ID", IRN: "IR", IRQ: "IQ", IRL: "IE", IMN: "IM", ISR: "IL",
  ITA: "IT", JAM: "JM", JPN: "JP", JEY: "JE", JOR: "JO", KAZ: "KZ", KEN: "KE", KIR: "KI", PRK: "KP", KOR: "KR",
  KWT: "KW", KGZ: "KG", LAO: "LA", LVA: "LV", LBN: "LB", LSO: "LS", LBR: "LR", LBY: "LY", LIE: "LI", LTU: "LT",
  LUX: "LU", MAC: "MO", MDG: "MG", MWI: "MW", MYS: "MY", MDV: "MV", MLI: "ML", MLT: "MT", MHL: "MH", MTQ: "MQ",
  MRT: "MR", MUS: "MU", MYT: "YT", MEX: "MX", FSM: "FM", MDA: "MD", MCO: "MC", MNG: "MN", MNE: "ME", MSR: "MS",
  MAR: "MA", MOZ: "MZ", MMR: "MM", NAM: "NA", NRU: "NR", NPL: "NP", NLD: "NL", NCL: "NC", NZL: "NZ", NIC: "NI",
  NER: "NE", NGA: "NG", NIU: "NU", NFK: "NF", MKD: "MK", MNP: "MP", NOR: "NO", OMN: "OM", PAK: "PK", PLW: "PW",
  PSE: "PS", PAN: "PA", PNG: "PG", PRY: "PY", PER: "PE", PHL: "PH", PCN: "PN", POL: "PL", PRT: "PT", PRI: "PR",
  QAT: "QA", REU: "RE", ROU: "RO", RUS: "RU", RWA: "RW", BLM: "BL", SHN: "SH", KNA: "KN", LCA: "LC", MAF: "MF",
  SPM: "PM", VCT: "VC", WSM: "WS", SMR: "SM", STP: "ST", SAU: "SA", SEN: "SN", SRB: "RS", SYC: "SC", SLE: "SL",
  SGP: "SG", SXM: "SX", SVK: "SK", SVN: "SI", SLB: "SB", SOM: "SO", ZAF: "ZA", SGS: "GS", SSD: "SS", ESP: "ES",
  LKA: "LK", SDN: "SD", SUR: "SR", SJM: "SJ", SWE: "SE", CHE: "CH", SYR: "SY", TWN: "TW", TJK: "TJ", TZA: "TZ",
  THA: "TH", TLS: "TL", TGO: "TG", TKL: "TK", TON: "TO", TTO: "TT", TUN: "TN", TUR: "TR", TKM: "TM", TCA: "TC",
  TUV: "TV", UGA: "UG", UKR: "UA", ARE: "AE", GBR: "GB", USA: "US", UMI: "UM", URY: "UY", UZB: "UZ", VUT: "VU",
  VEN: "VE", VNM: "VN", VGB: "VG", VIR: "VI", WLF: "WF", ESH: "EH", YEM: "YE", ZMB: "ZM", ZWE: "ZW", XKK: "XK",
};
