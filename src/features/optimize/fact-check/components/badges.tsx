import { flagEmoji } from "@/lib/countries";
import { cn } from "@/lib/utils";
import { FC_VERDICT_META } from "@/features/optimize/constants";

/** Colors for verdict types (charts, dots, badges). */
export const VERDICT_COLORS: Record<string, string> = {
  matched: "var(--brand)",
  off_label: "oklch(0.58 0.2 305)",
  contradicted: "var(--destructive)",
  unsupported: "var(--warning)",
  outdated: "var(--info)",
  needs_review: "oklch(0.7 0.01 95)",
  pending: "var(--border)",
};

export function verdictLabel(v: string) {
  return (FC_VERDICT_META as Record<string, { label: string }>)[v]?.label ?? v;
}

export function VerdictBadge({ verdict, className }: { verdict: string; className?: string }) {
  const color = VERDICT_COLORS[verdict] ?? "var(--muted-foreground)";
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset", className)}
      style={{
        background: `color-mix(in oklch, ${color} 12%, transparent)`,
        color: `color-mix(in oklch, ${color} 80%, var(--foreground))`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${color} 30%, transparent)`,
      }}
    >
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {verdict === "matched" ? "Matched" : verdictLabel(verdict).toLowerCase()}
    </span>
  );
}

const SEVERITY_TONE: Record<string, string> = {
  critical: "bg-destructive text-white",
  major: "bg-warning/20 text-[color-mix(in_oklch,var(--warning)_70%,var(--foreground))] ring-1 ring-inset ring-warning/40",
  minor: "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
};

export function SeverityBadge({ severity, className }: { severity: string | null | undefined; className?: string }) {
  if (!severity) return <span className={cn("text-xs text-muted-foreground", className)}>—</span>;
  return (
    <span className={cn("inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-semibold tracking-wide uppercase", SEVERITY_TONE[severity], className)}>
      {severity}
    </span>
  );
}

export function MarketChip({ country, regulator, className }: { country: string; regulator?: string | null; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded-md border bg-background px-1.5 text-[11px] font-medium whitespace-nowrap", className)}>
      <span className="text-[13px] leading-none">{flagEmoji(country)}</span>
      {country}
      {regulator && <span className="text-muted-foreground">· {regulator}</span>}
    </span>
  );
}
