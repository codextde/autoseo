import type { NavIcon } from "@/lib/navigation";

/**
 * Product tour content (isomorphic). Steps navigate across the real app pages; `route` is relative
 * to `/p/<projectId>` when `scope === "project"`, absolute otherwise. `anchor` is a CSS selector
 * highlighted on the page — `{base}` is replaced with `/p/<projectId>`.
 */
export type TourTrack = "business" | "agency";

export type TourTopic = { key: string; title: string; description: string; icon: NavIcon };

export type TourStep = {
  id: string;
  topic: string;
  title: string;
  body: string;
  route: string;
  scope: "project" | "global";
  anchor?: string;
  tracks: TourTrack[];
};

export type TourState = {
  track: TourTrack;
  active: boolean;
  stepIndex: number;
  completed: string[];
  projectId?: string | null;
  updatedAt?: string;
};

export const DEFAULT_TOUR_STATE: TourState = { track: "business", active: false, stepIndex: 0, completed: [] };

export const TOUR_TRACKS: { key: TourTrack; label: string; description: string }[] = [
  { key: "business", label: "Business tour", description: "For in-house teams growing one brand's visibility in AI search and Google." },
  { key: "agency", label: "Agency tour", description: "For agencies managing many clients: pitches, sharing, roles and white-label reports." },
];

export const TOUR_TOPICS: TourTopic[] = [
  { key: "start", title: "Getting started", description: "Projects, the dashboard and how everything fits together.", icon: "home" },
  { key: "agency", title: "Clients & pitches", description: "Switch clients, run pitch projects and share access.", icon: "layers" },
  { key: "ai", title: "AI visibility", description: "Prompts, answers, competitors, sentiment and sources across AI engines.", icon: "sparkles" },
  { key: "seo", title: "Classic SEO", description: "Keywords, rankings, domains, backlinks, audits and local SEO.", icon: "search" },
  { key: "analytics", title: "Analytics & attribution", description: "Human and AI bot traffic, Search Console and revenue attribution.", icon: "bar-chart" },
  { key: "optimize", title: "Optimize", description: "Fact checks, tasks, content and crawlability fixes.", icon: "wand" },
  { key: "share", title: "Reports & agent", description: "Reports, brand knowledge and the AI agent.", icon: "presentation" },
  { key: "settings", title: "Setup & team", description: "Integrations, API & MCP, workspace roles.", icon: "settings" },
];

const nav = (path: string) => `[data-sidebar="content"] a[href="{base}${path}"]`;
const BOTH: TourTrack[] = ["business", "agency"];

export const TOUR_STEPS: TourStep[] = [
  /* ── Getting started ── */
  {
    id: "welcome",
    topic: "start",
    title: "Welcome aboard 👋",
    body: "This tour walks you through the real app — every step opens the page it talks about. Use Next / Back or your arrow keys, and close it any time; your progress is saved.",
    route: "",
    scope: "project",
    tracks: ["business"],
  },
  {
    id: "welcome-agency",
    topic: "start",
    title: "Welcome, agency team 👋",
    body: "This tour shows how to run many client projects side by side — from pitch to reporting. Every step opens the page it describes; your progress is saved.",
    route: "",
    scope: "project",
    tracks: ["agency"],
  },
  {
    id: "home",
    topic: "start",
    title: "Your visibility dashboard",
    body: "Home summarises AI visibility, share of voice, sentiment and SEO health for the selected project, with trends for the period you pick.",
    route: "",
    scope: "project",
    anchor: nav(""),
    tracks: BOTH,
  },
  {
    id: "project-switcher",
    topic: "start",
    title: "Projects",
    body: "A project is one website/brand in one market. Switch projects here — the page you are on stays open. “New project” starts the guided setup.",
    route: "",
    scope: "project",
    anchor: '[data-sidebar="header"] [data-sidebar="menu-button"][data-size="lg"]',
    tracks: ["business"],
  },

  /* ── Agency: clients & pitches ── */
  {
    id: "client-switcher",
    topic: "agency",
    title: "One project per client",
    body: "Each client gets its own project with its own market, prompts, competitors and data. Jump between clients from the project switcher without losing your place.",
    route: "",
    scope: "project",
    anchor: '[data-sidebar="header"] [data-sidebar="menu-button"][data-size="lg"]',
    tracks: ["agency"],
  },
  {
    id: "pitch-projects",
    topic: "agency",
    title: "Pitch projects",
    body: "Prospecting? Create a pitch project from the setup wizard — it expires automatically after the pitch period and can be converted into a regular client project if you win.",
    route: "/settings/projects",
    scope: "global",
    tracks: ["agency"],
  },
  {
    id: "client-sharing",
    topic: "agency",
    title: "Share projects with clients",
    body: "Invite client stakeholders with the read-only Client role and give them access to just their project. Team members only see the projects you assign.",
    route: "/settings/workspace",
    scope: "global",
    anchor: '[data-sidebar="content"] a[href="/settings/workspace"]',
    tracks: ["agency"],
  },

  /* ── AI visibility ── */
  {
    id: "prompt-research",
    topic: "ai",
    title: "Prompt research",
    body: "Discover the questions people ask AI assistants in your space, with estimated volume and intent. Add the best ones to tracking in one click.",
    route: "/ai/prompt-research",
    scope: "project",
    anchor: nav("/ai/prompt-research"),
    tracks: BOTH,
  },
  {
    id: "tracker",
    topic: "ai",
    title: "Prompt tracker",
    body: "Your tracked prompts are asked to ChatGPT, Perplexity, Gemini, Claude, Google AI Overviews and more on a schedule. See mentions, position and the full answers.",
    route: "/ai/tracker",
    scope: "project",
    anchor: nav("/ai/tracker"),
    tracks: BOTH,
  },
  {
    id: "competitors",
    topic: "ai",
    title: "Competitors",
    body: "Share of voice against the brands AI mentions next to you — including brands you didn't know were competing for the same answers.",
    route: "/ai/competitors",
    scope: "project",
    anchor: nav("/ai/competitors"),
    tracks: BOTH,
  },
  {
    id: "sentiment",
    topic: "ai",
    title: "Sentiment",
    body: "How AI talks about you: positive and negative themes, pulled from every answer that mentions your brand.",
    route: "/ai/sentiment",
    scope: "project",
    anchor: nav("/ai/sentiment"),
    tracks: BOTH,
  },
  {
    id: "sources",
    topic: "ai",
    title: "Sources",
    body: "The pages and domains AI engines cite. Find the publications that shape answers in your category — and where you're missing.",
    route: "/ai/sources",
    scope: "project",
    anchor: nav("/ai/sources"),
    tracks: BOTH,
  },
  {
    id: "products",
    topic: "ai",
    title: "Products",
    body: "Which products AI recommends, how they're described and how often yours show up in shopping-style answers.",
    route: "/ai/products",
    scope: "project",
    anchor: nav("/ai/products"),
    tracks: ["business"],
  },
  {
    id: "ads",
    topic: "ai",
    title: "Ads in AI answers",
    body: "Track sponsored placements shown alongside AI answers for your prompts.",
    route: "/ai/ads",
    scope: "project",
    anchor: nav("/ai/ads"),
    tracks: ["business"],
  },
  {
    id: "models",
    topic: "ai",
    title: "Model settings",
    body: "Choose which AI engines are tracked for this project and how often prompts run.",
    route: "/ai/models",
    scope: "project",
    anchor: nav("/ai/models"),
    tracks: BOTH,
  },

  /* ── SEO ── */
  {
    id: "keywords",
    topic: "seo",
    title: "Keyword research",
    body: "Search volume, difficulty, CPC and intent for any keyword in any market. Save keyword lists for content planning.",
    route: "/seo/keywords",
    scope: "project",
    anchor: nav("/seo/keywords"),
    tracks: BOTH,
  },
  {
    id: "rank-tracking",
    topic: "seo",
    title: "Rank tracking",
    body: "Daily Google rankings for your keywords on desktop and mobile, with SERP features and history.",
    route: "/seo/rank-tracking",
    scope: "project",
    anchor: nav("/seo/rank-tracking"),
    tracks: BOTH,
  },
  {
    id: "domain",
    topic: "seo",
    title: "Domain overview",
    body: "Organic traffic, top keywords and pages of any domain — yours or a competitor's.",
    route: "/seo/domain",
    scope: "project",
    anchor: nav("/seo/domain"),
    tracks: BOTH,
  },
  {
    id: "backlinks",
    topic: "seo",
    title: "Backlinks",
    body: "Referring domains, anchors and new/lost links, plus link gaps against competitors.",
    route: "/seo/backlinks",
    scope: "project",
    anchor: nav("/seo/backlinks"),
    tracks: BOTH,
  },
  {
    id: "audit",
    topic: "seo",
    title: "Site audit",
    body: "Crawl your site for technical issues and Lighthouse scores — prioritised by impact.",
    route: "/seo/audit",
    scope: "project",
    anchor: nav("/seo/audit"),
    tracks: BOTH,
  },
  {
    id: "local",
    topic: "seo",
    title: "Local SEO",
    body: "Map-pack rankings and business listings for location-based searches.",
    route: "/seo/local",
    scope: "project",
    anchor: nav("/seo/local"),
    tracks: ["business"],
  },

  /* ── Analytics ── */
  {
    id: "traffic",
    topic: "analytics",
    title: "Human traffic from AI",
    body: "Visitors that arrive from ChatGPT, Perplexity, Gemini & co. — which pages they land on and how they convert.",
    route: "/analytics/traffic",
    scope: "project",
    anchor: nav("/analytics/traffic"),
    tracks: BOTH,
  },
  {
    id: "bots",
    topic: "analytics",
    title: "AI bot traffic",
    body: "Which AI crawlers read your site, how often and which pages — via your CDN or server logs.",
    route: "/analytics/bots",
    scope: "project",
    anchor: nav("/analytics/bots"),
    tracks: BOTH,
  },
  {
    id: "search-console",
    topic: "analytics",
    title: "Search Console",
    body: "Clicks, impressions and positions from Google Search Console, next to your AI visibility.",
    route: "/analytics/search-console",
    scope: "project",
    anchor: nav("/analytics/search-console"),
    tracks: BOTH,
  },
  {
    id: "attribution",
    topic: "analytics",
    title: "Attribution",
    body: "Connect forms, shops and CRMs to see which leads and revenue came from AI search.",
    route: "/attribution",
    scope: "project",
    anchor: nav("/attribution"),
    tracks: BOTH,
  },

  /* ── Optimize ── */
  {
    id: "fact-check",
    topic: "optimize",
    title: "Fact check",
    body: "Define your ground truth (prices, features, facts) and catch AI answers that get it wrong.",
    route: "/fact-check",
    scope: "project",
    anchor: nav("/fact-check"),
    tracks: ["business"],
  },
  {
    id: "tasks",
    topic: "optimize",
    title: "Tasks",
    body: "Actionable recommendations generated from your data, organised as a to-do list you can assign and track.",
    route: "/tasks",
    scope: "project",
    anchor: '[data-sidebar="footer"] a[href="{base}/tasks"]',
    tracks: BOTH,
  },
  {
    id: "content",
    topic: "optimize",
    title: "Content",
    body: "Create and optimise content designed to be cited by AI engines and rank on Google.",
    route: "/content",
    scope: "project",
    anchor: nav("/content"),
    tracks: BOTH,
  },
  {
    id: "crawlability",
    topic: "optimize",
    title: "Crawlability",
    body: "Check whether AI crawlers can access and understand your pages (robots.txt, llms.txt, rendering).",
    route: "/crawlability",
    scope: "project",
    anchor: nav("/crawlability"),
    tracks: ["business"],
  },

  /* ── Reports, knowledge, agent ── */
  {
    id: "reports",
    topic: "share",
    title: "Report builder",
    body: "Build reports from any chart and share them as a link or export them as slides.",
    route: "/reports",
    scope: "project",
    anchor: nav("/reports"),
    tracks: ["business"],
  },
  {
    id: "reports-whitelabel",
    topic: "share",
    title: "White-label client reports",
    body: "Build reports with your agency's logo and colors, share a live link with the client or export a pitch deck.",
    route: "/reports",
    scope: "project",
    anchor: nav("/reports"),
    tracks: ["agency"],
  },
  {
    id: "knowledge",
    topic: "share",
    title: "Brand knowledge",
    body: "What we learned about the brand — interests, sitemap, personas and products — used to generate better prompts.",
    route: "/knowledge",
    scope: "project",
    anchor: nav("/knowledge"),
    tracks: BOTH,
  },
  {
    id: "agent",
    topic: "share",
    title: "Agent mode",
    body: "Ask questions about your data in plain language, or let the agent build reports and tasks for you.",
    route: "/agent",
    scope: "project",
    anchor: '[data-sidebar="header"] a[href="{base}/agent"]',
    tracks: BOTH,
  },

  /* ── Settings ── */
  {
    id: "integrations",
    topic: "settings",
    title: "Integrations",
    body: "Connect Search Console, Analytics, Cloudflare, your CMS and CRM to enrich every report.",
    route: "/integrations",
    scope: "project",
    anchor: '[data-sidebar="content"] a[href="{base}/integrations"]',
    tracks: BOTH,
  },
  {
    id: "api",
    topic: "settings",
    title: "API & MCP",
    body: "Create API keys and connect Claude, ChatGPT, Cursor or VS Code through the MCP server.",
    route: "/settings/api",
    scope: "global",
    anchor: '[data-sidebar="content"] a[href="/settings/api"]',
    tracks: BOTH,
  },
  {
    id: "workspace",
    topic: "settings",
    title: "Your team",
    body: "Invite teammates, assign roles and choose which projects each member can see.",
    route: "/settings/workspace",
    scope: "global",
    anchor: '[data-sidebar="content"] a[href="/settings/workspace"]',
    tracks: ["business"],
  },
  {
    id: "account",
    topic: "settings",
    title: "You're all set 🎉",
    body: "Manage your profile, language and signed-in devices in Account settings. You can restart this tour any time from the sidebar.",
    route: "/settings/account",
    scope: "global",
    anchor: '[data-sidebar="content"] a[href="/settings/account"]',
    tracks: BOTH,
  },
];

export function stepsForTrack(track: TourTrack): TourStep[] {
  return TOUR_STEPS.filter((s) => s.tracks.includes(track));
}

export function topicsForTrack(track: TourTrack) {
  const steps = stepsForTrack(track);
  return TOUR_TOPICS.map((t) => ({ ...t, steps: steps.filter((s) => s.topic === t.key) })).filter((t) => t.steps.length > 0);
}

/** Absolute URL of a step for a project. */
export function stepHref(step: TourStep, projectId: string | null | undefined): string {
  if (step.scope === "global") return step.route;
  return projectId ? `/p/${projectId}${step.route}` : "/";
}

export function stepAnchor(step: TourStep, projectId: string | null | undefined): string | null {
  if (!step.anchor) return null;
  return step.anchor.replaceAll("{base}", projectId ? `/p/${projectId}` : "");
}

export function trackProgress(track: TourTrack, completed: string[]) {
  const steps = stepsForTrack(track);
  const done = steps.filter((s) => completed.includes(s.id)).length;
  return { done, total: steps.length, pct: steps.length ? Math.round((done / steps.length) * 100) : 0 };
}

export const TOUR_EVENT = "autoseo:tour";
