import { z } from "zod";

/**
 * Every configurable option of the instance. Values live in `app_settings`; fields listed in
 * `secrets` are encrypted at rest and never sent to the browser.
 */

const general = z.object({
  appName: z.string().min(1).default("AutoSEO"),
  tagline: z.string().default("AI visibility & SEO, self-hosted"),
  logoUrl: z.string().default(""),
  faviconUrl: z.string().default(""),
  primaryColor: z.string().default("#0f0f0f"),
  accentColor: z.string().default("#16a34a"),
  defaultLocale: z.enum(["en", "de"]).default("en"),
  supportEmail: z.string().default(""),
  docsUrl: z.string().default(""),
  demoBookingUrl: z.string().default(""),
  showProductTour: z.boolean().default(true),
});

const auth = z.object({
  /** Only emails from these domains can be invited / log in. Empty = any domain. */
  allowedDomains: z.array(z.string()).default([]),
  /** When true, only invited users can log in (recommended). */
  requireInvitation: z.boolean().default(true),
  /** When true, anyone with an allowed-domain email may self-register (joins default workspace). */
  allowDomainSignup: z.boolean().default(false),
  defaultRoleKey: z.string().default("member"),
  sessionDays: z.number().int().min(1).max(3650).default(365),
  magicLinkMinutes: z.number().int().min(5).max(1440).default(15),
  inviteDays: z.number().int().min(1).max(90).default(7),
  /** 0 = unlimited devices */
  maxSessionsPerUser: z.number().int().min(0).default(0),
  /** Hide whether an email exists (always show "check your inbox"). */
  genericLoginResponse: z.boolean().default(true),
  loginRateLimitPerHour: z.number().int().min(1).default(10),
});

const smtp = z.object({
  enabled: z.boolean().default(false),
  preset: z.enum(["ses", "custom"]).default("ses"),
  sesRegion: z.string().default("eu-central-1"),
  host: z.string().default(""),
  port: z.number().int().default(587),
  secure: z.boolean().default(false),
  user: z.string().default(""),
  password: z.string().default(""),
  fromEmail: z.string().default(""),
  fromName: z.string().default("AutoSEO"),
  replyTo: z.string().default(""),
});

const ai = z.object({
  /** Route AI work to online local agents (Claude Code / Codex) first. */
  preferLocalAgent: z.boolean().default(true),
  /** Seconds to wait for a local agent before falling back to API providers. */
  agentTimeoutSeconds: z.number().int().min(10).default(300),
  fallbackOrder: z.array(z.enum(["anthropic", "openai", "openrouter"])).default(["anthropic", "openai", "openrouter"]),
  anthropicApiKey: z.string().default(""),
  anthropicModel: z.string().default("claude-opus-5"),
  openaiApiKey: z.string().default(""),
  openaiModel: z.string().default("gpt-5"),
  openrouterApiKey: z.string().default(""),
  openrouterModel: z.string().default("anthropic/claude-opus-5"),
  perplexityApiKey: z.string().default(""),
  geminiApiKey: z.string().default(""),
  xaiApiKey: z.string().default(""),
  mistralApiKey: z.string().default(""),
  deepseekApiKey: z.string().default(""),
});

const dataforseo = z.object({
  login: z.string().default(""),
  password: z.string().default(""),
  /** Use sandbox.dataforseo.com (free test data). */
  sandbox: z.boolean().default(false),
  defaultLocationCode: z.number().int().default(2276),
  defaultLanguageCode: z.string().default("de"),
});

/** Which provider answers prompts for each AI engine. */
const engineProvider = z.object({
  provider: z.enum(["auto", "dataforseo", "api", "agent", "disabled"]).default("auto"),
  model: z.string().default(""),
});
const engines = z.object({
  chatgpt: engineProvider.default({ provider: "auto", model: "" }),
  chatgpt_gui: engineProvider.default({ provider: "auto", model: "" }),
  perplexity: engineProvider.default({ provider: "auto", model: "" }),
  ai_overview: engineProvider.default({ provider: "auto", model: "" }),
  google_ai_mode: engineProvider.default({ provider: "auto", model: "" }),
  gemini: engineProvider.default({ provider: "auto", model: "" }),
  claude: engineProvider.default({ provider: "auto", model: "" }),
  copilot: engineProvider.default({ provider: "auto", model: "" }),
  grok: engineProvider.default({ provider: "auto", model: "" }),
  mistral: engineProvider.default({ provider: "auto", model: "" }),
  deepseek: engineProvider.default({ provider: "auto", model: "" }),
});

const google = z.object({
  oauthClientId: z.string().default(""),
  oauthClientSecret: z.string().default(""),
  pagespeedApiKey: z.string().default(""),
});

const integrations = z.object({
  bingWebmasterApiKey: z.string().default(""),
  cloudflareApiToken: z.string().default(""),
});

const onboarding = z.object({
  enabled: z.boolean().default(true),
  /** Steps shown in the new-project wizard */
  steps: z
    .array(z.enum(["website", "market", "brand", "competitors", "prompts", "engines", "integrations", "invite"]))
    .default(["website", "market", "brand", "competitors", "prompts", "engines", "integrations", "invite"]),
  defaultCountry: z.string().default("DE"),
  defaultLanguage: z.string().default("de"),
  defaultEngines: z.array(z.string()).default(["chatgpt", "perplexity", "ai_overview"]),
  suggestedPromptCount: z.number().int().min(0).max(200).default(20),
  suggestedCompetitorCount: z.number().int().min(0).max(30).default(8),
  autoGeneratePrompts: z.boolean().default(true),
  autoDiscoverCompetitors: z.boolean().default(true),
  defaultTrackingFrequency: z.enum(["daily", "weekly", "monthly"]).default("daily"),
  welcomeTitle: z.string().default("Let's set up your first project"),
  welcomeText: z.string().default("We generate your first prompts and competitors automatically."),
  /** German variants shown when the wizard is switched to DE (empty = built-in translation). */
  welcomeTitleDe: z.string().default(""),
  welcomeTextDe: z.string().default(""),
  /** Offer "pitch projects" (temporary projects that expire, e.g. for sales pitches). */
  allowPitchProjects: z.boolean().default(true),
  defaultPitchDays: z.number().int().min(1).max(365).default(30),
  /** Show "Product tour" / "Book demo" buttons next to the wizard. */
  showTourButton: z.boolean().default(true),
  showDemoButton: z.boolean().default(true),
});

const limits = z.object({
  maxProjectsPerWorkspace: z.number().int().min(1).default(100),
  maxPromptsPerProject: z.number().int().min(1).default(500),
  dailyBudgetUsd: z.number().min(0).default(0),
  monthlyBudgetUsd: z.number().min(0).default(0),
  auditMaxPages: z.number().int().min(10).max(100000).default(2000),
  auditConcurrency: z.number().int().min(1).max(50).default(8),
  jobConcurrency: z.number().int().min(1).max(64).default(6),
  /** Optional agency markup shown in the cost estimator (Billing & Costs); 0 = raw provider cost. */
  resaleMarkupPercent: z.number().min(0).max(1000).default(0),
});

const agents = z.object({
  enabled: z.boolean().default(true),
  checkinIntervalSeconds: z.number().int().min(5).max(55).default(10),
  defaultWorkDir: z.string().default(""),
  autoCleanupHours: z.number().int().min(0).default(24),
  jobTimeoutMinutes: z.number().int().min(1).default(30),
  defaultMaxParallelJobs: z.number().int().min(1).max(32).default(2),
  allowAutoUpdate: z.boolean().default(true),
});

const security = z.object({
  allowIframeEmbedding: z.boolean().default(false),
  apiRateLimitPerMinute: z.number().int().min(10).default(120),
  auditLogRetentionDays: z.number().int().min(7).default(365),
  /** Finished (succeeded/failed/cancelled) jobs older than this are pruned by the maintenance job. */
  jobRetentionDays: z.number().int().min(1).max(3650).default(30),
  /**
   * Hostnames that may resolve to private/LAN addresses for integrations (e.g. a self-hosted
   * WordPress on the intranet). Everything else stays SSRF-protected.
   */
  privateNetworkAllowlist: z.array(z.string()).default([]),
  /** Trust the CF-Connecting-IP header (only enable when all traffic comes through Cloudflare). */
  behindCloudflare: z.boolean().default(false),
});

const freeTools = z.object({
  /** Signed-in users always get the tools hub; this also publishes them at /free-tools (no login). */
  publicEnabled: z.boolean().default(false),
  /** Hard cap on estimated DataForSEO spend of the public tools per UTC day. */
  dailyBudgetUsd: z.number().min(0).default(5),
  maxCallsPerDay: z.number().int().min(0).default(2000),
  perVisitorCallsPerDay: z.number().int().min(1).default(40),
  perIpPerMinute: z.number().int().min(1).default(5),
  /** Cloudflare Turnstile for the public tools (recommended when public). */
  turnstileSiteKey: z.string().default(""),
  turnstileSecretKey: z.string().default(""),
  /** Call-to-action shown under public tool results (defaults to the login page). */
  ctaUrl: z.string().default(""),
  ctaLabel: z.string().default(""),
});

export const settingsRegistry = {
  general: { schema: general, secrets: [] as const, label: "General & branding" },
  auth: { schema: auth, secrets: [] as const, label: "Authentication" },
  smtp: { schema: smtp, secrets: ["password"] as const, label: "Email (SMTP / Amazon SES)" },
  ai: {
    schema: ai,
    secrets: [
      "anthropicApiKey",
      "openaiApiKey",
      "openrouterApiKey",
      "perplexityApiKey",
      "geminiApiKey",
      "xaiApiKey",
      "mistralApiKey",
      "deepseekApiKey",
    ] as const,
    label: "AI providers",
  },
  dataforseo: { schema: dataforseo, secrets: ["password"] as const, label: "DataForSEO" },
  engines: { schema: engines, secrets: [] as const, label: "AI engines" },
  google: { schema: google, secrets: ["oauthClientSecret", "pagespeedApiKey"] as const, label: "Google" },
  integrations: {
    schema: integrations,
    secrets: ["bingWebmasterApiKey", "cloudflareApiToken"] as const,
    label: "Integrations",
  },
  onboarding: { schema: onboarding, secrets: [] as const, label: "Onboarding" },
  limits: { schema: limits, secrets: [] as const, label: "Limits & budgets" },
  agents: { schema: agents, secrets: [] as const, label: "Local agents" },
  security: { schema: security, secrets: [] as const, label: "Security" },
  freeTools: { schema: freeTools, secrets: ["turnstileSecretKey"] as const, label: "Free SEO tools" },
} as const;

export type SettingsKey = keyof typeof settingsRegistry;
export type Settings<K extends SettingsKey> = z.infer<(typeof settingsRegistry)[K]["schema"]>;
export type SettingsMap = { [K in SettingsKey]: Settings<K> };
