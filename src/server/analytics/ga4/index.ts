import "server-only";
/**
 * The 10 open-seo Google Analytics tools as reusable services. `GA4_REPORTS` maps MCP-style tool
 * names to their service function + description so the MCP/REST layers can expose them 1:1.
 */
import {
  getGa4AudienceBreakdown,
  getGa4EcommercePerformance,
  getGa4KeyEvents,
  getGa4MeasurementHealth,
  getGa4OrganicLandingPages,
  getGa4OrganicOverview,
  getGa4PagePerformance,
  getGa4SiteSearch,
  getGa4TrafficAcquisition,
} from "./reports";
import { getSearchOpportunities } from "../search-console/opportunities";

export * from "./reports";
export { getSearchOpportunities };

type AnyFn = (input: never) => Promise<unknown>;

export const GA4_REPORTS: Record<string, { description: string; run: AnyFn; readOnly: true }> = {
  get_google_analytics_organic_landing_pages: {
    description: "Organic-search landing pages with sessions, users, engagement, key events and revenue (GA4).",
    run: getGa4OrganicLandingPages as AnyFn,
    readOnly: true,
  },
  get_google_analytics_page_performance: {
    description: "Page views, users, engagement time and key events per page path; optional daily breakdown; organic or all channels.",
    run: getGa4PagePerformance as AnyFn,
    readOnly: true,
  },
  get_google_analytics_key_events: {
    description: "Key events (conversions) by event name, optionally by landing page; optional previous-period comparison.",
    run: getGa4KeyEvents as AnyFn,
    readOnly: true,
  },
  get_search_opportunities: {
    description: "Search Console × GA4 join: pages ranking 4–20 scored by demand, business value and reachability.",
    run: ((input: { projectId: string; startDate?: string; endDate?: string; limit?: number }) =>
      getSearchOpportunities(input.projectId, { startDate: input.startDate, endDate: input.endDate, limit: input.limit })) as AnyFn,
    readOnly: true,
  },
  get_google_analytics_organic_overview: {
    description: "Organic search overview (sessions, users, engagement, key events, revenue) vs previous period with a daily or weekly trend.",
    run: getGa4OrganicOverview as AnyFn,
    readOnly: true,
  },
  get_google_analytics_traffic_acquisition: {
    description: "Sessions by channel group, source/medium or campaign with attribution diagnostics; optional comparison.",
    run: getGa4TrafficAcquisition as AnyFn,
    readOnly: true,
  },
  get_google_analytics_ecommerce_performance: {
    description: "Ecommerce performance by item or landing page with ecommerce activity detection.",
    run: getGa4EcommercePerformance as AnyFn,
    readOnly: true,
  },
  get_google_analytics_site_search: {
    description: "Site search terms (view_search_results) with sessions and engagement.",
    run: getGa4SiteSearch as AnyFn,
    readOnly: true,
  },
  get_google_analytics_audience_breakdown: {
    description: "Users and sessions by device, country or new vs returning; optional comparison.",
    run: getGa4AudienceBreakdown as AnyFn,
    readOnly: true,
  },
  get_google_analytics_measurement_health: {
    description: "GA4 setup health: data streams, enhanced measurement, key events and custom definitions with issues.",
    run: getGa4MeasurementHealth as AnyFn,
    readOnly: true,
  },
};
