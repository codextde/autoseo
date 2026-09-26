import type { Metadata } from "next";
import { Clock, DatabaseZap, Loader2, ScanSearch, SearchCheck, Sparkles } from "lucide-react";
import { requireProject } from "@/server/auth/guards";
import { PageContainer, PageHeader, Panel, TabNav } from "@/components/app/page";
import { EmptyState } from "@/components/app/empty-state";
import { resolveAnalyticsPeriod } from "@/server/analytics/period";
import {
  getScConnections,
  getScLocations,
  getScOverview,
  getScPages,
  getScQueries,
  getStrikingDistance,
  hasScData,
  type ScQueryFilters,
  type ScSource,
} from "@/server/analytics/search-console/queries";
import { getSearchOpportunities } from "@/server/analytics/search-console/opportunities";
import {
  getCachedInspection,
  getInspectionQuota,
  InspectionError,
  listRecentInspections,
  type InspectUrlResult,
} from "@/server/analytics/search-console/inspection";
import { getGoogleConnectionState } from "@/server/integrations/service";
import { getIntegration, toPublicIntegration } from "@/server/integrations/store";
import { getSetting } from "@/server/settings";
import { PROVIDERS } from "@/lib/integrations-catalog";
import { ConnectPrompt } from "@/features/analytics/components/shared";
import { GoogleConnectionCard } from "@/features/integrations/components/google-connection";
import { TokenIntegrationCard } from "@/features/integrations/components/token-connect";
import { ScToolbar } from "@/features/analytics/search-console/components/toolbar";
import { ScOverviewPanel } from "@/features/analytics/search-console/components/overview";
import { QueriesTable, QueryFilters, ViewToggle } from "@/features/analytics/search-console/components/queries-table";
import { PagesTable } from "@/features/analytics/search-console/components/pages-table";
import { LocationsView } from "@/features/analytics/search-console/components/locations-view";
import { OpportunityScoring, StrikingDistanceTable } from "@/features/analytics/search-console/components/opportunities-view";
import { RefineIntentsButton } from "@/features/analytics/search-console/components/settings-extras";
import { InspectionView } from "@/features/analytics/search-console/components/inspection-view";

export const metadata: Metadata = { title: "Search Console" };

const TABS = [
  { key: "queries", label: "Search Queries" },
  { key: "pages", label: "Top Pages" },
  { key: "locations", label: "Locations" },
  { key: "opportunities", label: "Opportunities" },
  { key: "inspect", label: "URL Inspection" },
  { key: "settings", label: "Settings" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

type SP = Record<string, string | string[] | undefined>;
const one = (sp: SP, k: string) => {
  const v = sp[k];
  return (Array.isArray(v) ? v[0] : v) ?? undefined;
};
const list = (sp: SP, k: string) =>
  (one(sp, k) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export default async function SearchConsolePage({ params, searchParams }: PageProps<"/p/[projectId]/analytics/search-console">) {
  const { projectId } = await params;
  const sp = (await searchParams) as SP;
  const ctx = await requireProject(projectId);
  const canManage = ctx.permissions.has("settings.manage");
  const canAddPrompts = ctx.permissions.has("prompts.manage");

  const source: ScSource = one(sp, "source") === "bing" ? "bing" : "google";
  const tabParam = one(sp, "tab");
  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : "queries";
  const period = resolveAnalyticsPeriod(sp, { lagDays: source === "google" ? 2 : 1 });
  const connections = await getScConnections(projectId);
  const conn = connections[source];
  const base = `/p/${projectId}/analytics/search-console`;

  const keep = new URLSearchParams();
  for (const k of ["source", "period", "from", "to"]) {
    const v = one(sp, k);
    if (v) keep.set(k, v);
  }
  const hrefFor = (key: string) => {
    const q = new URLSearchParams(keep);
    if (key !== "queries") q.set("tab", key);
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };

  const filters: ScQueryFilters = {
    view: one(sp, "view") === "prompts" ? "prompts" : "all",
    words: one(sp, "words") ?? null,
    intents: list(sp, "intent"),
    countries: list(sp, "country"),
    q: one(sp, "q") ?? null,
    page: one(sp, "page") ?? null,
  };

  const header = (
    <>
      <PageHeader
        eyebrow="Analytics"
        title="Search Console"
        description="Queries, pages and countries from Google Search Console and Bing Webmaster Tools — and which of them read like AI prompts."
      />
      <TabNav tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: hrefFor(t.key) }))} active={tab} />
      <ScToolbar
        projectId={projectId}
        source={source}
        googleConnected={connections.google.connected}
        bingConnected={connections.bing.connected}
        preset={period.preset}
        from={period.from}
        to={period.to}
        periodLabel={period.label}
        lastSyncAt={conn.lastSyncAt}
        showPeriod={tab !== "settings" && tab !== "inspect" && conn.connected}
      />
    </>
  );

  /* ───────────── Settings ───────────── */
  if (tab === "settings") {
    const [googleState, bingRow, integrationsSettings] = await Promise.all([
      getGoogleConnectionState(projectId, "gsc", { includeAccounts: canManage }),
      getIntegration(projectId, PROVIDERS.bing),
      getSetting("integrations"),
    ]);
    const g = connections.google;
    return (
      <PageContainer>
        {header}
        <div className="grid gap-4 lg:grid-cols-2">
          <GoogleConnectionCard projectId={projectId} state={googleState} canManage={canManage} returnTo={`${base}?tab=settings`} />
          <TokenIntegrationCard
            projectId={projectId}
            provider={PROVIDERS.bing}
            integration={bingRow ? toPublicIntegration(bingRow) : null}
            canManage={canManage}
            note={
              integrationsSettings.bingWebmasterApiKey && !bingRow?.secret ? (
                <p className="text-xs text-muted-foreground">
                  An instance-wide Bing API key is configured — the API key field is optional.
                </p>
              ) : undefined
            }
          />
        </div>
        <Panel title="Data & classification" icon={<DatabaseZap className="size-4 text-muted-foreground" />}>
          <div className="grid gap-4 text-sm md:grid-cols-3">
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 font-medium">
                <Clock className="size-3.5 text-muted-foreground" /> Data freshness
              </p>
              <p className="text-muted-foreground">
                Google Search Console data trails by 2–3 days; the last days are re-imported on every daily sync. Bing reports query and page statistics weekly.
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-medium">History</p>
              <p className="text-muted-foreground">
                {g.syncedThrough
                  ? `Google data from ${g.backfilledFrom ?? "—"} to ${g.syncedThrough} (up to 16 months are kept).`
                  : "Up to 16 months of history are imported after connecting and kept for 16 months."}
              </p>
            </div>
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 font-medium">
                <Sparkles className="size-3.5 text-brand" /> AI prompt & intent detection
              </p>
              <p className="text-muted-foreground">
                Queries are classified by a multilingual heuristic. Refine the top 300 queries with your AI provider for more accurate intents.
              </p>
              {canAddPrompts && <RefineIntentsButton projectId={projectId} disabled={!g.connected && !connections.bing.connected} />}
            </div>
          </div>
        </Panel>
      </PageContainer>
    );
  }

  /* ───────────── URL Inspection (Google only, independent of synced data) ───────────── */
  if (tab === "inspect") {
    const google = connections.google;
    if (source === "bing") {
      return (
        <PageContainer>
          {header}
          <div className="rounded-2xl border bg-card shadow-soft">
            <EmptyState
              icon={ScanSearch}
              title="URL Inspection uses Google Search Console"
              description="Bing Webmaster Tools has no URL Inspection API. Switch to Google to inspect a URL."
              action={{ label: "Switch to Google", href: `${base}?tab=inspect` }}
            />
          </div>
        </PageContainer>
      );
    }
    if (!google.connected) {
      return (
        <PageContainer>
          {header}
          <ConnectPrompt
            icon={<ScanSearch />}
            title={google.status === "pending" ? "Choose your Search Console property" : "Connect Google Search Console"}
            description="URL Inspection shows Google's index status, canonical, crawl details, mobile usability and rich results for any URL of your property."
            href={`${base}?tab=settings`}
            actionLabel={google.status === "pending" ? "Choose property" : "Connect Google"}
          />
        </PageContainer>
      );
    }
    const gscRow = await getIntegration(projectId, PROVIDERS.gsc);
    const isDemo = gscRow?.config.demo === true;
    const urlParam = one(sp, "url")?.trim() ?? "";
    const [history, quota] = await Promise.all([listRecentInspections(projectId, 25), getInspectionQuota(projectId)]);
    let initial: InspectUrlResult | null = null;
    if (urlParam && !isDemo) {
      try {
        initial = await getCachedInspection(projectId, urlParam);
      } catch (err) {
        if (!(err instanceof InspectionError)) throw err;
      }
    }
    const canLive = ctx.permissions.has("seo.run") || canManage || ctx.isInstanceAdmin;
    return (
      <PageContainer>
        {header}
        <InspectionView
          projectId={projectId}
          property={google.site ?? ""}
          initialUrl={urlParam}
          initial={initial}
          history={history}
          quota={quota}
          canLive={canLive}
          disabledReason={isDemo ? "This project shows demo Search Console data. Connect a real Search Console property to inspect URLs." : null}
        />
      </PageContainer>
    );
  }

  /* ───────────── Not connected ───────────── */
  if (!conn.connected) {
    return (
      <PageContainer>
        {header}
        <ConnectPrompt
          title={
            source === "google"
              ? conn.status === "pending"
                ? "Choose your Search Console property"
                : "Connect Google Search Console"
              : "Connect Bing Webmaster Tools"
          }
          description={
            source === "google"
              ? "See the queries, pages and countries that bring search traffic — and which queries read like AI prompts you should track."
              : "Bing powers Copilot and ChatGPT search. Add your site URL and a Bing Webmaster API key to import queries and pages."
          }
          href={`${base}?tab=settings${source === "bing" ? "&source=bing" : ""}`}
          actionLabel={source === "google" ? (conn.status === "pending" ? "Choose property" : "Connect Google") : "Connect Bing"}
        />
      </PageContainer>
    );
  }

  const hasData = await hasScData(projectId, source);
  if (!hasData) {
    return (
      <PageContainer>
        {header}
        <div className="rounded-2xl border bg-card shadow-soft">
          <EmptyState
            icon={conn.lastSyncAt ? DatabaseZap : Loader2}
            title={conn.lastSyncAt ? "No search data yet" : "Importing your search data…"}
            description={
              conn.lastError
                ? `The last sync failed: ${conn.lastError}`
                : conn.lastSyncAt
                  ? "The connected property has no impressions yet. Data appears after the next daily sync."
                  : "The first import covers up to 16 months and usually takes a few minutes. Refresh this page in a moment."
            }
          />
        </div>
      </PageContainer>
    );
  }

  const overview = await getScOverview(projectId, source, period);

  let content: React.ReactNode = null;
  if (tab === "queries") {
    const data = await getScQueries(projectId, source, period, filters);
    content = (
      <Panel
        title="Search Queries"
        description="Queries driving traffic to your site"
        actions={<ViewToggle view={filters.view} allCount={data.queryCount} promptCount={data.promptCount} />}
        contentClassName="space-y-3 p-3 sm:p-4"
      >
        <QueryFilters countries={source === "google" ? data.countries : []} showCountries={source === "google"} />
        <QueriesTable projectId={projectId} data={data} view={filters.view} pageFilter={filters.page ?? null} canAddPrompts={canAddPrompts} source={source} />
      </Panel>
    );
  } else if (tab === "pages") {
    const data = await getScPages(projectId, source, period, { q: filters.q });
    content = (
      <Panel title="Top Pages" description="Pages with the most search impressions and the AI prompts they appear for" contentClassName="p-3 sm:p-4">
        <PagesTable rows={data.rows} truncated={data.truncated} source={source} />
      </Panel>
    );
  } else if (tab === "locations") {
    const data = await getScLocations(projectId, source, period, filters);
    const all = await getScQueries(projectId, source, period, { ...filters, countries: [], q: null, page: null });
    content = (
      <Panel
        title="Geographic Distribution"
        description={filters.view === "prompts" ? "AI prompt impressions by country" : "Search impressions by country"}
        actions={<ViewToggle view={filters.view} allCount={all.queryCount} promptCount={all.promptCount} />}
        contentClassName="space-y-3 p-3 sm:p-4"
      >
        <QueryFilters showCountries={false} showSearch={false} />
        <LocationsView rows={data.rows} view={filters.view} />
      </Panel>
    );
  } else if (tab === "opportunities") {
    if (source === "bing") {
      content = (
        <div className="rounded-2xl border bg-card shadow-soft">
          <EmptyState
            icon={SearchCheck}
            title="Opportunities use Google Search Console data"
            description="Striking-distance keywords and the GSC × GA4 score need query × page data, which Bing does not provide."
            action={{ label: "Switch to Google", href: `${base}?tab=opportunities` }}
          />
        </div>
      );
    } else {
      const [striking, opportunities] = await Promise.all([
        getStrikingDistance(projectId, source, period),
        getSearchOpportunities(projectId, { limit: 50 }),
      ]);
      content = (
        <div className="space-y-4">
          <StrikingDistanceTable projectId={projectId} rows={striking} canAddPrompts={canAddPrompts} range={{ from: period.from, to: period.to }} />
          <OpportunityScoring result={opportunities} projectId={projectId} />
        </div>
      );
    }
  }

  return (
    <PageContainer>
      {header}
      <ScOverviewPanel overview={overview} periodLabel={period.label} />
      {content}
    </PageContainer>
  );
}
