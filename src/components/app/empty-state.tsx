import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: { label: string; href?: string; onClick?: () => void } | React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  let actionNode: React.ReactNode = null;
  if (action && typeof action === "object" && "label" in (action as object)) {
    const a = action as { label: string; href?: string; onClick?: () => void };
    actionNode = a.href ? (
      <Button asChild size="sm" className="mt-4">
        <Link href={a.href}>{a.label}</Link>
      </Button>
    ) : (
      <Button size="sm" className="mt-4" onClick={a.onClick}>
        {a.label}
      </Button>
    );
  } else if (action) actionNode = <div className="mt-4">{action as React.ReactNode}</div>;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl text-center",
        compact ? "px-4 py-8" : "px-6 py-14",
        className,
      )}
    >
      {Icon && (
        <div className="mb-3 flex size-11 items-center justify-center rounded-xl border bg-background text-muted-foreground shadow-xs">
          <Icon className="size-5" />
        </div>
      )}
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-balance text-muted-foreground">{description}</p>}
      {actionNode}
    </div>
  );
}
