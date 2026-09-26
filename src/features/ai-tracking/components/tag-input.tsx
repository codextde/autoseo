"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { TagOption } from "../types";

/** Chip input for tag names: pick existing tags or type a new one (Enter / comma to add). */
export function TagInput({
  value,
  onChange,
  options,
  placeholder = "Add tags…",
  className,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  options: TagOption[];
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const lower = value.map((v) => v.toLowerCase());
  const add = (name: string) => {
    const t = name.trim().slice(0, 60);
    if (!t || lower.includes(t.toLowerCase())) return;
    onChange([...value, t]);
    setDraft("");
  };
  const suggestions = options.filter((o) => !lower.includes(o.name.toLowerCase()) && o.name.toLowerCase().includes(draft.trim().toLowerCase())).slice(0, 8);
  const canCreate = draft.trim() && !options.some((o) => o.name.toLowerCase() === draft.trim().toLowerCase());

  return (
    <Popover open={open && (suggestions.length > 0 || !!canCreate)} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div
          className={cn(
            "flex min-h-8 flex-wrap items-center gap-1 rounded-lg border border-input bg-background px-1.5 py-1 focus-within:ring-3 focus-within:ring-ring/50",
            className,
          )}
        >
          {value.map((t) => {
            const color = options.find((o) => o.name.toLowerCase() === t.toLowerCase())?.color;
            return (
              <span key={t} className="inline-flex h-6 items-center gap-1 rounded-md border bg-muted/60 pr-1 pl-1.5 text-xs">
                <span className="size-1.5 rounded-full" style={{ background: color ?? "var(--chart-3)" }} />
                {t}
                <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((v) => v !== t))} className="text-muted-foreground hover:text-foreground">
                  <X className="size-3" />
                </button>
              </span>
            );
          })}
          <Input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                add(draft);
              } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
            }}
            placeholder={value.length ? "" : placeholder}
            className="h-6 min-w-24 flex-1 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
        </div>
      </PopoverAnchor>
      <PopoverContent align="start" className="w-64 p-1" onOpenAutoFocus={(e) => e.preventDefault()}>
        {suggestions.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => add(o.name)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
          >
            <span className="size-2 rounded-full" style={{ background: o.color ?? "var(--chart-3)" }} />
            <span className="flex-1 truncate">{o.name}</span>
            <span className="text-muted-foreground tabular">{o.count}</span>
          </button>
        ))}
        {canCreate && (
          <button type="button" onClick={() => add(draft)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted">
            <Plus className="size-3.5" /> Create “{draft.trim()}”
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
