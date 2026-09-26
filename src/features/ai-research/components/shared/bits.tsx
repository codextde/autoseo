"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { FunnelStage } from "../../types";

export const FUNNEL_COLORS: Record<FunnelStage, string> = {
  tofu: "var(--chart-3)",
  mofu: "var(--chart-6)",
  bofu: "var(--chart-2)",
};

const FUNNEL_TEXT: Record<FunnelStage, string> = {
  tofu: "TOFU · Awareness — the user explores a problem or category",
  mofu: "MOFU · Consideration — the user compares options",
  bofu: "BOFU · Decision — the user is ready to buy / choose",
};

/** Colored funnel glyph (TOFU / MOFU / BOFU) like finseo's prompt column. */
export function FunnelIcon({ stage, className, withTooltip = true }: { stage: FunnelStage | null; className?: string; withTooltip?: boolean }) {
  if (!stage) return <span className={cn("inline-block size-4 shrink-0", className)} />;
  const fill = { tofu: 1, mofu: 2, bofu: 3 }[stage];
  const icon = (
    <svg viewBox="0 0 16 16" className={cn("size-4 shrink-0", className)} aria-label={stage.toUpperCase()}>
      {[0, 1, 2].map((i) => {
        const y = 2 + i * 4.3;
        const inset = i * 2.2;
        const active = i < fill;
        return (
          <path
            key={i}
            d={`M${1.5 + inset} ${y} H${14.5 - inset} L${13.4 - inset - 0.9} ${y + 3.4} H${2.6 + inset + 0.9} Z`}
            fill={active ? FUNNEL_COLORS[stage] : "var(--muted)"}
            stroke={active ? FUNNEL_COLORS[stage] : "var(--border)"}
            strokeWidth="0.6"
          />
        );
      })}
    </svg>
  );
  if (!withTooltip) return icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{icon}</span>
      </TooltipTrigger>
      <TooltipContent>{FUNNEL_TEXT[stage]}</TooltipContent>
    </Tooltip>
  );
}

export function BrandedBadge({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={cn("h-[18px] rounded-md border-brand/30 bg-brand-soft px-1.5 text-[10px] font-semibold tracking-wide text-brand uppercase", className)}>
      Branded
    </Badge>
  );
}

/** Stable topic color from a palette (hash of the name). */
export function topicColor(name: string | null | undefined): string {
  const palette = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)", "var(--chart-7)", "var(--chart-8)"];
  if (!name) return "var(--chart-8)";
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length]!;
}

/** Warning banner for a missing provider with a link to the admin page. */
export function ProviderNotice({
  title,
  children,
  href,
  linkLabel,
  className,
  tone = "warning",
}: {
  title: string;
  children?: React.ReactNode;
  href?: string;
  linkLabel?: string;
  className?: string;
  tone?: "warning" | "info";
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border px-3.5 py-3 text-sm",
        tone === "warning" ? "border-warning/30 bg-warning/8" : "border-info/25 bg-info/6",
        className,
      )}
    >
      <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", tone === "warning" ? "text-warning" : "text-info")} />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-medium">{title}</p>
        {children && <div className="text-muted-foreground">{children}</div>}
      </div>
      {href && (
        <Link href={href} className="shrink-0 text-xs font-medium underline-offset-4 hover:underline">
          {linkLabel ?? "Configure"}
        </Link>
      )}
    </div>
  );
}

/** Tag-style multi value input (Enter / comma adds a value). */
export function ChipsInput({
  value,
  onChange,
  placeholder,
  max = 30,
  suggestions,
  className,
  disabled,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  max?: number;
  suggestions?: string[];
  className?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const parts = raw
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) if (!next.some((v) => v.toLowerCase() === p.toLowerCase()) && next.length < max) next.push(p);
    onChange(next);
    setDraft("");
  };
  const unused = (suggestions ?? []).filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()));
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border bg-background px-2 py-1.5 focus-within:ring-3 focus-within:ring-ring/40">
        {value.map((v) => (
          <span key={v} className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs">
            <span className="truncate">{v}</span>
            {!disabled && (
              <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))} className="text-muted-foreground hover:text-foreground">
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
        <Input
          value={draft}
          disabled={disabled || value.length >= max}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => draft && add(draft)}
          placeholder={value.length ? "" : placeholder}
          className="h-6 min-w-24 flex-1 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
      </div>
      {unused.length > 0 && !disabled && (
        <div className="flex flex-wrap gap-1">
          {unused.slice(0, 16).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="inline-flex items-center gap-0.5 rounded-md border border-dashed px-1.5 py-0.5 text-[11px] text-muted-foreground hover:border-solid hover:text-foreground"
            >
              <Plus className="size-3" />
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Toggle chip used for option groups (funnel stages, lengths, models). */
export function ToggleChip({
  active,
  onClick,
  children,
  className,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
        active ? "border-foreground bg-foreground text-background" : "bg-background text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}
