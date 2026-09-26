"use client";

import { Eye, FileText, Globe, Settings2, ShieldAlert, Swords, Wrench, type LucideIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { priorityBand } from "@/server/optimize/tasks/scoring";
import { TASK_CATEGORY_META, type TaskCategoryKey } from "@/features/optimize/constants";
import { cn } from "@/lib/utils";

export const CATEGORY_ICONS: Record<TaskCategoryKey, LucideIcon> = {
  technical: Wrench,
  content: FileText,
  visibility: Eye,
  competitor: Swords,
  offsite: Globe,
  reputation: ShieldAlert,
  setup: Settings2,
};

export function CategoryIcon({ category, className, size = "md" }: { category: TaskCategoryKey; className?: string; size?: "sm" | "md" }) {
  const Icon = CATEGORY_ICONS[category] ?? Settings2;
  const meta = TASK_CATEGORY_META[category];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
        size === "md" ? "size-8" : "size-6 rounded-md",
        className,
      )}
      style={{
        background: `color-mix(in oklch, ${meta.color} 12%, transparent)`,
        color: meta.color,
        boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${meta.color} 22%, transparent)`,
      }}
      aria-label={meta.label}
    >
      <Icon className={size === "md" ? "size-4" : "size-3.5"} />
    </span>
  );
}

export function CategoryBadge({ category, className }: { category: TaskCategoryKey; className?: string }) {
  const meta = TASK_CATEGORY_META[category];
  const Icon = CATEGORY_ICONS[category];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", className)} style={{ background: `color-mix(in oklch, ${meta.color} 12%, transparent)`, color: meta.color }}>
      <Icon className="size-3" />
      {meta.label}
    </span>
  );
}

const bandTone = {
  p1: "bg-destructive/12 text-destructive ring-destructive/25",
  p2: "bg-warning/15 text-warning ring-warning/30",
  p3: "bg-info/12 text-info ring-info/25",
  p4: "bg-muted text-muted-foreground ring-border",
} as const;

export function PriorityBadge({ priority, impact, effort, className }: { priority: number; impact?: number; effort?: number; className?: string }) {
  const band = priorityBand(priority);
  const node = (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset tabular", bandTone[band.key], className)}>
      {band.short}
      <span className="font-medium opacity-75">{Math.round(priority)}</span>
    </span>
  );
  if (impact == null) return node;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{node}</TooltipTrigger>
      <TooltipContent>
        {band.label} priority · impact {impact}/10 · effort {effort}/10
      </TooltipContent>
    </Tooltip>
  );
}

/** 10-dot meter for impact/effort. */
export function ScoreDots({ value, tone = "brand", className }: { value: number; tone?: "brand" | "muted"; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-[2px]", className)} aria-label={`${value} of 10`}>
      {Array.from({ length: 10 }).map((_, i) => (
        <span
          key={i}
          className={cn("h-2.5 w-[3px] rounded-full", i < value ? (tone === "brand" ? "bg-brand" : "bg-foreground/60") : "bg-muted-foreground/20")}
        />
      ))}
    </span>
  );
}

export type MemberLite = { id: string; name: string | null; email: string; avatarUrl: string | null };

export function initials(m: { name: string | null; email: string }) {
  const src = (m.name || m.email).trim();
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function MemberAvatar({ member, size = "sm", className }: { member: MemberLite | null | undefined; size?: "xs" | "sm" | "md"; className?: string }) {
  const dim = size === "xs" ? "size-5 text-[9px]" : size === "sm" ? "size-6 text-[10px]" : "size-8 text-xs";
  if (!member)
    return (
      <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full border border-dashed text-muted-foreground", dim, className)} aria-label="Unassigned">
        ?
      </span>
    );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Avatar className={cn(dim, className)}>
          {member.avatarUrl && <AvatarImage src={member.avatarUrl} alt="" />}
          <AvatarFallback className="bg-brand-soft font-semibold text-brand">{initials(member)}</AvatarFallback>
        </Avatar>
      </TooltipTrigger>
      <TooltipContent>{member.name ?? member.email}</TooltipContent>
    </Tooltip>
  );
}
