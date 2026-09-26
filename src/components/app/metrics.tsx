import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function formatNumber(n: number | null | undefined, opts: Intl.NumberFormatOptions = {}): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, ...opts }).format(n);
}

export function formatCompact(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function formatPercent(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function formatCurrency(n: number | null | undefined, currency = "EUR", digits = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: digits }).format(n);
}

/**
 * Change indicator (↗ +5.8 green / ↘ −2.0 red). `invert` for metrics where lower is better
 * (e.g. position, mention depth).
 */
export function Delta({
  value,
  suffix = "",
  invert,
  digits = 1,
  className,
  showZero = true,
}: {
  value: number | null | undefined;
  suffix?: string;
  invert?: boolean;
  digits?: number;
  className?: string;
  showZero?: boolean;
}) {
  if (value == null || Number.isNaN(value)) return null;
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) {
    if (!showZero) return null;
    return (
      <span className={cn("inline-flex items-center gap-0.5 text-xs text-muted-foreground tabular", className)}>
        <Minus className="size-3" />0{suffix}
      </span>
    );
  }
  const good = invert ? rounded < 0 : rounded > 0;
  const Icon = rounded > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium tabular",
        good ? "text-success" : "text-destructive",
        className,
      )}
    >
      <Icon className="size-3" />
      {Math.abs(rounded).toLocaleString("en-US", { maximumFractionDigits: digits })}
      {suffix}
    </span>
  );
}

export type KpiItem = {
  key: string;
  label: string;
  value: React.ReactNode;
  delta?: number | null;
  deltaSuffix?: string;
  invert?: boolean;
  hint?: string;
  sub?: React.ReactNode;
};

/**
 * Segmented KPI strip (finseo-style). When `onSelect` is set, tiles are selectable and the
 * active tile is highlighted (used to switch chart metric).
 */
export function KpiStrip({
  items,
  active,
  onSelect,
  className,
}: {
  items: KpiItem[];
  active?: string;
  onSelect?: (key: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-2 gap-1 rounded-xl bg-muted/70 p-1 sm:flex sm:flex-wrap", className)}>
      {items.map((item) => {
        const selected = active === item.key;
        const content = (
          <>
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              {item.label}
            </span>
            <span className="mt-0.5 flex items-baseline gap-1.5">
              <span className="text-lg font-semibold tracking-tight tabular">{item.value}</span>
              <Delta value={item.delta} suffix={item.deltaSuffix} invert={item.invert} showZero={false} />
            </span>
            {item.sub && <span className="text-[11px] text-muted-foreground">{item.sub}</span>}
          </>
        );
        const cls = cn(
          "flex min-w-[112px] flex-1 flex-col rounded-lg px-3 py-2 text-left transition-colors",
          selected ? "bg-background shadow-xs ring-1 ring-border" : onSelect ? "hover:bg-background/60" : "",
        );
        const node = onSelect ? (
          <button key={item.key} type="button" className={cls} onClick={() => onSelect(item.key)}>
            {content}
          </button>
        ) : (
          <div key={item.key} className={cls}>
            {content}
          </div>
        );
        return item.hint ? (
          <Tooltip key={item.key}>
            <TooltipTrigger asChild>{node}</TooltipTrigger>
            <TooltipContent className="max-w-64">{item.hint}</TooltipContent>
          </Tooltip>
        ) : (
          node
        );
      })}
    </div>
  );
}

/** Standalone stat card (dashboard tiles). */
export function StatCard({
  label,
  value,
  delta,
  deltaSuffix,
  invert,
  icon,
  footer,
  className,
  children,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  delta?: number | null;
  deltaSuffix?: string;
  invert?: boolean;
  icon?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col rounded-2xl border bg-card p-4 shadow-soft", className)}>
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight tabular">{value}</span>
        <Delta value={delta} suffix={deltaSuffix} invert={invert} showZero={false} />
      </div>
      {children}
      {footer && <div className="mt-2 text-xs text-muted-foreground">{footer}</div>}
    </div>
  );
}

/** Thin horizontal meter (usage, share, scores). */
export function Meter({ value, max = 100, className, tone = "brand" }: { value: number; max?: number; className?: string; tone?: "brand" | "info" | "warning" | "destructive" | "foreground" }) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  const color = {
    brand: "bg-brand",
    info: "bg-info",
    warning: "bg-warning",
    destructive: "bg-destructive",
    foreground: "bg-foreground",
  }[tone];
  return (
    // Spans (display:block) so the meter is valid inside <p> descriptions.
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn("block h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <span className={cn("block h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
    </span>
  );
}

/** 10-segment volume bars (finseo prompt volume column). */
export function SegmentBar({ value, segments = 10, className }: { value: number; segments?: number; className?: string }) {
  const filled = Math.round(Math.max(0, Math.min(1, value)) * segments);
  return (
    <span className={cn("inline-flex items-end gap-[3px]", className)} aria-label={`${Math.round(value * 100)}%`}>
      {Array.from({ length: segments }).map((_, i) => (
        <span key={i} className={cn("h-4 w-[3px] rounded-full", i < filled ? "bg-chart-5" : "bg-chart-5/20")} />
      ))}
    </span>
  );
}
