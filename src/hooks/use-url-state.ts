"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useTransition } from "react";

/**
 * State persisted in the URL query string (so views are bookmarkable & shareable).
 * Values equal to the default are removed from the URL.
 */
export function useUrlState(key: string, defaultValue: string): [string, (v: string | null) => void, boolean] {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const value = params.get(key) ?? defaultValue;
  const set = useCallback(
    (v: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (v === null || v === defaultValue || v === "") next.delete(key);
      else next.set(key, v);
      const qs = next.toString();
      start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [params, pathname, router, key, defaultValue],
  );
  return [value, set, pending];
}

/** Multi-value URL state stored as comma-separated list. */
export function useUrlListState(key: string): [string[], (v: string[]) => void, boolean] {
  const [raw, set, pending] = useUrlState(key, "");
  const list = useMemo(() => (raw ? raw.split(",").filter(Boolean) : []), [raw]);
  return [list, (v) => set(v.length ? v.join(",") : null), pending];
}

/** Set several URL params at once. */
export function useUrlPatch() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const patch = useCallback(
    (values: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(values)) {
        if (v === null || v === undefined || v === "") next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [params, pathname, router],
  );
  return [patch, pending] as const;
}
