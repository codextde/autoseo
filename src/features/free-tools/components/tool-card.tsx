import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FreeTool } from "../lib/registry";
import { TOOL_ICONS } from "./icons";

/** Source label for a tool card: what powers it and whether it costs anything. */
export function toolSourceLabel(tool: FreeTool, surface: "app" | "public"): string {
  if (tool.source === "rdap") return "Free · registry lookup";
  if (tool.source === "client") return "Free · runs in your browser";
  return surface === "app" ? "DataForSEO · pay per run" : "Free · no signup";
}

/** Link card for a tool (hubs + related tools). Server-compatible. */
export function ToolCard({ tool, href, surface, compact, className }: { tool: FreeTool; href: string; surface: "app" | "public"; compact?: boolean; className?: string }) {
  const Icon = TOOL_ICONS[tool.slug];
  return (
    <Link
      href={href}
      className={cn(
        "group relative flex min-w-0 flex-col rounded-2xl border bg-card p-4 shadow-soft transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-brand-soft/60 text-brand">
          <Icon className="size-5" />
        </span>
        <ArrowUpRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <h3 className="mt-3 text-[15px] font-semibold tracking-tight">{tool.name}</h3>
      <p className={cn("mt-1 text-sm text-muted-foreground", compact && "line-clamp-2 text-xs")}>{tool.shortDescription}</p>
      {!compact && (
        <span
          className={cn(
            "mt-3 inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
            tool.source === "dataforseo" && surface === "app" ? "bg-muted text-muted-foreground" : "bg-success/12 text-success",
          )}
        >
          {toolSourceLabel(tool, surface)}
        </span>
      )}
    </Link>
  );
}
