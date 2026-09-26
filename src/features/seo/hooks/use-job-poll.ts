"use client";

import { useEffect, useRef, useState } from "react";
import { getJobStatusAction } from "../actions/common";

export type JobState = { status: string; result: unknown; lastError: string | null } | null;

/** Polls a background job every `intervalMs` until it succeeds/fails; calls onDone once. */
export function useJobPoll(projectId: string, jobId: string | null, onDone: (job: NonNullable<JobState>) => void, intervalMs = 2000) {
  const [job, setJob] = useState<JobState>(null);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const res = await getJobStatusAction(projectId, jobId);
      if (cancelled) return;
      if (res.ok && res.data) {
        const next = { status: res.data.status, result: res.data.result, lastError: res.data.lastError };
        setJob(next);
        if (["succeeded", "failed", "cancelled"].includes(next.status)) {
          doneRef.current(next);
          return;
        }
      }
      timer = setTimeout(tick, intervalMs);
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [projectId, jobId, intervalMs]);
  return job;
}
