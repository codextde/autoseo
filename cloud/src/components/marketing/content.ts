/**
 * Marketing copy for autoseo.codext.de. Kept in one place (plain strings, no JSX) so it can be translated later.
 * Only describe features that exist in the open-source app (see README.md and src/lib/navigation.ts in the repo root).
 */
import { site } from "@/lib/site";

export const price = `$${site.priceMonthlyUsd}`;
export const installCommand = `curl -fsSL https://${site.host}/install | bash`;
export const instanceHost = `yourname.${site.host}`;

export type LinkItem = { label: string; href: string; external?: boolean };

export const mainNav: LinkItem[] = [
  { label: "Features", href: "/#features" },
  { label: "Pricing", href: "/pricing" },
  { label: "Self-hosting", href: "/self-hosting" },
];

export const authLinks = {
  login: { label: "Log in", href: "/login" },
  signup: { label: "Get started", href: "/signup" },
};

/** AI answer engines tracked by the app (mirrors src/lib/engines.ts in the repo root). */
export const engines = [
  { name: "ChatGPT", vendor: "OpenAI" },
  { name: "ChatGPT App", vendor: "OpenAI" },
  { name: "Perplexity", vendor: "Perplexity" },
  { name: "Google AI Overviews", vendor: "Google" },
  { name: "Google AI Mode", vendor: "Google" },
  { name: "Gemini", vendor: "Google" },
  { name: "Claude", vendor: "Anthropic" },
  { name: "Microsoft Copilot", vendor: "Microsoft" },
  { name: "Grok", vendor: "xAI" },
  { name: "Mistral", vendor: "Mistral AI" },
  { name: "DeepSeek", vendor: "DeepSeek" },
] as const;

export const hero = {
  eyebrow: "Open source · MIT licensed",
  eyebrowCta: "Star on GitHub",
  titleLead: "See how AI search talks about your brand",
  titleAccent: "— and fix it",
  subtitle:
    "AutoSEO is the open-source AI visibility and SEO platform. Track what ChatGPT, Perplexity, Gemini, Claude and Google AI Overviews say about you, see which sources they trust, and close the gaps with a complete SEO suite and an AI agent that runs on your own Claude Code or Codex.",
  primaryCta: { label: `Start for ${price}/month`, href: "/signup" },
  secondaryCta: { label: "Self-host for free", href: "/self-hosting" },
  installLabel: "Or install it on your own server",
  assurances: ["Private instance in minutes", "Cancel anytime", "No lock-in"],
  screenshotAlt:
    "AutoSEO project dashboard with AI visibility score, mention rate, citation rate and competitor ranking across AI engines",
  mobileAlt: "AutoSEO AI visibility dashboard on a phone",
  answerCard: {
    label: "Tracked prompt",
    prompt: "Which open-source tool tracks my brand in AI search?",
    engines: ["ChatGPT", "Perplexity", "Gemini", "Claude", "AI Overviews"],
    stats: [
      { label: "Mentioned", value: "Yes" },
      { label: "Cited", value: "3 sources" },
      { label: "Position", value: "#1" },
    ],
  },
};

export const engineStrip = {
  title: "Tracks the answer engines your customers actually use",
  subtitle: "Run your prompts on a schedule across 11 AI engines and 143 markets — and see every answer.",
};

export const problem = {
  eyebrow: "Why generative engine optimization",
  title: "Search is turning into answers. Most brands can't see what's being said.",
  subtitle:
    "People now ask AI assistants which product to buy, which agency to hire, which tool to try. The answer names a few brands, cites a few pages — and classic SEO tools are blind to all of it.",
  points: [
    {
      title: "AI picks the shortlist",
      body: "A single answer replaces ten blue links. If the model doesn't name you, you're not in the conversation — no matter where you rank.",
    },
    {
      title: "Answers are built from sources",
      body: "Engines lean on reviews, listicles, forums and documentation. If those pages don't mention you, the answer won't either.",
    },
    {
      title: "Rank trackers can't see it",
      body: "Position tracking won't tell you whether ChatGPT recommends you, what it gets wrong, or which competitor it prefers.",
    },
  ],
  loopTitle: "AutoSEO closes the loop",
  loop: [
    { title: "Measure", body: "Daily answers from 11 AI engines" },
    { title: "Understand", body: "Competitors, sentiment and sources" },
    { title: "Improve", body: "Tasks, content and technical fixes" },
    { title: "Report", body: "White-label decks for every client" },
  ],
};

export const overview = {
  eyebrow: "Platform",
  title: "One open-source platform for AI visibility and SEO",
  subtitle: "Everything a modern search team needs in one app — instead of stitching together five subscriptions.",
  items: [
    {
      icon: "sparkles",
      title: "AI visibility",
      body: "Prompt research, scheduled tracking, trends, prompt flow, locations and query fan-outs across 11 engines.",
    },
    {
      icon: "swords",
      title: "Competitors & sentiment",
      body: "Share of voice, mention depth, sentiment, praise and criticism, and head-to-head recommendations.",
    },
    {
      icon: "link",
      title: "Sources & citations",
      body: "Every URL AI engines cite, grouped by content type, with gaps where competitors are cited and you aren't.",
    },
    {
      icon: "search",
      title: "Complete SEO suite",
      body: "Keyword research, rank tracking, domain overview, backlinks, site audits with Lighthouse and local SEO.",
    },
    {
      icon: "chart",
      title: "Analytics & attribution",
      body: "Traffic from AI platforms via GA4, AI bot crawls, Search Console insights and revenue attribution.",
    },
    {
      icon: "wand",
      title: "Optimizations",
      body: "Evidence-backed tasks, content briefs and drafts, crawlability checks and fact checking of AI answers.",
    },
    {
      icon: "presentation",
      title: "White-label reports",
      body: "Drag-and-drop report builder with brand kits, 11 templates, PPTX and PDF export and share links.",
    },
    {
      icon: "bot",
      title: "Agent mode & API",
      body: "Chat with your data through your own Claude Code or Codex. REST API, MCP server and plugins included.",
    },
  ],
} as const;

export type Screenshot = { src: string; alt: string; url: string; darkSrc?: string };

export type FeatureRow = {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
  image: Screenshot;
  secondary?: Screenshot;
};

export const featureRows: FeatureRow[] = [
  {
    id: "ai-visibility",
    eyebrow: "AI visibility tracking",
    title: "Know when AI recommends you — and when it doesn't",
    body: "Add the prompts your customers ask, choose markets and engines, and AutoSEO runs them on schedule. Every answer is stored, scored and compared over time, so you can prove what moved the needle.",
    bullets: [
      "Visibility, mention rate, citation rate and average position per prompt and engine",
      "Trends, breakdowns, prompt flow between periods and a map of results by location",
      "Query fan-outs: the searches AI engines run behind the scenes",
      "Prompt research by topic, funnel stage and persona to decide what to track",
    ],
    image: {
      src: "/screenshots/ai-tracker.png",
      darkSrc: "/screenshots/ai-tracker-dark.png",
      alt: "AutoSEO AI visibility tracker with visibility trend chart and tracked prompts per AI engine",
      url: "ai/tracker",
    },
  },
  {
    id: "competitors",
    eyebrow: "Competitors & sentiment",
    title: "See who AI prefers, and why",
    body: "Benchmark your brand against every competitor that shows up in AI answers. Understand the tone of each answer and the attributes AI associates with you — and with them.",
    bullets: [
      "Visibility ranking with mention depth, average position and per-model breakdown",
      "Sentiment score, praise and criticism, and brand perception by theme",
      "Head-to-head: when AI compares you with a competitor, who comes out ahead",
      "Products and ads that surface inside AI answers",
    ],
    image: {
      src: "/screenshots/competitors.png",
      darkSrc: "/screenshots/competitors-dark.png",
      alt: "AutoSEO competitor ranking comparing brand visibility, mention rate and sentiment in AI answers",
      url: "ai/competitors",
    },
    secondary: {
      src: "/screenshots/sentiment.png",
      alt: "AutoSEO sentiment overview with praise, neutral and criticism share over time",
      url: "ai/sentiment",
    },
  },
  {
    id: "sources",
    eyebrow: "Sources & citations",
    title: "Find the pages that shape AI answers",
    body: "AI engines build answers from sources. AutoSEO shows every cited URL, groups them by content type and highlights where competitors are cited and you aren't — your outreach list, ready to go.",
    bullets: [
      "Top cited sources over time with citation and prompt counts",
      "Source types such as listicles, reviews, UGC, documentation and video",
      "Per-source analysis of which prompts cite it and which brands it mentions",
      "Crawlability checks for AI bots, robots.txt and llms.txt",
    ],
    image: {
      src: "/screenshots/sources.png",
      alt: "AutoSEO source analysis listing the URLs AI engines cite most, with content types and citation counts",
      url: "ai/sources",
    },
  },
  {
    id: "agent",
    eyebrow: "Agent mode",
    title: "An AI SEO analyst that runs on your own subscription",
    body: "Chat with all of your AutoSEO data. Agent mode uses your own Claude Code or Codex CLI through a lightweight local agent, so the heavy AI work runs on the subscription you already pay for. API keys are only a fallback.",
    bullets: [
      "Every AutoSEO tool available to the agent: tracking, keywords, audits and reports",
      "Local agents connect over outbound HTTPS only — no open ports",
      "Each job runs in a fresh, isolated CLI session; agents update themselves on every deploy",
      "Prefer APIs? Use Anthropic, OpenAI, OpenRouter and other provider keys instead",
    ],
    image: {
      src: "/screenshots/agent.png",
      alt: "AutoSEO agent mode chat answering questions about AI visibility data",
      url: "agent",
    },
  },
  {
    id: "reports",
    eyebrow: "White-label reports",
    title: "Client-ready reports in minutes, not days",
    body: "Build branded decks with live data in a drag-and-drop editor, or start from one of 11 templates. Present in the browser, export to PowerPoint or PDF, or share a password-protected link.",
    bullets: [
      "Brand kits with your agency's logo and colors",
      "Live data fields and charts that update with the reporting period",
      "PPTX and PDF export, presentation mode and share links",
      "AI-generated HTML reports straight from agent mode",
    ],
    image: {
      src: "/screenshots/reports.png",
      alt: "AutoSEO report builder with a branded slide showing AI visibility metrics",
      url: "reports",
    },
  },
];

export const seoSuite = {
  id: "seo",
  eyebrow: "Complete SEO suite",
  title: "All the classic SEO tools, right next to your AI data",
  body: "AI visibility builds on solid SEO. AutoSEO includes the research and monitoring tools you'd otherwise pay for separately — powered by DataForSEO and your own Google accounts.",
  bullets: [
    "Keyword research, saved keyword lists and rank tracking by location",
    "Domain overview and backlink analysis",
    "Site audit with issues, pages, Lighthouse scores and crawl comparisons",
    "Local SEO, Search Console and GA4 — plus CSV and Google Sheets export",
  ],
  images: [
    {
      src: "/screenshots/keywords.png",
      alt: "AutoSEO keyword research with search volume, difficulty and intent",
      url: "seo/keywords",
    },
    {
      src: "/screenshots/rank-tracking.png",
      alt: "AutoSEO rank tracking with keyword positions over time",
      url: "seo/rank-tracking",
    },
    {
      src: "/screenshots/site-audit.png",
      alt: "AutoSEO site audit with health score, issues and Lighthouse results",
      url: "seo/audit",
    },
  ] satisfies Screenshot[],
};

export const actions = {
  eyebrow: "From insight to action",
  title: "Turn what AI says into work that gets done",
  image: {
    src: "/screenshots/tasks.png",
    alt: "AutoSEO tasks with prioritized, evidence-backed actions for AI visibility and SEO",
    url: "tasks",
  } satisfies Screenshot,
  secondary: {
    src: "/screenshots/bot-traffic.png",
    alt: "AutoSEO bot traffic analytics with daily visits from AI crawlers such as GPTBot and ClaudeBot",
    url: "analytics/bots",
  } satisfies Screenshot,
  items: [
    {
      icon: "list",
      title: "Prioritized tasks",
      body: "Findings from visibility, citations, competitors and crawl data become evidence-backed tasks you can push to Jira, Linear and more.",
    },
    {
      icon: "file",
      title: "Content briefs & drafts",
      body: "Data-backed briefs and drafts written for AI citations, ready to publish to WordPress, Webflow and other CMSs.",
    },
    {
      icon: "shield",
      title: "Fact check",
      body: "Check what AI engines claim about your products against your own reference material and track deviations.",
    },
    {
      icon: "bot",
      title: "Bot & traffic analytics",
      body: "See which AI crawlers visit your pages, how much human traffic AI platforms send, and what it converts to.",
    },
  ],
} as const;

export const developers = {
  eyebrow: "API, MCP & plugins",
  title: "Plug AutoSEO into every agent and workflow",
  body: "Everything in the app is available programmatically. Connect Claude Code, Codex or Cursor to your instance and let your agents work with real SEO and AI visibility data.",
  bullets: [
    "REST API v1 with an OpenAPI spec",
    "MCP server with 100+ tools — OAuth 2.1 or API keys",
    "Scoped API keys: read, write, spend and export",
    "17 agent skills and plugins for Claude Code, Codex and Cursor",
  ],
  snippets: [
    {
      title: "Claude Code",
      code: [
        "# Plugin: MCP server + 17 skills",
        `claude plugin marketplace add https://acme.${site.host}/api/plugin/marketplace.json`,
        "claude plugin install autoseo@autoseo",
        "",
        "# Or only the MCP server",
        `claude mcp add --transport http autoseo https://acme.${site.host}/api/mcp`,
      ].join("\n"),
    },
    {
      title: "REST API",
      code: [`curl https://acme.${site.host}/api/v1/projects \\`, '  -H "Authorization: Bearer $AUTOSEO_API_KEY"'].join("\n"),
    },
  ],
};

export const security = {
  id: "admin",
  eyebrow: "Admin & security",
  title: "Built for teams, agencies and security reviews",
  body: "Invite your team and your clients, decide exactly who sees which project, and keep a complete audit trail. Configure everything — email, AI providers, branding, limits — in the admin panel.",
  bullets: [
    "Passwordless magic-link sign-in with one-time codes and email-domain allow-lists",
    "Owner, Admin, Member and Client roles, custom roles and per-project access",
    "Audit log, GDPR export and erasure, daily and monthly spend limits",
    "Secrets encrypted with AES-256-GCM; API keys and tokens stored only as hashes",
  ],
  image: {
    src: "/screenshots/admin.png",
    alt: "AutoSEO admin panel with users, roles and permissions",
    url: "admin",
  } satisfies Screenshot,
  mobileNote: "Fully mobile optimized, in light and dark mode.",
};

export const steps = {
  eyebrow: "AutoSEO Cloud",
  title: "Your own private AutoSEO, running in minutes",
  subtitle: "The same open-source app, fully managed by us. No servers, no updates, no DevOps.",
  items: [
    {
      title: "Sign up with your email",
      body: "No password to remember. We send you a magic link — one click and you're in your dashboard.",
    },
    {
      title: `Pick ${instanceHost}`,
      body: `Choose your address and subscribe for ${price}/month. Payment is handled securely by Stripe.`,
    },
    {
      title: "Your private instance is ready",
      body: "We provision an isolated instance with its own database, SSL and email delivery. Sign in with one click and add your first project.",
    },
  ],
  cta: { label: `Start for ${price}/month`, href: "/signup" },
};

export const openSource = {
  eyebrow: "Open source",
  title: "MIT licensed. Yours to keep.",
  body: "Every feature of AutoSEO lives in the public repository. Run it on your own server for free, read the code before your security review, or send a pull request. AutoSEO Cloud runs the exact same image.",
  bullets: [
    "Self-host with one command, Docker Compose or Coolify",
    "No vendor lock-in — move from Cloud to your own server at any time",
    "Bring your own AI keys or local Claude Code and Codex agents",
    "Your data stays in your own PostgreSQL database",
  ],
  primaryCta: { label: "Star on GitHub", href: site.github },
  secondaryCta: { label: "Read the self-hosting guide", href: "/self-hosting" },
};

export type Plan = {
  id: "self-hosted" | "cloud";
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  cta: LinkItem;
  highlight?: boolean;
  badge?: string;
  note?: string;
};

export const plans: Plan[] = [
  {
    id: "self-hosted",
    name: "Self-hosted",
    price: "$0",
    period: "free forever",
    description: "For teams that want to run AutoSEO on their own infrastructure.",
    features: [
      "Every feature, no limits",
      "MIT license — use it however you like",
      "Runs on your own server",
      "One-line installer, Docker Compose or Coolify",
      "Community support via GitHub",
    ],
    cta: { label: "Deploy on your server", href: "/self-hosting" },
  },
  {
    id: "cloud",
    name: "Cloud",
    price,
    period: "per instance / month",
    description: "Your own private AutoSEO instance, fully managed by us.",
    features: [
      `Private instance at ${instanceHost}`,
      "Every feature included",
      "Unlimited users, projects and workspaces",
      "Automatic updates",
      "SSL and email delivery preconfigured",
      "Isolated database for your instance",
      "One-click sign-in from your dashboard",
      "Email support",
    ],
    cta: { label: `Start for ${price}/month`, href: "/signup" },
    highlight: true,
    badge: "Fully managed",
    note: "Billed monthly · cancel anytime",
  },
];

export const pricingNotes = [
  "Bring your own AI provider keys or connect your local Claude Code / Codex subscription. DataForSEO is optional and billed pay-as-you-go by DataForSEO.",
  "Prices exclude VAT where applicable. AutoSEO Cloud is offered to business customers.",
];

export const comparison = {
  eyebrow: "Compare",
  title: "AutoSEO vs. closed AI visibility tools",
  subtitle: "How an open-source platform compares with typical closed-source SaaS in this category.",
  columns: ["AutoSEO", "Typical closed-source SaaS"],
  rows: [
    { label: "Source code", ours: "Open source (MIT)", theirs: "Proprietary" },
    { label: "Where it runs", ours: "Your server, or a private managed instance", theirs: "Shared vendor cloud" },
    { label: "Your data", ours: "Your own database, exportable any time", theirs: "Stored on the vendor's platform" },
    { label: "AI engine costs", ours: "Your own keys or Claude Code / Codex subscription", theirs: "Bundled into credits or plan limits" },
    { label: "Users & projects", ours: "Unlimited", theirs: "Usually limited by plan" },
    { label: "Classic SEO suite", ours: "Included", theirs: "Often a separate tool" },
    { label: "API & MCP server", ours: "Included", theirs: "Varies by plan" },
    { label: "Price", ours: `Free self-hosted · ${price}/month managed`, theirs: "Typically tiered by prompts or seats" },
  ],
};

export type Faq = { q: string; a: string };

export const homeFaq: Faq[] = [
  {
    q: "What is AutoSEO?",
    a: "AutoSEO is an open-source AI visibility (GEO) and SEO platform. It tracks how AI answer engines such as ChatGPT, Perplexity, Gemini, Claude and Google AI Overviews talk about your brand and combines that with keyword research, rank tracking, backlinks, site audits, analytics, content tools and white-label reporting in a single app.",
  },
  {
    q: "What is generative engine optimization (GEO)?",
    a: "Generative engine optimization is the practice of improving how often and how favorably AI assistants mention and cite your brand in their answers. It builds on SEO: the pages AI engines cite still need to be crawlable, relevant and trusted. AutoSEO measures your AI visibility and shows which sources, topics and competitors to work on.",
  },
  {
    q: "Which AI engines does AutoSEO track?",
    a: "ChatGPT (search and app), Perplexity, Google AI Overviews, Google AI Mode, Gemini, Claude, Microsoft Copilot, Grok, Mistral and DeepSeek. You choose the engines, markets and tracking frequency per project.",
  },
  {
    q: "Is AutoSEO really free?",
    a: "Yes. The complete application is open source under the MIT license and free to self-host with every feature. You only pay for the server you run it on and any third-party APIs you decide to use. AutoSEO Cloud is for teams that want us to run it for them.",
  },
  {
    q: "What's the difference between self-hosting and AutoSEO Cloud?",
    a: `The software is identical. When you self-host, you run and maintain the server. With AutoSEO Cloud we provision a private instance for you at ${instanceHost} with its own isolated database, SSL, email delivery and automatic updates — for ${price} per month.`,
  },
  {
    q: "Do I need API keys for the AI engines?",
    a: "Not necessarily. AutoSEO can run AI work through your own Claude Code or Codex CLI via a lightweight local agent, so it uses the subscription you already have. You can also add API keys for Anthropic, OpenAI, OpenRouter, Perplexity, Gemini, xAI, Mistral or DeepSeek. Google AI Overviews, AI Mode and Copilot are tracked through DataForSEO.",
  },
  {
    q: "Are there costs beyond the subscription?",
    a: "Third-party usage is billed by the providers directly — for example DataForSEO for keyword, SERP and backlink data, or your AI provider if you use API keys. AutoSEO records every paid call and lets admins set daily and monthly spend limits.",
  },
  {
    q: "Can I move from AutoSEO Cloud to my own server?",
    a: "Yes. Cloud instances run the same open-source Docker image you can self-host. Ask us for an export of your database and data volume and restore it on your own server — there's no lock-in.",
  },
  {
    q: "Is AutoSEO a good fit for agencies?",
    a: "Yes. Organize clients in workspaces and projects, give clients restricted access with the Client role, and send white-label reports with your own brand kit. There are no per-seat or per-project fees.",
  },
  {
    q: "Where is my data stored?",
    a: "AutoSEO Cloud instances run on servers in Germany, each with its own PostgreSQL database and data volume. When you self-host, your data stays on your server — apart from requests to the third-party providers you configure.",
  },
];

export const pricingFaq: Faq[] = [
  {
    q: "How does billing work?",
    a: `AutoSEO Cloud costs ${price} per instance per month, billed monthly. Payments are processed securely by Stripe, and you receive an invoice for every payment.`,
  },
  {
    q: "Is VAT included?",
    a: "Prices exclude VAT. Where VAT applies, it is added to your invoice based on your billing details. AutoSEO Cloud is offered to business customers only.",
  },
  {
    q: "Can I cancel at any time?",
    a: "Yes. Cancel from your dashboard whenever you like. Your instance keeps running until the end of the current billing period, and you won't be charged again.",
  },
  {
    q: "What happens to my data after I cancel?",
    a: "When your subscription ends, your instance is stopped. We keep your data for 30 days so you can resubscribe and continue where you left off, or request an export. After that, the instance and its data are deleted.",
  },
  {
    q: "Can I export my data?",
    a: "Yes. Inside the app you can export tables as CSV or to Google Sheets, download reports as PPTX or PDF, and request a GDPR export. To move to your own server, we provide a full export of your database and data volume on request.",
  },
  {
    q: "Are AI and SEO data costs included?",
    a: "No — deliberately. You connect your own AI provider keys or your local Claude Code / Codex subscription and, optionally, your own DataForSEO account. You pay those providers directly at their prices, without a markup from us.",
  },
  {
    q: "Is the self-hosted version limited in any way?",
    a: "No. Self-hosted AutoSEO includes every feature with no limits on users, projects or prompts. Cloud customers pay for hosting, maintenance, updates and support — not for features.",
  },
];

export const finalCta = {
  title: "Find out what AI says about your brand",
  subtitle: `Start with a private cloud instance for ${price}/month, or self-host the open-source edition for free.`,
  primary: { label: `Start for ${price}/month`, href: "/signup" },
  secondary: { label: "Self-host for free", href: "/self-hosting" },
};

export const footer = {
  tagline: "The open-source AI visibility and SEO platform. Track, understand and improve how AI search talks about your brand.",
  columns: [
    {
      title: "Product",
      links: [
        { label: "Features", href: "/#features" },
        { label: "Pricing", href: "/pricing" },
        { label: "Get started", href: "/signup" },
        { label: "Log in", href: "/login" },
      ],
    },
    {
      title: "Open source",
      links: [
        { label: "GitHub", href: site.github, external: true },
        { label: "Self-hosting guide", href: "/self-hosting" },
        { label: "Report an issue", href: `${site.github}/issues`, external: true },
        { label: "llms.txt", href: "/llms.txt" },
      ],
    },
    {
      title: "Legal",
      links: [
        { label: "Imprint", href: "/imprint" },
        { label: "Privacy", href: "/privacy" },
        { label: "Terms", href: "/terms" },
      ],
    },
  ] satisfies { title: string; links: LinkItem[] }[],
  madeBy: `Made by ${site.company} in Germany`,
};
