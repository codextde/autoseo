"use client";

import { useSearchParams } from "next/navigation";
import { useCallback } from "react";

export type ParamPatch = Record<string, string | number | boolean | null | undefined>;

/**
 * URL state without a server round trip: patches `window.location.search` via the native History API, which
 * Next.js syncs into `useSearchParams` (see docs: "Using the native History API"). Values that are null/""/
 * undefined are removed. `push` creates a history entry (new searches), default replaces.
 */
export function useQueryParams() {
  const params = useSearchParams();
  const set = useCallback((patch: ParamPatch, opts: { push?: boolean; reset?: boolean } = {}) => {
    const next = new URLSearchParams(opts.reset ? "" : window.location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined || v === "" || v === false) next.delete(k);
      else next.set(k, String(v));
    }
    const qs = next.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (opts.push) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }, []);
  const get = useCallback((k: string) => params.get(k), [params]);
  return { params, get, set };
}
