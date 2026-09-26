import type { Permission } from "@/server/auth/permissions";

/**
 * Central navigation config. Every route of the app is listed here so feature modules only need
 * to implement their pages. `href` is relative to `/p/[projectId]` when `scope === "project"`.
 */
export type NavIcon =
  | "home"
  | "sparkles"
  | "search"
  | "radar"
  | "swords"
  | "heart"
  | "book"
  | "shopping-bag"
  | "megaphone"
  | "cpu"
  | "git-fork"
  | "bar-chart"
  | "users"
  | "bot"
  | "search-check"
  | "euro"
  | "shield-check"
  | "wand"
  | "list-checks"
  | "file-text"
  | "bug"
  | "presentation"
  | "library"
  | "key"
  | "plug"
  | "wallet"
  | "settings"
  | "line-chart"
  | "link"
  | "globe"
  | "map-pin"
  | "gauge"
  | "tag"
  | "terminal"
  | "shield"
  | "mail"
  | "brain"
  | "layers";

export type NavItem = {
  title: string;
  href: string;
  icon?: NavIcon;
  badge?: string;
  permission?: Permission;
  /** Additional path prefixes that mark this item active */
  match?: string[];
};

export type NavGroup = {
  title: string;
  icon: NavIcon;
  items: NavItem[];
};

export type NavEntry = NavItem | NavGroup;

export function isGroup(e: NavEntry): e is NavGroup {
  return "items" in e;
}

export const projectNav: NavEntry[] = [
  { title: "Home", href: "", icon: "home" },
  {
    title: "AI Visibility",
    icon: "sparkles",
    items: [
      { title: "Prompt Research", href: "/ai/prompt-research" },
      { title: "Tracker", href: "/ai/tracker" },
      { title: "Competitors", href: "/ai/competitors" },
      { title: "Sentiment", href: "/ai/sentiment" },
      { title: "Sources", href: "/ai/sources" },
      { title: "Products", href: "/ai/products" },
      { title: "Ads", href: "/ai/ads" },
      { title: "Brand Lookup", href: "/ai/brand-lookup" },
      { title: "Prompt Explorer", href: "/ai/prompt-explorer" },
      { title: "Model Settings", href: "/ai/models" },
    ],
  },
  {
    title: "SEO",
    icon: "search",
    items: [
      { title: "Keyword Research", href: "/seo/keywords" },
      { title: "Saved Keywords", href: "/seo/saved-keywords" },
      { title: "Rank Tracking", href: "/seo/rank-tracking" },
      { title: "Domain Overview", href: "/seo/domain" },
      { title: "Backlinks", href: "/seo/backlinks" },
      { title: "Site Audit", href: "/seo/audit" },
      { title: "Local SEO", href: "/seo/local" },
      { title: "SEO Tools", href: "/seo/tools" },
    ],
  },
  {
    title: "Analytics",
    icon: "bar-chart",
    items: [
      { title: "Human Traffic", href: "/analytics/traffic" },
      { title: "Bot Traffic", href: "/analytics/bots" },
      { title: "Search Console", href: "/analytics/search-console" },
    ],
  },
  { title: "Attribution", href: "/attribution", icon: "euro", badge: "New" },
  { title: "Fact Check", href: "/fact-check", icon: "shield-check" },
  {
    title: "Optimizations",
    icon: "wand",
    items: [
      { title: "Tasks", href: "/tasks" },
      { title: "Content", href: "/content" },
      { title: "Crawlability", href: "/crawlability" },
    ],
  },
  { title: "Report Builder", href: "/reports", icon: "presentation" },
  { title: "Brand Knowledge", href: "/knowledge", icon: "library" },
];

export const settingsNav: NavItem[] = [
  { title: "Account", href: "/settings/account", icon: "settings" },
  { title: "API & MCP", href: "/settings/api", icon: "key" },
  { title: "Integrations", href: "/integrations", icon: "plug" },
  { title: "Local Agents", href: "/agents", icon: "terminal", permission: "agents.manage" },
  { title: "Usage", href: "/settings/usage", icon: "wallet", permission: "usage.view" },
  { title: "Billing & Costs", href: "/settings/billing", icon: "euro", permission: "usage.view" },
  { title: "Workspace", href: "/settings/workspace", icon: "users", permission: "team.view" },
];

export const adminNav: NavItem[] = [
  { title: "Overview", href: "/admin", icon: "gauge" },
  { title: "Users", href: "/admin/users", icon: "users" },
  { title: "Invitations", href: "/admin/invitations", icon: "mail" },
  { title: "Roles & Permissions", href: "/admin/roles", icon: "shield" },
  { title: "Workspaces & Projects", href: "/admin/workspaces", icon: "layers" },
  { title: "Authentication", href: "/admin/auth", icon: "key" },
  { title: "Email", href: "/admin/email", icon: "mail" },
  { title: "AI Providers", href: "/admin/ai", icon: "brain" },
  { title: "Data Providers", href: "/admin/data", icon: "globe" },
  { title: "Onboarding", href: "/admin/onboarding", icon: "sparkles" },
  { title: "Branding", href: "/admin/branding", icon: "wand" },
  { title: "Limits & Budgets", href: "/admin/limits", icon: "wallet" },
  { title: "Free SEO Tools", href: "/admin/free-tools", icon: "globe" },
  { title: "Local Agents", href: "/admin/agents", icon: "terminal" },
  { title: "Jobs", href: "/admin/jobs", icon: "list-checks" },
  { title: "Audit Log", href: "/admin/audit-log", icon: "file-text" },
  { title: "System", href: "/admin/system", icon: "cpu" },
];
