"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Entry = { data?: unknown; error?: string; at: number; promise?: Promise<unknown> };
/** Session-level cache so tab switches / back-navigation don't re-bill cached-or-not DataForSEO calls. */
const cache = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

function notify(key: string) {
  listeners.get(key)?.forEach((l) => l());
}

export function peekSeoQuery<T>(key: string): T | undefined {
  return cache.get(key)?.data as T | undefined;
}

export function setSeoQueryData(key: string, data: unknown) {
  cache.set(key, { data, at: Date.now() });
  notify(key);
}

export function invalidateSeoQueries(prefix: string) {
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
}

/**
 * Minimal react-query-like hook around server actions: no retries, no refetch on focus (every call may be
 * billed), results memoized per key for `staleMs`.
 */
export function useSeoQuery<T>(key: string | null, fetcher: () => Promise<T>, opts: { staleMs?: number } = {}) {
  const staleMs = opts.staleMs ?? 5 * 60_000;
  const [, force] = useState(0);
  const fetcherRef = useRef(fetcher);
  // Keep the latest fetcher without re-subscribing (declared before the effect that uses it).
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const run = useCallback(
    (k: string, forceRefetch = false) => {
      const existing = cache.get(k);
      if (!forceRefetch && existing?.promise) return;
      if (!forceRefetch && existing && (existing.data !== undefined || existing.error) && Date.now() - existing.at < staleMs) return;
      const promise = fetcherRef
        .current()
        .then((data) => cache.set(k, { data, at: Date.now() }))
        .catch((err: unknown) => cache.set(k, { error: err instanceof Error ? err.message : String(err), at: Date.now() }))
        .finally(() => notify(k));
      cache.set(k, { ...(existing ?? { at: Date.now() }), promise, error: undefined });
      notify(k);
    },
    [staleMs],
  );

  useEffect(() => {
    if (!key) return;
    const l = () => force((n) => n + 1);
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key)!.add(l);
    run(key);
    return () => {
      listeners.get(key)?.delete(l);
    };
  }, [key, run]);

  const entry = key ? cache.get(key) : undefined;
  return {
    data: entry?.data as T | undefined,
    error: entry?.error ?? null,
    loading: Boolean(key && entry?.promise),
    refetch: () => key && run(key, true),
  };
}
