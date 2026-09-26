import { Suspense } from "react";
import type { Metadata } from "next";
import { AlertTriangle, Loader2, Users } from "lucide-react";
import { requireProject } from "@/server/auth/guards";
import { PageContainer, PageHeader, Panel, TabNav } from "@/components/app/page";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { resolveAnalyticsPeriod } from "@/server/analytics/period";
import {
  getTrafficFlow,
  getTrafficOverview,
  getTrafficPlatforms,
  getTrafficSources,
  getTrafficTable,
  TRAFFIC_PROVIDERS,
} from "@/server/analytics/traffic/queries";
import type { FlowMetric } from "@/server/analytics/traffic/flow";
import { getGoogleConnectionState } from "@/server/integrations/service";
import { getIntegration, toPublicIntegration } from "@/server/integrations/store";
import { PROVIDERS } from "@/lib/integrations-catalog";
import type { TrafficProvider } from "@/server/db/schema";
import { ConnectPrompt } from "@/features/analytics/components/shared";
import { GoogleConnectionCard } from "@/features/integrations/components/google-connection";
import { TokenIntegrationCard } from "@/features/integrations/components/token-connect";
import { TrafficToolbar } from "@/features/analytics/traffic/components/toolbar";
import { TrafficOverviewPanel } from "@/features/analytics/traffic/components/overview";
import { FlowPanel } from "@/features/analytics/traffic/components/flow-panel";
import { TrafficAnalyticsPanel, type AnalyticsTab } from "@/features/analytics/traffic/components/analytics-tables";
import { MeasurementHealthPanel } from "@/features/analytics/traffic/components/measurement-health";

export const metadata: Metadata = { title: "Human Traffic" };

type SP = Record<string, string | string[] | undefined>;
const one = (sp: SP, k: string) => {
  const v = sp[k];
  return (Array.isArray(v) ? v[0] : v) ?? undefined;
};

const FLOW_METRICS: FlowMetric[] = ["sessions", "conversions", "conversion_rate", "intent"];

export default async function HumanTrafficPage({ params, searchParams }: PageProps<"/p/[projectId]/analytics/traffic">) {
  const { projectId } = await params;
  const sp = (await searchParams) as SP;
  const ctx = await requireProject(projectId);
  const canManage = ctx.permissions.has("settings.manage");
  const base = `/p/${projectId}/analytics/traffic`;
  const tab = one(sp, "tab") === "settings" ? "settings" : "human";

  const header = (
    <>
      <PageHeader
        eyebrow="Analytics"
        title="Human Traffic"
        description="Real visitors that AI assistants send to your website — sessions, conversions and revenue per AI platform."
      />
      <TabNav
        tabs={[
          { key: "human", label: "Human Traffic", href: base },
          { key: "bots", label: "Bot Traffic", href: `/p/${projectId}/analytics/bots` },
          { key: "settings", label: "Settings", href: `${base}?tab=settings` },
        ]}
        active={tab}
      />
    </>
  );

  /* ───────────── Settings ───────────── */
  if (tab === "settings") {
    const [ga4State, matomoRow, piwikRow] = await Promise.all([
      getGoogleConnectionState(projectId, "ga4", { includeAccounts: canManage }),
      getIntegration(projectId, PROVIDERS.matomo),
      getIntegration(projectId, PROVIDERS.piwik),
    ]);
    return (
      <PageContainer>
        {header}
        <div className="space-y-1">
          <h2 className="text-[15px] font-semibold tracking-tight">Analytics Settings</h2>
          <p className="text-sm text-muted-foreground">
            Manage your analytics connection. Connect Google Analytics 4, Matomo or Piwik PRO — AI-referred sessions from every source are
            stored in the same normalized format and synced daily.
          </p>
        </div>
        <GoogleConnectionCard projectId={projectId} state={ga4State} canManage={canManage} returnTo={`${base}?tab=settings`} />
        {ga4State.status === "connected" && (
          <Suspense
            fallback={
              <Panel title="GA4 measurement health">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Checking data streams and key events…
                </div>
              </Panel>
            }
          >
            <MeasurementHealthPanel projectId={projectId} />
          </Suspense>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          <TokenIntegrationCard
            projectId={projectId}
            provider={PROVIDERS.matomo}
            integration={matomoRow ? toPublicIntegration(matomoRow) : null}
            canManage={canManage}
          />
          <TokenIntegrationCard
            projectId={projectId}
            provider={PROVIDERS.piwik}
            integration={piwikRow ? toPublicIntegration(piwikRow) : null}
            canManage={canManage}
          />
        </div>
      </PageContainer>
    );
  }

  /* ───────────── Human traffic ───────────── */
  const sources = await getTrafficSources(projectId);
  const ready = sources.filter((s) => s.status !== "pending");
  if (!ready.length) {
    const pendingGa4 = sources.some((s) => s.provider === "google_analytics" && s.status === "pending");
    return (
      <PageContainer>
        {header}
        <ConnectPrompt
          icon={<Users />}
          title={pendingGa4 ? "Choose your Google Analytics property" : "Connect your analytics"}
          description={
            pendingGa4
              ? "Your Google account is connected — pick the GA4 property of this website to import AI-referred sessions."
              : "Connect Google Analytics 4, Matomo or Piwik PRO to see how many visitors ChatGPT, Perplexity, Gemini, Claude and Copilot send you — and whether they convert."
          }
          href={`${base}?tab=settings`}
          actionLabel={pendingGa4 ? "Choose property" : "Connect analytics"}
        />
      </PageContainer>
    );
  }

  const requested = one(sp, "source");
  const source = ready.find((s) => s.provider === requested) ?? ready[0]!;
  const provider = source.provider as TrafficProvider;
  const period = resolveAnalyticsPeriod(sp, { lagDays: 1 });
  const granularity = one(sp, "granularity") === "monthly" ? "monthly" : "daily";
  const flowParam = one(sp, "flow") as FlowMetric | undefined;
  const flowMetric: FlowMetric = flowParam && FLOW_METRICS.includes(flowParam) ? flowParam : "sessions";
  const url = (one(sp, "url") ?? "").slice(0, 200);
  const atabParam = one(sp, "atab");
  const atab: AnalyticsTab = atabParam === "location" || atabParam === "engagement" ? atabParam : "urls";
  const models = (one(sp, "models") ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean)
    .slice(0, 30);

  const [overview, flow, tableRows, availableModels] = await Promise.all([
    getTrafficOverview(projectId, provider, period, granularity),
    getTrafficFlow(projectId, provider, period, { metric: flowMetric, url }),
    getTrafficTable(projectId, provider, period, { by: atab, models }),
    getTrafficPlatforms(projectId, provider),
  ]);

  const importing = !source.lastSyncAt && !overview.hasData;

  return (
    <PageContainer>
      {header}
      <TrafficToolbar
        projectId={projectId}
        sources={sources.filter((s) => TRAFFIC_PROVIDERS.includes(s.provider))}
        source={provider}
        preset={period.preset}
        from={period.from}
        to={period.to}
        granularity={granularity}
        lastSyncAt={source.lastSyncAt}
      />
      {source.lastError && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>The last {source.label} sync failed</AlertTitle>
          <AlertDescription>
            {source.lastError}
            {canManage && (
              <>
                {" "}
                <a href={`${base}?tab=settings`}>Check the connection</a>.
              </>
            )}
          </AlertDescription>
        </Alert>
      )}
      {importing ? (
        <Panel>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
            <div>
              <p className="text-sm font-semibold">Importing {source.label} data…</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                We are importing up to 16 months of AI-referred sessions from {source.propertyLabel || source.label}. This usually takes a
                minute — refresh the page shortly.
              </p>
            </div>
            <div className="w-full max-w-lg space-y-2 pt-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          </div>
        </Panel>
      ) : (
        <>
          <TrafficOverviewPanel
            overview={overview}
            currency={source.currency}
            granularity={granularity}
            periodLabel={period.label}
            sourceLabel={`${source.label}${source.propertyLabel ? ` · ${source.propertyLabel}` : ""}`}
          />
          <FlowPanel flow={flow} metric={flowMetric} url={url} />
          <TrafficAnalyticsPanel
            tab={atab}
            rows={tableRows}
            sort={one(sp, "sort") ?? "sessions"}
            models={models}
            availableModels={availableModels}
            currency={source.currency}
            periodLabel={period.label}
          />
        </>
      )}
    </PageContainer>
  );
}
