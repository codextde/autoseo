"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { Loader2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { getLocationOption } from "@/server/seo/lib/locations";
import { peekSeoQuery } from "../../hooks/use-seo-query";
import { researchKey, sameInput, type KeywordSearchInput } from "./params";
import { cn } from "@/lib/utils";

export type SearchTab = { id: string; label: string; input: KeywordSearchInput; createdAt: number; viewedAt: number | null };

const MAX_TABS = 20;

function storageKey(projectId: string) {
  return `search-tabs:keyword:${projectId}`;
}

/* sessionStorage-backed store (useSyncExternalStore keeps SSR + hydration consistent). */
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readRaw(projectId: string): string {
  try {
    return window.sessionStorage.getItem(storageKey(projectId)) ?? "[]";
  } catch {
    return "[]";
  }
}

function parse(raw: string): SearchTab[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SearchTab[]).filter((t) => t && typeof t.id === "string" && t.input?.keyword) : [];
  } catch {
    return [];
  }
}

function write(projectId: string, tabs: SearchTab[]) {
  try {
    window.sessionStorage.setItem(storageKey(projectId), JSON.stringify(tabs));
  } catch {
    // storage unavailable
  }
  listeners.forEach((l) => l());
}

export function tabLabel(input: KeywordSearchInput, defaultLoc: number) {
  const loc = input.loc !== defaultLoc ? getLocationOption(input.loc)?.shortLabel : null;
  return loc ? `${input.keyword} · ${loc}` : input.keyword;
}

/** Session-scoped search tabs (max 20, oldest evicted). Identical inputs re-activate the existing tab. */
export function useSearchTabs(projectId: string, defaultLoc: number) {
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(projectId),
    () => "[]",
  );
  const tabs = useMemo(() => parse(raw), [raw]);

  const update = useCallback(
    (fn: (prev: SearchTab[]) => SearchTab[]) => {
      const prev = parse(readRaw(projectId));
      const next = fn(prev);
      if (JSON.stringify(next) !== JSON.stringify(prev)) write(projectId, next);
    },
    [projectId],
  );

  const open = useCallback(
    (inputs: KeywordSearchInput[]) =>
      update((prev) => {
        let next = [...prev];
        for (const input of inputs) {
          if (next.some((t) => sameInput(t.input, input))) continue;
          next.push({ id: crypto.randomUUID(), label: tabLabel(input, defaultLoc), input, createdAt: Date.now(), viewedAt: null });
        }
        if (next.length > MAX_TABS) next = next.slice(next.length - MAX_TABS);
        return next;
      }),
    [update, defaultLoc],
  );

  const markViewed = useCallback(
    (input: KeywordSearchInput, at: number | null = Date.now()) =>
      update((prev) => prev.map((t) => (sameInput(t.input, input) ? { ...t, viewedAt: at } : t))),
    [update],
  );

  /** Removes a tab and returns the tab to activate (right neighbour, else left, else none). */
  const close = useCallback(
    (id: string): SearchTab | null => {
      const idx = tabs.findIndex((t) => t.id === id);
      const remaining = tabs.filter((t) => t.id !== id);
      update(() => remaining);
      return remaining[idx] ?? remaining[idx - 1] ?? null;
    },
    [tabs, update],
  );

  return { tabs, open, close, markViewed };
}

export function SearchTabStrip({
  projectId,
  tabs,
  active,
  activeLoading,
  activeError,
  onSelect,
  onClose,
}: {
  projectId: string;
  tabs: SearchTab[];
  active: KeywordSearchInput | null;
  activeLoading: boolean;
  activeError: boolean;
  onSelect: (tab: SearchTab) => void;
  onClose: (tab: SearchTab) => void;
}) {
  if (tabs.length === 0) return null;
  return (
    <div className="scrollbar-none -mx-1 flex min-w-0 gap-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Keyword searches">
      <AnimatePresence initial={false}>
        {tabs.map((tab) => {
          const isActive = active != null && sameInput(tab.input, active);
          const hasData = peekSeoQuery(researchKey(projectId, tab.input)) !== undefined;
          const unviewed = !isActive && hasData && tab.viewedAt == null;
          return (
            <motion.div
              key={tab.id}
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={cn(
                "group flex h-8 shrink-0 items-center rounded-lg border text-sm transition-colors",
                isActive ? "border-foreground/15 bg-card font-medium shadow-xs" : "border-transparent bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <button type="button" role="tab" aria-selected={isActive} className="flex h-full max-w-48 items-center gap-1.5 pr-1 pl-2.5" onClick={() => onSelect(tab)}>
                {isActive && activeLoading ? (
                  <Loader2 className="size-3 animate-spin text-muted-foreground" />
                ) : isActive && activeError ? (
                  <span className="size-1.5 rounded-full bg-destructive" />
                ) : unviewed ? (
                  <span className="size-1.5 rounded-full bg-brand" />
                ) : null}
                <span className="truncate">{tab.label}</span>
              </button>
              <button
                type="button"
                className="mr-1 rounded p-0.5 opacity-50 hover:bg-foreground/10 hover:opacity-100"
                onClick={() => onClose(tab)}
                aria-label={`Close ${tab.label} tab`}
              >
                <X className="size-3" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
