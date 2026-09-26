/**
 * Access-log parsing (pure). Supports:
 *  - nginx / Apache "combined", "common" and "vhost_combined"
 *  - Cloudflare Logpush JSON (http_requests dataset)
 *  - Akamai DataStream 2 JSON
 *  - native NDJSON ({timestamp, ip, user_agent, path, status, method, host, bytes})
 *  - W3C extended (IIS, with a `#Fields:` header) and a heuristic "custom" fallback
 */

export type LogFormat = "combined" | "cloudflare" | "akamai" | "ndjson" | "w3c" | "custom";
/** Formats selectable in the UI ("nginx"/"apache" are both the combined format). */
export type LogFormatOption = "auto" | "nginx" | "apache" | "cloudflare" | "akamai" | "ndjson" | "custom";

export type ParsedHit = {
  ts: Date;
  ip: string | null;
  method: string | null;
  path: string;
  status: number | null;
  userAgent: string;
  host: string | null;
  bytes: number | null;
  referer: string | null;
};

const MAX_PATH = 2048;
/** Longer lines are rejected before any regex runs (keeps worst-case parsing linear-ish). */
export const MAX_LINE_LENGTH = 8192;
/** JSON-array ingest bodies above this size are rejected (arrays are parsed in one piece). */
export const MAX_JSON_ARRAY_BYTES = 8 * 1024 * 1024;
const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

export function normalizeFormatOption(option: string | null | undefined): LogFormat | "auto" {
  switch ((option ?? "auto").toLowerCase()) {
    case "nginx":
    case "apache":
    case "combined":
      return "combined";
    case "cloudflare":
      return "cloudflare";
    case "akamai":
      return "akamai";
    case "ndjson":
    case "json":
      return "ndjson";
    case "w3c":
    case "iis":
      return "w3c";
    case "custom":
      return "custom";
    default:
      return "auto";
  }
}

/* ───────────────────────────── helpers ───────────────────────────── */

/** "10/Oct/2000:13:55:36 -0700" → Date */
export function parseClfTime(value: string): Date | null {
  const m = value.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:\s*([+-])(\d{2}):?(\d{2}))?$/);
  if (!m) return null;
  const month = MONTHS[m[2]!.toLowerCase()];
  if (month === undefined) return null;
  let ms = Date.UTC(Number(m[3]), month, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]));
  if (m[7]) {
    const offset = (Number(m[8]) * 60 + Number(m[9])) * 60_000;
    ms += m[7] === "+" ? -offset : offset;
  }
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Numbers: unix s / ms / µs / ns; strings: ISO 8601, CLF, or numeric strings. */
export function parseTimestamp(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number" || (typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim()))) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    let ms: number;
    if (n > 1e17) ms = n / 1e6; // ns
    else if (n > 1e14) ms = n / 1e3; // µs
    else if (n > 1e11) ms = n; // ms
    else ms = n * 1000; // s
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value !== "string") return null;
  const s = value.trim();
  const clf = parseClfTime(s.replace(/^\[|\]$/g, ""));
  if (clf) return clf;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    // "2024-05-01 12:00:00" (no zone) is treated as UTC.
    const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s.replace(" ", "T") : `${s.replace(" ", "T")}Z`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Splits a URL or request target into path(+query) and host. */
export function splitTarget(target: string | null | undefined): { path: string; host: string | null } {
  let t = (target ?? "").trim();
  if (!t) return { path: "/", host: null };
  let host: string | null = null;
  const abs = t.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)(.*)$/i);
  if (abs) {
    host = abs[1]!.replace(/^[^@]*@/, "").toLowerCase();
    t = abs[2] || "/";
  }
  if (!t.startsWith("/") && !t.startsWith("*")) t = `/${t}`;
  const hashIdx = t.indexOf("#");
  if (hashIdx >= 0) t = t.slice(0, hashIdx);
  return { path: t.slice(0, MAX_PATH), host };
}

function toInt(v: unknown): number | null {
  if (v == null || v === "" || v === "-") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s && s !== "-" ? s : null;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, "%20"));
  } catch {
    return s;
  }
}

function unescapeQuoted(s: string): string {
  return s.replace(/\\x([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16))).replace(/\\(["\\])/g, "$1");
}

/* ───────────────────────────── combined / common ───────────────────────────── */

const COMBINED_RE =
  /^(?:(\S+?)(?::\d+)?\s+)?(\S+)\s+\S+\s+(?:\S+|"[^"]*")\s+\[([^\]]+)\]\s+"((?:[^"\\]|\\.)*)"\s+(\d{3}|-)\s+(\d+|-)(?:\s+"((?:[^"\\]|\\.)*)"\s+"((?:[^"\\]|\\.)*)")?/;

export function parseCombinedLine(line: string): ParsedHit | null {
  const m = COMBINED_RE.exec(line);
  if (!m) return null;
  const ts = parseClfTime(m[3]!);
  if (!ts) return null;
  const request = unescapeQuoted(m[4] ?? "");
  const reqMatch = request.match(/^([A-Z]{3,10})\s+(\S+)(?:\s+HTTP\/[\d.]+)?$/);
  const { path, host } = splitTarget(reqMatch ? reqMatch[2] : request.split(/\s+/)[1] ?? "/");
  return {
    ts,
    ip: str(m[2]),
    method: reqMatch?.[1] ?? null,
    path,
    status: toInt(m[5]),
    userAgent: m[8] !== undefined ? unescapeQuoted(m[8]) : "",
    host: host ?? (m[1] && /[a-z]/i.test(m[1]) ? m[1].toLowerCase() : null),
    bytes: toInt(m[6]),
    referer: m[7] !== undefined ? str(unescapeQuoted(m[7])) : null,
  };
}

/* ───────────────────────────── JSON records ───────────────────────────── */

type Rec = Record<string, unknown>;

function pick(rec: Rec, keys: string[]): unknown {
  for (const k of keys) {
    if (rec[k] !== undefined && rec[k] !== null && rec[k] !== "") return rec[k];
  }
  return undefined;
}

export function isCloudflareRecord(rec: Rec): boolean {
  return "ClientRequestUserAgent" in rec || "EdgeStartTimestamp" in rec || "ClientRequestURI" in rec;
}

export function isAkamaiRecord(rec: Rec): boolean {
  return "reqTimeSec" in rec || "cliIP" in rec || ("UA" in rec && "statusCode" in rec);
}

export function parseCloudflareRecord(rec: Rec): ParsedHit | null {
  const ts = parseTimestamp(pick(rec, ["EdgeStartTimestamp", "EdgeEndTimestamp", "Datetime"]));
  const ua = str(rec.ClientRequestUserAgent) ?? "";
  if (!ts) return null;
  const { path, host } = splitTarget(str(pick(rec, ["ClientRequestURI", "ClientRequestPath"])) ?? "/");
  return {
    ts,
    ip: str(rec.ClientIP),
    method: str(rec.ClientRequestMethod),
    path,
    status: toInt(pick(rec, ["EdgeResponseStatus", "OriginResponseStatus"])),
    userAgent: ua,
    host: str(rec.ClientRequestHost)?.toLowerCase() ?? host,
    bytes: toInt(pick(rec, ["EdgeResponseBytes", "EdgeResponseBodyBytes"])),
    referer: str(rec.ClientRequestReferer),
  };
}

export function parseAkamaiRecord(rec: Rec): ParsedHit | null {
  const ts = parseTimestamp(pick(rec, ["reqTimeSec", "reqTime", "timestamp"]));
  if (!ts) return null;
  const rawPath = str(rec.reqPath) ?? "/";
  const query = str(rec.queryStr);
  const { path, host } = splitTarget(`${rawPath.startsWith("/") ? "" : "/"}${safeDecode(rawPath)}${query ? `?${query}` : ""}`);
  return {
    ts,
    ip: str(rec.cliIP),
    method: str(rec.reqMethod),
    path,
    status: toInt(rec.statusCode),
    userAgent: safeDecode(str(rec.UA) ?? ""),
    host: str(rec.reqHost)?.toLowerCase() ?? host,
    bytes: toInt(pick(rec, ["totalBytes", "rspContentLen", "bytes"])),
    referer: str(rec.referer) ? safeDecode(String(rec.referer)) : null,
  };
}

export function parseNativeRecord(rec: Rec): ParsedHit | null {
  const ts = parseTimestamp(pick(rec, ["timestamp", "time", "ts", "date", "datetime", "@timestamp", "time_iso8601", "time_local"]));
  if (!ts) return null;
  const target = str(pick(rec, ["path", "url", "uri", "request_uri", "request_url", "requestUri", "requestPath"]));
  let method = str(pick(rec, ["method", "request_method", "requestMethod", "verb"]));
  let pathSource = target;
  const request = str(rec.request);
  if (!pathSource && request) {
    const rm = request.match(/^([A-Z]{3,10})\s+(\S+)/);
    if (rm) {
      method ??= rm[1]!;
      pathSource = rm[2]!;
    }
  }
  const { path, host } = splitTarget(pathSource ?? "/");
  return {
    ts,
    ip: str(pick(rec, ["ip", "remote_addr", "client_ip", "clientIp", "clientIP", "remoteAddr", "remote_ip", "x_forwarded_for"]))?.split(",")[0]?.trim() ?? null,
    method,
    path,
    status: toInt(pick(rec, ["status", "status_code", "statusCode", "response_status", "code"])),
    userAgent: str(pick(rec, ["user_agent", "userAgent", "ua", "http_user_agent", "agent", "useragent"])) ?? "",
    host: str(pick(rec, ["host", "hostname", "server_name", "http_host", "domain"]))?.toLowerCase() ?? host,
    bytes: toInt(pick(rec, ["bytes", "body_bytes_sent", "bytes_sent", "size", "response_size"])),
    referer: str(pick(rec, ["referer", "referrer", "http_referer"])),
  };
}

/** Parses one JSON record, auto-detecting Cloudflare / Akamai / native field names. */
export function parseJsonRecord(rec: unknown, prefer?: LogFormat): ParsedHit | null {
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) return null;
  const r = rec as Rec;
  if (prefer === "cloudflare" || (prefer !== "akamai" && isCloudflareRecord(r))) return parseCloudflareRecord(r);
  if (prefer === "akamai" || isAkamaiRecord(r)) return parseAkamaiRecord(r);
  return parseNativeRecord(r);
}

/* ───────────────────────────── W3C extended (IIS) ───────────────────────────── */

export function parseW3cLine(line: string, fields: string[]): ParsedHit | null {
  const values = line.trim().split(/\s+/);
  if (values.length < fields.length) return null;
  const rec: Record<string, string> = {};
  fields.forEach((f, i) => (rec[f.toLowerCase()] = values[i]!));
  const date = rec["date"];
  const time = rec["time"];
  const ts = date && time ? parseTimestamp(`${date}T${time}Z`) : null;
  if (!ts) return null;
  const stem = rec["cs-uri-stem"] ?? "/";
  const query = rec["cs-uri-query"] && rec["cs-uri-query"] !== "-" ? `?${rec["cs-uri-query"]}` : "";
  const { path } = splitTarget(`${stem}${query}`);
  return {
    ts,
    ip: str(rec["c-ip"]),
    method: str(rec["cs-method"]),
    path,
    status: toInt(rec["sc-status"]),
    userAgent: (str(rec["cs(user-agent)"]) ?? "").replace(/\+/g, " "),
    host: str(rec["cs-host"])?.toLowerCase() ?? null,
    bytes: toInt(rec["sc-bytes"]),
    referer: str(rec["cs(referer)"]),
  };
}

/* ───────────────────────────── custom fallback ───────────────────────────── */

const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const IPV6_RE = /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{0,4}\b/i;
const BRACKET_TIME_RE = /\[([^[\]\n]{1,64})\]/;
const ISO_TIME_RE = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/;
const REQUEST_RE = /"?\b(GET|HEAD|POST|PUT|DELETE|OPTIONS|PATCH|CONNECT|TRACE)\s+(\S+)(?:\s+HTTP\/[\d.]+)?"?/;
const QUOTED_RE = /"((?:[^"\\]|\\.)*)"/g;

export function parseCustomLine(line: string): ParsedHit | null {
  const req = REQUEST_RE.exec(line);
  if (!req) return null;
  const timeRaw = BRACKET_TIME_RE.exec(line)?.[1] ?? ISO_TIME_RE.exec(line)?.[0];
  const ts = timeRaw ? parseTimestamp(timeRaw) : null;
  if (!ts) return null;
  const after = line.slice(req.index + req[0].length);
  const status = after.match(/(?:^|\s)([1-5]\d{2})(?=\s|$)/)?.[1];
  const quoted = [...line.matchAll(QUOTED_RE)].map((m) => unescapeQuoted(m[1]!)).filter((q) => !/^[A-Z]{3,10}\s+\S+/.test(q));
  const ua = [...quoted].reverse().find((q) => /mozilla|bot|crawler|spider|\/\d/i.test(q)) ?? "";
  const ipMatch = IPV4_RE.exec(line) ?? IPV6_RE.exec(line);
  const { path, host } = splitTarget(req[2]!);
  return {
    ts,
    ip: ipMatch?.[0] ?? null,
    method: req[1]!,
    path,
    status: status ? Number(status) : null,
    userAgent: ua,
    host,
    bytes: null,
    referer: null,
  };
}

/* ───────────────────────────── line parser factory ───────────────────────────── */

export type LineParser = {
  format: LogFormat;
  /** Returns a hit, null for an unparseable line, or "skip" for comments/headers/blank lines. */
  parse: (line: string) => ParsedHit | null | "skip";
};

export function createLineParser(format: LogFormat): LineParser {
  let w3cFields: string[] | null = null;
  return {
    format,
    parse(raw: string) {
      if (raw.length > MAX_LINE_LENGTH) return null;
      const line = raw.replace(/\r$/, "");
      if (!line.trim()) return "skip";
      if (line.startsWith("#")) {
        const fields = line.match(/^#Fields:\s*(.+)$/i);
        if (fields) w3cFields = fields[1]!.trim().split(/\s+/);
        return "skip";
      }
      switch (format) {
        case "combined":
          return parseCombinedLine(line);
        case "cloudflare":
        case "akamai":
        case "ndjson": {
          const t = line.trim();
          if (!t.startsWith("{")) return parseCombinedLine(line) ?? parseCustomLine(line);
          try {
            return parseJsonRecord(JSON.parse(t), format === "ndjson" ? undefined : format);
          } catch {
            return null;
          }
        }
        case "w3c":
          return w3cFields ? parseW3cLine(line, w3cFields) : null;
        default:
          return parseCombinedLine(line) ?? parseCustomLine(line);
      }
    },
  };
}

/** Detects the format from a sample of lines (first non-empty lines of a file). */
export function detectLogFormat(sample: string[]): LogFormat {
  const lines = sample.filter((l) => l.length <= MAX_LINE_LENGTH).map((l) => l.replace(/\r$/, "")).filter((l) => l.trim());
  if (!lines.length) return "custom";
  if (lines.some((l) => /^#Fields:/i.test(l))) return "w3c";
  const json = lines.filter((l) => l.trim().startsWith("{"));
  if (json.length >= Math.ceil(lines.length / 2)) {
    let cf = 0;
    let ak = 0;
    for (const l of json) {
      try {
        const rec = JSON.parse(l.trim()) as Rec;
        if (isCloudflareRecord(rec)) cf++;
        else if (isAkamaiRecord(rec)) ak++;
      } catch {
        // ignore
      }
    }
    if (cf && cf >= ak) return "cloudflare";
    if (ak) return "akamai";
    return "ndjson";
  }
  const combined = lines.filter((l) => parseCombinedLine(l)).length;
  if (combined >= Math.ceil(lines.length * 0.6)) return "combined";
  return "custom";
}

/** Human label for a detected/selected format. */
export function formatLabel(format: string | null | undefined): string {
  return (
    {
      combined: "nginx / Apache (combined)",
      nginx: "nginx",
      apache: "Apache",
      cloudflare: "Cloudflare (JSON)",
      akamai: "Akamai DataStream 2",
      ndjson: "NDJSON",
      w3c: "W3C / IIS",
      custom: "Custom",
      auto: "Auto-detect",
    } as Record<string, string>
  )[format ?? "auto"] ?? String(format);
}

/** Parses an NDJSON (or JSON array) ingest body. Non-JSON lines fall back to access-log parsing. */
export function parseIngestBody(text: string): { received: number; hits: ParsedHit[]; invalid: number } {
  const trimmed = text.trim();
  if (trimmed.startsWith("[") && trimmed.length > MAX_JSON_ARRAY_BYTES) {
    throw new RangeError(`JSON array bodies are limited to ${MAX_JSON_ARRAY_BYTES / 1024 / 1024} MB — send NDJSON instead.`);
  }
  const hits: ParsedHit[] = [];
  let received = 0;
  let invalid = 0;
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed) as unknown[];
      for (const rec of Array.isArray(arr) ? arr : []) {
        received++;
        const hit = parseJsonRecord(rec);
        if (hit) hits.push(hit);
        else invalid++;
      }
      return { received, hits, invalid };
    } catch {
      // fall through to line mode
    }
  }
  const parser = createLineParser("ndjson");
  for (const line of trimmed.split("\n")) {
    const res = parser.parse(line);
    if (res === "skip") continue;
    received++;
    if (res) hits.push(res);
    else invalid++;
  }
  return { received, hits, invalid };
}

/** Counts non-empty lines of a body without parsing (limit checks). */
export function countLines(text: string): number {
  let n = 0;
  let inLine = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) {
      if (inLine) n++;
      inLine = false;
    } else if (c !== 13 && c !== 32) inLine = true;
  }
  return inLine ? n + 1 : n;
}
