import "server-only";
import { z } from "zod";
import { API_SCOPES, SCOPE_INFO } from "@/features/api-settings/scopes";
import { ENGINE_IDS, KPI_DEFINITIONS } from "./ai-data";
import { createProjectBody, updateProjectBody } from "./projects";
import {
  answerQuery,
  competitorsQuery,
  exportQuery,
  fanoutDetailsQuery,
  fanoutsQuery,
  filterOnlyQuery,
  projectsListQuery,
  promptsCreateBody,
  promptsListQuery,
  sourcesQuery,
  tagsCreateBody,
} from "./schemas";
import { FILTER_ARRAY_KEYS } from "./rest";
import { attributionBulkBody, attributionListQuery, attributionSummaryQuery } from "./attribution";
import { tasksQuery } from "./tasks";
import { createAttributionSchema } from "@/server/attribution/service";
import { apiUrls } from "./urls";
import { seoResearchOperations } from "./openapi-ops/seo-research";
import { seoTrackingOperations } from "./openapi-ops/seo-tracking";
import { auditOperations } from "./openapi-ops/audit";
import { analyticsOperations } from "./openapi-ops/analytics";
import { researchOperations } from "./openapi-ops/research";
import { optimizeOperations } from "./openapi-ops/optimize";
import { reportsOperations } from "./openapi-ops/reports";

import { S, type Json, type OpenApiOperation } from "./openapi-helpers";

export { S, type OpenApiOperation };
const { ref, arr, num, int, str, strN, bool, obj } = S;


function schemaOf(t: z.ZodType): Json {
  const s = z.toJSONSchema(t, { io: "input", unrepresentable: "any" }) as Json;
  delete s.$schema;
  return s;
}

const metricsProps = Object.fromEntries(
  Object.entries(KPI_DEFINITIONS).map(([k, d]) => [k, { ...num, description: d }]),
);

const components = {
  securitySchemes: {
    bearerAuth: {
      type: "http",
      scheme: "bearer",
      description: "API key (`as_live_…`, Settings → API & MCP) or an OAuth 2.1 access token (`as_oat_…`).",
    },
    oauth2: {
      type: "oauth2",
      description: "Authorization code flow with PKCE (S256). Clients register dynamically (RFC 7591).",
      flows: {
        authorizationCode: {
          authorizationUrl: "",
          tokenUrl: "",
          refreshUrl: "",
          scopes: Object.fromEntries(API_SCOPES.map((s) => [s, SCOPE_INFO[s].description])),
        },
      },
    },
  },
  schemas: {
    Error: obj(
      {
        code: {
          type: "string",
          enum: ["unauthorized", "invalid_token", "forbidden", "insufficient_scope", "not_found", "validation_error", "conflict", "payload_too_large", "rate_limited", "internal_error"],
        },
        message: str,
        details: {},
      },
      { required: ["code", "message"] },
    ),
    ErrorEnvelope: obj({ data: { type: "null" }, meta: obj({ requestId: str }), error: ref("Error") }, { required: ["data", "meta", "error"] }),
    Pagination: obj({ page: int, limit: int, total: int, totalPages: int }),
    Period: obj({
      from: { type: "string", format: "date" },
      to: { type: "string", format: "date" },
      days: int,
      previous: obj({ from: { type: "string", format: "date" }, to: { type: "string", format: "date" } }),
      models: { oneOf: [{ const: "all" }, arr(str)] },
      tagIds: arr(str),
    }),
    PeriodMetrics: obj({
      ...metricsProps,
      answers: { ...int, description: "Answers in the period." },
      prompts: { ...int, description: "Prompts with at least one answer." },
      visibleAnswers: int,
      mentions: { ...int, description: "Answers naming the brand." },
      citedAnswers: { ...int, description: "Answers citing an own-domain page." },
    }),
    Project: obj({
      id: str,
      name: str,
      domain: str,
      websiteUrl: strN,
      description: strN,
      country: { ...str, description: "ISO market, e.g. DE" },
      language: str,
      brand: obj({ aliases: arr(str), domains: arr(str), industry: strN }),
      engines: arr({ type: "string", enum: ENGINE_IDS }),
      trackingFrequency: { type: "string", enum: ["daily", "weekly", "monthly", "paused"] },
      isPitch: bool,
      activePrompts: int,
      competitors: int,
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      url: { type: "string", format: "uri" },
    }),
    PromptMetrics: obj({
      isVisible: { ...bool, description: "Brand named or cited in at least one answer." },
      answers: int,
      visibility: num,
      visibilityChange: num,
      totalMentions: { ...int, description: "Answers naming the brand." },
      mentionRate: num,
      ownDomainCitations: { ...int, description: "Citations of own-domain pages." },
      citationRate: num,
      sentiment: num,
      avgPosition: num,
    }),
    Prompt: obj({
      id: str,
      text: str,
      country: str,
      language: str,
      status: { type: "string", enum: ["active", "archived"] },
      tags: arr(obj({ id: str, name: str })),
      models: arr(str),
      createdAt: { type: "string", format: "date-time" },
      lastRunAt: { type: ["string", "null"], format: "date-time" },
      metrics: ref("PromptMetrics"),
      competitorsMentioned: arr(obj({ id: str, name: str, mentions: int })),
    }),
    Answer: obj({
      answerId: str,
      prompt: str,
      model: str,
      provider: str,
      modelVersion: strN,
      date: { type: "string", format: "date" },
      country: str,
      status: { type: "string", enum: ["ok", "error"] },
      brandMentioned: bool,
      brandCited: bool,
      position: num,
      sentiment: num,
      text: str,
      mentions: arr(obj({ name: str, isOwn: bool, competitorId: strN, position: int, sentiment: num, cited: bool, recommended: bool })),
      citations: arr(obj({ url: str, domain: str, title: strN, contentType: str, ownership: str, position: int })),
      fanoutQueries: arr(str),
      products: arr({ type: "object" }),
      ads: arr({ type: "object" }),
      statements: arr({ type: "object" }),
      recommendations: arr({ type: "object" }),
    }),
    BrandMetrics: obj(
      Object.fromEntries(
        ["visibility", "mentionRate", "mentions", "citationRate", "citations", "sentiment", "avgPosition", "mentionDepth", "sov", "firstShare", "top3Share", "citationShare"].map((k) => [k, num]),
      ),
    ),
    CompetitorRow: obj({
      rank: int,
      competitorId: { ...strN, description: "null for your own brand" },
      isOwnBrand: bool,
      name: str,
      domain: strN,
      tracked: bool,
      metrics: ref("BrandMetrics"),
      changes: ref("BrandMetrics"),
      byModel: arr(obj({ model: str, visibility: num, visibleAnswers: int, answers: int })),
    }),
    Source: obj({
      rank: int,
      sourceId: str,
      url: str,
      title: strN,
      domain: str,
      contentType: strN,
      ownership: { type: ["string", "null"], enum: ["own", "competitor", "third_party", null] },
      citations: int,
      citationsChange: int,
      prompts: int,
      answers: int,
      models: arr(str),
    }),
    Tag: obj({ id: str, name: str, color: strN, promptCount: int }),
    FanoutQuery: obj({
      query: str,
      frequency: int,
      models: arr(str),
      prompts: arr(obj({ id: str, text: str })),
      promptCount: int,
      firstSeen: { type: "string", format: "date" },
      lastSeen: { type: "string", format: "date" },
    }),
    Attribution: obj({
      id: str,
      respondedAt: { type: "string", format: "date-time" },
      channel: str,
      channelLabel: str,
      channelDetail: strN,
      channelDetailLabel: strN,
      isAiSearch: bool,
      rawAnswer: strN,
      freetext: strN,
      sourceType: str,
      provider: str,
      formId: strN,
      formName: strN,
      contact: obj({ emailMask: strN, emailHash: strN, externalId: strN, name: strN }),
      dealValue: num,
      dealCurrency: strN,
      transactionId: strN,
      conversion: { type: ["object", "null"] },
      pageUrl: strN,
      status: { type: "string", enum: ["active", "dismissed"] },
      metadata: { type: "object" },
    }),
    Task: obj({
      id: str,
      title: str,
      summary: str,
      category: str,
      status: { type: "string", enum: ["open", "in_progress", "done", "dismissed"] },
      impact: { ...int, description: "1–10" },
      effort: { ...int, description: "1–10" },
      priority: { type: "number" },
      assigneeId: strN,
      signalActive: bool,
      source: str,
      datasets: arr(str),
      stepsDone: int,
      stepsTotal: int,
      targetPrompts: arr(str),
      dueDate: strN,
      firstDetectedAt: { type: "string", format: "date-time" },
      lastDetectedAt: { type: "string", format: "date-time" },
      resolvedAt: { type: ["string", "null"], format: "date-time" },
    }),
    ExportAnswer: obj({
      answerId: str,
      date: { type: "string", format: "date" },
      promptId: str,
      prompt: str,
      country: str,
      language: str,
      model: str,
      provider: str,
      status: str,
      brandMentioned: bool,
      brandCited: bool,
      position: num,
      mentionDepth: num,
      sentiment: num,
      brandCount: int,
      citationCount: int,
      ownCitationCount: int,
      competitorsMentioned: arr(str),
      sources: arr(str),
      text: { ...str, description: "Only with includeText=true" },
    }),
  },
};

const periodMeta = { period: ref("Period") };
const pagedMeta = { period: ref("Period"), pagination: ref("Pagination") };

export const OPERATIONS: OpenApiOperation[] = [
  {
    method: "get",
    path: "/me",
    operationId: "getMe",
    summary: "Current credential",
    description: "The authenticated user, workspace, role, scopes and accessible projects.",
    tag: "Account",
    scope: "read",
    data: obj({
      user: obj({ id: str, email: str, name: strN }),
      workspace: obj({ id: str, name: str, slug: str }),
      role: str,
      credential: obj({ id: str, kind: { type: "string", enum: ["api_key", "oauth_token", "session_key"] }, name: str, clientId: strN }),
      scopes: arr({ type: "string", enum: [...API_SCOPES] }),
      projectAccess: obj({ type: { type: "string", enum: ["all", "selected"] }, projectIds: arr(str) }),
      projects: arr(obj({ id: str, name: str, domain: str })),
    }),
  },
  { method: "get", path: "/projects", operationId: "listProjects", summary: "List projects", tag: "Projects", scope: "read", query: projectsListQuery, data: arr(ref("Project")), meta: { pagination: ref("Pagination") } },
  {
    method: "post",
    path: "/projects",
    operationId: "createProject",
    summary: "Create project",
    description: "Creates a project; brand profile, competitors and prompts are bootstrapped in the background.",
    tag: "Projects",
    scope: "write",
    permission: "projects.manage",
    body: createProjectBody,
    data: ref("Project"),
    status: 201,
  },
  { method: "get", path: "/projects/{projectId}", operationId: "getProject", summary: "Get project", tag: "Projects", scope: "read", data: ref("Project") },
  {
    method: "put",
    path: "/projects/{projectId}",
    operationId: "updateProject",
    summary: "Update project",
    description: "Partial update (PATCH is accepted too).",
    tag: "Projects",
    scope: "write",
    permission: "projects.manage",
    body: updateProjectBody,
    data: ref("Project"),
  },
  {
    method: "get",
    path: "/projects/{projectId}/prompts",
    operationId: "listPrompts",
    summary: "List prompts with metrics",
    description: "Tracked prompts with isVisible, totalMentions, mentionRate, ownDomainCitations and citationRate for the period.",
    tag: "Prompts",
    scope: "read",
    query: promptsListQuery,
    data: arr(ref("Prompt")),
    meta: pagedMeta,
  },
  {
    method: "post",
    path: "/projects/{projectId}/prompts",
    operationId: "createPrompts",
    summary: "Add prompts",
    description: "Adds prompts to AI visibility tracking (duplicates skipped, prompt limit applies) and optionally starts a tracking run.",
    tag: "Prompts",
    scope: "write",
    permission: "prompts.manage",
    body: promptsCreateBody,
    status: 201,
    data: obj({
      created: arr(str),
      duplicates: int,
      skippedOverLimit: int,
      run: { oneOf: [{ type: "null" }, obj({ runId: str, tasks: int, skipped: arr(obj({ engine: str, reason: str })) })] },
      runError: strN,
    }),
  },
  {
    method: "get",
    path: "/projects/{projectId}/prompts/{promptId}",
    operationId: "getPrompt",
    summary: "Prompt details",
    description: "Per-model metrics, competitors named and recent answers of one prompt.",
    tag: "Prompts",
    scope: "read",
    query: filterOnlyQuery,
    data: obj({
      prompt: ref("Prompt"),
      metrics: ref("PromptMetrics"),
      byModel: arr({ type: "object" }),
      competitorsMentioned: arr(obj({ id: str, name: str, domain: strN, mentions: int })),
      recentAnswers: arr(obj({ answerId: str, model: str, date: str, status: str, mentioned: bool, cited: bool, position: num, sentiment: num })),
    }),
    meta: periodMeta,
  },
  { method: "get", path: "/projects/{projectId}/answers/{answerId}", operationId: "getAnswer", summary: "AI answer", tag: "Prompts", scope: "read", query: answerQuery, data: ref("Answer") },
  {
    method: "get",
    path: "/projects/{projectId}/metrics",
    operationId: "getMetrics",
    summary: "Visibility metrics",
    description: "PeriodMetrics for today and yesterday plus the selected timeframe vs the previous period of equal length, with changes (percentage points / absolute).",
    tag: "Metrics",
    scope: "read",
    query: filterOnlyQuery,
    data: obj({
      today: ref("PeriodMetrics"),
      yesterday: ref("PeriodMetrics"),
      dailyChanges: ref("PeriodMetrics"),
      current: ref("PeriodMetrics"),
      previous: ref("PeriodMetrics"),
      changes: ref("PeriodMetrics"),
      definitions: { type: "object", additionalProperties: str },
    }),
    meta: periodMeta,
  },
  {
    method: "get",
    path: "/projects/{projectId}/metrics/timeseries",
    operationId: "getMetricsTimeseries",
    summary: "Visibility time series",
    tag: "Metrics",
    scope: "read",
    query: filterOnlyQuery,
    data: arr(
      obj({
        date: { type: "string", format: "date" },
        answers: int,
        visibility: num,
        mentionRate: num,
        citationRate: num,
        avgPosition: num,
        sentiment: num,
        mentionedAndCited: int,
        mentionedOnly: int,
        citedOnly: int,
        notVisible: int,
      }),
    ),
    meta: periodMeta,
  },
  {
    method: "get",
    path: "/projects/{projectId}/competitors",
    operationId: "listCompetitors",
    summary: "Competitor ranking",
    description: "Your brand and tracked competitors ranked by a metric, with changes vs the previous period.",
    tag: "Competitors",
    scope: "read",
    query: competitorsQuery,
    data: arr(ref("CompetitorRow")),
    meta: { ...pagedMeta, sortBy: str, order: str, totals: obj({ answers: int, prompts: int }) },
  },
  { method: "get", path: "/projects/{projectId}/sources", operationId: "listSources", summary: "Cited sources", tag: "Sources", scope: "read", query: sourcesQuery, data: arr(ref("Source")), meta: { ...pagedMeta, groupedBy: str } },
  { method: "get", path: "/projects/{projectId}/tags", operationId: "listTags", summary: "List tags", tag: "Tags", scope: "read", data: arr(ref("Tag")) },
  {
    method: "post",
    path: "/projects/{projectId}/tags",
    operationId: "createTags",
    summary: "Create & apply tags",
    tag: "Tags",
    scope: "write",
    permission: "prompts.manage",
    body: tagsCreateBody,
    status: 201,
    data: obj({ tags: arr(obj({ id: str, name: str })), appliedToPrompts: int }),
  },
  {
    method: "get",
    path: "/projects/{projectId}/export",
    operationId: "exportProject",
    summary: "Bulk export",
    description: "All prompts with metrics (first page) and one row per AI answer in the period. `format=csv` returns the answers as CSV (headers X-Total-Count / X-Total-Pages).",
    tag: "Export",
    scope: "export",
    query: exportQuery,
    data: obj({ project: obj({ id: str, name: str, domain: str }), prompts: { oneOf: [{ type: "null" }, arr(ref("Prompt"))] }, answers: arr(ref("ExportAnswer")) }),
    meta: pagedMeta,
    csv: true,
  },
  {
    method: "get",
    path: "/projects/{projectId}/fanouts",
    operationId: "listFanouts",
    summary: "Query fan-outs",
    description: "Search sub-queries AI engines ran while answering tracked prompts (default: last 90 days).",
    tag: "Fan-outs",
    scope: "read",
    query: fanoutsQuery,
    data: arr(ref("FanoutQuery")),
    meta: pagedMeta,
  },
  {
    method: "get",
    path: "/projects/{projectId}/fanouts/details",
    operationId: "getFanoutDetails",
    summary: "Fan-out query details",
    tag: "Fan-outs",
    scope: "read",
    query: fanoutDetailsQuery,
    data: obj({
      query: str,
      occurrences: int,
      answersShown: int,
      models: arr(str),
      prompts: arr(obj({ promptId: str, text: str })),
      answers: arr(obj({ answerId: str, promptId: str, model: str, date: str, brandMentioned: bool, brandCited: bool })),
    }),
    meta: periodMeta,
  },
  {
    method: "get",
    path: "/projects/{projectId}/attribution",
    operationId: "listAttributions",
    summary: "List attribution responses",
    description: "Self-reported attribution (\"How did you hear about us?\") responses with deal values, newest first.",
    tag: "Attribution",
    scope: "read",
    query: attributionListQuery,
    data: arr(ref("Attribution")),
    meta: { pagination: ref("Pagination") },
  },
  {
    method: "post",
    path: "/projects/{projectId}/attribution",
    operationId: "createAttribution",
    summary: "Record attribution",
    description: "Records one response (same fields as the attribution webhook). channelId is required: ai_search, search, social, ads, referral, content, other or a custom channel.",
    tag: "Attribution",
    scope: "write",
    permission: "attribution.manage",
    body: createAttributionSchema,
    status: 201,
    data: ref("Attribution"),
  },
  {
    method: "get",
    path: "/projects/{projectId}/attribution/summary",
    operationId: "getAttributionSummary",
    summary: "Attribution summary",
    description: "Responses, AI search share, deal value (AI vs other), breakdowns by channel and AI assistant, daily series and matched conversions.",
    tag: "Attribution",
    scope: "read",
    query: attributionSummaryQuery,
    data: { type: "object" },
  },
  {
    method: "post",
    path: "/projects/{projectId}/attribution/bulk",
    operationId: "bulkCreateAttributions",
    summary: "Bulk record attributions",
    description: "Up to 1000 items (array or { items }). Valid items are stored, invalid ones are reported by index.",
    tag: "Attribution",
    scope: "write",
    permission: "attribution.manage",
    body: attributionBulkBody,
    status: 201,
    data: obj({ created: int, failed: arr(obj({ index: int, error: str })), ids: arr(str) }),
  },
  {
    method: "get",
    path: "/projects/{projectId}/tasks",
    operationId: "listTasks",
    summary: "List optimization tasks",
    description: "Prioritized, evidence-backed tasks with counts (open, inProgress, done30, auto30, highImpact).",
    tag: "Tasks",
    scope: "read",
    query: tasksQuery,
    data: arr(ref("Task")),
    meta: { pagination: ref("Pagination"), counts: obj({ open: int, inProgress: int, done30: int, auto30: int, highImpact: int }) },
  },
  {
    method: "get",
    path: "/projects/{projectId}/tasks/{taskId}",
    operationId: "getTask",
    summary: "Task details",
    description: "Description, steps, acceptance criteria, content plan, targets, evidence and activity.",
    tag: "Tasks",
    scope: "read",
    data: { type: "object" },
  },
];

/**
 * REST operations that can incur cost (DataForSEO, AI generation, tracking runs). The matching
 * route handlers pass `spend: true` to apiRoute; a unit test keeps both in sync.
 */
export const SPEND_ROUTES = [
  "POST /projects",
  "POST /projects/{projectId}/prompts",
  "POST /projects/{projectId}/research/brand-lookup",
  "POST /projects/{projectId}/research/prompt-explorer",
  "POST /projects/{projectId}/research/prompt-lists/generate",
  "POST /projects/{projectId}/research/prompt-lists/track",
  "POST /projects/{projectId}/crawlability",
  "POST /projects/{projectId}/audits",
  "POST /projects/{projectId}/content",
  "POST /projects/{projectId}/content/optimize-url",
  "POST /projects/{projectId}/fact-check/run",
  "POST /projects/{projectId}/seo/rank-trackers",
  "POST /projects/{projectId}/seo/rank-trackers/{trackerId}/keywords",
  "POST /projects/{projectId}/seo/rank-trackers/{trackerId}/runs",
  "POST /projects/{projectId}/seo/local/{tool}",
  "POST /projects/{projectId}/reports/generate",
  "POST /projects/{projectId}/seo/keywords/research",
  "POST /projects/{projectId}/seo/keywords/metrics",
  "POST /projects/{projectId}/seo/serp",
  "POST /projects/{projectId}/seo/domain/overview",
  "POST /projects/{projectId}/seo/domain/keywords",
  "POST /projects/{projectId}/seo/domain/pages",
  "POST /projects/{projectId}/seo/domain/keyword-suggestions",
  "POST /projects/{projectId}/seo/domain/competitors",
  "POST /projects/{projectId}/seo/backlinks/overview",
  "POST /projects/{projectId}/seo/backlinks/list",
  "POST /projects/{projectId}/seo/backlinks/referring-domains",
  "POST /projects/{projectId}/seo/backlinks/top-pages",
] as const;
const SPEND_SET = new Set<string>(SPEND_ROUTES);

/** Local SEO tools are documented as separate paths (…/local/business-search etc.) of the `{tool}` route. */
function isSpendOperation(op: OpenApiOperation): boolean {
  const key = `${op.method.toUpperCase()} ${op.path}`;
  return op.spend === true || SPEND_SET.has(key) || (op.method === "post" && /^\/projects\/\{projectId\}\/seo\/local\/(?!runs|categories)[a-z-]+$/.test(op.path));
}

function parameters(op: OpenApiOperation): Json[] {
  const out: Json[] = [];
  for (const m of op.path.matchAll(/\{(\w+)\}/g)) out.push({ name: m[1], in: "path", required: true, schema: str });
  if (op.query) {
    for (const [name, field] of Object.entries(op.query.shape)) {
      const f = field as z.ZodType;
      const schema = schemaOf(f);
      const description = (schema.description as string | undefined) ?? (f as { description?: string }).description;
      delete schema.description;
      const isArray = FILTER_ARRAY_KEYS.includes(name);
      out.push({
        name,
        in: "query",
        required: !f.safeParse(undefined).success,
        ...(description ? { description } : {}),
        schema,
        ...(isArray ? { style: "form", explode: true, description: `${description ?? ""} Repeat the parameter or pass a comma-separated list.`.trim() } : {}),
      });
    }
  }
  return out;
}

function envelopeSchema(data: Json, meta?: Json) {
  return obj({ data, meta: obj({ requestId: str, ...(meta ?? {}) }), error: { type: "null" } }, { required: ["data", "meta", "error"] });
}

const ERROR_RESPONSES = {
  "400": { description: "Validation error", content: { "application/json": { schema: ref("ErrorEnvelope") } } },
  "401": { description: "Missing / invalid credential (WWW-Authenticate points at the resource metadata)", content: { "application/json": { schema: ref("ErrorEnvelope") } } },
  "403": { description: "Insufficient scope or role permission", content: { "application/json": { schema: ref("ErrorEnvelope") } } },
  "404": { description: "Not found or not accessible with this credential", content: { "application/json": { schema: ref("ErrorEnvelope") } } },
  "429": { description: "Rate limited (see Retry-After)", content: { "application/json": { schema: ref("ErrorEnvelope") } } },
};

const BASE_TAGS: { name: string; description?: string }[] = [
      { name: "Account", description: "The authenticated credential." },
      { name: "Projects", description: "Brands / websites tracked in the workspace." },
      { name: "Prompts", description: "Tracked prompts, their metrics and AI answers." },
      { name: "Metrics", description: "AI visibility KPIs and time series." },
      { name: "Competitors", description: "Brand ranking vs competitors." },
      { name: "Sources", description: "Pages and domains cited in AI answers." },
      { name: "Tags", description: "Prompt tags." },
      { name: "Fan-outs", description: "Search sub-queries AI engines ran (query fan-out)." },
      { name: "Export", description: "Bulk export (export scope)." },
      { name: "Attribution", description: "Self-reported attribution & AI search revenue." },
      { name: "Tasks", description: "Prioritized optimization tasks." }
];

/** Builds the OpenAPI 3.1 document for the REST API v1. */
export function buildOpenApiDocument(appName: string, rateLimitPerMinute: number): Json {
  const paths: Record<string, Json> = {};
  const all = [
    ...OPERATIONS,
    ...seoResearchOperations,
    ...seoTrackingOperations,
    ...auditOperations,
    ...analyticsOperations,
    ...researchOperations,
    ...optimizeOperations,
    ...reportsOperations,
  ];
  for (const raw of all) {
    const op = { ...raw, spend: isSpendOperation(raw) };
    const success: Json = {
      description: "Success",
      content: {
        "application/json": { schema: envelopeSchema(op.data, op.meta) },
        ...(op.csv ? { "text/csv": { schema: { type: "string" } } } : {}),
      },
    };
    const operation: Json = {
      operationId: op.operationId,
      summary: op.summary,
      ...(op.description ? { description: op.description } : {}),
      tags: [op.tag],
      security: [{ bearerAuth: [] }, { oauth2: op.spend ? [op.scope, "spend"] : [op.scope] }],
      "x-required-scope": op.spend ? `${op.scope} + spend` : op.scope,
      ...(op.spend ? { "x-incurs-cost": true } : {}),
      ...(op.permission ? { "x-required-permission": op.permission } : {}),
      parameters: parameters(op),
      ...(op.body ? { requestBody: { required: true, content: { "application/json": { schema: schemaOf(op.body) } } } } : {}),
      responses: { [String(op.status ?? 200)]: success, ...ERROR_RESPONSES },
    };
    paths[op.path] = { ...(paths[op.path] ?? {}), [op.method]: operation };
  }
  const c = structuredClone(components) as typeof components;
  c.securitySchemes.oauth2.flows.authorizationCode.authorizationUrl = apiUrls.authorize;
  c.securitySchemes.oauth2.flows.authorizationCode.tokenUrl = apiUrls.token;
  c.securitySchemes.oauth2.flows.authorizationCode.refreshUrl = apiUrls.token;
  return {
    openapi: "3.1.0",
    info: {
      title: `${appName} API`,
      version: "1.0.0",
      description: [
        `REST API for AI visibility (GEO) data. Every response uses the envelope \`{ data, meta, error }\`.`,
        `Authenticate with \`Authorization: Bearer <API key or OAuth token>\`. Scopes: read, write, spend, export. Write endpoints also require the matching role permission of the key owner. Endpoints marked \`x-incurs-cost\` (DataForSEO research, AI generation, tracking runs) additionally require the **spend** scope.`,
        `Rate limit: ${rateLimitPerMinute} requests/minute per credential (headers X-RateLimit-Limit / -Remaining / -Reset, 429 with Retry-After).`,
        `Filters: timeframe (e.g. 7d, 30d; default 30d) or startDate/endDate (YYYY-MM-DD), model (AI engine ids: ${ENGINE_IDS.join(", ")}), tags (names or ids). Percentages are 0–100; changes compare with the previous period of equal length.`,
        `MCP server: ${apiUrls.mcp} (Streamable HTTP, same credentials).`,
      ].join("\n\n"),
    },
    servers: [{ url: apiUrls.rest }],
    security: [{ bearerAuth: [] }],
    tags: [
      ...BASE_TAGS,
      ...[...new Set(all.map((o) => o.tag))].filter((t) => !BASE_TAGS.some((b) => b.name === t)).map((name) => ({ name })),
    ],
    paths,
    components: c,
    "x-mcp-server": { url: apiUrls.mcp, transport: "streamable-http", authorization: `${apiUrls.base}/.well-known/oauth-protected-resource/api/mcp` },
  };
}
