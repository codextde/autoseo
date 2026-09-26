import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { competitors, prompts } from "@/server/db/schema";
import { getSetting } from "@/server/settings";
import { getEngineAvailability, providerLabel } from "@/server/ai/engines";
import { listPromptTags } from "@/server/ai/tracking/prompts";
import {
  getCompetitorSeries,
  getCountryRows,
  getDailySeries,
  getLatestRun,
  getPromptAddedMarkers,
  getPromptFlow,
  getPromptRows,
  getPromptsPerDay,
  getTrackerKpis,
  type TrackerFilter,
} from "@/server/ai/metrics";
import { getEngine } from "@/lib/engines";
import { getCountry } from "@/lib/countries";
import { resolveRange } from "./period";
import type { CompetitorOption, EngineAvailabilityView, KpiKey, TagOption } from "./types";
import type { TrackerView } from "./components/tracker-overview";

export type SearchParams = Record<string, string | string[] | undefined>;

export function one(sp: SearchParams, key: string): string {
  const v = sp[key];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export function listParam(sp: SearchParams, key: string): string[] {
  return one(sp, key)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function engineAvailabilityView(workspaceId: string): Promise<EngineAvailabilityView[]> {
  const list = await getEngineAvailability({ workspaceId });
  return list.map((a) => ({
    id: a.id,
    name: a.name,
    vendor: a.vendor,
    provider: a.provider,
    providerLabel: providerLabel(a.provider),
    configured: a.configured,
    status: a.status,
    reason: a.reason,
    adminHref: a.adminHref,
    providers: a.providers,
  }));
}

export async function competitorOptions(projectId: string): Promise<CompetitorOption[]> {
  return db
    .select({ id: competitors.id, name: competitors.name, domain: competitors.domain, color: competitors.color })
    .from(competitors)
    .where(and(eq(competitors.projectId, projectId), eq(competitors.tracked, true)))
    .orderBy(competitors.name);
}

const VIEWS: TrackerView[] = ["trends", "breakdown", "flow", "locations"];
const KPIS: KpiKey[] = ["visibility", "mentionRate", "citationRate", "position"];

/** Everything the tracker page needs, computed for the current URL state. */
export async function loadTrackerData(project: { id: string; workspaceId: string; engines: string[]; country: string }, sp: SearchParams) {
  const view = (VIEWS.includes(one(sp, "view") as TrackerView) ? one(sp, "view") : "trends") as TrackerView;
  const kpi = (KPIS.includes(one(sp, "kpi") as KpiKey) ? one(sp, "kpi") : "visibility") as KpiKey;
  const period = resolveRange(one(sp, "period") || "30d", one(sp, "from"), one(sp, "to"));
  const engines = listParam(sp, "engines").filter((e) => getEngine(e));

  const [tags, comps, availability, limits] = await Promise.all([
    listPromptTags(project.id) as Promise<TagOption[]>,
    competitorOptions(project.id),
    engineAvailabilityView(project.workspaceId),
    getSetting("limits"),
  ]);
  const tagIds = new Set(tags.map((t) => t.id));
  const compIds = new Set(comps.map((c) => c.id));
  const tagSel = listParam(sp, "tags").filter((t) => tagIds.has(t));
  const compare = listParam(sp, "compare").filter((c) => c === "prev" || compIds.has(c));

  const filter: TrackerFilter = { projectId: project.id, engines, tagIds: tagSel };

  // Prompt table (separate filters, finseo-style)
  const status = one(sp, "status") === "archived" ? "archived" : "active";
  const tPeriod = resolveRange(one(sp, "tperiod") || "7d");
  const tloc = getCountry(one(sp, "tloc")) ? one(sp, "tloc") : "";
  const teng = listParam(sp, "teng").filter((e) => getEngine(e));
  const ttags = listParam(sp, "ttags").filter((t) => tagIds.has(t));
  const tableFilter: TrackerFilter = {
    projectId: project.id,
    status,
    countries: tloc ? [tloc] : undefined,
    engines: teng,
    tagIds: ttags,
  };

  const [kpis, series, prevSeries, compareSeries, promptsPerDay, markers, flow, countries, rows, latestRun, activeCount, promptCountries] =
    await Promise.all([
      getTrackerKpis(filter, period),
      view === "trends" || view === "breakdown" ? getDailySeries(filter, period) : Promise.resolve([]),
      view === "trends" && compare.includes("prev") ? getDailySeries(filter, period.prev) : Promise.resolve(null),
      view === "trends" ? getCompetitorSeries(filter, period, compare.filter((c) => c !== "prev")) : Promise.resolve([]),
      view === "trends" ? getPromptsPerDay(filter, period) : Promise.resolve(null),
      view === "trends" ? getPromptAddedMarkers(project.id, period) : Promise.resolve([]),
      view === "flow" ? getPromptFlow(filter, period) : Promise.resolve(null),
      view === "locations" ? getCountryRows(filter, period) : Promise.resolve(null),
      getPromptRows(tableFilter, tPeriod),
      getLatestRun(project.id),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(prompts)
        .where(and(eq(prompts.projectId, project.id), eq(prompts.status, "active")))
        .then((r) => r[0]?.n ?? 0),
      db
        .selectDistinct({ country: prompts.country })
        .from(prompts)
        .where(eq(prompts.projectId, project.id))
        .then((r) => r.map((x) => x.country)),
    ]);

  return {
    view,
    kpi,
    period,
    engines,
    tagSel,
    compare,
    tags,
    comps,
    availability,
    kpis,
    series,
    prevSeries,
    compareSeries,
    promptsPerDay,
    markers,
    flow,
    countries,
    rows,
    status: status as "active" | "archived",
    latestRun,
    usage: { active: Number(activeCount), engines: project.engines.length, limit: limits.maxPromptsPerProject },
    promptCountries: promptCountries.length ? promptCountries : [project.country],
  };
}
