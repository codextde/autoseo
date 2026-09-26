"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { ArrowRight, ArrowUpRight, BookmarkPlus, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Favicon } from "@/components/app/favicon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { saveKeywordsAction } from "@/features/seo/actions/keywords";
import { countryLanguage } from "../lib/countries";
import { withApp, type FreeTool } from "../lib/registry";
import { useToolRunner } from "./runner";

export function formatCount(value: number | null | undefined): string {
  return typeof value === "number" ? Math.round(value).toLocaleString("en-US") : "—";
}

export function formatMoney(value: number | null | undefined): string {
  if (typeof value !== "number") return "—";
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/** Fade/slide-in wrapper for a result block. */
export function Reveal({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, delay }} className={className}>
      {children}
    </motion.div>
  );
}

export function DomainTitle({ domain, sub, className }: { domain: string; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background">
        <Favicon domain={domain} className="size-4" />
      </span>
      <div className="min-w-0">
        <div className="truncate text-[15px] font-semibold tracking-tight">{domain}</div>
        {sub && <div className="truncate text-xs text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}

/** Metric tiles (label + value + optional hint + sub) in a responsive grid. */
export function MetricTiles({
  items,
  className,
}: {
  items: { label: string; value: React.ReactNode; hint?: string; sub?: React.ReactNode; accent?: boolean }[];
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-2 gap-2 sm:grid-cols-4", className)}>
      {items.map((m) => {
        const tile = (
          <div
            className={cn(
              "flex min-w-0 flex-col rounded-xl border bg-card px-3.5 py-3 text-left shadow-soft",
              m.accent && "border-brand/30 bg-brand-soft/40",
              m.hint && "cursor-help",
            )}
          >
            <span className="truncate text-[11px] font-medium text-muted-foreground">{m.label}</span>
            <span className="mt-1 text-xl font-semibold tracking-tight tabular sm:text-2xl">{m.value}</span>
            {m.sub && <span className="mt-0.5 text-[11px] text-muted-foreground">{m.sub}</span>}
          </div>
        );
        return m.hint ? (
          <Tooltip key={m.label}>
            <TooltipTrigger asChild>{tile}</TooltipTrigger>
            <TooltipContent className="max-w-64">{m.hint}</TooltipContent>
          </Tooltip>
        ) : (
          <div key={m.label}>{tile}</div>
        );
      })}
    </div>
  );
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

/** Outbound URL (new tab, nofollow) shown as host + path. */
export function UrlLink({ url, className, label }: { url: string | null | undefined; className?: string; label?: string }) {
  if (!url) return <span className="text-muted-foreground">—</span>;
  const safe = /^https?:\/\//i.test(url) ? url : null;
  const text = label ?? pathOf(url);
  if (!safe) return <span className={cn("block truncate", className)}>{text}</span>;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={cn("group/url inline-flex max-w-full items-center gap-1 text-foreground/90 hover:text-foreground hover:underline", className)}
      title={url}
    >
      <span className="truncate">{text}</span>
      <ArrowUpRight className="size-3 shrink-0 opacity-0 transition-opacity group-hover/url:opacity-60" />
    </a>
  );
}

export function FollowBadge({ dofollow }: { dofollow: boolean | null }) {
  if (dofollow == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium",
        dofollow ? "bg-success/12 text-success" : "bg-muted text-muted-foreground",
      )}
    >
      {dofollow ? "Follow" : "Nofollow"}
    </span>
  );
}

/** 0–100 score pill; `invert` = higher is worse (spam). */
export function ScorePill({ value, invert, className }: { value: number | null | undefined; invert?: boolean; className?: string }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const v = Math.round(value);
  const bad = invert ? v >= 60 : v < 20;
  const mid = invert ? v >= 30 : v < 50;
  return (
    <span
      className={cn(
        "inline-flex h-6 min-w-8 items-center justify-center rounded-full px-2 text-xs font-semibold tabular",
        bad ? "bg-destructive/12 text-destructive" : mid ? "bg-warning/15 text-warning" : "bg-success/12 text-success",
        className,
      )}
    >
      {v}
    </span>
  );
}

export function SectionTitle({ children, sub, actions }: { children: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight">{children}</h2>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * What the free run leaves out + the next step: public → the configured CTA (default: sign in); app → the full SEO
 * feature, deep-linked to the same query.
 */
export function UpsellCard({ tool, query }: { tool: FreeTool; query?: Record<string, string | number> }) {
  const runner = useToolRunner();
  if (!tool.upsell) return null;
  const href = runner.surface === "app" ? runner.featureHref(tool, query) : runner.cta.href;
  const label = runner.surface === "app" ? `Open ${tool.feature.label}` : runner.cta.label;
  if (!href) return null;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-gradient-to-br from-brand-soft/50 to-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <p className="max-w-2xl text-sm text-foreground/80">{withApp(tool.upsell.body, runner.appName)}</p>
      <Button asChild className="h-10 shrink-0 px-4">
        <Link href={href}>
          {label}
          <ArrowRight />
        </Link>
      </Button>
    </div>
  );
}

/** App only: saves keywords (+ volume/difficulty) to the project's Saved keywords. */
export function SaveKeywordsButton({
  keywords,
  locationCode,
  label = "Save to project",
}: {
  keywords: { keyword: string | null; searchVolume: number | null; difficulty: number | null }[];
  locationCode: number;
  label?: string;
}) {
  const runner = useToolRunner();
  const router = useRouter();
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  if (runner.surface !== "app" || !runner.projectId) return null;
  const rows = keywords.filter((k): k is { keyword: string; searchVolume: number | null; difficulty: number | null } => !!k.keyword?.trim());
  if (rows.length === 0) return null;
  const disabled = !runner.canRunPaid || state === "saving";
  const save = async () => {
    setState("saving");
    const res = await saveKeywordsAction(runner.projectId!, {
      keywords: rows.map((r) => r.keyword),
      locationCode,
      languageCode: countryLanguage(locationCode) ?? undefined,
      metrics: rows.map((r) => ({ keyword: r.keyword, searchVolume: r.searchVolume, keywordDifficulty: r.difficulty })),
    }).catch(() => ({ ok: false as const, error: "Could not save keywords." }));
    if (res.ok) {
      setState("saved");
      toast.success(`${res.data.savedCount} keyword${res.data.savedCount === 1 ? "" : "s"} saved`, {
        action: { label: "View", onClick: () => router.push(`/p/${runner.projectId}/seo/saved-keywords`) },
      });
    } else {
      setState("idle");
      toast.error(res.error);
    }
  };
  return (
    <Button type="button" variant="outline" size="sm" onClick={save} disabled={disabled} title={runner.canRunPaid ? undefined : "Requires “Run paid SEO research”"}>
      {state === "saving" ? <Loader2 className="animate-spin" /> : state === "saved" ? <Check /> : <BookmarkPlus />}
      {state === "saved" ? "Saved" : `${label} (${rows.length})`}
    </Button>
  );
}

/** App only: "Open in …" link into the full SEO feature. */
export function FeatureLink({ tool, query, label }: { tool: FreeTool; query?: Record<string, string | number>; label?: string }) {
  const runner = useToolRunner();
  const href = runner.featureHref(tool, query);
  if (runner.surface !== "app" || !href) return null;
  return (
    <Button asChild variant="ghost" size="sm">
      <Link href={href}>
        {label ?? `Open in ${tool.feature.label}`}
        <ArrowRight />
      </Link>
    </Button>
  );
}
