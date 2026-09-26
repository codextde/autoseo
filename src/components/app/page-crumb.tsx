"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

/**
 * Lets a detail page name the last breadcrumb ("Velocita" instead of "cmp_…"). The label is keyed by
 * pathname so a stale label never leaks onto the next page.
 */
let current: { path: string; label: string } | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function usePageCrumbLabel(pathname: string): string | null {
  const snapshot = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => null,
  );
  return snapshot && snapshot.path === pathname ? snapshot.label : null;
}

export function PageCrumb({ label }: { label: string | null | undefined }) {
  const pathname = usePathname();
  useEffect(() => {
    if (!label) return;
    current = { path: pathname, label };
    emit();
    return () => {
      if (current?.path === pathname && current.label === label) {
        current = null;
        emit();
      }
    };
  }, [pathname, label]);
  return null;
}

const ACRONYMS: Record<string, string> = {
  ai: "AI",
  seo: "SEO",
  serp: "SERP",
  gsc: "GSC",
  ga4: "GA4",
  api: "API",
  mcp: "MCP",
  cms: "CMS",
  url: "URL",
  urls: "URLs",
  pdf: "PDF",
  csv: "CSV",
  faq: "FAQ",
  geo: "GEO",
  rdap: "RDAP",
};

/** IDs like `cmp_wllbx8dtybi2talr` or long hashes aren't meaningful to people. */
export function isIdSegment(segment: string): boolean {
  return /^[a-z]{2,5}_[a-z0-9]{8,}$/i.test(segment) || /^[0-9a-f]{16,}$/i.test(segment);
}

/** "serp-simulator" → "SERP Simulator", "duplicate-content" → "Duplicate Content". */
export function humanizeSegment(segment: string): string {
  if (isIdSegment(segment)) return "Details";
  return decodeURIComponent(segment)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => ACRONYMS[w.toLowerCase()] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
