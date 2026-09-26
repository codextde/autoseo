"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { RefreshCw, ScrollText } from "lucide-react";
import { Panel } from "@/components/app/page";
import { DataTable, type Column } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { StatusBadge, TimeAgo } from "@/components/app/misc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUrlState } from "@/hooks/use-url-state";
import type { WebhookLogDTO } from "@/server/attribution/workflows";
import { providerName } from "./shared";

const STATUS: Record<string, { tone: string; label: string }> = {
  stored: { tone: "success", label: "stored" },
  stored_conversion: { tone: "success", label: "stored_conversion" },
  parse_failed: { tone: "warning", label: "parse_failed" },
  invalid_token: { tone: "error", label: "invalid_token" },
  error: { tone: "error", label: "error" },
  ignored: { tone: "disabled", label: "ignored" },
};

export function WebhookLogs({ projectId, logs }: { projectId: string; logs: WebhookLogDTO[] }) {
  const [status, setStatus] = useUrlState("status", "all");
  const router = useRouter();
  const [refreshing, start] = useTransition();
  const base = `/p/${projectId}/attribution`;

  const columns: Column<WebhookLogDTO>[] = [
    {
      id: "time",
      header: "Received",
      sortValue: (l) => l.createdAt,
      cell: (l) => (
        <span className="text-xs whitespace-nowrap text-muted-foreground">
          <TimeAgo date={l.createdAt} />
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (l) => <StatusBadge status={STATUS[l.status]?.tone ?? "queued"} label={STATUS[l.status]?.label ?? l.status} className="font-mono text-[11px]" />,
    },
    { id: "source", header: "Source", cell: (l) => <span className="text-sm">{l.provider ? providerName(l.provider) : "—"}</span> },
    {
      id: "message",
      header: "Details",
      cell: (l) => (
        <div className="max-w-[420px] min-w-0 space-y-1">
          {l.message && <p className="truncate text-xs" title={l.message}>{l.message}</p>}
          {l.payloadKeys.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {l.payloadKeys.slice(0, 6).map((k) => (
                <code key={k} className="rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">
                  {k}
                </code>
              ))}
              {l.payloadKeys.length > 6 && <span className="text-[10px] text-muted-foreground">+{l.payloadKeys.length - 6}</span>}
            </div>
          )}
        </div>
      ),
    },
    {
      id: "links",
      header: "Result",
      cell: (l) => (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {l.responseId && (
            <Link href={`${base}?view=all&r=${l.responseId}`} className="underline-offset-2 hover:underline">
              Response
            </Link>
          )}
          {l.conversionId && <Badge variant="outline" className="h-5 font-mono text-[10px]">conversion</Badge>}
          {l.workflowId && (
            <Link href={`${base}?tab=mapping&wf=${l.workflowId}`} className="underline-offset-2 hover:underline">
              Workflow
            </Link>
          )}
          {l.pending && <Badge variant="outline" className="h-5 text-[10px] text-warning">waiting for mapping</Badge>}
        </div>
      ),
    },
    { id: "size", header: "Size", align: "right", hideBelow: "lg", cell: (l) => <span className="text-xs text-muted-foreground tabular">{(l.payloadBytes / 1024).toFixed(1)} KB</span> },
  ];

  return (
    <Panel
      title="Webhook logs"
      description="Every delivery of the last 30 days. Payloads are never logged in clear text — only status, size and top-level keys."
      actions={
        <>
          <Select value={status} onValueChange={(v) => setStatus(v === "all" ? null : v)}>
            <SelectTrigger size="sm" className="h-8 min-w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {Object.keys(STATUS).map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => start(() => router.refresh())} disabled={refreshing}>
            <RefreshCw className={refreshing ? "size-3.5 animate-spin" : "size-3.5"} /> Refresh
          </Button>
        </>
      }
    >
      <DataTable
        columns={columns}
        data={logs}
        getRowId={(l) => l.id}
        pageSize={50}
        empty={<EmptyState compact icon={ScrollText} title="No deliveries yet" description="Webhook calls appear here with their status (stored, stored_conversion, parse_failed, invalid_token, error)." />}
        mobileCard={(l) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <StatusBadge status={STATUS[l.status]?.tone ?? "queued"} label={l.status} className="font-mono text-[11px]" />
              <span className="text-xs text-muted-foreground">
                <TimeAgo date={l.createdAt} />
              </span>
            </div>
            <div className="text-sm">{l.provider ? providerName(l.provider) : "Webhook"}</div>
            {l.message && <p className="text-xs break-words text-muted-foreground">{l.message}</p>}
          </div>
        )}
      />
    </Panel>
  );
}
