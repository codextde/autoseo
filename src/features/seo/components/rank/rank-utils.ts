import { flagEmoji, getCountryByLocationCode } from "@/lib/countries";
import { formatLocationLabel, locationLabel } from "@/server/seo/lib/locations";
import type { RankDevices, ScheduleInterval } from "@/server/seo/lib/rank-tracking";

export type ConfigLike = {
  id: string;
  domain: string;
  locationCode: number;
  languageCode: string;
  locationName: string | null;
  devices: RankDevices;
  serpDepth: number;
  scheduleInterval: ScheduleInterval;
  lastSkipReason: string | null;
};

/** "<City, Region> | <Country>" for local configs, else the country name. */
export function configLocationLabel(config: Pick<ConfigLike, "locationCode" | "locationName">): string {
  const country = locationLabel(config.locationCode);
  return config.locationName ? `${formatLocationLabel(config.locationName, 2)} | ${country}` : country;
}

export function configFlag(locationCode: number): string {
  return flagEmoji(getCountryByLocationCode(locationCode)?.iso);
}

/** First segment of the canonical location name ("Enid,Oklahoma,United States" → "Enid"). */
export function localCity(locationName: string | null): string | null {
  if (!locationName) return null;
  return locationName.split(",")[0]?.trim() || null;
}

export function skipReasonMessage(reason: string | null, variant: "list" | "detail"): string | null {
  switch (reason) {
    case "insufficient_credits":
      return variant === "list"
        ? "Scheduled check skipped — insufficient DataForSEO funds"
        : "Last scheduled check was skipped due to insufficient DataForSEO funds. Top up your DataForSEO balance to resume automatic tracking.";
    case "budget_exceeded":
      return variant === "list"
        ? "Scheduled check skipped — budget limit reached (Admin → Limits & Budgets)"
        : "Last scheduled check was skipped because the spending limit was reached. Raise it in Admin → Limits & Budgets to resume automatic tracking.";
    case "not_configured":
      return variant === "list"
        ? "Scheduled check skipped — DataForSEO isn't connected (Admin → Data Providers)"
        : "Last scheduled check was skipped because DataForSEO isn't connected. An admin can connect it in Admin → Data Providers.";
    case "no_keywords":
      return variant === "list"
        ? "Scheduled check skipped — no keywords"
        : "Last scheduled check was skipped because this domain has no keywords yet.";
    default:
      return null;
  }
}

export function formatShortDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatDuration(seconds: number): string {
  return seconds < 60 ? `~${seconds}s` : `~${Math.ceil(seconds / 60)} min`;
}

/** Tracked-keyword KD badge: green ≤30, warning 31–60, red >60. */
export function kdTone(kd: number | null | undefined): string {
  if (kd == null) return "bg-muted text-muted-foreground";
  if (kd <= 30) return "bg-success/12 text-success";
  if (kd <= 60) return "bg-warning/15 text-warning";
  return "bg-destructive/10 text-destructive";
}

export function pathOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || "/";
  } catch {
    return url;
  }
}
