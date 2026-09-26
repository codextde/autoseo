/**
 * Field-mapping engine for incoming webhook payloads (Typeform, HubSpot, Tally, Jotform, custom JSON…).
 *
 * Path syntax (dot-separated):
 *   - `a.b.c`                 object keys
 *   - `items[0].name`         array index
 *   - `answers[field.ref=hdyhau].choice.label`   first array element whose nested key equals the value
 *   - `answers[*].email`      first non-empty value across array elements
 *   - `["key with.dots"]`     quoted key
 * Pure module (no server-only) so it can be unit-tested.
 */
import { createHash } from "node:crypto";
import { HDYHAU_PATTERN } from "./channels";
import { redactEmails } from "./email";
import type { FieldMapping, MappingTarget } from "./types";

type Segment =
  | { type: "key"; key: string }
  | { type: "index"; index: number }
  | { type: "match"; key: string; value: string }
  | { type: "any" };

export function parsePath(path: string): Segment[] {
  const segments: Segment[] = [];
  let i = 0;
  let buf = "";
  const flush = () => {
    if (buf) segments.push({ type: "key", key: buf });
    buf = "";
  };
  while (i < path.length) {
    const ch = path[i]!;
    if (ch === ".") {
      flush();
      i++;
    } else if (ch === "[") {
      flush();
      const end = findClosingBracket(path, i);
      const inner = path.slice(i + 1, end).trim();
      i = end + 1;
      if (inner === "*") segments.push({ type: "any" });
      else if (/^\d+$/.test(inner)) segments.push({ type: "index", index: Number(inner) });
      else if (/^(["']).*\1$/.test(inner)) segments.push({ type: "key", key: inner.slice(1, -1) });
      else {
        const eq = inner.indexOf("=");
        if (eq > 0) {
          let value = inner.slice(eq + 1).trim();
          if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
          segments.push({ type: "match", key: inner.slice(0, eq).trim(), value });
        } else segments.push({ type: "key", key: inner });
      }
    } else {
      buf += ch;
      i++;
    }
  }
  flush();
  return segments;
}

function findClosingBracket(path: string, start: number): number {
  let quote: string | null = null;
  for (let i = start + 1; i < path.length; i++) {
    const ch = path[i]!;
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "]") return i;
  }
  return path.length;
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

function applySegments(value: unknown, segments: Segment[]): unknown {
  let cur: unknown = value;
  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s]!;
    if (cur === null || cur === undefined) return undefined;
    if (seg.type === "key") {
      if (typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[seg.key];
    } else if (seg.type === "index") {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[seg.index];
    } else if (seg.type === "match") {
      if (!Array.isArray(cur)) return undefined;
      const sub = parsePath(seg.key);
      cur = cur.find((el) => {
        const v = applySegments(el, sub);
        return v !== undefined && v !== null && String(v).toLowerCase() === seg.value.toLowerCase();
      });
    } else {
      if (!Array.isArray(cur)) return undefined;
      const rest = segments.slice(s + 1);
      for (const el of cur) {
        const v = applySegments(el, rest);
        if (!isEmpty(v)) return v;
      }
      return undefined;
    }
  }
  return cur;
}

/** Reads a (nested) value from a payload using the path syntax above. */
export function getPath(payload: unknown, path: string): unknown {
  if (!path) return undefined;
  return applySegments(payload, parsePath(path));
}

/** Coerces a mapped value to a display string (arrays → comma-joined, objects → label/value/name). */
export function valueToString(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    const parts = v.map(valueToString).filter((x): x is string => !!x);
    return parts.length ? parts.join(", ") : null;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["label", "value", "name", "text", "title", "answer", "labels", "other"]) {
      if (!isEmpty(o[k])) return valueToString(o[k]);
    }
  }
  return null;
}

/** Parses "1.234,56", "€ 99.90", 4990 (cents when `cents`), "12.5 EUR" → number. */
export function valueToNumber(v: unknown, cents = false): number | null {
  if (v === undefined || v === null || v === "") return null;
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string") {
    let s = v.replace(/[^\d.,-]/g, "");
    if (!s) return null;
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
    n = Number(s);
  } else if (typeof v === "object" && v && "amount" in v) return valueToNumber((v as { amount: unknown }).amount, cents);
  else return null;
  if (!Number.isFinite(n)) return null;
  return cents ? n / 100 : n;
}

/* ─────────────────────────── Flatten for the mapping UI ─────────────────────────── */

export type FlatField = { path: string; sample: string; type: "string" | "number" | "boolean" | "array" | "object" | "null" };

const IDENTIFYING_KEYS = ["ref", "key", "name", "id", "label", "title", "field.ref", "field.id", "property", "qid"];

function identifyingSelector(el: unknown): string | null {
  if (!el || typeof el !== "object" || Array.isArray(el)) return null;
  for (const k of IDENTIFYING_KEYS) {
    const v = getPath(el, k);
    if ((typeof v === "string" && v.length > 0 && v.length <= 80 && !/[\]\n]/.test(v)) || typeof v === "number") {
      return `${k}=${String(v)}`;
    }
  }
  return null;
}

function typeOf(v: unknown): FlatField["type"] {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "object") return "object";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  return "string";
}

/**
 * Lists every leaf path of a payload with a (redacted, truncated) sample value. Arrays of objects
 * with an identifying key (ref/key/name/id…) are expanded as `[ref=value]` selectors so mappings stay
 * stable when the order of answers changes (e.g. Typeform `form_response.answers`).
 */
export function flattenPaths(payload: unknown, maxFields = 400): FlatField[] {
  const out: FlatField[] = [];
  const walk = (v: unknown, path: string, depth: number) => {
    if (out.length >= maxFields || depth > 12) return;
    if (Array.isArray(v)) {
      if (v.length === 0) {
        out.push({ path, sample: "[]", type: "array" });
        return;
      }
      if (v.every((el) => typeof el !== "object" || el === null)) {
        out.push({ path, sample: redactEmails(v.slice(0, 5).map(String).join(", ")).slice(0, 120), type: "array" });
        return;
      }
      v.slice(0, 50).forEach((el, i) => {
        const sel = identifyingSelector(el);
        walk(el, `${path}[${sel ?? i}]`, depth + 1);
      });
      return;
    }
    if (v && typeof v === "object") {
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        const safeKey = /^[A-Za-z0-9_$-]+$/.test(k) ? k : `["${k.replace(/"/g, "")}"]`;
        const next = path ? (safeKey.startsWith("[") ? `${path}${safeKey}` : `${path}.${safeKey}`) : safeKey;
        walk(child, next, depth + 1);
      }
      return;
    }
    out.push({
      path,
      sample: v === null || v === undefined ? "null" : redactEmails(String(v)).slice(0, 160),
      type: typeOf(v),
    });
  };
  walk(payload, "", 0);
  return out;
}

/* ─────────────────────────── Auto-suggest ─────────────────────────── */

const EMAIL_VALUE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Suggests a mapping from a sample payload: looks for "How did you hear about us?" questions (label
 * text anywhere near the answer), emails, amounts, currencies, order ids and form names.
 */
export function suggestMapping(payload: unknown): FieldMapping {
  const mapping: FieldMapping = {};
  const fields = flattenPaths(payload, 800);
  const raw = fields.map((f) => ({ ...f, realValue: getPath(payload, f.path) }));

  // 1) Channel: answer inside an array element whose question/label matches HDYHAU.
  const channelCandidate = findHdyhauAnswerPath(payload);
  if (channelCandidate) mapping.channel = { path: channelCandidate };
  else {
    const byKey = raw.find((f) => /channel|hear|source|aufmerksam|hdyhau|attribution|referral|how_did/i.test(f.path) && f.type === "string" && !EMAIL_VALUE.test(String(f.realValue)));
    if (byKey) mapping.channel = { path: byKey.path };
  }

  const pick = (re: RegExp, pred: (v: unknown) => boolean = () => true) =>
    raw.find((f) => re.test(f.path) && f.type !== "object" && f.type !== "array" && pred(f.realValue))?.path;

  const emailPath = raw.find((f) => typeof f.realValue === "string" && EMAIL_VALUE.test(f.realValue.trim()))?.path;
  if (emailPath) mapping.email = { path: emailPath };

  const valuePath = pick(/(deal_?value|amount_?total|total_?price|order_?total|grand_?total|\btotal\b|amount|revenue|value|price)$/i, (v) => valueToNumber(v) !== null);
  if (valuePath) mapping.dealValue = { path: valuePath };

  const currencyPath = pick(/currency(_?code|iso(_?code)?)?$/i, (v) => typeof v === "string" && /^[A-Za-z]{3}$/.test(v));
  if (currencyPath) mapping.dealCurrency = { path: currencyPath };

  const txPath = pick(/(transaction_?id|order_?id|order_?number|order_?key|payment_?intent|invoice(_?id)?|deal_?id|checkout_?id)$/i);
  if (txPath) mapping.transactionId = { path: txPath };

  const externalPath = pick(/(respondent_?id|contact_?id|submission_?id|response_?id|token|customer_?id|lead_?id|object_?id|vid)$/i);
  if (externalPath) mapping.externalId = { path: externalPath };

  const namePath = pick(/(^|\.)(full_?name|name|first_?name|firstname)$/i, (v) => typeof v === "string" && !EMAIL_VALUE.test(v) && v.length < 80);
  if (namePath && namePath !== mapping.channel?.path) mapping.name = { path: namePath };

  const formIdPath = pick(/(form_?id|formid)$/i);
  if (formIdPath) mapping.formId = { path: formIdPath };
  const formNamePath = pick(/(form_?(name|title)|definition\.title|survey_?(name|title))$/i);
  if (formNamePath) mapping.formName = { path: formNamePath };

  const pagePath = pick(/(page_?url|landing_?page|referrer|url)$/i, (v) => typeof v === "string" && /^https?:\/\//.test(v));
  if (pagePath) mapping.pageUrl = { path: pagePath };

  const datePath = pick(/(submitted_?at|created_?at|occurred_?at|timestamp|date_?created|landed_?at|inserted_?at)$/i, (v) => !Number.isNaN(Date.parse(String(v))));
  if (datePath) mapping.occurredAt = { path: datePath };

  return mapping;
}

/** Finds the answer path of an HDYHAU question in array-of-answers payloads (Typeform, Tally, Jotform…). */
function findHdyhauAnswerPath(payload: unknown): string | null {
  // Typeform: definition.fields[].title + answers[].field.ref
  const tf = payload as { form_response?: { definition?: { fields?: Array<{ id?: string; ref?: string; title?: string }> }; answers?: Array<Record<string, unknown>> } };
  const fields = tf?.form_response?.definition?.fields;
  const answers = tf?.form_response?.answers;
  if (Array.isArray(fields) && Array.isArray(answers)) {
    const q = fields.find((f) => f.title && HDYHAU_PATTERN.test(f.title));
    if (q?.ref) {
      const ans = answers.find((a) => (a.field as { ref?: string } | undefined)?.ref === q.ref);
      const t = (ans?.type as string | undefined) ?? "choice";
      const leaf = t === "choice" ? "choice.label" : t === "choices" ? "choices.labels" : t === "text" ? "text" : t;
      return `form_response.answers[field.ref=${q.ref}].${leaf}`;
    }
  }
  // Generic: any array element with a question-ish label matching HDYHAU and a value/answer key.
  let found: string | null = null;
  const walk = (v: unknown, path: string, depth: number) => {
    if (found || depth > 8 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      v.forEach((el, i) => {
        if (found || !el || typeof el !== "object") return;
        const o = el as Record<string, unknown>;
        const label = [o.label, o.title, o.question, o.name, o.text, o.key].find((x) => typeof x === "string" && HDYHAU_PATTERN.test(x)) as string | undefined;
        if (label) {
          const sel = identifyingSelector(el) ?? String(i);
          const valueKey = ["answer", "value", "response", "choice", "answers"].find((k) => !isEmpty(o[k]));
          if (valueKey) {
            found = `${path}[${sel}].${valueKey}`;
            return;
          }
        }
        walk(el, `${path}[${identifyingSelector(el) ?? i}]`, depth + 1);
      });
      return;
    }
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
      if (found) return;
      if (typeof child === "string" && HDYHAU_PATTERN.test(k)) {
        found = path ? `${path}.${k}` : k;
        return;
      }
      walk(child, path ? `${path}.${k}` : k, depth + 1);
    }
  };
  walk(payload, "", 0);
  return found;
}

/* ─────────────────────────── Apply ─────────────────────────── */

export type MappedValues = Partial<Record<MappingTarget, string>> & { metadata?: Record<string, unknown> };

export function applyMapping(payload: unknown, mapping: FieldMapping): MappedValues {
  const out: MappedValues = {};
  for (const [target, rule] of Object.entries(mapping) as Array<[string, unknown]>) {
    if (target === "metadata") continue;
    const r = rule as { path?: string; constant?: string } | undefined;
    if (!r) continue;
    const v = r.constant ? r.constant : r.path ? valueToString(getPath(payload, r.path)) : null;
    if (v) out[target as MappingTarget] = v.slice(0, 2000);
  }
  if (mapping.metadata?.length) {
    const meta: Record<string, unknown> = {};
    for (const p of mapping.metadata.slice(0, 30)) {
      const v = getPath(payload, p);
      if (v !== undefined) meta[p] = typeof v === "string" ? redactEmails(v).slice(0, 500) : v;
    }
    out.metadata = meta;
  }
  return out;
}

/** Whether a mapping is complete enough to parse payloads automatically. */
export function isMappingUsable(mapping: FieldMapping, kind: "auto" | "response" | "conversion"): boolean {
  const hasChannel = !!(mapping.channel?.path || mapping.channel?.constant);
  const hasOrder = !!(mapping.transactionId?.path || mapping.dealValue?.path);
  if (kind === "response") return hasChannel;
  if (kind === "conversion") return hasOrder;
  return hasChannel || hasOrder;
}

/* ─────────────────────────── Provider detection / fingerprint ─────────────────────────── */

/** Detects well-known providers from the payload shape. */
export function detectProvider(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (Array.isArray(payload)) {
    const first = payload[0] as Record<string, unknown> | undefined;
    if (first && "subscriptionType" in first && "portalId" in first) return "hubspot";
    return null;
  }
  if (p.object === "event" && typeof p.type === "string" && p.data) return "stripe";
  if ("form_response" in p && "event_type" in p) return "typeform";
  if ("eventType" in p && p.data && typeof p.data === "object" && "fields" in (p.data as object)) return "tally";
  if ("formID" in p && ("rawRequest" in p || "submissionID" in p)) return "jotform";
  if ("order_key" in p && "line_items" in p) return "woocommerce";
  if ("form_id" in p && "entry_id" in p) return "gravity_forms";
  if ("FormID" in p && "UniqueID" in p) return "formstack";
  if ("event" in p && typeof p.event === "string" && p.event.startsWith("invitee.") && p.payload) return "calendly";
  if ("topic" in p && "data" in p && typeof p.topic === "string" && p.topic.includes(".")) return "intercom";
  if ("meta" in p && "current" in p && (p.meta as Record<string, unknown> | null)?.object === "deal") return "pipedrive";
  if ("event_type" in p && "data" in p && "object_type" in p) return "close";
  if ("webhook_id" in p && "event" in p && (p.event as Record<string, unknown> | null)?.type) return "attio";
  if ("orderNumber" in p && "amountTotal" in p) return "shopware";
  if ("attributes" in p && (p.attributes as Record<string, unknown> | null)?.type && "Id" in p) return "salesforce";
  return null;
}

/**
 * Structural fingerprint used to route future payloads of the same shape to the same workflow.
 * Uses the provider (when detected) plus sorted top-level keys and the form id when present.
 */
export function payloadFingerprint(payload: unknown, provider: string | null): string {
  let keys: string[] = [];
  let formId = "";
  if (Array.isArray(payload)) {
    const first = payload[0];
    keys = first && typeof first === "object" ? Object.keys(first as object).sort() : ["[]"];
  } else if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    keys = Object.keys(p).sort();
    formId =
      valueToString(getPath(p, "form_response.form_id")) ??
      valueToString(getPath(p, "data.formId")) ??
      valueToString(p.formID) ??
      valueToString(p.form_id) ??
      valueToString(p.formId) ??
      "";
  }
  const basis = `${provider ?? "custom"}|${formId}|${keys.join(",")}`;
  return createHash("sha256").update(basis).digest("hex").slice(0, 32);
}

/** Redacts emails in a payload (deep) and truncates long strings — used for stored samples. */
export function redactPayload(payload: unknown, depth = 0): unknown {
  if (depth > 14) return null;
  if (typeof payload === "string") return redactEmails(payload).slice(0, 1000);
  if (Array.isArray(payload)) return payload.slice(0, 100).map((v) => redactPayload(v, depth + 1));
  if (payload && typeof payload === "object") {
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
      if (n++ > 200) break;
      if (/password|secret|token|authorization|api[_-]?key|card|iban|cvc/i.test(k) && typeof v === "string") out[k] = "[redacted]";
      else out[k] = redactPayload(v, depth + 1);
    }
    return out;
  }
  return payload;
}

/* ─────────────────────────── Provider pre-processing ─────────────────────────── */

/**
 * Normalizes quirky provider payloads before mapping:
 *  - Tally: resolves choice option ids to their labels (`fields[].answer`)
 *  - Jotform: parses the `rawRequest` JSON string and the `pretty` summary into `answers[]`
 *  - HubSpot legacy: `properties.x.value` → `props.x`
 *  - Arrays (HubSpot webhook batches): first element
 */
export function preprocessPayload(payload: unknown): unknown {
  if (Array.isArray(payload)) return payload.length ? preprocessPayload(payload[0]) : payload;
  if (!payload || typeof payload !== "object") return payload;
  const p = { ...(payload as Record<string, unknown>) };

  // Tally
  const data = p.data as Record<string, unknown> | undefined;
  if (data && Array.isArray(data.fields)) {
    p.data = {
      ...data,
      fields: (data.fields as Array<Record<string, unknown>>).map((f) => {
        if (!f || typeof f !== "object") return f;
        const options = Array.isArray(f.options) ? (f.options as Array<{ id?: unknown; text?: unknown }>) : null;
        let answer: unknown = f.value;
        if (options) {
          const ids = Array.isArray(f.value) ? f.value : [f.value];
          const labels = ids.map((id) => options.find((o) => o.id === id)?.text ?? id).filter((x) => x != null && x !== "");
          answer = labels.length ? labels.map(String).join(", ") : null;
        }
        return { ...f, answer };
      }),
    };
  }

  // Jotform
  if (typeof p.rawRequest === "string") {
    try {
      p.rawRequest = JSON.parse(p.rawRequest);
    } catch {
      // keep string
    }
  }
  if (typeof p.pretty === "string" && !Array.isArray(p.answers)) {
    const answers: Array<{ label: string; value: string }> = [];
    for (const part of p.pretty.split(/,\s(?=[^,:]{1,120}:)/)) {
      const idx = part.indexOf(":");
      if (idx > 0) answers.push({ label: part.slice(0, idx).trim(), value: part.slice(idx + 1).trim() });
    }
    if (answers.length) p.answers = answers;
  }

  // HubSpot legacy contact payload
  const props = p.properties as Record<string, unknown> | undefined;
  if (props && typeof props === "object" && !Array.isArray(props)) {
    const flat: Record<string, unknown> = {};
    let hasValueObjects = false;
    for (const [k, v] of Object.entries(props)) {
      if (v && typeof v === "object" && "value" in (v as object)) {
        flat[k] = (v as { value: unknown }).value;
        hasValueObjects = true;
      }
    }
    if (hasValueObjects) p.props = flat;
  }
  return p;
}
