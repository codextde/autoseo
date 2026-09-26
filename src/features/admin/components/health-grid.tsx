"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { Bot, Brain, Database, Globe, ListChecks, Mail, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Panel } from "@/components/app/page";
import { cn } from "@/lib/utils";
import { runHealthChecksAction } from "../actions/overview";

type Check = {
  key: string;
  label: string;
  status: "ok" | "warning" | "error" | "off";
  summary: string;
  detail?: string;
  href: string;
};

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  db: Database,
  smtp: Mail,
  ai: Brain,
  dataforseo: Globe,
  agents: Bot,
  queue: ListChecks,
};

const ORDER = ["db", "smtp", "ai", "dataforseo", "agents", "queue"];
const LABELS: Record<string, string> = {
  db: "Database",
  smtp: "Email",
  ai: "AI providers",
  dataforseo: "DataForSEO",
  agents: "Local agents",
  queue: "Job queue",
};

const TONE: Record<Check["status"], { dot: string; ring: string; text: string; label: string }> = {
  ok: { dot: "bg-success", ring: "ring-success/25", text: "text-success", label: "Healthy" },
  warning: { dot: "bg-warning", ring: "ring-warning/30", text: "text-warning", label: "Attention" },
  error: { dot: "bg-destructive", ring: "ring-destructive/25", text: "text-destructive", label: "Problem" },
  off: { dot: "bg-muted-foreground/40", ring: "ring-border", text: "text-muted-foreground", label: "Off" },
};

export function HealthGrid() {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  const apply = useCallback((res: Awaited<ReturnType<typeof runHealthChecksAction>>) => {
    if (res.ok) {
      setChecks(res.data);
      setError(null);
    } else setError(res.error);
    setBusy(false);
  }, []);

  const recheck = async () => {
    setBusy(true);
    apply(await runHealthChecksAction(true));
  };

  useEffect(() => {
    let alive = true;
    runHealthChecksAction(false).then((res) => alive && apply(res));
    return () => {
      alive = false;
    };
  }, [apply]);

  const byKey = new Map((checks ?? []).map((c) => [c.key, c]));
  const problems = (checks ?? []).filter((c) => c.status === "error").length;

  return (
    <Panel
      title="System health"
      description={
        checks
          ? problems
            ? `${problems} problem${problems > 1 ? "s" : ""} need${problems > 1 ? "" : "s"} attention`
            : "All core services respond"
          : "Checking services…"
      }
      actions={
        <Button variant="ghost" size="sm" className="h-7" onClick={recheck} disabled={busy}>
          <RefreshCw className={cn("size-3.5", busy && "animate-spin")} /> Re-check
        </Button>
      }
      contentClassName="p-3 sm:p-3"
    >
      {error && <p className="px-2 pb-2 text-xs text-destructive">{error}</p>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {ORDER.map((key, i) => {
          const c = byKey.get(key);
          const Icon = ICONS[key]!;
          if (!c) {
            return (
              <div key={key} className="flex items-center gap-3 rounded-xl border bg-background/50 p-3">
                <Icon className="size-4 text-muted-foreground" />
                <div className="flex-1 space-y-1.5">
                  <div className="text-sm font-medium">{LABELS[key]}</div>
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            );
          }
          const tone = TONE[c.status];
          return (
            <motion.div key={key} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
              <Link
                href={c.href}
                className="group flex items-start gap-3 rounded-xl border bg-background/50 p-3 transition-colors hover:bg-muted/40"
              >
                <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-card ring-1", tone.ring)}>
                  <Icon className={cn("size-4", tone.text)} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {c.label}
                    <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium", tone.text)}>
                      <span className={cn("size-1.5 rounded-full", tone.dot, c.status === "ok" && "animate-pulse")} />
                      {tone.label}
                    </span>
                  </span>
                  <span className="block truncate text-xs text-foreground/80">{c.summary}</span>
                  {c.detail && <span className="block truncate text-[11px] text-muted-foreground">{c.detail}</span>}
                </span>
              </Link>
            </motion.div>
          );
        })}
      </div>
    </Panel>
  );
}
