/**
 * Catalog of every integration AutoSEO offers (finseo parity). Isomorphic: used by the
 * Integrations page, the server (field validation) and other modules (provider keys).
 *
 * Provider keys are the values stored in `integrations.provider`. Providers owned by other
 * modules carry a `setupHref`; the Integrations page links there instead of connecting inline.
 */

export type IntegrationCategory =
  | "analytics"
  | "search_console"
  | "bot_traffic"
  | "data_reporting"
  | "project_management"
  | "attribution"
  | "cms";

export type ConnectType = "oauth" | "token" | "webhook" | "snippet" | "link";
export type IntegrationStatusBadge = "beta" | "coming_soon" | "new";

export type TokenField = {
  key: string;
  label: string;
  type: "text" | "password" | "url" | "number";
  placeholder?: string;
  help?: string;
  required?: boolean;
  /** Stored encrypted in `integrations.secret` (never sent back to the browser). */
  secret?: boolean;
  /**
   * The value determines where stored secrets are sent (e.g. a self-hosted base URL). Changing it
   * discards the stored secrets, which must then be re-entered.
   */
  destination?: boolean;
  /** Optional regex (source) the value must match. */
  pattern?: string;
  patternMessage?: string;
};

export type CatalogEntry = {
  key: string;
  name: string;
  category: IntegrationCategory;
  description: string;
  /** Vendor domain — logo is rendered through the favicon proxy. */
  domain?: string;
  /** Monogram fallback color. */
  color: string;
  status?: IntegrationStatusBadge;
  connect: ConnectType;
  fields?: TokenField[];
  /** Other-module (or dedicated page) setup link. `{projectId}` is replaced. */
  setupHref?: string;
  /** Where a connected integration is managed (in-app). `{projectId}` is replaced. */
  manageHref?: string;
  /** Whether the server can verify the credentials ("Test connection"). */
  testable?: boolean;
  docsUrl?: string;
  /** Short list of what the integration powers. */
  features?: string[];
};

export const INTEGRATION_CATEGORIES: { key: IntegrationCategory; label: string; description: string }[] = [
  { key: "analytics", label: "Analytics", description: "Human traffic from AI platforms, conversions & revenue" },
  { key: "search_console", label: "Search Console", description: "Search queries, impressions and AI-style prompts" },
  { key: "bot_traffic", label: "Bot Traffic", description: "AI crawler visits from your CDN or server logs" },
  { key: "data_reporting", label: "Data & Reporting", description: "Export your data to BI tools, agents and scripts" },
  { key: "project_management", label: "Project Management", description: "Push optimization tasks to your PM tool" },
  { key: "attribution", label: "Attribution", description: "Tie leads, deals and orders to AI search" },
  { key: "cms", label: "CMS", description: "Publish optimized content directly to your site" },
];

const p = (path: string) => `/p/{projectId}${path}`;
const attribution = (key: string) => p(`/attribution?setup=${key}`);
const pm = (key: string) => p(`/tasks?connect=${key}`);
const cms = (key: string) => p(`/content?connect=${key}`);

export const INTEGRATIONS: CatalogEntry[] = [
  /* ───────────── Analytics ───────────── */
  {
    key: "google_analytics",
    name: "Google Analytics",
    category: "analytics",
    description: "Sessions, conversions and revenue from AI platforms via the GA4 Data API.",
    domain: "analytics.google.com",
    color: "#e37400",
    connect: "oauth",
    manageHref: p("/analytics/traffic?tab=settings"),
    features: ["Human traffic from AI platforms", "AI model → page → outcome flow", "GSC × GA4 opportunities"],
  },
  {
    key: "piwik_pro",
    name: "Piwik PRO",
    category: "analytics",
    description: "Privacy-first analytics. Connect with API client credentials to import AI-referred sessions.",
    domain: "piwik.pro",
    color: "#1c3e8f",
    connect: "token",
    testable: true,
    manageHref: p("/analytics/traffic?tab=settings"),
    docsUrl: "https://developers.piwik.pro/en/latest/platform/getting_started.html#generate-api-credentials",
    fields: [
      {
        key: "accountUrl",
        label: "Account URL",
        type: "url",
        destination: true,
        placeholder: "https://yourcompany.piwik.pro",
        required: true,
        help: "The address you use to log in to Piwik PRO.",
      },
      {
        key: "websiteId",
        label: "Site / App ID",
        type: "text",
        placeholder: "e.g. 3b1c0e5a-…",
        required: true,
        help: "Administration → Sites & apps → the site's ID.",
      },
      { key: "clientId", label: "Client ID", type: "text", required: true, help: "Menu → Profile → API credentials." },
      { key: "clientSecret", label: "Client secret", type: "password", required: true, secret: true },
    ],
  },
  {
    key: "matomo",
    name: "Matomo",
    category: "analytics",
    description: "Self-hosted or cloud Matomo. Imports visits referred by ChatGPT, Perplexity, Gemini & co.",
    domain: "matomo.org",
    color: "#3152a0",
    connect: "token",
    testable: true,
    manageHref: p("/analytics/traffic?tab=settings"),
    docsUrl: "https://matomo.org/faq/general/faq_114/",
    fields: [
      {
        key: "url",
        label: "Matomo URL",
        type: "url",
        destination: true,
        placeholder: "https://analytics.example.com",
        required: true,
        help: "Base URL of your Matomo instance (without index.php).",
      },
      {
        key: "siteId",
        label: "Site ID",
        type: "text",
        placeholder: "1",
        required: true,
        pattern: "^\\d+$",
        patternMessage: "The site ID is a number.",
      },
      {
        key: "tokenAuth",
        label: "Auth token (token_auth)",
        type: "password",
        required: true,
        secret: true,
        help: "Administration → Personal → Security → Auth tokens. Read access is enough.",
      },
    ],
  },

  /* ───────────── Search Console ───────────── */
  {
    key: "google_search_console",
    name: "Google Search Console",
    category: "search_console",
    description: "Queries, pages and countries from Google Search — detect AI-style prompts in your search data.",
    domain: "search.google.com",
    color: "#4285f4",
    connect: "oauth",
    manageHref: p("/analytics/search-console?tab=settings"),
    features: ["Search queries & AI prompts", "Top pages", "Striking distance keywords"],
  },
  {
    key: "bing_webmaster",
    name: "Bing Webmaster Tools",
    category: "search_console",
    description: "Bing search queries and pages (Bing powers Copilot and ChatGPT search results).",
    domain: "bing.com",
    color: "#008373",
    connect: "token",
    testable: true,
    manageHref: p("/analytics/search-console?tab=settings&source=bing"),
    docsUrl: "https://learn.microsoft.com/en-us/bingwebmaster/getting-access",
    fields: [
      {
        key: "siteUrl",
        label: "Site URL",
        type: "url",
        placeholder: "https://www.example.com/",
        required: true,
        help: "Exactly as the site is registered in Bing Webmaster Tools.",
      },
      {
        key: "apiKey",
        label: "API key",
        type: "password",
        secret: true,
        help: "Bing Webmaster → Settings → API access. Leave empty to use the instance-wide key from Admin → Data Providers.",
      },
    ],
  },

  /* ───────────── Bot Traffic ───────────── */
  {
    key: "cloudflare",
    name: "Cloudflare",
    category: "bot_traffic",
    description: "Stream AI crawler requests with a Cloudflare Worker (all plans) or Logpush (Enterprise).",
    domain: "cloudflare.com",
    color: "#f38020",
    connect: "webhook",
    setupHref: p("/analytics/bots?tab=sync&connector=cloudflare"),
    features: ["Worker or Logpush", "Real-time bot visits"],
  },
  {
    key: "akamai",
    name: "Akamai",
    category: "bot_traffic",
    description: "Send DataStream 2 logs to your AutoSEO HTTPS endpoint.",
    domain: "akamai.com",
    color: "#0096d6",
    connect: "webhook",
    setupHref: p("/analytics/bots?tab=sync&connector=akamai"),
    features: ["DataStream 2 (HTTPS)"],
  },
  {
    key: "server_logs",
    name: "Server Logs / API",
    category: "bot_traffic",
    description: "Push NDJSON from nginx, Apache or any backend — or upload log files manually.",
    color: "#0f0f0f",
    connect: "webhook",
    setupHref: p("/analytics/bots?tab=sync&connector=server_logs"),
    features: ["NDJSON ingest API", "Log file upload (up to 1 GB)"],
  },
  {
    key: "fastly",
    name: "Fastly",
    category: "bot_traffic",
    description: "Real-time log streaming from Fastly.",
    domain: "fastly.com",
    color: "#ff282d",
    status: "coming_soon",
    connect: "webhook",
  },
  {
    key: "cloudfront",
    name: "AWS CloudFront",
    category: "bot_traffic",
    description: "Real-time logs from Amazon CloudFront distributions.",
    domain: "aws.amazon.com",
    color: "#8c4fff",
    status: "coming_soon",
    connect: "webhook",
  },

  /* ───────────── Data & Reporting ───────────── */
  {
    key: "looker_studio",
    name: "Looker Studio",
    category: "data_reporting",
    description: "Build dashboards on top of the AutoSEO REST API with an API key.",
    domain: "lookerstudio.google.com",
    color: "#4285f4",
    connect: "link",
    status: "beta",
    setupHref: "/settings/api",
  },
  {
    key: "mcp",
    name: "AutoSEO MCP",
    category: "data_reporting",
    description: "Connect Claude, ChatGPT, Cursor or VS Code to your project data via MCP.",
    color: "#16a34a",
    connect: "link",
    setupHref: "/settings/api",
  },
  {
    key: "rest_api",
    name: "AutoSEO API",
    category: "data_reporting",
    description: "Programmatic access to prompts, visibility, traffic and reports.",
    color: "#0f0f0f",
    connect: "link",
    setupHref: "/settings/api",
  },

  /* ───────────── Project Management ───────────── */
  ...(
    [
      ["clickup", "ClickUp", "clickup.com", "#7b68ee"],
      ["asana", "Asana", "asana.com", "#f06a6a"],
      ["linear", "Linear", "linear.app", "#5e6ad2"],
      ["jira", "Jira", "atlassian.com", "#0052cc"],
      ["monday", "Monday.com", "monday.com", "#ff3d57"],
      ["trello", "Trello", "trello.com", "#0079bf"],
      ["notion", "Notion", "notion.so", "#111111"],
      ["awork", "awork", "awork.com", "#2e3bff"],
    ] as const
  ).map(
    ([key, name, domain, color]): CatalogEntry => ({
      key,
      name,
      category: "project_management",
      description: `Push prioritized optimization tasks to ${name} and keep status in sync.`,
      domain,
      color,
      connect: "token",
      setupHref: pm(key),
    }),
  ),

  /* ───────────── Attribution ───────────── */
  {
    key: "hubspot",
    name: "HubSpot",
    category: "attribution",
    description: "Attribute contacts and deals to AI search.",
    domain: "hubspot.com",
    color: "#ff7a59",
    connect: "oauth",
    setupHref: attribution("hubspot"),
  },
  {
    key: "salesforce",
    name: "Salesforce",
    category: "attribution",
    description: "Sync leads and opportunities with their AI-search source.",
    domain: "salesforce.com",
    color: "#00a1e0",
    connect: "oauth",
    setupHref: attribution("salesforce"),
  },
  {
    key: "typeform",
    name: "Typeform",
    category: "attribution",
    description: "Capture “How did you hear about us?” answers from Typeform.",
    domain: "typeform.com",
    color: "#262627",
    connect: "webhook",
    setupHref: attribution("typeform"),
  },
  {
    key: "zapier",
    name: "Zapier / Make",
    category: "attribution",
    description: "Send responses from any tool through Zapier or Make.",
    domain: "zapier.com",
    color: "#ff4f00",
    connect: "webhook",
    setupHref: attribution("zapier"),
  },
  {
    key: "shopify",
    name: "Shopify",
    category: "attribution",
    description: "Custom pixel that attributes orders and revenue to AI search.",
    domain: "shopify.com",
    color: "#95bf47",
    connect: "snippet",
    setupHref: attribution("shopify"),
  },
  {
    key: "stripe",
    name: "Stripe",
    category: "attribution",
    description: "Webhook for payments and subscriptions.",
    domain: "stripe.com",
    color: "#635bff",
    connect: "webhook",
    setupHref: attribution("stripe"),
  },
  ...(
    [
      ["woocommerce", "WooCommerce", "woocommerce.com", "#7f54b3", "Attribute WooCommerce orders to AI search.", "webhook"],
      ["shopware", "Shopware", "shopware.com", "#189eff", "Attribute Shopware orders to AI search.", "webhook"],
      ["fairing", "Fairing", "fairing.co", "#1f2937", "Import post-purchase survey answers.", "webhook"],
      ["knocommerce", "KnoCommerce", "knocommerce.com", "#2563eb", "Import post-purchase survey answers.", "webhook"],
      ["zigpoll", "Zigpoll", "zigpoll.com", "#0ea5e9", "Import on-site and post-purchase poll answers.", "webhook"],
      ["surveymonkey", "SurveyMonkey", "surveymonkey.com", "#00bf6f", "Import survey responses.", "webhook"],
      ["tally", "Tally", "tally.so", "#111111", "Capture form submissions from Tally.", "webhook"],
      ["custom_webhook", "Custom Webhook", undefined, "#0f0f0f", "POST any lead or order payload to your endpoint.", "webhook"],
      ["jotform", "Jotform", "jotform.com", "#ff6100", "Capture form submissions from Jotform.", "webhook"],
      ["gravity_forms", "Gravity Forms", "gravityforms.com", "#f15a2b", "Capture WordPress form submissions.", "webhook"],
      ["formstack", "Formstack", "formstack.com", "#21b573", "Capture form submissions from Formstack.", "webhook"],
      ["attio", "Attio", "attio.com", "#111111", "Sync records and deals from Attio.", "token"],
      ["pipedrive", "Pipedrive", "pipedrive.com", "#1a1a1a", "Sync deals and their AI-search source.", "token"],
      ["close", "Close", "close.com", "#1e40af", "Sync leads and opportunities from Close.", "token"],
      ["calendly", "Calendly", "calendly.com", "#006bff", "Attribute booked meetings to AI search.", "webhook"],
      ["intercom", "Intercom", "intercom.com", "#1f8ded", "Attribute conversations and leads.", "token"],
      ["n8n", "n8n", "n8n.io", "#ea4b71", "Send responses from any n8n workflow.", "webhook"],
    ] as const
  ).map(
    ([key, name, domain, color, description, connect]): CatalogEntry => ({
      key,
      name,
      category: "attribution",
      description,
      domain,
      color,
      connect,
      setupHref: attribution(key),
    }),
  ),

  /* ───────────── CMS ───────────── */
  {
    key: "shopify_cms",
    name: "Shopify",
    category: "cms",
    description: "Publish optimized product and blog content to Shopify.",
    domain: "shopify.com",
    color: "#95bf47",
    status: "coming_soon",
    connect: "oauth",
  },
  {
    key: "wordpress",
    name: "WordPress",
    category: "cms",
    description: "Publish content as drafts via the WordPress REST API (application password).",
    domain: "wordpress.org",
    color: "#21759b",
    status: "beta",
    connect: "token",
    setupHref: cms("wordpress"),
  },
  {
    key: "webflow",
    name: "Webflow",
    category: "cms",
    description: "Publish content to Webflow CMS collections.",
    domain: "webflow.com",
    color: "#146ef5",
    status: "beta",
    connect: "token",
    setupHref: cms("webflow"),
  },
  {
    key: "framer",
    name: "Framer",
    category: "cms",
    description: "Sync content into Framer CMS collections.",
    domain: "framer.com",
    color: "#0055ff",
    status: "beta",
    connect: "token",
    setupHref: cms("framer"),
  },
];

export const INTEGRATION_MAP = new Map(INTEGRATIONS.map((i) => [i.key, i]));

export function getCatalogEntry(key: string): CatalogEntry | undefined {
  return INTEGRATION_MAP.get(key);
}

/** Replaces `{projectId}` in catalog hrefs. */
export function resolveIntegrationHref(href: string | undefined, projectId: string): string | undefined {
  return href?.replaceAll("{projectId}", projectId);
}

export function integrationsByCategory(category: IntegrationCategory | "all"): CatalogEntry[] {
  return category === "all" ? INTEGRATIONS : INTEGRATIONS.filter((i) => i.category === category);
}

/** Providers whose credentials are managed by the generic token dialog on the Integrations page. */
export function isInlineTokenProvider(entry: CatalogEntry): boolean {
  return entry.connect === "token" && !entry.setupHref && !!entry.fields?.length;
}

/** Normalized form of a field value as stored in `integrations.config`. */
export function normalizeFieldValue(field: TokenField, value: string): string {
  const v = value.trim();
  if (!v || field.type !== "url") return v;
  return v.replace(/\/+$/, field.key === "siteUrl" ? "/" : "");
}

/** True when a destination field (where secrets are sent) differs from the stored config. */
export function destinationChanged(
  entry: CatalogEntry,
  stored: Record<string, unknown> | null | undefined,
  values: Record<string, unknown>,
): boolean {
  if (!stored) return false;
  return (entry.fields ?? []).some((f) => {
    if (!f.destination) return false;
    const next = normalizeFieldValue(f, String(values[f.key] ?? ""));
    const prev = stored[f.key] == null ? "" : String(stored[f.key]);
    return next.toLowerCase() !== prev.toLowerCase();
  });
}

/** Provider keys used by the analytics module. */
export const PROVIDERS = {
  gsc: "google_search_console",
  ga4: "google_analytics",
  bing: "bing_webmaster",
  matomo: "matomo",
  piwik: "piwik_pro",
  cloudflare: "cloudflare",
  akamai: "akamai",
  serverLogs: "server_logs",
} as const;
