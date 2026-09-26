"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getJobStatusAction } from "../../actions/research";
import type { JobStatus } from "../../types";

/**
 * Polls a background job while it is queued/running and refreshes the server components when the
 * job finishes (and, optionally, whenever its progress counter changes).
 */
export function useJobPoll(
  projectId: string,
  jobId: string | null | undefined,
  opts: { intervalMs?: number; refreshOnProgress?: boolean; onDone?: (s: JobStatus) => void } = {},
) {
  const router = useRouter();
  const [state, setState] = useState<{ jobId: string; status: JobStatus | null } | null>(null);
  const lastDone = useRef<number | undefined>(undefined);
  const onDone = useRef(opts.onDone);
  useEffect(() => {
    onDone.current = opts.onDone;
  });
  const interval = opts.intervalMs ?? 2500;
  const refreshOnProgress = opts.refreshOnProgress ?? false;

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const res = await getJobStatusAction(projectId, jobId).catch(() => null);
      if (cancelled) return;
      const s = res?.ok ? res.data : null;
      setState({ jobId, status: s });
      if (!s || s.status === "succeeded" || s.status === "failed" || s.status === "cancelled") {
        if (s) onDone.current?.(s);
        router.refresh();
        return;
      }
      const done = s.progress?.done;
      if (refreshOnProgress && done !== undefined && done !== lastDone.current) {
        lastDone.current = done;
        router.refresh();
      }
      timer = setTimeout(tick, interval);
    };
    timer = setTimeout(tick, 600);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [projectId, jobId, interval, refreshOnProgress, router]);

  return state && state.jobId === jobId ? state.status : null;
}
