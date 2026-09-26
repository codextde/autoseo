"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, Loader2, Plug, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUrlState } from "@/hooks/use-url-state";
import type { ConnectedIntegration } from "@/server/optimize/integrations/types";
import { pushTasksAction } from "../actions";
import { ProviderGlyph } from "./provider-glyph";
import { openExternal, safeHttpUrl } from "@/features/optimize/shared/safe-url";

function shortName(name: string) {
  return name.replace(/ \(.*\)$/, "");
}

export function PushToPmButton({
  projectId,
  taskIds,
  connected,
  canEdit,
  size = "sm",
  label,
  onDone,
}: {
  projectId: string;
  taskIds: string[];
  connected: ConnectedIntegration[];
  canEdit: boolean;
  size?: "sm" | "default";
  label?: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [, setConnect] = useUrlState("connect", "");
  const [pending, start] = useTransition();
  const pm = connected.filter((c) => c.kind === "pm" && c.status !== "disconnected");
  const ready = pm.filter((c) => c.status === "connected" || c.status === "error");
  const needsTarget = pm.filter((c) => c.status === "pending");
  const disabled = !canEdit || taskIds.length === 0 || pending;

  const push = (item: ConnectedIntegration) =>
    start(async () => {
      const res = await pushTasksAction({ projectId, provider: item.provider, taskIds });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const name = shortName(item.name);
      if (res.data.mode === "queued") {
        toast.success(`Queued ${res.data.count} tasks for ${name}`, { description: "They'll appear in your tool within a minute." });
      } else {
        const ok = res.data.results.filter((r) => r.ok);
        const failed = res.data.results.filter((r) => !r.ok);
        const single = ok.length === 1 ? safeHttpUrl(ok[0]?.url) : null;
        if (ok.length)
          toast.success(item.provider === "webhook" ? `Sent ${ok.length} task${ok.length === 1 ? "" : "s"} to the webhook` : `Pushed ${ok.length} task${ok.length === 1 ? "" : "s"} to ${name}`, {
            action: single ? { label: "Open", onClick: () => openExternal(single) } : undefined,
          });
        if (failed.length) toast.error(`${failed.length} task${failed.length === 1 ? "" : "s"} failed`, { description: failed[0]?.error });
      }
      router.refresh();
      onDone?.();
    });

  if (!pm.length) {
    return (
      <Button variant="outline" size={size} disabled={!canEdit} onClick={() => setConnect("pm")}>
        <Plug /> Connect PM tool
      </Button>
    );
  }

  if (ready.length === 1 && !needsTarget.length) {
    const item = ready[0]!;
    return (
      <Button variant="outline" size={size} disabled={disabled} onClick={() => push(item)}>
        {pending ? <Loader2 className="animate-spin" /> : <ProviderGlyph provider={item.provider} size="xs" />}
        {label ?? (item.provider === "webhook" ? "Send to webhook" : `Push to ${shortName(item.name)}`)}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size} disabled={disabled}>
          {pending ? <Loader2 className="animate-spin" /> : <Send />}
          {label ?? "Push to…"}
          <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {taskIds.length} task{taskIds.length === 1 ? "" : "s"}
        </DropdownMenuLabel>
        {ready.map((item) => (
          <DropdownMenuItem key={item.provider} onSelect={() => push(item)} className="gap-2">
            <ProviderGlyph provider={item.provider} size="xs" />
            <span className="min-w-0 flex-1 truncate">
              {item.provider === "webhook" ? "Webhook" : shortName(item.name)}
              {item.target && <span className="text-muted-foreground"> · {item.target.name}</span>}
            </span>
          </DropdownMenuItem>
        ))}
        {needsTarget.map((item) => (
          <DropdownMenuItem key={item.provider} onSelect={() => setConnect(item.provider)} className="gap-2 text-muted-foreground">
            <ProviderGlyph provider={item.provider} size="xs" className="opacity-60" />
            <span className="min-w-0 flex-1 truncate">{shortName(item.name)} — finish setup</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setConnect("pm")} className="gap-2 text-xs">
          <Plug className="size-3.5" /> Manage PM tools
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
