"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Link2, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/app/page";
import { DataTable, type Column } from "@/components/app/data-table";
import { ConfirmButton, TimeAgo } from "@/components/app/misc";
import { EmptyState } from "@/components/app/empty-state";
import { formatNumber } from "@/components/app/metrics";
import { revokeOAuthGrantAction } from "../actions";
import type { OAuthGrantView } from "../types";
import { ProjectScope, ScopeChips } from "./keys-panel";

export function ConnectedAppsPanel({
  grants,
  workspaceId,
  showUser,
  currentUserId,
  canManage,
}: {
  grants: OAuthGrantView[];
  workspaceId: string;
  showUser: boolean;
  currentUserId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [, start] = useTransition();

  const revoke = async (g: OAuthGrantView) => {
    const res = await revokeOAuthGrantAction({ workspaceId, grantId: g.id });
    if (!res.ok) return void toast.error(res.error);
    toast.success(`Disconnected ${g.clientName}`);
    start(() => router.refresh());
  };

  const Disconnect = ({ g }: { g: OAuthGrantView }) =>
    canManage || g.user.id === currentUserId ? (
      <ConfirmButton
        title={`Disconnect ${g.clientName}?`}
        description="All access and refresh tokens of this app are revoked immediately. The app has to be re-authorized to connect again."
        confirmLabel="Disconnect"
        destructive
        onConfirm={() => revoke(g)}
      >
        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
          <Unplug className="size-3.5" /> Disconnect
        </Button>
      </ConfirmButton>
    ) : null;

  const columns: Column<OAuthGrantView>[] = [
    {
      id: "app",
      header: "App",
      sortValue: (g) => g.clientName.toLowerCase(),
      cell: (g) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{g.clientName}</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">{g.redirectHosts.join(", ")}</div>
        </div>
      ),
    },
    ...(showUser
      ? [{ id: "user", header: "User", hideBelow: "md" as const, cell: (g: OAuthGrantView) => <span className="text-sm">{g.user.name ?? g.user.email}</span> }]
      : []),
    { id: "scopes", header: "Scopes", cell: (g) => <ScopeChips scopes={g.scopes} /> },
    { id: "projects", header: "Projects", hideBelow: "md", cell: (g) => <ProjectScope ids={g.projectIds} names={g.projectNames} /> },
    { id: "connected", header: "Connected", hideBelow: "lg", sortValue: (g) => g.createdAt, cell: (g) => <span className="text-sm tabular">{format(new Date(g.createdAt), "MMM d, yyyy")}</span> },
    { id: "lastUsed", header: "Last used", hideBelow: "md", sortValue: (g) => g.lastUsedAt ?? "", cell: (g) => <TimeAgo date={g.lastUsedAt} className="text-sm" /> },
    { id: "requests", header: "Requests", align: "right", sortValue: (g) => g.requestCount, cell: (g) => <span className="tabular">{formatNumber(g.requestCount)}</span> },
    { id: "actions", header: "", align: "right", cell: (g) => <Disconnect g={g} /> },
  ];

  return (
    <Panel
      title="Connected apps"
      icon={<Link2 className="size-4 text-brand" />}
      description="AI assistants and tools authorized via OAuth (Claude, ChatGPT, Claude Code…). Access tokens expire after 1 hour and refresh automatically."
    >
      <DataTable
        columns={columns}
        data={grants}
        getRowId={(g) => g.id}
        paginate={grants.length > 20}
        pageSize={20}
        empty={
          <EmptyState
            icon={Link2}
            compact
            title="No connected apps"
            description="Add the MCP server URL as a custom connector in Claude or ChatGPT — you'll approve access here and the app shows up in this list."
          />
        }
        mobileCard={(g) => (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium">{g.clientName}</div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">{g.redirectHosts.join(", ")}</div>
              </div>
              <Disconnect g={g} />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <ScopeChips scopes={g.scopes} />
              <ProjectScope ids={g.projectIds} names={g.projectNames} />
              {showUser && <span>{g.user.name ?? g.user.email}</span>}
              <span className="tabular">{formatNumber(g.requestCount)} requests</span>
            </div>
          </div>
        )}
      />
    </Panel>
  );
}
