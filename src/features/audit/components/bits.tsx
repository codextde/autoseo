import { AlertOctagon, AlertTriangle, CircleCheck, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export type Severity = "critical" | "warning" | "info";

export const SEVERITY_META: Record<Severity, { label: string; dot: string; text: string; soft: string; ring: string }> = {
  critical: { label: "Critical", dot: "bg-destructive", text: "text-destructive", soft: "bg-destructive/10", ring: "ring-destructive/25" },
  warning: { label: "Warning", dot: "bg-warning", text: "text-warning", soft: "bg-warning/15", ring: "ring-warning/30" },
  info: { label: "Notice", dot: "bg-info", text: "text-info", soft: "bg-info/12", ring: "ring-info/25" },
};

export function SeverityDot({ severity, className }: { severity: Severity; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", SEVERITY_META[severity].dot, className)} aria-hidden />;
}

export function SeverityIcon({ severity, className }: { severity: Severity | "pass"; className?: string }) {
  if (severity === "pass") return <CircleCheck className={cn("size-4 text-success", className)} />;
  const Icon = severity === "critical" ? AlertOctagon : severity === "warning" ? AlertTriangle : Info;
  return <Icon className={cn("size-4", SEVERITY_META[severity].text, className)} />;
}

export function SeverityBadge({ severity, className, children }: { severity: Severity; className?: string; children?: React.ReactNode }) {
  const m = SEVERITY_META[severity];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", m.soft, m.text, m.ring, className)}>
      <span className={cn("size-1.5 rounded-full", m.dot)} />
      {children ?? m.label}
    </span>
  );
}

export function HttpStatusBadge({ status, fetchClass, className }: { status: number | null | undefined; fetchClass?: string | null; className?: string }) {
  if (fetchClass === "blocked" || fetchClass === "rate_limited") {
    return (
      <span className={cn("inline-flex rounded-md bg-destructive/10 px-1.5 py-0.5 font-mono text-[11px] font-medium text-destructive tabular", className)}>
        {fetchClass === "blocked" ? `${status ?? ""} blocked`.trim() : "429"}
      </span>
    );
  }
  if (!status) return <span className={cn("inline-flex rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground", className)}>—</span>;
  const tone =
    status < 300
      ? "bg-success/12 text-success"
      : status < 400
        ? "bg-warning/15 text-warning"
        : "bg-destructive/10 text-destructive";
  return <span className={cn("inline-flex rounded-md px-1.5 py-0.5 font-mono text-[11px] font-medium tabular", tone, className)}>{status}</span>;
}

export function scoreTone(score: number | null | undefined): { color: string; text: string; soft: string } {
  if (score == null) return { color: "var(--muted-foreground)", text: "text-muted-foreground", soft: "bg-muted" };
  if (score >= 90) return { color: "var(--success)", text: "text-success", soft: "bg-success/12" };
  if (score >= 50) return { color: "var(--warning)", text: "text-warning", soft: "bg-warning/15" };
  return { color: "var(--destructive)", text: "text-destructive", soft: "bg-destructive/10" };
}

export function ScorePill({ score, className }: { score: number | null | undefined; className?: string }) {
  const t = scoreTone(score);
  return (
    <span className={cn("inline-flex min-w-8 justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular", t.soft, t.text, className)}>
      {score == null ? "—" : score}
    </span>
  );
}

/** Circular score gauge (SVG, r=28) used for Lighthouse categories. */
export function ScoreGauge({ score, label, size = 72 }: { score: number | null | undefined; label: string; size?: number }) {
  const r = 28;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score ?? 0));
  const t = scoreTone(score);
  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg width={size} height={size} viewBox="0 0 72 72" className="-rotate-90">
        <circle cx="36" cy="36" r={r} stroke="var(--muted)" strokeWidth="6" fill="none" />
        <circle
          cx="36"
          cy="36"
          r={r}
          stroke={t.color}
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (pct / 100) * c}
          className="transition-[stroke-dashoffset] duration-700"
        />
        <text x="36" y="36" dominantBaseline="central" textAnchor="middle" transform="rotate(90 36 36)" className="fill-foreground text-[17px] font-semibold tabular">
          {score == null ? "—" : score}
        </text>
      </svg>
      <span className="text-center text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function pathOf(url: string, predominantHost?: string | null): string {
  try {
    const u = new URL(url);
    const p = `${u.pathname}${u.search}` || "/";
    return predominantHost && u.hostname !== predominantHost ? `${u.hostname}${p}` : p;
  } catch {
    return url;
  }
}

export function formatDetails(details: Record<string, unknown> | null | undefined): string {
  if (!details) return "";
  return Object.entries(details)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" → ") : typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s` : `${Math.round(ms)}ms`;
}

export const PHASES = [
  { key: "discovery", label: "Discovery" },
  { key: "crawling", label: "Crawling" },
  { key: "lighthouse", label: "Lighthouse" },
  { key: "finalizing", label: "Finalizing" },
] as const;
