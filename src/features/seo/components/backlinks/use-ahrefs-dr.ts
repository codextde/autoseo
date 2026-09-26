"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { getAhrefsDomainRatingsAction } from "../../actions/backlinks";
import { stripWww } from "./params";

const CHUNK = 100;

/**
 * Opt-in Ahrefs Domain Rating enrichment (free public endpoint, cached server-side 24h). Unique domains are sent
 * in sequential chunks of 100; known / pending domains are skipped; failures keep partial results.
 */
export function useAhrefsDr(projectId: string) {
  const [enabled, setEnabled] = useState(false);
  const [ratings, setRatings] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(false);
  const known = useRef(new Set<string>());
  const pending = useRef(new Set<string>());
  const queue = useRef<Promise<void>>(Promise.resolve());

  const enrich = useCallback(
    (domains: (string | null | undefined)[]) => {
      const todo = [...new Set(domains.map(stripWww).filter(Boolean))].filter((d) => !known.current.has(d) && !pending.current.has(d));
      if (!todo.length) return;
      todo.forEach((d) => pending.current.add(d));
      setLoading(true);
      queue.current = queue.current.then(async () => {
        let failed = false;
        for (let i = 0; i < todo.length; i += CHUNK) {
          const chunk = todo.slice(i, i + CHUNK);
          try {
            const res = await getAhrefsDomainRatingsAction(projectId, chunk);
            if (res.ok) {
              chunk.forEach((d) => known.current.add(d));
              setRatings((prev) => ({ ...prev, ...res.data }));
            } else failed = true;
          } catch {
            failed = true;
          } finally {
            chunk.forEach((d) => pending.current.delete(d));
          }
        }
        if (failed) toast.error("Could not load Ahrefs DR.");
        if (pending.current.size === 0) setLoading(false);
      });
    },
    [projectId],
  );

  const enable = useCallback(
    (domains: (string | null | undefined)[]) => {
      setEnabled(true);
      enrich(domains);
    },
    [enrich],
  );

  const get = useCallback((domain: string | null | undefined) => {
    const d = stripWww(domain);
    return d in ratings ? ratings[d] : undefined;
  }, [ratings]);

  return { enabled, enable, enrich, get, loading };
}

export type AhrefsDr = ReturnType<typeof useAhrefsDr>;
