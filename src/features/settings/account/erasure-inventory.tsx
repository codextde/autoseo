"use client";

import { Archive, EyeOff, Link2Off, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type InventoryItemView = {
  key: string;
  label: string;
  count: number;
  action: "delete" | "anonymize" | "revoke" | "keep";
};

const ACTIONS = {
  delete: { label: "Deleted", icon: Trash2, tone: "text-destructive" },
  revoke: { label: "Revoked", icon: Link2Off, tone: "text-warning" },
  anonymize: { label: "Anonymized", icon: EyeOff, tone: "text-info" },
  keep: { label: "Kept for the team", icon: Archive, tone: "text-muted-foreground" },
} as const;

/** Grouped dry-run inventory: what an erasure deletes, revokes, anonymizes or keeps. */
export function ErasureInventoryList({ items, className }: { items: InventoryItemView[]; className?: string }) {
  const groups = (["delete", "revoke", "anonymize", "keep"] as const)
    .map((action) => ({ action, rows: items.filter((i) => i.action === action && i.count > 0) }))
    .filter((g) => g.rows.length);
  if (!groups.length) return <p className={cn("text-sm text-muted-foreground", className)}>No stored data besides the account itself.</p>;
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2", className)}>
      {groups.map((g) => {
        const meta = ACTIONS[g.action];
        const Icon = meta.icon;
        return (
          <div key={g.action} className="rounded-xl border bg-background/60 p-3">
            <div className={cn("mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase", meta.tone)}>
              <Icon className="size-3.5" /> {meta.label}
            </div>
            <ul className="space-y-1">
              {g.rows.map((r) => (
                <li key={r.key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-muted-foreground">{r.label}</span>
                  <span className="shrink-0 font-medium tabular">{r.count.toLocaleString("en-US")}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
