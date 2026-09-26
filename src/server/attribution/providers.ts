/**
 * Attribution integrations catalogue: every provider with its connection kind, a step-by-step setup
 * guide and (for fixed-format webhooks) a preset field mapping. Isomorphic (used by UI + server).
 *
 * Guide placeholders: {{webhookUrl}} {{collectUrl}} {{snippetTag}} {{appName}}
 */
import type { FieldMapping } from "./types";

export type ProviderCategory = "ecommerce" | "payments" | "forms" | "crm" | "surveys" | "automation" | "scheduling" | "support" | "custom";

export type ProviderKind =
  /** Generic webhook (token URL) — optional preset mapping. */
  | "webhook"
  /** Webhook with provider signature verification (Stripe, WooCommerce). */
  | "signed_webhook"
  /** Browser pixel code (Shopify Custom Pixel) posting to the public collect endpoint. */
  | "pixel"
  /** Pull responses via the provider API (token) + CSV import fallback. */
  | "api_import";

export type ProviderInfo = {
  key: string;
  name: string;
  category: ProviderCategory;
  kind: ProviderKind;
  description: string;
  captures: "responses" | "conversions" | "both";
  /** Brand-ish accent for the logo tile (no third-party logo assets). */
  color: string;
  steps: string[];
  presetMapping?: FieldMapping;
  /** Secret fields asked when connecting (stored encrypted). */
  secretFields?: Array<{ key: string; label: string; placeholder?: string; help?: string; generate?: boolean }>;
  /** Non-secret config fields. */
  configFields?: Array<{ key: string; label: string; placeholder?: string; help?: string }>;
  docsUrl?: string;
  supportsCsv?: boolean;
};

export const CATEGORY_LABELS: Record<ProviderCategory, string> = {
  ecommerce: "E-commerce",
  payments: "Payments",
  forms: "Forms & surveys",
  surveys: "Post-purchase surveys",
  crm: "CRM",
  automation: "Automation",
  scheduling: "Scheduling",
  support: "Support",
  custom: "Custom",
};

const DEFAULT_SCHEMA_STEP =
  'Send JSON with our schema: {"channelId": "<answer>", "respondentEmail": "<email>", "dealValue": 1200, "dealCurrency": "EUR", "respondentExternalId": "<crm id>", "formId": "<form>", "pageUrl": "<url>"} — only channelId is required. Order-only payloads ({"transactionId", "dealValue", "dealCurrency", "respondentEmail"}) are stored as conversions.';

export const PROVIDERS: ProviderInfo[] = [
  /* ─────────────── E-commerce ─────────────── */
  {
    key: "shopify",
    name: "Shopify (Custom Pixel)",
    category: "ecommerce",
    kind: "pixel",
    captures: "conversions",
    color: "#5e8e3e",
    description: "Capture every checkout via a Shopify Custom Pixel — no app install required.",
    steps: [
      "In Shopify admin open Settings → Customer events → Add custom pixel and name it “{{appName}} Attribution”.",
      "Set Permission to “Not required” (the pixel only sends order id, value, currency and a hashed email) and Data sale to “Data collected does not qualify as data sale”.",
      "Paste the generated pixel code below into the Code field, click Save and then Connect.",
      "Add the website snippet to your theme (Online Store → Themes → Edit code → theme.liquid, before </head>) so visitors see the survey.",
      "Place a test order — it appears under Webhook logs / Verify within seconds.",
    ],
    docsUrl: "https://help.shopify.com/en/manual/promoting-marketing/pixels/custom-pixels",
  },
  {
    key: "woocommerce",
    name: "WooCommerce",
    category: "ecommerce",
    kind: "signed_webhook",
    captures: "both",
    color: "#7f54b3",
    description: "Native WooCommerce order webhooks, verified with a shared secret.",
    steps: [
      "Click Connect to generate your webhook URL and secret (both are shown once).",
      "In WordPress open WooCommerce → Settings → Advanced → Webhooks → Add webhook.",
      "Name: “{{appName}} Attribution”, Status: Active, Topic: “Order updated” (also add a second one for “Order created” if you like), API version: WP REST API Integration v3.",
      "Delivery URL: {{webhookUrl}} — Secret: the generated secret. Save.",
      "Paid orders (processing / completed) are stored as conversions. If your checkout has a “How did you hear about us?” field, its order meta answer is stored as a response too.",
    ],
    secretFields: [{ key: "signingSecret", label: "Webhook secret", generate: true, help: "Paste this into the Secret field in WooCommerce." }],
    docsUrl: "https://woocommerce.com/document/webhooks/",
  },
  {
    key: "shopware",
    name: "Shopware 6 (Flow Builder)",
    category: "ecommerce",
    kind: "webhook",
    captures: "conversions",
    color: "#189eff",
    description: "Send placed orders from the Shopware Flow Builder “Call webhook” action.",
    steps: [
      "Click Connect to generate your webhook URL (shown once).",
      "In Shopware admin open Settings → Flow Builder → Add flow, Trigger: “Checkout / Order / Placed”.",
      "Add the action “Call webhook” (Flow Builder webhook), method POST, URL: {{webhookUrl}}, content type JSON.",
      'Body: {"transactionId": "{{ order.orderNumber }}", "dealValue": {{ order.amountTotal }}, "dealCurrency": "{{ order.currency.isoCode }}", "respondentEmail": "{{ order.orderCustomer.email }}"}',
      "Save and place a test order. Orders are stored as conversions and merged with survey answers by order number or email.",
    ],
    presetMapping: {
      transactionId: { path: "transactionId" },
      dealValue: { path: "dealValue" },
      dealCurrency: { path: "dealCurrency" },
      email: { path: "respondentEmail" },
    },
    docsUrl: "https://docs.shopware.com/en/shopware-6-en/settings/flow-builder",
  },
  /* ─────────────── Payments ─────────────── */
  {
    key: "stripe",
    name: "Stripe",
    category: "payments",
    kind: "signed_webhook",
    captures: "conversions",
    color: "#635bff",
    description: "Checkout sessions and subscription invoices via a signed Stripe webhook. $0 checkouts count as trials, recurring invoices as renewals.",
    steps: [
      "Click Connect to generate your webhook URL (shown once).",
      "In the Stripe Dashboard open Developers → Webhooks → Add endpoint and paste {{webhookUrl}}.",
      "Select events: checkout.session.completed, checkout.session.async_payment_succeeded, invoice.paid.",
      "After creating the endpoint, reveal its Signing secret (whsec_…) and paste it here — every event is verified with it.",
      "Use “Send test webhook” in Stripe to verify. $0 checkouts are stored as trials, subscription_cycle invoices as renewals (never double counted).",
    ],
    secretFields: [{ key: "signingSecret", label: "Signing secret", placeholder: "whsec_…", help: "Stripe → Developers → Webhooks → your endpoint → Signing secret." }],
    docsUrl: "https://docs.stripe.com/webhooks",
  },
  /* ─────────────── Post-purchase surveys ─────────────── */
  {
    key: "fairing",
    name: "Fairing",
    category: "surveys",
    kind: "api_import",
    captures: "responses",
    color: "#ff6a3d",
    description: "Import post-purchase survey responses (incl. order id & total) from Fairing.",
    steps: [
      "In Fairing open Settings → Integrations → API and copy your API key.",
      "Paste it here and click Connect — responses sync every hour (and on “Sync now”).",
      "Alternatively export responses as CSV in Fairing and use “Import CSV”.",
    ],
    secretFields: [{ key: "apiToken", label: "API key" }],
    configFields: [{ key: "questionId", label: "Question ID (optional)", help: "Defaults to every question that looks like “How did you hear about us?”." }],
    supportsCsv: true,
    docsUrl: "https://docs.fairing.co/reference/retrieve-responses",
  },
  {
    key: "knocommerce",
    name: "KnoCommerce",
    category: "surveys",
    kind: "api_import",
    captures: "responses",
    color: "#1f6feb",
    description: "Import KnoCommerce post-purchase survey responses.",
    steps: [
      "In KnoCommerce open Settings → API and create API credentials (client id + secret) with the RESPONSES scope (API access depends on your Kno plan).",
      "Paste them here and click Connect — responses sync every hour.",
      "Alternatively export responses as CSV and use “Import CSV”.",
    ],
    secretFields: [
      { key: "clientId", label: "Client ID" },
      { key: "clientSecret", label: "Client secret" },
    ],
    configFields: [{ key: "questionId", label: "Question ID (optional)", help: "Defaults to the question labelled “How did you hear about us?”." }],
    supportsCsv: true,
    docsUrl: "https://developers.knocommerce.com/",
  },
  {
    key: "zigpoll",
    name: "Zigpoll",
    category: "surveys",
    kind: "api_import",
    captures: "responses",
    color: "#0ea5e9",
    description: "Import Zigpoll survey responses.",
    steps: [
      "In Zigpoll open Settings → API key and copy your key (API access requires the Premium plan).",
      "Copy the id of your “How did you hear about us?” question (slide id) — or use the poll id / account id.",
      "Paste them here and click Connect — responses sync every hour.",
      "Alternatively export responses as CSV and use “Import CSV”.",
    ],
    secretFields: [{ key: "apiToken", label: "API key" }],
    configFields: [
      { key: "slideId", label: "Question (slide) ID", help: "Recommended — only this question is imported." },
      { key: "pollId", label: "Poll ID (alternative)" },
      { key: "accountId", label: "Account ID (alternative)" },
    ],
    supportsCsv: true,
    docsUrl: "https://apidocs.zigpoll.com/reference/get_responses",
  },
  {
    key: "surveymonkey",
    name: "SurveyMonkey",
    category: "surveys",
    kind: "api_import",
    captures: "responses",
    color: "#00bf6f",
    description: "Import responses of a SurveyMonkey survey via the v3 API.",
    steps: [
      "Create a private app at developer.surveymonkey.com with the scopes “View surveys” and “View responses”, then copy its access token.",
      "Copy the survey id (from the survey URL or the API) that contains the “How did you hear about us?” question.",
      "Paste both here and click Connect — responses sync every hour.",
    ],
    secretFields: [{ key: "apiToken", label: "Access token" }],
    configFields: [
      { key: "surveyId", label: "Survey ID" },
      { key: "questionId", label: "Question ID (optional)", help: "Defaults to the question that looks like “How did you hear about us?”." },
    ],
    supportsCsv: true,
    docsUrl: "https://api.surveymonkey.com/v3/docs",
  },
  /* ─────────────── Forms ─────────────── */
  {
    key: "typeform",
    name: "Typeform",
    category: "forms",
    kind: "webhook",
    captures: "responses",
    color: "#262627",
    description: "Typeform webhooks — the “How did you hear about us?” answer is detected automatically.",
    steps: [
      "Click Connect to generate your webhook URL (shown once).",
      "In Typeform open your form → Connect → Webhooks → Add a webhook and paste {{webhookUrl}}. Turn it on.",
      "Click “View deliveries → Send test request” (or submit the form once).",
      "Open Field Mapping: the created workflow already suggests the answer, email and form fields — confirm and save. Future submissions parse automatically.",
      "Optional: add hidden fields page_url / deal_value to pass extra context.",
    ],
    presetMapping: {
      email: { path: "form_response.answers[type=email].email" },
      externalId: { path: "form_response.token" },
      formId: { path: "form_response.form_id" },
      formName: { path: "form_response.definition.title" },
      occurredAt: { path: "form_response.submitted_at" },
      pageUrl: { path: "form_response.hidden.page_url" },
    },
    docsUrl: "https://www.typeform.com/developers/webhooks/",
  },
  {
    key: "tally",
    name: "Tally",
    category: "forms",
    kind: "webhook",
    captures: "responses",
    color: "#000000",
    description: "Tally form webhooks with automatic option-label resolution.",
    steps: [
      "Click Connect to generate your webhook URL (shown once).",
      "In Tally open your form → Integrations → Webhooks → Connect and paste {{webhookUrl}}.",
      "Submit the form once, then open Field Mapping and confirm the suggested fields.",
    ],
    presetMapping: {
      externalId: { path: "data.responseId" },
      formId: { path: "data.formId" },
      formName: { path: "data.formName" },
      occurredAt: { path: "data.createdAt" },
      email: { path: "data.fields[type=INPUT_EMAIL].answer" },
    },
    docsUrl: "https://tally.so/help/webhooks",
  },
  {
    key: "jotform",
    name: "Jotform",
    category: "forms",
    kind: "webhook",
    captures: "responses",
    color: "#ff6100",
    description: "Jotform webhooks (multipart submissions are parsed automatically).",
    steps: [
      "Click Connect to generate your webhook URL (shown once).",
      "In Jotform open your form → Settings → Integrations → WebHooks and paste {{webhookUrl}}.",
      "Submit the form once, then open Field Mapping and pick the “How did you hear about us?” field.",
    ],
    presetMapping: {
      externalId: { path: "submissionID" },
      formId: { path: "formID" },
      formName: { path: "formTitle" },
    },
    docsUrl: "https://www.jotform.com/help/245-how-to-setup-a-webhook-with-jotform/",
  },
  {
    key: "gravity_forms",
    name: "Gravity Forms",
    category: "forms",
    kind: "webhook",
    captures: "responses",
    color: "#f15a2b",
    description: "Gravity Forms Webhooks Add-On.",
    steps: [
      "Click Connect to generate your webhook URL (shown once).",
      "In WordPress install the Gravity Forms Webhooks Add-On, open Form → Settings → Webhooks → Add New.",
      "Request URL: {{webhookUrl}}, Method: POST, Format: JSON, Request Body: “Select Fields” and add channelId (your question), respondentEmail (email field), pageUrl (Embed URL).",
      "Submit the form once and confirm the mapping under Field Mapping if needed.",
    ],
    docsUrl: "https://docs.gravityforms.com/webhooks-add-on/",
  },
  {
    key: "formstack",
    name: "Formstack",
    category: "forms",
    kind: "webhook",
    captures: "responses",
    color: "#21b573",
    description: "Formstack form webhooks.",
    steps: [
      "Click Connect to generate your webhook URL (shown once).",
      "In Formstack open your form → Settings → Emails & Actions → Add Webhook, paste {{webhookUrl}}, enable “Post with sub-field names” and “Post as JSON”.",
      "Submit the form once and confirm the mapping under Field Mapping.",
    ],
    presetMapping: { externalId: { path: "UniqueID" }, formId: { path: "FormID" } },
    docsUrl: "https://help.formstack.com/s/article/Webhooks",
  },
  /* ─────────────── CRM ─────────────── */
  {
    key: "hubspot",
    name: "HubSpot",
    category: "crm",
    kind: "webhook",
    captures: "both",
    color: "#ff7a59",
    description: "HubSpot workflow “Send a webhook” action for contacts or deals (with deal value).",
    steps: [
      "Click Connect to generate your webhook URL (shown once).",
      "In HubSpot create a workflow (Contact- or Deal-based) → action “Send a webhook” → Method POST → URL {{webhookUrl}}.",
      "Choose “Customize request body” and add: channelId → your “How did you hear about us?” property, respondentEmail → Email, respondentExternalId → Record ID, dealValue → Amount, dealCurrency → Currency.",
      "Click “Test action” to send a test — without customized body open Field Mapping to map the HubSpot properties.",
    ],
    presetMapping: {
      channel: { path: "channelId" },
      email: { path: "respondentEmail" },
      externalId: { path: "respondentExternalId" },
      dealValue: { path: "dealValue" },
      dealCurrency: { path: "dealCurrency" },
    },
    docsUrl: "https://knowledge.hubspot.com/workflows/how-do-i-use-webhooks-with-hubspot-workflows",
  },
  {
    key: "salesforce",
    name: "Salesforce",
    category: "crm",
    kind: "webhook",
    captures: "both",
    color: "#00a1e0",
    description: "Salesforce Flow HTTP callout on Lead / Opportunity changes.",
    steps: [
      "Click Connect to generate your webhook URL (shown once).",
      "In Setup → Named Credentials create an External Credential + Named Credential pointing to your {{appName}} host.",
      "Create a Record-Triggered Flow on Lead (or Opportunity when Closed Won) → Action “Create HTTP Callout” → POST to the webhook path incl. ?token=….",
      "Send the record as JSON (Id, Email, LeadSource or your custom “How did you hear” field, Amount, CurrencyIsoCode) and map the fields under Field Mapping.",
    ],
    presetMapping: {
      channel: { path: "LeadSource" },
      email: { path: "Email" },
      externalId: { path: "Id" },
      dealValue: { path: "Amount" },
      dealCurrency: { path: "CurrencyIsoCode" },
    },
    docsUrl: "https://help.salesforce.com/s/articleView?id=sf.flow_http_callout.htm",
  },
  {
    key: "pipedrive",
    name: "Pipedrive",
    category: "crm",
    kind: "webhook",
    captures: "both",
    color: "#1a1a1a",
    description: "Pipedrive deal webhooks (value + currency) or Automations webhooks.",
    steps: [
      "Click Connect to generate your webhook URL (shown once).",
      "In Pipedrive open Tools & apps → Webhooks → Create new webhook: Event action “added” (or “updated”), Event object “deal”, Endpoint URL {{webhookUrl}}.",
      "Create a test deal, then open Field Mapping and map your custom “How did you hear about us?” field (current.<field key>).",
    ],
    presetMapping: {
      externalId: { path: "current.id" },
      dealValue: { path: "current.value" },
      dealCurrency: { path: "current.currency" },
      formName: { constant: "Pipedrive deal" },
    },
    docsUrl: "https://pipedrive.readme.io/docs/guide-for-webhooks",
  },
  {
    key: "attio",
    name: "Attio",
    category: "crm",
    kind: "webhook",
    captures: "both",
    color: "#111827",
    description: "Attio workflow “Send HTTP request” block.",
    steps: [
      "Click Connect to generate your webhook URL (shown once).",
      "In Attio create a workflow (trigger: record created/updated) → add “Send HTTP request”, POST {{webhookUrl}}.",
      DEFAULT_SCHEMA_STEP,
    ],
    docsUrl: "https://attio.com/help/reference/automations/workflows",
  },
  {
    key: "close",
    name: "Close",
    category: "crm",
    kind: "webhook",
    captures: "both",
    color: "#2563eb",
    description: "Close CRM webhook subscriptions for leads & opportunities.",
    steps: [
      "Click Connect to generate your webhook URL (shown once).",
      "Create a webhook subscription (Settings → Developer → Webhooks) for lead.created / opportunity.updated pointing to {{webhookUrl}}.",
      "Trigger a test event, then map event.data custom fields under Field Mapping.",
    ],
    presetMapping: {
      externalId: { path: "event.object_id" },
      dealValue: { path: "event.data.value" },
      dealCurrency: { path: "event.data.value_currency" },
    },
    docsUrl: "https://developer.close.com/resources/webhook-subscriptions/",
  },
  /* ─────────────── Scheduling & support ─────────────── */
  {
    key: "calendly",
    name: "Calendly",
    category: "scheduling",
    kind: "webhook",
    captures: "responses",
    color: "#006bff",
    description: "Booking questions (“How did you hear about us?”) from Calendly invitee webhooks.",
    steps: [
      "Add a question “How did you hear about us?” to your Calendly event type.",
      "Click Connect to generate your webhook URL (shown once).",
      "Create a webhook subscription (API: POST /webhook_subscriptions, event invitee.created) with url {{webhookUrl}}.",
      "Book a test meeting — the answer is detected automatically from questions_and_answers.",
    ],
    presetMapping: {
      email: { path: "payload.email" },
      name: { path: "payload.name" },
      externalId: { path: "payload.uri" },
      occurredAt: { path: "payload.created_at" },
      formName: { constant: "Calendly booking" },
    },
    docsUrl: "https://developer.calendly.com/api-docs/webhooks",
  },
  {
    key: "intercom",
    name: "Intercom",
    category: "support",
    kind: "webhook",
    captures: "responses",
    color: "#1f8ded",
    description: "Intercom contact webhooks with a custom attribute for the answer.",
    steps: [
      "Create a custom contact attribute “How did you hear about us?” (e.g. filled by a Series or bot).",
      "Click Connect to generate your webhook URL (shown once).",
      "In the Intercom Developer Hub → your app → Webhooks subscribe to contact.user.updated / contact.lead.created with {{webhookUrl}}.",
      "Send a test notification and map data.item.custom_attributes under Field Mapping.",
    ],
    presetMapping: {
      email: { path: "data.item.email" },
      name: { path: "data.item.name" },
      externalId: { path: "data.item.id" },
    },
    docsUrl: "https://developers.intercom.com/docs/webhooks",
  },
  /* ─────────────── Automation ─────────────── */
  {
    key: "zapier",
    name: "Zapier / Make",
    category: "automation",
    kind: "webhook",
    captures: "both",
    color: "#ff4a00",
    description: "Connect 6,000+ apps with a “Webhooks by Zapier” POST or Make HTTP module.",
    steps: [
      "Click Connect to generate your webhook URL (shown once).",
      "Zapier: add the action “Webhooks by Zapier → POST”, URL {{webhookUrl}}, Payload type JSON. Make: add “HTTP → Make a request”, method POST, body type JSON.",
      DEFAULT_SCHEMA_STEP,
      "Run a test — the event appears under Webhook logs.",
    ],
    docsUrl: "https://help.zapier.com/hc/en-us/articles/8496326446989",
  },
  {
    key: "n8n",
    name: "n8n",
    category: "automation",
    kind: "webhook",
    captures: "both",
    color: "#ea4b71",
    description: "n8n HTTP Request node.",
    steps: [
      "Click Connect to generate your webhook URL (shown once).",
      "Add an “HTTP Request” node: Method POST, URL {{webhookUrl}}, Send Body → JSON.",
      DEFAULT_SCHEMA_STEP,
    ],
    docsUrl: "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/",
  },
  /* ─────────────── Custom ─────────────── */
  {
    key: "custom_webhook",
    name: "Custom Webhook",
    category: "custom",
    kind: "webhook",
    captures: "both",
    color: "#16a34a",
    description: "Any system that can POST JSON — raw JSON is mapped in Field Mapping.",
    steps: [
      "Click Connect to generate your webhook URL (shown once). The token can also be sent as header “X-Attribution-Token” or “Authorization: Bearer …”.",
      DEFAULT_SCHEMA_STEP,
      "Any other JSON shape creates a Field Mapping workflow on first delivery — map it once, future payloads parse automatically.",
      "Limits: 120 requests / minute per project, 256 KB per payload.",
    ],
  },
];

export const PROVIDER_MAP = new Map(PROVIDERS.map((p) => [p.key, p]));

export function getProvider(key: string | null | undefined): ProviderInfo | undefined {
  return key ? PROVIDER_MAP.get(key) : undefined;
}

/** Preset mappings for workflows (also for raw JSON = empty preset). */
export const MAPPING_PRESETS: Array<{ key: string; name: string; mapping: FieldMapping }> = [
  ...PROVIDERS.filter((p) => p.presetMapping).map((p) => ({ key: p.key, name: p.name, mapping: p.presetMapping! })),
  {
    key: "stripe",
    name: "Stripe (event JSON)",
    mapping: {
      transactionId: { path: "data.object.id" },
      dealValue: { path: "data.object.amount_total" },
      dealCurrency: { path: "data.object.currency" },
      email: { path: "data.object.customer_details.email" },
    },
  },
  {
    key: "woocommerce",
    name: "WooCommerce (order JSON)",
    mapping: {
      transactionId: { path: "number" },
      dealValue: { path: "total" },
      dealCurrency: { path: "currency" },
      email: { path: "billing.email" },
    },
  },
  {
    key: "raw",
    name: "Raw JSON (our schema)",
    mapping: {
      channel: { path: "channelId" },
      email: { path: "respondentEmail" },
      externalId: { path: "respondentExternalId" },
      name: { path: "respondentName" },
      freetext: { path: "freetextResponse" },
      dealValue: { path: "dealValue" },
      dealCurrency: { path: "dealCurrency" },
      formId: { path: "formId" },
      pageUrl: { path: "pageUrl" },
      transactionId: { path: "transactionId" },
    },
  },
];
