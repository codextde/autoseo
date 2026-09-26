"use client";

import { Loader2 } from "lucide-react";
import { PageHeader, TabNav } from "@/components/app/page";
import { HowWeGetDataDialog, type InfoStep } from "../shared/info-dialog";
import { InterestTab } from "./interest-tab";
import { SitemapTab } from "./sitemap-tab";
import { PersonasTab } from "./personas-tab";
import { ProductsTab } from "./products-tab";
import { ProfileTab } from "./profile-tab";
import type {
  BrandProfile,
  CatalogProduct,
  ContextNote,
  InterestData,
  KnowledgeKind,
  KnowledgeState,
  PersonasData,
  ProductStreamConfig,
  SitemapData,
} from "../../types";

const TABS: { key: KnowledgeKind; label: string }[] = [
  { key: "interest", label: "Interest" },
  { key: "sitemap", label: "Sitemap" },
  { key: "personas", label: "Personas" },
  { key: "products", label: "Products" },
  { key: "profile", label: "Profile" },
];

const INFO: Record<KnowledgeKind, { title: string; steps: InfoStep[] }> = {
  interest: {
    title: "How we get interest data",
    steps: [
      { title: "Seed terms", body: "Your brand name, profile categories, industry and the category sections of your sitemap." },
      { title: "Search queries", body: "DataForSEO Labs keyword ideas & suggestions return the real queries around these seeds with monthly Google search volume, 12-month trend and search intent." },
      { title: "Clustering", body: "Your local agent / AI provider groups the queries into interest clusters (or a term-overlap heuristic when no AI is connected). Without DataForSEO the AI estimates clusters and volumes (marked “estimated”)." },
      { title: "Use", body: "Clusters become topics in the Prompt Set Helper and context for personas." },
    ],
  },
  sitemap: {
    title: "How we get sitemap data",
    steps: [
      { title: "robots.txt", body: "We read robots.txt for Sitemap: entries and check which AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended…) are allowed." },
      { title: "Sitemaps", body: "Every sitemap and sitemap index is walked (gzip supported, up to 25,000 URLs and 60 files, private network addresses are never contacted)." },
      { title: "Page tree", body: "URLs are grouped by path into a tree and classified by page type (product, category, blog, help, legal, company…) from URL patterns and sitemap names." },
      { title: "Your input", body: "Star important sections — they are used as context for prompts, personas and content." },
    ],
  },
  personas: {
    title: "How we get persona data",
    steps: [
      { title: "Research", body: "Your local agent / AI provider researches your brand (web search), your interest clusters and site structure." },
      { title: "Personas", body: "It builds buyer personas with goals, pains, funnel stage and the typical questions they ask AI assistants." },
      { title: "Your edits", body: "Edit, delete or add personas. “Generate prompts” creates a persona-specific prompt set in Prompt Research." },
    ],
  },
  products: {
    title: "How we get product data",
    steps: [
      { title: "Feed URL", body: "Google Merchant XML, RSS/Atom, CSV or JSON feeds (incl. Shopify products.json) are fetched securely and optionally re-synced daily." },
      { title: "File upload", body: "Upload CSV, JSON or XML exports (up to 10,000 products per file)." },
      { title: "Push API", body: "POST JSON arrays to the project endpoint with a Bearer token (stored only as SHA-256)." },
    ],
  },
  profile: {
    title: "How we get profile data",
    steps: [
      { title: "Your input", body: "Brand name, aliases and own domains decide how your brand is detected in AI answers and citations." },
      { title: "AI research", body: "“Research with AI” lets your local agent / AI provider research the brand (web search) and fills empty fields only." },
      { title: "Project context", body: "Notes (goals, positioning, writing preferences, research log) are shared with agents via the local agent runtime and MCP." },
    ],
  },
};

export type KnowledgeViewProps = {
  projectId: string;
  tab: KnowledgeKind;
  domain: string;
  all: Record<KnowledgeKind, KnowledgeState<unknown>>;
  profile: BrandProfile;
  stream: ProductStreamConfig;
  products: { rows: CatalogProduct[]; total: number; categories: { name: string; count: number }[] };
  notes: ContextNote[];
  providers: { dataforseo: boolean; llm: boolean };
  pushEndpoint: string;
  canManage: boolean;
  canEditProfile: boolean;
  canManageSettings: boolean;
};

export function KnowledgeView(props: KnowledgeViewProps) {
  const { projectId, tab, all } = props;
  const base = `/p/${projectId}/knowledge`;
  const info = INFO[tab];
  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader
        title="Brand Knowledge"
        description="Everything AutoSEO knows about your brand — the foundation for prompt research, personas and content."
        actions={<HowWeGetDataDialog title={info.title} steps={info.steps} label={`How we get ${tab} data`} />}
      />
      <TabNav
        active={tab}
        tabs={TABS.map((t) => ({
          key: t.key,
          label: t.label,
          href: `${base}?tab=${t.key}`,
          badge: all[t.key]?.status === "running" ? <Loader2 className="ml-1.5 inline size-3 animate-spin text-brand" /> : undefined,
        }))}
      />
      {tab === "interest" && <InterestTab projectId={projectId} state={all.interest as KnowledgeState<InterestData>} canManage={props.canManage} providers={props.providers} />}
      {tab === "sitemap" && <SitemapTab key={all.sitemap.finishedAt ?? "none"} projectId={projectId} state={all.sitemap as KnowledgeState<SitemapData>} canManage={props.canManage} domain={props.domain} />}
      {tab === "personas" && <PersonasTab projectId={projectId} state={all.personas as KnowledgeState<PersonasData>} canManage={props.canManage} providers={props.providers} />}
      {tab === "products" && (
        <ProductsTab
          projectId={projectId}
          state={all.products as KnowledgeState<Record<string, unknown>>}
          stream={props.stream}
          initial={props.products}
          endpoint={props.pushEndpoint}
          canManage={props.canManage}
          canManageSettings={props.canManageSettings}
        />
      )}
      {tab === "profile" && (
        <ProfileTab
          key={JSON.stringify(props.profile)}
          projectId={projectId}
          profile={props.profile}
          state={all.profile as KnowledgeState<Record<string, unknown>>}
          notes={props.notes}
          canEditProfile={props.canEditProfile}
          canManage={props.canManage}
          providers={props.providers}
        />
      )}
    </div>
  );
}
