"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plug, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PeriodSelect } from "@/components/app/filters";
import { useUrlPatch } from "@/hooks/use-url-state";
import { useCan } from "@/components/app/shell-context";
import { EmptyState } from "@/components/app/empty-state";
import { TimeAgo } from "@/components/app/misc";
import { syncIntegrationAction } from "@/features/integrations/actions";
import { cn } from "@/lib/utils";

/** 7d / 30d / 90d + custom range, stored in `?period=&from=&to=`. */
export function PeriodFilter({
  preset,
  from,
  to,
  className,
  presets,
}: {
  preset: string;
  from?: string;
  to?: string;
  className?: string;
  presets?: { key: string; label: string }[];
}) {
  const [patch] = useUrlPatch();
  return (
    <PeriodSelect
      value={preset}
      from={preset === "custom" ? from : undefined}
      to={preset === "custom" ? to : undefined}
      presets={presets}
      onChange={(p) => patch({ period: p === "30d" ? null : p, from: null, to: null, page: null })}
      onCustom={(r) => patch({ period: "custom", from: r.from, to: r.to, page: null })}
      className={className}
    />
  );
}

/** "Refresh" button that enqueues a sync of the given integration (settings.manage only). */
export function SyncButton({
  projectId,
  provider,
  lastSyncAt,
  className,
  label = "Refresh",
}: {
  projectId: string;
  provider: string;
  lastSyncAt?: string | null;
  className?: string;
  label?: string;
}) {
  const can = useCan();
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!can("settings.manage")) {
    return lastSyncAt ? (
      <span className={cn("text-xs text-muted-foreground", className)}>
        Synced <TimeAgo date={lastSyncAt} />
      </span>
    ) : null;
  }
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn("h-8 gap-1.5 text-xs", className)}
      disabled={pending}
      title={lastSyncAt ? `Last synced ${new Date(lastSyncAt).toLocaleString()}` : undefined}
      onClick={() =>
        start(async () => {
          const res = await syncIntegrationAction(projectId, provider);
          if (res.ok) {
            toast.success(res.data.alreadyQueued ? "A sync is already running." : "Sync started — data refreshes in a moment.");
            setTimeout(() => router.refresh(), 4000);
          } else toast.error(res.error);
        })
      }
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
      {label}
    </Button>
  );
}

/** Empty state shown when the page's data source is not connected. */
export function ConnectPrompt({
  icon,
  title,
  description,
  href,
  actionLabel = "Connect",
  className,
}: {
  /** Rendered icon element (component functions can't be passed from server components). */
  icon?: React.ReactNode;
  title: string;
  description: React.ReactNode;
  href: string;
  actionLabel?: string;
  className?: string;
}) {
  const can = useCan();
  return (
    <div className={cn("rounded-2xl border border-dashed bg-card/60", className)}>
      <EmptyState
        title={
          <span className="flex flex-col items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl border bg-background text-muted-foreground shadow-xs [&_svg]:size-5">
              {icon ?? <Plug />}
            </span>
            {title}
          </span>
        }
        description={description}
        action={
          can("settings.manage") ? (
            <Button asChild>
              <Link href={href}>{actionLabel}</Link>
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Ask a workspace admin to connect it.</p>
          )
        }
      />
    </div>
  );
}
