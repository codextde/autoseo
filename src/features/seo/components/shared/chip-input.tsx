"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Term chip input: Enter or comma commits a chip, Backspace on empty removes the last, blur commits.
 * Terms are split on `,` / `+`. `tone` colours include (green +) vs exclude (rose −) chips.
 */
export function ChipInput({
  value,
  onChange,
  placeholder,
  tone,
  className,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  tone: "include" | "exclude";
  className?: string;
}) {
  const [text, setText] = useState("");
  const commit = (raw: string) => {
    const terms = raw
      .split(/[,+]/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (!terms.length) return;
    onChange([...new Set([...value, ...terms])].slice(0, 20));
    setText("");
  };
  return (
    <div
      className={cn(
        "flex min-h-8 flex-wrap items-center gap-1 rounded-lg border border-input bg-background px-1.5 py-1 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        className,
      )}
    >
      {value.map((t) => (
        <span
          key={t}
          className={cn(
            "inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium",
            tone === "include" ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400" : "bg-rose-500/12 text-rose-700 dark:text-rose-400",
          )}
        >
          {tone === "include" ? "+" : "−"} {t}
          <button type="button" className="opacity-60 hover:opacity-100" onClick={() => onChange(value.filter((v) => v !== t))} aria-label={`Remove ${t}`}>
            ×
          </button>
        </span>
      ))}
      <input
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          if (/[,+]$/.test(v)) commit(v);
          else setText(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(text);
          } else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => commit(text)}
        placeholder={value.length ? "" : placeholder}
        className="h-6 min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
