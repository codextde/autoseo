"use client";

import { useCallback, useState } from "react";
import type { SearchHistoryItem } from "@/server/seo/history";
import { clearSearchHistoryAction, listSearchHistoryAction, removeSearchHistoryAction } from "../../actions/common";
import { toastError, unwrap } from "../../lib/client";

/** Recent searches (server-side per project + user, max 20) with optimistic remove / clear. */
export function useSearchHistory(projectId: string, feature: "domain" | "backlinks", initial: SearchHistoryItem[]) {
  const [items, setItems] = useState<SearchHistoryItem[]>(initial);
  const reload = useCallback(async () => {
    const res = await listSearchHistoryAction(projectId, feature);
    if (res.ok) setItems(res.data);
  }, [projectId, feature]);
  const remove = useCallback(
    async (id: string) => {
      setItems((prev) => prev.filter((i) => i.id !== id));
      try {
        unwrap(await removeSearchHistoryAction(projectId, [id]));
      } catch (err) {
        toastError(err);
        void reload();
      }
    },
    [projectId, reload],
  );
  const clear = useCallback(async () => {
    setItems([]);
    try {
      unwrap(await clearSearchHistoryAction(projectId, feature));
    } catch (err) {
      toastError(err);
      void reload();
    }
  }, [projectId, feature, reload]);
  return { items, reload, remove, clear };
}
