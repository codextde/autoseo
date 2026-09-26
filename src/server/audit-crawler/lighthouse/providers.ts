import "server-only";
import { dfsPost, isDataForSeoConfigured } from "@/server/dataforseo/client";
import { getSetting } from "@/server/settings";
import { recordUsage } from "@/server/usage";
import { buildStoredPayloadFromReport, type RawLighthouseReport, type StoredLighthousePayload } from "./stored-payload";

export type LighthouseProvider = "psi" | "dataforseo";

export type LighthouseRunContext = { projectId: string; workspaceId?: string | null; userId?: string | null };

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const PSI_TIMEOUT_MS = 120_000;
const DFS_LIGHTHOUSE_PATH = "/v3/on_page/lighthouse/live/json";

export async function lighthouseProviderStatus(): Promise<{ psi: { keyConfigured: boolean }; dataforseo: { configured: boolean } }> {
  const [google, dfs] = await Promise.all([getSetting("google"), isDataForSeoConfigured()]);
  return { psi: { keyConfigured: Boolean(google.pagespeedApiKey) }, dataforseo: { configured: dfs } };
}

/** Google PageSpeed Insights API v5 (free; optional API key from Admin → Google). */
export async function runPageSpeedInsights(
  url: string,
  strategy: "mobile" | "desktop",
  ctx: LighthouseRunContext,
): Promise<StoredLighthousePayload> {
  const google = await getSetting("google");
  const params = new URLSearchParams({ url, strategy: strategy.toUpperCase() });
  for (const c of ["PERFORMANCE", "ACCESSIBILITY", "BEST_PRACTICES", "SEO"]) params.append("category", c);
  if (google.pagespeedApiKey) params.set("key", google.pagespeedApiKey);
  const res = await fetch(`${PSI_ENDPOINT}?${params.toString()}`, {
    signal: AbortSignal.timeout(PSI_TIMEOUT_MS),
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const json = (await res.json().catch(() => null)) as { lighthouseResult?: RawLighthouseReport; error?: { code?: number; message?: string } } | null;
  await recordUsage({
    provider: "google_psi",
    feature: "site_audit",
    endpoint: "pagespeedonline/v5/runPagespeed",
    costUsd: 0,
    projectId: ctx.projectId,
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    meta: { strategy, ok: res.ok },
  });
  if (!res.ok || !json?.lighthouseResult) {
    const msg = json?.error?.message ?? `PageSpeed Insights HTTP ${res.status}`;
    if (res.status === 429)
      throw new Error(`${msg}. Add a free PageSpeed Insights API key in Admin → Google to raise the quota.`);
    throw new Error(msg.replace(/key=[^&\s]+/g, "key=***"));
  }
  return buildStoredPayloadFromReport(json.lighthouseResult, { url, strategy, source: "pagespeed-insights" });
}

/**
 * DataForSEO On-Page Lighthouse (billed). Never retried: a failed/aborted call may still be charged.
 */
export async function runDataForSeoLighthouse(
  url: string,
  strategy: "mobile" | "desktop",
  ctx: LighthouseRunContext,
): Promise<StoredLighthousePayload> {
  const task = await dfsPost<RawLighthouseReport>(
    DFS_LIGHTHOUSE_PATH,
    [{ url, for_mobile: strategy === "mobile", categories: ["performance", "accessibility", "best_practices", "seo"] }],
    { feature: "site_audit", projectId: ctx.projectId, workspaceId: ctx.workspaceId, userId: ctx.userId },
    { timeoutMs: 120_000, estimatedCostUsd: 0.005 },
  );
  const report = task.result?.[0];
  if (!report) throw new Error("DataForSEO Lighthouse response missing result");
  return buildStoredPayloadFromReport(report, {
    url,
    strategy,
    source: "dataforseo-lighthouse",
    taskId: task.id ?? null,
    cost: typeof task.cost === "number" ? task.cost : null,
  });
}

export async function runLighthouse(
  provider: LighthouseProvider,
  url: string,
  strategy: "mobile" | "desktop",
  ctx: LighthouseRunContext,
): Promise<StoredLighthousePayload> {
  return provider === "dataforseo" ? runDataForSeoLighthouse(url, strategy, ctx) : runPageSpeedInsights(url, strategy, ctx);
}
