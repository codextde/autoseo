/**
 * Client-safe metadata of the optimize PM-tool / CMS integrations (names, setup steps, form fields).
 * Server clients live in src/server/optimize/integrations/providers/*.
 */
import { PROVIDER_ALIASES } from "@/features/optimize/constants";
import type { ProviderMeta } from "@/server/optimize/integrations/types";

export const PM_PROVIDERS: ProviderMeta[] = [
  {
    key: "linear",
    name: "Linear",
    kind: "pm",
    description: "Create Linear issues from tasks and close tasks when the issue is completed.",
    setupSteps: [
      "In Linear open Settings → Account → Security & access → Personal API keys.",
      "Create a key (label it “AutoSEO”) with read + write access to the team you want to use.",
      "Paste the key below, then pick the team new issues are created in.",
    ],
    docsUrl: "https://linear.app/developers/graphql",
    fields: [{ key: "apiKey", label: "Personal API key", type: "password", placeholder: "lin_api_…", required: true, secret: true }],
    targetLabel: "Team",
    supportsStatusSync: true,
  },
  {
    key: "jira",
    name: "Jira Cloud",
    kind: "pm",
    description: "Create Jira issues (Task type) with a formatted description and sync their status back.",
    setupSteps: [
      "Go to id.atlassian.com → Security → Create and manage API tokens → Create API token.",
      "Enter your Jira site URL (https://yourcompany.atlassian.net), your Atlassian account email and the token.",
      "Pick the project new issues are created in.",
    ],
    docsUrl: "https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/",
    fields: [
      { key: "siteUrl", label: "Jira site URL", type: "url", placeholder: "https://yourcompany.atlassian.net", required: true },
      { key: "email", label: "Account email", type: "email", placeholder: "you@company.com", required: true },
      { key: "apiToken", label: "API token", type: "password", required: true, secret: true },
    ],
    targetLabel: "Project",
    supportsStatusSync: true,
  },
  {
    key: "asana",
    name: "Asana",
    kind: "pm",
    description: "Create Asana tasks in a project and mark AutoSEO tasks done when they're completed.",
    setupSteps: [
      "In Asana open My settings → Apps → Manage developer apps (app.asana.com/0/my-apps).",
      "Create a personal access token.",
      "Paste it below and pick the project tasks go to.",
    ],
    docsUrl: "https://developers.asana.com/docs/personal-access-token",
    fields: [{ key: "token", label: "Personal access token", type: "password", required: true, secret: true }],
    targetLabel: "Project",
    supportsStatusSync: true,
  },
  {
    key: "clickup",
    name: "ClickUp",
    kind: "pm",
    description: "Create ClickUp tasks (markdown description, priority, tags) in a list and sync their status.",
    setupSteps: [
      "In ClickUp click your avatar → Settings → Apps.",
      "Generate a personal API token (starts with pk_).",
      "Paste it below and pick the list tasks are created in.",
    ],
    docsUrl: "https://developer.clickup.com/docs/authentication",
    fields: [{ key: "token", label: "Personal API token", type: "password", placeholder: "pk_…", required: true, secret: true }],
    targetLabel: "List",
    supportsStatusSync: true,
  },
  {
    key: "trello",
    name: "Trello",
    kind: "pm",
    description: "Create Trello cards on a list; cards moved to a Done list (or archived) close the task.",
    setupSteps: [
      "Open trello.com/power-ups/admin, create a Power-Up (any name) and copy its API key.",
      "Next to the API key click “Token” to authorize and copy the token.",
      "Paste both below and pick the board list new cards go to.",
    ],
    docsUrl: "https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/",
    fields: [
      { key: "apiKey", label: "API key", type: "text", required: true, secret: true },
      { key: "token", label: "Token", type: "password", required: true, secret: true },
    ],
    targetLabel: "List",
    supportsStatusSync: true,
  },
  {
    key: "monday",
    name: "monday.com",
    kind: "pm",
    description: "Create items on a monday.com board with the task details as an update.",
    setupSteps: [
      "In monday.com click your avatar → Developers → My access tokens (or Administration → Connections → API).",
      "Copy your personal API token.",
      "Paste it below and pick the board items are created on.",
    ],
    docsUrl: "https://developer.monday.com/api-reference/docs/authentication",
    fields: [{ key: "token", label: "API token", type: "password", required: true, secret: true }],
    targetLabel: "Board",
    supportsStatusSync: true,
  },
  {
    key: "notion",
    name: "Notion",
    kind: "pm",
    description: "Create pages in a Notion database (task board) with steps as to-dos.",
    setupSteps: [
      "Go to notion.so/profile/integrations → New integration (internal) and copy the secret.",
      "Open your task database in Notion → ••• → Connections → add the integration.",
      "Paste the secret below and pick the database. A “Status” property is used for status sync.",
    ],
    docsUrl: "https://developers.notion.com/docs/create-a-notion-integration",
    fields: [{ key: "token", label: "Internal integration secret", type: "password", placeholder: "ntn_… / secret_…", required: true, secret: true }],
    targetLabel: "Database",
    supportsStatusSync: true,
  },
  {
    key: "awork",
    name: "awork",
    kind: "pm",
    description: "Create project tasks in awork and sync their status back.",
    setupSteps: [
      "In awork open Settings → Integrations → API and create a client application with an API key.",
      "Paste the API key below and pick the project tasks are created in.",
    ],
    docsUrl: "https://developers.awork.com/",
    fields: [{ key: "apiKey", label: "API key", type: "password", required: true, secret: true }],
    targetLabel: "Project",
    supportsStatusSync: true,
  },
  {
    key: "webhook",
    name: "Webhook (Zapier, n8n, Make)",
    kind: "pm",
    description: "Send signed JSON events when tasks are created, updated or resolved — route them anywhere.",
    setupSteps: [
      "Create a “Catch hook” (Zapier), Webhook node (n8n) or custom webhook (Make) and copy its URL.",
      "Paste the URL below — we send a signed test “ping” event.",
      "Verify requests with the signing secret: X-AutoSEO-Signature = sha256=HMAC_SHA256(secret, `${X-AutoSEO-Timestamp}.${body}`).",
    ],
    fields: [{ key: "url", label: "Webhook URL", type: "url", placeholder: "https://hooks.zapier.com/hooks/catch/…", required: true, secret: true }],
  },
];

export const CMS_PROVIDERS: ProviderMeta[] = [
  {
    key: "wordpress",
    name: "WordPress",
    kind: "cms",
    description: "Publish or save drafts via the WordPress REST API, incl. JSON-LD and Yoast / Rank Math meta.",
    setupSteps: [
      "In WordPress go to Users → Profile → Application Passwords (requires HTTPS).",
      "Add a new application password named “AutoSEO” and copy it.",
      "Enter your site URL, WordPress username and the application password below.",
    ],
    docsUrl: "https://developer.wordpress.org/rest-api/reference/posts/",
    fields: [
      { key: "siteUrl", label: "Site URL", type: "url", placeholder: "https://blog.example.com", required: true },
      { key: "username", label: "Username", type: "text", required: true },
      { key: "appPassword", label: "Application password", type: "password", placeholder: "xxxx xxxx xxxx xxxx xxxx xxxx", required: true, secret: true },
    ],
  },
  {
    key: "webflow",
    name: "Webflow",
    kind: "cms",
    description: "Create CMS collection items (name, slug, rich-text body, summary) and publish them live.",
    setupSteps: [
      "In Webflow open Site settings → Apps & integrations → API access → Generate API token.",
      "Grant CMS: read & write and Sites: read (add Sites: write to publish).",
      "Paste the token below and pick the blog collection.",
    ],
    docsUrl: "https://developers.webflow.com/data/reference/cms/collection-items/staged-items/create-item",
    fields: [{ key: "token", label: "API token", type: "password", required: true, secret: true }],
    targetLabel: "Collection",
  },
  {
    key: "shopify_cms",
    name: "Shopify",
    kind: "cms",
    description: "Publish articles to a Shopify blog with SEO title & description metafields.",
    setupSteps: [
      "In Shopify admin open Settings → Apps and sales channels → Develop apps → Create an app.",
      "Configure Admin API scopes: write_content and read_content (plus online store pages), then install the app.",
      "Copy the Admin API access token (shpat_…) and enter your *.myshopify.com domain below.",
    ],
    docsUrl: "https://shopify.dev/docs/api/admin-graphql/latest/mutations/articleCreate",
    fields: [
      { key: "shopDomain", label: "Shop domain", type: "text", placeholder: "your-store.myshopify.com", required: true },
      { key: "accessToken", label: "Admin API access token", type: "password", placeholder: "shpat_…", required: true, secret: true },
      { key: "authorName", label: "Author name (optional)", type: "text", placeholder: "Shop name" },
    ],
    targetLabel: "Blog",
  },
  {
    key: "framer",
    name: "Framer",
    kind: "cms",
    description: "Framer has no publishing API yet — export Markdown, HTML or a CMS-ready CSV and import it in one step.",
    setupSteps: [
      "Optional: enter your Framer site URL for reference.",
      "In the content editor use Publish → Framer to download a CSV and import it into your Framer CMS collection.",
    ],
    docsUrl: "https://www.framer.com/help/articles/how-to-import-csv-into-cms/",
    fields: [{ key: "siteUrl", label: "Framer site URL (optional)", type: "url", placeholder: "https://yoursite.framer.website" }],
    exportOnly: true,
  },
];

const ALL = [...PM_PROVIDERS, ...CMS_PROVIDERS];

export function resolveProviderKey(key: string): string {
  const k = key.trim().toLowerCase();
  return PROVIDER_ALIASES[k] ?? k;
}

export function getProviderMeta(key: string): ProviderMeta | undefined {
  const k = resolveProviderKey(key);
  return ALL.find((p) => p.key === k);
}

export function isOptimizeProvider(key: string): boolean {
  return ALL.some((p) => p.key === key);
}

export const OPTIMIZE_PROVIDER_KEYS = ALL.map((p) => p.key);

