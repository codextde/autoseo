"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadDataAction } from "../actions";
import type { DataBundle } from "../lib/bundle";
import type { DateRangeValue } from "../lib/types";

export const appAssetUrl = (projectId: string) => (assetId: string) => `/p/${projectId}/reports/assets/${assetId}`;
export const shareAssetUrl = (token: string) => (assetId: string) => `/share/r/${token}/asset/${assetId}`;

/** Loads the live data bundle for a project + range (re-fetches when either changes). */
export function useReportData(projectId: string, range: DateRangeValue, dataProjectId?: string | null, initial?: DataBundle | null) {
  const [bundle, setBundle] = useState<DataBundle | null>(initial ?? null);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);
  const key = `${dataProjectId ?? projectId}|${range.preset}|${range.from ?? ""}|${range.to ?? ""}`;
  const firstKey = useRef(initial ? key : null);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    const res = await loadDataAction(projectId, { dataProjectId: dataProjectId ?? null, dateRange: range as { preset: "30d" } });
    if (id !== seq.current) return;
    if (res.ok) {
      setBundle(res.data);
      setError(null);
    } else setError(res.error);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (firstKey.current === key) {
      firstKey.current = null;
      return;
    }
    void reload();
  }, [key, reload]);

  return { bundle, loading, error, reload };
}

/** Human-readable byte size (AI report sizes). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 102.4) / 10} KB`;
  return `${Math.round(n / 104857.6) / 10} MB`;
}
