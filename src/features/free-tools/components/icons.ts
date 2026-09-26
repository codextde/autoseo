import { CalendarClock, Gauge, KeyRound, Link2, type LucideIcon, ScanSearch, ShieldAlert, Sparkles, Swords } from "lucide-react";
import type { FreeToolSlug } from "../lib/registry";

/** One icon per tool (isomorphic — usable from server and client components). */
export const TOOL_ICONS: Record<FreeToolSlug, LucideIcon> = {
  "backlink-checker": Link2,
  "competitor-keyword-finder": KeyRound,
  "keyword-generator": Sparkles,
  "website-traffic-checker": Gauge,
  "competitor-analysis": Swords,
  "spam-score-checker": ShieldAlert,
  "domain-age-checker": CalendarClock,
  "serp-simulator": ScanSearch,
};
