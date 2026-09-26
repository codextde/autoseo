"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getRunStateAction, runCheckAction } from "../actions";

/** "Run check" — enqueues a fact-check run and polls until it finishes. */
export function RunCheckButton({
  projectId,
  assetId,
  initiallyActive,
  disabled,
  disabledReason,
  size = "sm",
  variant = "outline",
}: {
  projectId: string;
  assetId?: string;
  initiallyActive?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  size?: "sm" | "default";
  variant?: "outline" | "default";
}) {
  const router = useRouter();
  const [active, setActive] = useState(!!initiallyActive);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!active) return;
    timer.current = setInterval(async () => {
      const res = await getRunStateAction(projectId);
      if (res.ok && !res.data.active) {
        setActive(false);
        router.refresh();
        const stats = res.data.lastRun?.stats as { judged?: number; statementsNew?: number } | undefined;
        if (res.data.lastRun?.status === "failed") toast.error(`Check failed: ${res.data.lastRun.error ?? "unknown error"}`);
        else if (stats) toast.success(`Check finished — ${stats.statementsNew ?? 0} new statements, ${stats.judged ?? 0} judged.`);
      }
    }, 3000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [active, projectId, router]);

  const button = (
    <Button
      size={size}
      variant={variant}
      disabled={disabled || pending || active}
      onClick={() =>
        start(async () => {
          const res = await runCheckAction(projectId, assetId ?? null);
          if (!res.ok) return void toast.error(res.error);
          setActive(true);
          toast.message("Check queued", { description: "New AI answers are scanned and judged against the label." });
        })
      }
    >
      {active || pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
      {active ? "Checking…" : "Run check"}
    </Button>
  );
  if (disabled && disabledReason)
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}>{button}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">{disabledReason}</TooltipContent>
      </Tooltip>
    );
  return button;
}
