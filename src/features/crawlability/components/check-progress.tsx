"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Check, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Panel } from "@/components/app/page";
import { cn } from "@/lib/utils";

const STEPS = ["Resolving site", "Reading robots.txt", "Checking sitemaps & llms.txt", "Analyzing pages", "Testing AI crawler user agents", "Scoring"];

export function CheckProgress({ projectId, checkId, initial }: { projectId: string; checkId: string; initial: { step: string; done: number; total: number } | null }) {
  const router = useRouter();
  const [progress, setProgress] = useState(initial);
  const done = useRef(false);

  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const res = await fetch(`/p/${projectId}/crawlability/${checkId}/status`, { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { status: string; progress: typeof initial };
          if (!alive) return;
          setProgress(data.progress);
          if (!["queued", "running"].includes(data.status) && !done.current) {
            done.current = true;
            router.refresh();
            return;
          }
        }
      } catch {
        /* retry */
      }
      if (alive) t = setTimeout(tick, 1500);
    };
    t = setTimeout(tick, 1000);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [projectId, checkId, router]);

  const idx = progress ? Math.max(0, STEPS.indexOf(progress.step)) : 0;
  const pct = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 3;
  return (
    <Panel title="Checking AI crawler access…" icon={<Bot className="size-4 animate-pulse text-brand" />} description="This usually takes 20–60 seconds.">
      <Progress value={Math.max(pct, 4)} className="h-2 [&>div]:bg-brand" />
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {STEPS.map((s, i) => {
          const state = !progress ? (i === 0 ? "active" : "todo") : i < idx ? "done" : i === idx ? "active" : "todo";
          return (
            <li key={s} className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm", state === "active" ? "bg-brand-soft/60" : "bg-muted/40")}>
              {state === "done" ? <Check className="size-4 text-success" /> : state === "active" ? <Loader2 className="size-4 animate-spin text-brand" /> : <span className="size-4 rounded-full border" />}
              <span className={cn(state === "todo" && "text-muted-foreground")}>{s}</span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
