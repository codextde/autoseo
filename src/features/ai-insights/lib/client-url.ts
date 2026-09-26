"use client";

import { useCallback } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Sets a query param via the native History API (Next.js syncs `useSearchParams`) without a
 * server round-trip. Use for purely client-side view state (tabs inside a loaded dataset, open
 * drawers, chart types, table search) so it survives reloads/bookmarks.
 */
export function setClientParams(values: Record<string, string | null | undefined>) {
  const next = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(values)) {
    if (v === null || v === undefined || v === "") next.delete(k);
    else next.set(k, v);
  }
  const qs = next.toString();
  window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
}

export function useClientParam(key: string, defaultValue: string): [string, (v: string | null) => void] {
  const params = useSearchParams();
  const value = params.get(key) ?? defaultValue;
  const set = useCallback(
    (v: string | null) => setClientParams({ [key]: v === defaultValue ? null : v }),
    [key, defaultValue],
  );
  return [value, set];
}

export function useClientListParam(key: string): [string[], (v: string[]) => void] {
  const [raw, set] = useClientParam(key, "");
  const list = raw ? raw.split(",").filter(Boolean) : [];
  return [list, (v: string[]) => set(v.length ? v.join(",") : null)];
}

/** Builds links to another `?tab=` of the current page, keeping filters (and dropping `reset` keys). */
export function useTabHref(reset: string[] = []) {
  const params = useSearchParams();
  const pathname = usePathname();
  return (tab: string, extra: Record<string, string> = {}) => {
    const p = new URLSearchParams(params.toString());
    for (const k of reset) p.delete(k);
    p.delete("answer");
    if (tab === "overview" || tab === "") p.delete("tab");
    else p.set("tab", tab);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    const qs = p.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
}
