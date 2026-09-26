"use client";

import { Clock, X } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { formatDate } from "../../lib/client";

export type RecentItem = { id: string; label: string; sub?: React.ReactNode; createdAt: Date | string };

/** "N recent searches" list with remove (open-seo search history, max 20). */
export function RecentSearches({
  items,
  onSelect,
  onRemove,
  onClear,
  empty,
}: {
  items: RecentItem[];
  onSelect: (item: RecentItem) => void;
  onRemove?: (item: RecentItem) => void;
  onClear?: () => void;
  empty: React.ReactNode;
}) {
  if (!items.length) return <>{empty}</>;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {items.length} recent search{items.length === 1 ? "" : "es"}
        </span>
        {onClear && (
          <Button variant="ghost" size="xs" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
      <ul className="divide-y rounded-xl border bg-card">
        {items.map((item, i) => (
          <motion.li
            key={item.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.02, 0.2) }}
            className="group flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40"
          >
            <Clock className="size-3.5 shrink-0 text-muted-foreground" />
            <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => onSelect(item)}>
              <span className="truncate text-sm font-medium">{item.label}</span>
              {item.sub && <span className="truncate text-xs text-muted-foreground">{item.sub}</span>}
            </button>
            <span className="shrink-0 text-xs text-muted-foreground tabular">{formatDate(item.createdAt, { month: "short", day: "numeric" })}</span>
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(item)}
                className="shrink-0 rounded p-1 text-muted-foreground opacity-60 hover:bg-muted hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100"
                aria-label={`Remove ${item.label}`}
              >
                <X className="size-3.5" />
              </button>
            )}
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
