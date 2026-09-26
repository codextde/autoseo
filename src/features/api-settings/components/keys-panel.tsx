"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { KeyRound, Lock, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Panel } from "@/components/app/page";
import { DataTable, type Column } from "@/components/app/data-table";
import { ConfirmButton, TimeAgo } from "@/components/app/misc";
import { EmptyState } from "@/components/app/empty-state";
import { formatNumber } from "@/components/app/metrics";
import { revokeApiKeyAction } from "../actions";
import type { ApiKeyView } from "../types";
import type { ApiScope } from "../scopes";
import type { PickerProject } from "./access-picker";
import { CreateKeyDialog } from "./create-key-dialog";

export function ScopeChips({ scopes }: { scopes: ApiScope[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {scopes.map((s) => (
        <Badge key={s} variant="secondary" className="h-5 px-1.5 font-mono text-[10px] font-medium">
          {s}
        </Badge>
      ))}
    </span>
  );
}

export function ProjectScope({ ids, names }: { ids: string[] | null; names: string[] }) {
  if (!ids) return <span className="text-sm">All projects</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default text-sm underline decoration-dotted underline-offset-4">
          {ids.length === 1 ? names[0] : `${ids.length} projects`}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{names.join(", ")}</TooltipContent>
    </Tooltip>
  );
}

export function KeysPanel({
  keys,
  canManage,
  workspaceId,
  projects,
  restUrl,
  mcpUrl,
}: {
  keys: ApiKeyView[];
  canManage: boolean;
  workspaceId: string;
  projects: PickerProject[];
  restUrl: string;
  mcpUrl: string;
}) {
  const router = useRouter();
  const [, start] = useTransition();

  const revoke = async (k: ApiKeyView) => {
    const res = await revokeApiKeyAction({ workspaceId, keyId: k.id });
    if (!res.ok) return void toast.error(res.error);
    toast.success(`Revoked “${k.name}”`);
    start(() => router.refresh());
  };

  const RevokeButton = ({ k }: { k: ApiKeyView }) => (
    <ConfirmButton
      title={`Revoke “${k.name}”?`}
      description="Clients using this key will stop working immediately. This cannot be undone."
      confirmLabel="Revoke key"
      destructive
      onConfirm={() => revoke(k)}
    >
      <Button variant="ghost" size="icon-sm" aria-label={`Revoke ${k.name}`} className="text-muted-foreground hover:text-destructive">
        <Trash2 className="size-3.5" />
      </Button>
    </ConfirmButton>
  );

  const columns: Column<ApiKeyView>[] = [
    {
      id: "name",
      header: "Name",
      sortValue: (k) => k.name.toLowerCase(),
      cell: (k) => (
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{k.name}</span>
          <Badge className="h-5 border-success/25 bg-success/12 px-1.5 text-[10px] text-success">live</Badge>
        </div>
      ),
    },
    { id: "prefix", header: "Key", cell: (k) => <code className="font-mono text-xs text-muted-foreground">{k.prefix}…</code> },
    { id: "scopes", header: "Scopes", cell: (k) => <ScopeChips scopes={k.scopes} /> },
    { id: "projects", header: "Projects", hideBelow: "md", cell: (k) => <ProjectScope ids={k.projectIds} names={k.projectNames} /> },
    {
      id: "created",
      header: "Created",
      hideBelow: "lg",
      sortValue: (k) => k.createdAt,
      cell: (k) => (
        <div className="text-sm">
          <div className="tabular">{format(new Date(k.createdAt), "MMM d, yyyy")}</div>
          <div className="max-w-40 truncate text-[11px] text-muted-foreground">{k.createdBy.name ?? k.createdBy.email}</div>
        </div>
      ),
    },
    { id: "lastUsed", header: "Last used", hideBelow: "md", sortValue: (k) => k.lastUsedAt ?? "", cell: (k) => <TimeAgo date={k.lastUsedAt} className="text-sm" /> },
    { id: "requests", header: "Requests", align: "right", sortValue: (k) => k.requestCount, cell: (k) => <span className="tabular">{formatNumber(k.requestCount)}</span> },
    ...(canManage ? [{ id: "actions", header: "", align: "right" as const, width: "48px", cell: (k: ApiKeyView) => <RevokeButton k={k} /> }] : []),
  ];

  return (
    <Panel
      title="API Keys"
      icon={<KeyRound className="size-4 text-brand" />}
      description="Manage keys for the REST API and bearer-token MCP clients. Keys are shown once and stored hashed."
      actions={canManage ? <CreateKeyDialog workspaceId={workspaceId} projects={projects} restUrl={restUrl} mcpUrl={mcpUrl} /> : undefined}
    >
      {!canManage ? (
        <EmptyState
          icon={Lock}
          compact
          title="Only workspace admins can manage API keys"
          description="Ask an owner or admin to create a key for you — or connect Claude / ChatGPT via OAuth below, which uses your own access."
        />
      ) : (
        <DataTable
          columns={columns}
          data={keys}
          getRowId={(k) => k.id}
          paginate={keys.length > 20}
          pageSize={20}
          initialSort={{ id: "created", dir: "desc" }}
          empty={
            <EmptyState
              icon={KeyRound}
              compact
              title="No API keys yet"
              description="Create a key to use the REST API or connect Cursor, VS Code or Codex to the MCP server."
              action={<CreateKeyDialog workspaceId={workspaceId} projects={projects} restUrl={restUrl} mcpUrl={mcpUrl} />}
            />
          }
          mobileCard={(k) => (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{k.name}</span>
                    <Badge className="h-5 border-success/25 bg-success/12 px-1.5 text-[10px] text-success">live</Badge>
                  </div>
                  <code className="font-mono text-xs text-muted-foreground">{k.prefix}…</code>
                </div>
                <RevokeButton k={k} />
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <ScopeChips scopes={k.scopes} />
                <ProjectScope ids={k.projectIds} names={k.projectNames} />
                <span className="tabular">{formatNumber(k.requestCount)} requests</span>
                <span>
                  Last used <TimeAgo date={k.lastUsedAt} />
                </span>
              </div>
            </div>
          )}
        />
      )}
    </Panel>
  );
}
