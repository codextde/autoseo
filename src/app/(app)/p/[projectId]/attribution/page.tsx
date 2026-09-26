import type { Metadata } from "next";
import { requireProject } from "@/server/auth/guards";
import { PageContainer, PageHeader, TabNav } from "@/components/app/page";
import { Badge } from "@/components/ui/badge";
import { getBranding } from "@/server/branding";
import { getAttributionSettings, installTag, snippetNamespace, collectUrl } from "@/server/attribution/settings";
import { countResponses, getAttributionSummary, getLiveStatus, listAttributions, listResponseSources } from "@/server/attribution/service";
import { getAiTrafficRevenue } from "@/server/attribution/ga4";
import { listSources } from "@/server/attribution/sources";
import { listWebhookLogs, listWorkflows } from "@/server/attribution/workflows";
import { recommendInstallPath } from "@/server/attribution/recommend";
import { resolveAttributionPeriod } from "@/server/attribution/period";
import { buildShopifyPixel } from "@/server/attribution/snippet";
import { env } from "@/server/env";
import { AttributionOverview } from "@/features/attribution/components/overview";
import { SetupWizard } from "@/features/attribution/components/setup-wizard";
import { SurveyEditor } from "@/features/attribution/components/survey-editor";
import { AdvancedSettings } from "@/features/attribution/components/advanced-settings";
import { FieldMappingTab } from "@/features/attribution/components/mapping";
import { WebhookLogs } from "@/features/attribution/components/webhook-logs";
import { IntegrationsTab, type IntegrationsContext } from "@/features/attribution/components/integrations";

export const metadata: Metadata = { title: "Attribution" };

type SP = Record<string, string | string[] | undefined>;
const one = (sp: SP, k: string) => {
  const v = sp[k];
  return (Array.isArray(v) ? v[0] : v) ?? undefined;
};

const TABS = ["overview", "setup", "survey", "mapping", "logs", "integrations"] as const;
type Tab = (typeof TABS)[number];
const PAGE_SIZE = 50;

export default async function AttributionPage({ params, searchParams }: PageProps<"/p/[projectId]/attribution">) {
  const { projectId } = await params;
  const sp = (await searchParams) as SP;
  const ctx = await requireProject(projectId);
  const canManage = ctx.permissions.has("attribution.manage");
  const settings = await getAttributionSettings(projectId);
  const setupParam = one(sp, "setup");
  const rawTab = one(sp, "tab");
  const tab: Tab = setupParam ? "integrations" : TABS.includes(rawTab as Tab) ? (rawTab as Tab) : "overview";
  const base = `/p/${projectId}/attribution`;
  const setupComplete = !!settings.setupCompletedAt;

  const header = (
    <>
      <PageHeader
        eyebrow="Revenue"
        title={
          <span className="flex items-center gap-2">
            Attribution <Badge className="h-5 bg-brand text-[10px] text-brand-foreground">New</Badge>
          </span>
        }
        description="Ask “How did you hear about us?”, merge the answers with orders and deals, and see how much revenue AI search really drives."
      />
      <TabNav
        active={tab}
        tabs={[
          { key: "overview", label: "Overview", href: base },
          {
            key: "setup",
            label: "Setup",
            href: `${base}?tab=setup`,
            badge: !setupComplete ? <span className="ml-1.5 inline-block size-1.5 rounded-full bg-brand align-middle" /> : undefined,
          },
          { key: "survey", label: "Survey", href: `${base}?tab=survey` },
          { key: "mapping", label: "Field Mapping", href: `${base}?tab=mapping` },
          { key: "logs", label: "Webhook Logs", href: `${base}?tab=logs` },
          { key: "integrations", label: "Integrations", href: `${base}?tab=integrations` },
        ]}
      />
    </>
  );

  const integrationsCtx = async (): Promise<IntegrationsContext> => {
    const [sources, tag, ns, branding] = await Promise.all([listSources(projectId), installTag(settings.publicKey), snippetNamespace(), getBranding()]);
    const rec = recommendInstallPath({ trackMode: settings.trackMode, platform: settings.platform ?? null, formsMode: settings.formsMode ?? null });
    return {
      projectId,
      canManage,
      appName: branding.appName,
      sources,
      installTag: tag,
      shopifyPixel: buildShopifyPixel({ publicKey: settings.publicKey, endpoint: collectUrl(), ns, appName: branding.appName }),
      webhookBase: `${env.appUrl}/api/attribution/webhook/${projectId}`,
      recommended: settings.setupCompletedAt || settings.platform || settings.formsMode ? rec.providers : [],
    };
  };

  /* ───────────── Overview ───────────── */
  if (tab === "overview") {
    const period = resolveAttributionPeriod(one(sp, "period"), one(sp, "from"), one(sp, "to"));
    const view = one(sp, "view") === "all" ? "all" : "ai";
    const q = (one(sp, "q") ?? "").slice(0, 200);
    const source = (one(sp, "source") ?? "").slice(0, 200);
    const analytics = ["included", "dismissed"].includes(one(sp, "analytics") ?? "") ? (one(sp, "analytics") as "included" | "dismissed") : "all";
    const page = Math.max(0, Math.min(10_000, Number(one(sp, "page")) || 0));
    const [summary, list, sources, ga, total] = await Promise.all([
      getAttributionSummary(projectId, { from: period.from, to: period.to }),
      listAttributions(projectId, {
        from: period.from,
        to: period.to,
        channel: view === "ai" ? "ai_search" : "all",
        search: q || undefined,
        source: source || undefined,
        status: analytics === "included" ? "active" : analytics === "dismissed" ? "dismissed" : "all",
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
      listResponseSources(projectId),
      getAiTrafficRevenue(projectId, period.from, period.to),
      countResponses(projectId),
    ]);
    return (
      <PageContainer>
        {header}
        <AttributionOverview
          projectId={projectId}
          canManage={canManage}
          summary={summary}
          ga={ga}
          items={list.items}
          total={list.total}
          page={page}
          pageSize={PAGE_SIZE}
          sources={sources}
          hasAnyResponses={total > 0}
          setupComplete={setupComplete}
          filters={{ period: period.preset, from: period.fromParam, to: period.toParam, view, q, source, analytics }}
        />
      </PageContainer>
    );
  }

  /* ───────────── Setup wizard ───────────── */
  if (tab === "setup") {
    const [ic, live, ns, branding] = await Promise.all([integrationsCtx(), getLiveStatus(projectId), snippetNamespace(), getBranding()]);
    return (
      <PageContainer>
        {header}
        <SetupWizard
          projectId={projectId}
          canManage={canManage}
          trackMode={settings.trackMode}
          platform={settings.platform ?? null}
          formsMode={settings.formsMode ?? null}
          conversionSource={settings.conversionSource ?? null}
          wizardStep={settings.wizardStep}
          setupComplete={setupComplete}
          survey={settings.survey}
          installTag={ic.installTag}
          ns={`${ns}Attribution`}
          bookingUrl={branding.demoBookingUrl}
          integrations={ic}
          webhook={{
            endpoint: ic.webhookBase,
            tokenPrefix: settings.webhookTokenPrefix,
            tokenCreatedAt: settings.webhookTokenCreatedAt?.toISOString() ?? null,
          }}
          live={live}
        />
      </PageContainer>
    );
  }

  /* ───────────── Survey ───────────── */
  if (tab === "survey") {
    return (
      <PageContainer>
        {header}
        <SurveyEditor projectId={projectId} initial={settings.survey} canManage={canManage} />
        <AdvancedSettings
          projectId={projectId}
          canManage={canManage}
          reportingCurrency={settings.reportingCurrency}
          allowedDomains={settings.allowedDomains}
          publicKey={settings.publicKey}
        />
      </PageContainer>
    );
  }

  /* ───────────── Field mapping ───────────── */
  if (tab === "mapping") {
    const workflows = await listWorkflows(projectId);
    return (
      <PageContainer>
        {header}
        <FieldMappingTab
          projectId={projectId}
          canManage={canManage}
          workflows={workflows}
          endpoint={`${env.appUrl}/api/attribution/webhook/${projectId}`}
          tokenPrefix={settings.webhookTokenPrefix}
          tokenCreatedAt={settings.webhookTokenCreatedAt?.toISOString() ?? null}
        />
      </PageContainer>
    );
  }

  /* ───────────── Webhook logs ───────────── */
  if (tab === "logs") {
    const logs = await listWebhookLogs(projectId, { status: one(sp, "status"), limit: 300 });
    return (
      <PageContainer>
        {header}
        <WebhookLogs projectId={projectId} logs={logs} />
      </PageContainer>
    );
  }

  /* ───────────── Integrations ───────────── */
  const ic = await integrationsCtx();
  return (
    <PageContainer>
      {header}
      <IntegrationsTab ctx={ic} />
    </PageContainer>
  );
}
