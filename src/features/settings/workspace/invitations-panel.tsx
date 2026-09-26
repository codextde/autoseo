"use client";

import { useState } from "react";
import { Link2, Loader2, MailCheck, MoreHorizontal, RefreshCcw, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Panel } from "@/components/app/page";
import { DataTable, type Column } from "@/components/app/data-table";
import { CopyButton, StatusBadge, TimeAgo } from "@/components/app/misc";
import { invitationLinkAction, resendInvitationAction, revokeInvitationAction } from "../actions";
import type { WorkspaceView } from "./queries";

type Invite = WorkspaceView["invitations"][number];

export function InvitationsPanel({
  view,
  workspaceId,
  canManage,
  canCopyLinks = false,
}: {
  view: WorkspaceView;
  workspaceId: string;
  canManage: boolean;
  /** Only instance admins may copy accept links (a link signs in whoever opens it). */
  canCopyLinks?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const roleName = (key: string) => view.roles.find((r) => r.key === key)?.name ?? key;

  async function run(id: string, fn: () => Promise<void>) {
    setBusy(id);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  }

  const menu = (inv: Invite) =>
    canManage ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label="Invitation actions" disabled={busy === inv.id}>
            {busy === inv.id ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem
            onSelect={() =>
              run(inv.id, async () => {
                const res = await resendInvitationAction({ workspaceId, invitationId: inv.id });
                if (!res.ok) return void toast.error(res.error);
                toast.success(
                  res.data.transport === "log"
                    ? "New link created — SMTP isn't configured, copy the link instead."
                    : res.data.delivered
                      ? `Invitation re-sent to ${inv.email}`
                      : "Sending failed — check Admin → Email.",
                );
              })
            }
          >
            {inv.status === "expired" ? <RefreshCcw /> : <Send />} {inv.status === "expired" ? "Renew & resend" : "Resend email"}
          </DropdownMenuItem>
          {canCopyLinks && (
            <DropdownMenuItem
              onSelect={() =>
                run(inv.id, async () => {
                  const res = await invitationLinkAction({ workspaceId, invitationId: inv.id });
                  if (!res.ok) return void toast.error(res.error);
                  setLink({ email: inv.email, url: res.data.url });
                })
              }
            >
              <Link2 /> Copy invite link
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {inv.status === "pending" && (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() =>
                run(inv.id, async () => {
                  const res = await revokeInvitationAction({ workspaceId, invitationId: inv.id });
                  if (!res.ok) return void toast.error(res.error);
                  toast.success("Invitation revoked");
                })
              }
            >
              <XCircle /> Revoke invitation
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  const columns: Column<Invite>[] = [
    {
      id: "email",
      header: "Email",
      sortValue: (i) => i.email,
      cell: (i) => (
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{i.email}</div>
          {i.invitedByEmail && <div className="truncate text-xs text-muted-foreground">Invited by {i.invitedByEmail}</div>}
        </div>
      ),
    },
    {
      id: "role",
      header: "Role",
      cell: (i) => (
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant="secondary">{roleName(i.roleKey)}</Badge>
          {i.projectIds.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {i.projectIds.length} {i.projectIds.length === 1 ? "project" : "projects"}
            </span>
          )}
        </div>
      ),
    },
    { id: "status", header: "Status", cell: (i) => <StatusBadge status={i.status} /> },
    {
      id: "sent",
      header: "Last sent",
      hideBelow: "md",
      sortValue: (i) => +new Date(i.lastSentAt ?? i.createdAt),
      cell: (i) => <TimeAgo date={i.lastSentAt ?? i.createdAt} className="text-sm text-muted-foreground" />,
    },
    {
      id: "expires",
      header: "Expires",
      hideBelow: "lg",
      cell: (i) => <TimeAgo date={i.expiresAt} className="text-sm text-muted-foreground" />,
    },
    { id: "actions", header: "", align: "right", width: "48px", cell: menu },
  ];

  return (
    <Panel
      title="Pending invitations"
      icon={<MailCheck className="size-4 text-muted-foreground" />}
      description="Invitations that haven't been accepted yet. Links expire automatically."
    >
      <DataTable
        columns={columns}
        data={view.invitations}
        getRowId={(i) => i.id}
        pageSize={10}
        empty={<div className="py-8 text-center text-sm text-muted-foreground">No pending invitations.</div>}
        mobileCard={(i) => (
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1.5">
              <div className="truncate text-sm font-medium">{i.email}</div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <Badge variant="secondary">{roleName(i.roleKey)}</Badge>
                <StatusBadge status={i.status} />
                <span>
                  sent <TimeAgo date={i.lastSentAt ?? i.createdAt} />
                </span>
              </div>
            </div>
            {menu(i)}
          </div>
        )}
      />

      <Dialog open={!!link} onOpenChange={(v) => !v && setLink(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invitation link</DialogTitle>
            <DialogDescription>
              Share this link with {link?.email} only — it signs them in directly. Previous links for this invitation no
              longer work.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={link?.url ?? ""} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            {link && <CopyButton value={link.url} />}
          </div>
          <DialogFooter>
            <Button onClick={() => setLink(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
