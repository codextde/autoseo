import "server-only";
import { saveIntegration } from "@/server/integrations";
import { HDYHAU_PATTERN } from "./channels";
import { csvToResponses, parseCsv, type CsvColumnMap } from "./csv";
import { ingestResponse } from "./ingest";
import { valueToNumber, valueToString } from "./mapping";
import { getAttributionSettings } from "./settings";
import { getSourceById, markSourceError, sourceSecretsOf, type SourceRow } from "./sources";
import type { ResponseInput } from "./types";

const TIMEOUT_MS = 30_000;
const MAX_PAGES = 50;
const DEFAULT_LOOKBACK_DAYS = 90;

class ImportError extends Error {}

async function getJson(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
  if (res.status === 401 || res.status === 403) throw new ImportError(`Authentication failed (${res.status}) — check the API credentials`);
  if (res.status === 429) throw new ImportError("Rate limited by the provider — will retry on the next sync");
  if (!res.ok) throw new ImportError(`Provider API returned HTTP ${res.status}`);
  return res.json();
}

/** Non-secret string config of a source. */
function cfg(row: SourceRow, key: string): string | undefined {
  const v = row.config?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function sinceDate(row: SourceRow): Date {
  const since = cfg(row, "importSince");
  const d = since ? new Date(since) : null;
  return d && !Number.isNaN(d.getTime()) ? d : new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 86_400_000);
}

type Pulled = { inputs: ResponseInput[]; newest: Date | null };

/* ─────────────────────────────── Fairing ─────────────────────────────── */
// GET https://app.fairing.co/api/responses  (Authorization: <key>) — cursor via starting_after.
async function pullFairing(row: SourceRow, secrets: Record<string, string>): Promise<Pulled> {
  const since = sinceDate(row);
  const inputs: ResponseInput[] = [];
  let newest: Date | null = null;
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ inserted_at_min: since.toISOString(), sort: "inserted_at_asc", limit: "1000" });
    const questionId = cfg(row, "questionId");
    if (questionId) params.set("question_id", questionId);
    if (after) params.set("starting_after", after);
    const data = (await getJson(`https://app.fairing.co/api/responses?${params}`, {
      headers: { Authorization: secrets.apiToken!, Accept: "application/json" },
    })) as { data?: Array<Record<string, unknown>> };
    const items = Array.isArray(data.data) ? data.data : [];
    for (const r of items) {
      const question = valueToString(r.question) ?? "";
      if (r.clarification_question === true) continue;
      if (!cfg(row, "questionId") && !HDYHAU_PATTERN.test(question)) continue;
      const answer = valueToString(r.response);
      const other = valueToString(r.other_response);
      if (!answer && !other) continue;
      const at = valueToString(r.response_provided_at) ?? valueToString(r.inserted_at);
      const date = at ? new Date(at) : null;
      if (date && (!newest || date > newest)) newest = date;
      inputs.push({
        channel: answer ?? other,
        rawAnswer: answer ?? other,
        freetext: other,
        email: valueToString(r.email),
        transactionId: valueToString(r.order_number) ?? valueToString(r.order_id),
        dealValue: valueToNumber(r.order_total),
        dealCurrency: valueToString(r.order_currency_code),
        externalId: valueToString(r.id),
        formName: "Fairing post-purchase survey",
        occurredAt: date,
        metadata: {
          question,
          orderId: valueToString(r.order_id),
          utmSource: valueToString(r.utm_source),
          utmMedium: valueToString(r.utm_medium),
          referringSite: valueToString(r.referring_site),
          landingPage: valueToString(r.landing_page_path),
        },
      });
    }
    if (items.length < 1000) break;
    after = valueToString(items[items.length - 1]!.id);
    if (!after) break;
  }
  return { inputs, newest };
}

/* ─────────────────────────────── KnoCommerce ─────────────────────────────── */
// OAuth2 client credentials → GET https://app-api.knocommerce.com/api/rest/responses (cursor pagination).
async function pullKno(row: SourceRow, secrets: Record<string, string>): Promise<Pulled> {
  const basic = Buffer.from(`${secrets.clientId}:${secrets.clientSecret}`).toString("base64");
  const tok = (await getJson("https://api.knocommerce.com/api/oauth2/token?grant_type=client_credentials&scope=RESPONSES", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, Accept: "application/json" },
  })) as { access_token?: string };
  if (!tok.access_token) throw new ImportError("KnoCommerce did not return an access token");
  const since = sinceDate(row);
  const inputs: ResponseInput[] = [];
  let newest: Date | null = null;
  let pageToken: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ maxPageSize: "250", status: "completed", "completedAt[gte]": since.toISOString(), expand: "order" });
    if (pageToken) params.set("pageToken", pageToken);
    const data = (await getJson(`https://app-api.knocommerce.com/api/rest/responses?${params}`, {
      headers: { Authorization: `Bearer ${tok.access_token}`, Accept: "application/json" },
    })) as { results?: Array<Record<string, unknown>>; nextPageToken?: string | null; hasMore?: boolean };
    for (const r of data.results ?? []) {
      const answers = Array.isArray(r.response) ? (r.response as Array<Record<string, unknown>>) : [];
      const hit = answers.find((a) => HDYHAU_PATTERN.test(valueToString(a.label) ?? "")) ?? (cfg(row, "questionId") ? answers.find((a) => a.questionId === cfg(row, "questionId")) : undefined);
      if (!hit) continue;
      const answer = valueToString(hit.value);
      const other = hit.other ? valueToString(hit.otherValue) : null;
      if (!answer && !other) continue;
      const order = (r.order ?? {}) as Record<string, unknown>;
      const at = valueToString(r.completed_at) ?? valueToString(r.created_at);
      const date = at ? new Date(at) : null;
      if (date && (!newest || date > newest)) newest = date;
      inputs.push({
        channel: answer ?? other,
        rawAnswer: answer ?? other,
        freetext: other,
        email: valueToString(r.customer_email),
        transactionId: valueToString(order.name) ?? valueToString(order.orderNumber) ?? valueToString(order.order_number) ?? valueToString(order.id),
        dealValue: valueToNumber(order.total ?? order.totalPrice ?? order.total_price),
        dealCurrency: valueToString(order.currency) ?? valueToString(order.currencyCode),
        externalId: valueToString(r.id),
        formName: "KnoCommerce survey",
        occurredAt: date,
        metadata: { question: valueToString(hit.label), surveyId: valueToString(r.survey_id) },
      });
    }
    if (!data.hasMore || !data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return { inputs, newest };
}

/* ─────────────────────────────── Zigpoll ─────────────────────────────── */
// GET https://v1.zigpoll.com/responses?slideId|pollId|accountId=…&createdAfter=<ms> (Authorization: <key>).
async function pullZigpoll(row: SourceRow, secrets: Record<string, string>): Promise<Pulled> {
  const scope = cfg(row, "slideId") ? ["slideId", cfg(row, "slideId")] : cfg(row, "pollId") ? ["pollId", cfg(row, "pollId")] : cfg(row, "accountId") ? ["accountId", cfg(row, "accountId")] : null;
  if (!scope) throw new ImportError("Set the Zigpoll question (slide) id, poll id or account id");
  const since = sinceDate(row);
  const inputs: ResponseInput[] = [];
  let newest: Date | null = null;
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ [scope[0]!]: scope[1]!, createdAfter: String(since.getTime()), limit: "1000" });
    if (cursor) params.set("startCursor", cursor);
    const data = (await getJson(`https://v1.zigpoll.com/responses?${params}`, {
      headers: { Authorization: secrets.apiToken!, Accept: "application/json" },
    })) as { data?: Array<Record<string, unknown>>; hasNextPage?: boolean; endCursor?: string };
    for (const r of data.data ?? []) {
      const answer = valueToString(r.response);
      if (!answer) continue;
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      const at = valueToString(r.createdAt);
      const date = at ? new Date(at) : null;
      if (date && (!newest || date > newest)) newest = date;
      inputs.push({
        channel: answer,
        rawAnswer: answer,
        freetext: r.valueType === "open-ended" ? answer : null,
        email: valueToString(meta.email) ?? valueToString(meta.customer_email),
        transactionId: valueToString(meta.order_number) ?? valueToString(meta.shopify_order_id) ?? valueToString(meta.order_id),
        dealValue: valueToNumber(r.orderValue),
        externalId: valueToString(r._id),
        formName: "Zigpoll survey",
        pageUrl: valueToString(meta.url),
        occurredAt: date,
        metadata: { utmSource: valueToString(meta.utm_source), utmMedium: valueToString(meta.utm_medium), referrer: valueToString(meta["original-referrer"]) },
      });
    }
    if (!data.hasNextPage || !data.endCursor) break;
    cursor = data.endCursor;
  }
  return { inputs, newest };
}

/* ─────────────────────────────── SurveyMonkey ─────────────────────────────── */
// v3 API: survey details (question + choice texts) + /responses/bulk.
async function pullSurveyMonkey(row: SourceRow, secrets: Record<string, string>): Promise<Pulled> {
  const surveyId = cfg(row, "surveyId");
  if (!surveyId || !/^\d{3,20}$/.test(surveyId)) throw new ImportError("Set a numeric SurveyMonkey survey id");
  const headers = { Authorization: `Bearer ${secrets.apiToken}`, Accept: "application/json" };
  const details = (await getJson(`https://api.surveymonkey.com/v3/surveys/${surveyId}/details`, { headers })) as {
    title?: string;
    pages?: Array<{ questions?: Array<{ id: string; headings?: Array<{ heading?: string }>; answers?: { choices?: Array<{ id: string; text: string }>; other?: { id: string; text: string } } }> }>;
  };
  const questions = (details.pages ?? []).flatMap((p) => p.questions ?? []);
  const q = questions.find((x) => (cfg(row, "questionId") ? x.id === cfg(row, "questionId") : HDYHAU_PATTERN.test(x.headings?.[0]?.heading ?? "")));
  if (!q) throw new ImportError("No “How did you hear about us?” question found in this survey (set the question id)");
  const choices = new Map((q.answers?.choices ?? []).map((c) => [c.id, c.text]));
  const since = sinceDate(row);
  const inputs: ResponseInput[] = [];
  let newest: Date | null = null;
  let url: string | null =
    `https://api.surveymonkey.com/v3/surveys/${surveyId}/responses/bulk?per_page=100&sort_order=ASC&status=completed&start_created_at=${encodeURIComponent(since.toISOString().slice(0, 19))}`;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const data = (await getJson(url, { headers })) as {
      data?: Array<{ id: string; date_created?: string; metadata?: { contact?: { email?: { value?: string } } }; pages?: Array<{ questions?: Array<{ id: string; answers?: Array<{ choice_id?: string; other_id?: string; text?: string }> }> }> }>;
      links?: { next?: string };
    };
    for (const r of data.data ?? []) {
      const ans = (r.pages ?? []).flatMap((p) => p.questions ?? []).find((x) => x.id === q.id);
      if (!ans?.answers?.length) continue;
      const labels = ans.answers.map((a) => (a.choice_id ? choices.get(a.choice_id) : null)).filter((x): x is string => !!x);
      const other = ans.answers.find((a) => a.other_id || (!a.choice_id && a.text))?.text ?? null;
      const answer = labels.join(", ") || other;
      if (!answer) continue;
      const date = r.date_created ? new Date(r.date_created) : null;
      if (date && (!newest || date > newest)) newest = date;
      inputs.push({
        channel: answer,
        rawAnswer: answer,
        freetext: other,
        email: r.metadata?.contact?.email?.value ?? null,
        externalId: r.id,
        formName: `SurveyMonkey — ${details.title ?? surveyId}`,
        formId: surveyId,
        occurredAt: date,
      });
    }
    url = data.links?.next && data.links.next.startsWith("https://api.surveymonkey.com/") ? data.links.next : null;
  }
  return { inputs, newest };
}

const PULLERS: Record<string, (row: SourceRow, secrets: Record<string, string>) => Promise<Pulled>> = {
  fairing: pullFairing,
  knocommerce: pullKno,
  zigpoll: pullZigpoll,
  surveymonkey: pullSurveyMonkey,
};

export function isImportProvider(provider: string) {
  return provider in PULLERS;
}

/** Runs an API import for a connected source (called from the job handler). */
export async function runSourceImport(sourceId: string): Promise<{ imported: number; merged: number }> {
  const row = await getSourceById(sourceId);
  if (!row || row.status === "disconnected") return { imported: 0, merged: 0 };
  const pull = PULLERS[row.provider];
  if (!pull) return { imported: 0, merged: 0 };
  const secrets = sourceSecretsOf(row);
  try {
    const { inputs, newest } = await pull(row, secrets);
    const settings = await getAttributionSettings(row.projectId);
    let imported = 0;
    let merged = 0;
    for (const input of inputs) {
      const r = await ingestResponse(row.projectId, input, { sourceType: "integration", provider: row.provider, customChannels: settings.survey.channels });
      if (r.created) imported++;
      if (r.merged) merged++;
    }
    const prevCount = typeof row.config?.eventCount === "number" ? row.config.eventCount : 0;
    await saveIntegration({
      projectId: row.projectId,
      provider: row.provider,
      mergeConfig: {
        importSince: (newest ?? sinceDate(row)).toISOString(),
        eventCount: prevCount + imported,
        ...(imported ? { lastEventAt: new Date().toISOString() } : {}),
      },
      lastSyncAt: new Date(),
      lastError: null,
      status: "connected",
    });
    return { imported, merged };
  } catch (err) {
    const msg = err instanceof ImportError ? err.message : "Import failed — the provider API could not be reached";
    await markSourceError(row, msg);
    if (!(err instanceof ImportError)) console.error("[attribution] import failed", row.provider, err instanceof Error ? err.message : err);
    throw new Error(msg);
  }
}

/** CSV import (Fairing / KnoCommerce / Zigpoll / SurveyMonkey exports or any sheet). */
export async function importCsv(
  projectId: string,
  csvText: string,
  opts: { provider: string; columns?: CsvColumnMap },
): Promise<{ imported: number; updated: number; merged: number; skipped: number; failed: number }> {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error("The CSV needs a header row and at least one data row");
  const { inputs, skipped } = csvToResponses(rows, opts.columns);
  if (!inputs.length) throw new Error("No answers found — make sure the file has a response/answer column");
  const settings = await getAttributionSettings(projectId);
  let imported = 0;
  let updated = 0;
  let merged = 0;
  let failed = 0;
  for (const input of inputs.slice(0, 50_000)) {
    try {
      const r = await ingestResponse(projectId, input, { sourceType: "import", provider: opts.provider, customChannels: settings.survey.channels });
      if (r.created) imported++;
      else updated++;
      if (r.merged) merged++;
    } catch {
      failed++;
    }
  }
  return { imported, updated, merged, skipped, failed };
}
