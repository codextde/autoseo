"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { PROVISION_STEPS, type InstanceView } from "@/server/instance-view";

const HINTS = [
  "Confirming your payment with Stripe.",
  "Creating your private server resources and database.",
  "Pulling the latest AutoSEO release and starting it. This usually takes 1–3 minutes.",
  "Almost there.",
];

/** Step progress while an instance is set up; polls /api/instance/status every 5 s. */
export function ProvisioningProgress({
  initial,
  waitWhile = ["provisioning"],
}: {
  initial: InstanceView;
  /** Keep polling while the status is one of these; refresh the page once it changes. */
  waitWhile?: InstanceView["status"][];
}) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const waitKey = waitWhile.join(",");

  useEffect(() => {
    const waiting = waitKey.split(",");
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/instance/status", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { instance: InstanceView | null };
        if (stopped || !data.instance) return;
        setView(data.instance);
        if (!waiting.includes(data.instance.status)) {
          stopped = true;
          clearInterval(timer);
          router.refresh();
        }
      } catch {
        // transient network error — next tick retries
      }
    }, 5_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [router, waitKey]);

  return (
    <div className="space-y-6">
      <ol className="grid gap-3 sm:grid-cols-4">
        {PROVISION_STEPS.map((label, i) => {
          const done = i < view.step;
          const active = i === view.step;
          return (
            <li
              key={label}
              className={cn(
                "flex items-center gap-3 rounded-xl border p-3 transition-colors sm:flex-col sm:items-start",
                done && "border-brand/30 bg-brand-soft/60 dark:bg-brand/10",
                active && "border-foreground/20 bg-card shadow-sm",
                !done && !active && "text-muted-foreground",
              )}
              aria-current={active ? "step" : undefined}
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                  done && "border-transparent bg-brand text-brand-foreground",
                  active && "border-foreground/20",
                )}
              >
                {done ? <Check className="size-4" /> : active ? <Spinner className="size-4" /> : i + 1}
              </span>
              <span className="text-sm font-medium">{label}</span>
            </li>
          );
        })}
      </ol>
      <p className="flex items-start gap-2 text-sm text-muted-foreground" aria-live="polite">
        <Clock className="mt-0.5 size-4 shrink-0" />
        {view.retrying
          ? "We hit a temporary problem and are retrying automatically. No action needed — we'll email you when it's ready."
          : `${HINTS[Math.min(view.step, HINTS.length - 1)]} We'll also email you when it's ready — you can close this page.`}
      </p>
    </div>
  );
}
