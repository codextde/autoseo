"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getLookupAction } from "../../actions/lookup";

/** Polls an ai_lookups row while it is queued/running; refreshes the page once it finished. */
export function useLookupPoll(projectId: string, id: string | null, status: string | null) {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);
  const active = !!id && (status === "queued" || status === "running");
  useEffect(() => {
    if (!active || !id) return;
    let cancelled = false;
    const started = Date.now();
    const clock = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    const tick = async () => {
      const res = await getLookupAction(projectId, id).catch(() => null);
      if (cancelled) return;
      if (!res?.ok || res.data.status === "done" || res.data.status === "failed") {
        router.refresh();
        return;
      }
      timer = setTimeout(tick, 2500);
    };
    let timer: ReturnType<typeof setTimeout> = setTimeout(tick, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(clock);
    };
  }, [active, id, projectId, router]);
  return elapsed;
}
