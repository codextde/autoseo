"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { flagEmoji, getCountry } from "@/lib/countries";
import { cn } from "@/lib/utils";

export function CountryFlag({ iso, withName, className }: { iso: string | null | undefined; withName?: boolean; className?: string }) {
  const c = getCountry(iso ?? "");
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} title={c?.name ?? iso ?? ""}>
      <span className="text-[15px] leading-none">{flagEmoji(iso)}</span>
      {withName && <span className="truncate">{c?.name ?? iso}</span>}
    </span>
  );
}

export function CopyButton({ value, label, className, size = "sm" }: { value: string; label?: string; className?: string; size?: "sm" | "icon" }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  if (size === "icon")
    return (
      <Button type="button" variant="ghost" size="icon" className={cn("size-7", className)} onClick={onCopy} aria-label="Copy">
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      </Button>
    );
  return (
    <Button type="button" variant="outline" size="sm" className={cn("gap-1.5", className)} onClick={onCopy}>
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      {label ?? (copied ? "Copied" : "Copy")}
    </Button>
  );
}

export function ConfirmButton({
  children,
  title,
  description,
  confirmLabel = "Confirm",
  destructive,
  onConfirm,
  asChild = true,
}: {
  children: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  asChild?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild={asChild}>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            className={destructive ? "bg-destructive text-white hover:bg-destructive/90" : undefined}
            onClick={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await onConfirm();
                setOpen(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const statusTone: Record<string, string> = {
  success: "bg-success/12 text-success ring-success/25",
  active: "bg-success/12 text-success ring-success/25",
  online: "bg-success/12 text-success ring-success/25",
  succeeded: "bg-success/12 text-success ring-success/25",
  published: "bg-success/12 text-success ring-success/25",
  completed: "bg-success/12 text-success ring-success/25",
  running: "bg-info/12 text-info ring-info/25",
  queued: "bg-muted text-muted-foreground ring-border",
  pending: "bg-warning/15 text-warning ring-warning/30",
  draft: "bg-muted text-muted-foreground ring-border",
  warning: "bg-warning/15 text-warning ring-warning/30",
  failed: "bg-destructive/10 text-destructive ring-destructive/25",
  error: "bg-destructive/10 text-destructive ring-destructive/25",
  offline: "bg-muted text-muted-foreground ring-border",
  cancelled: "bg-muted text-muted-foreground ring-border",
  revoked: "bg-muted text-muted-foreground ring-border",
  disabled: "bg-muted text-muted-foreground ring-border",
};

export function StatusBadge({ status, label, className, dot = true }: { status: string; label?: string; className?: string; dot?: boolean }) {
  const tone = statusTone[status.toLowerCase()] ?? "bg-muted text-muted-foreground ring-border";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tone, className)}>
      {dot && (
        <span className={cn("size-1.5 rounded-full bg-current", ["running", "online"].includes(status.toLowerCase()) && "animate-pulse")} />
      )}
      {label ?? status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export function TimeAgo({ date, className }: { date: Date | string | null | undefined; className?: string }) {
  if (!date) return <span className={cn("text-muted-foreground", className)}>—</span>;
  const d = typeof date === "string" ? new Date(date) : date;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Relative text legitimately differs between server render and hydration ("20s" vs "21s"). */}
        <time dateTime={d.toISOString()} className={cn("whitespace-nowrap", className)} suppressHydrationWarning>
          {formatDistanceToNowStrict(d, { addSuffix: true })}
        </time>
      </TooltipTrigger>
      <TooltipContent>{d.toLocaleString()}</TooltipContent>
    </Tooltip>
  );
}

export function TagChip({ name, color, className }: { name: string; color?: string | null; className?: string }) {
  return (
    <Badge variant="outline" className={cn("h-5 max-w-36 gap-1 truncate px-1.5 text-[11px] font-normal", className)}>
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: color ?? "var(--chart-3)" }} />
      <span className="truncate">{name}</span>
    </Badge>
  );
}
