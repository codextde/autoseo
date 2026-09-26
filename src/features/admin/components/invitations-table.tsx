"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Link2, MailPlus, MoreHorizontal, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DataTable, type Column } from "@/components/app/data-table";
import { FilterBar, SearchInput } from "@/components/app/filters";
import { CopyButton, StatusBadge, TimeAgo } from "@/components/app/misc";
import { EmptyState } from "@/components/app/empty-state";
import { useUrlState } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import { InviteDialog, type InviteContext } from "./invite-dialog";
import { regenerateInvitationLinkAction, resendInvitationAction, revokeInvitationAction } from "../actions/invitations";

export type InvitationItem = {
  id: string;
  email: string;
  workspaceId: string;
  workspaceName: string;
  roleKey: string;
  projectIds: string[];
  makeInstanceAdmin: boolean;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  lastSentAt: string | null;
  acceptedAt: string | null;
  createdAt: string;
  invitedByEmail: string | null;
};

const TABS = ["pending", "accepted", "expired", "revoked", "all"] as const;

function InviteStatus({ status }: { status: InvitationItem["status"] }) {
  const tone = status === "expired" ? "warning" : status === "accepted" ? "success" : status;
  return <StatusBadge status={tone} label={status[0]!.toUpperCase() + status.slice(1)} />;
}

export function InvitationsTable({ items, context }: { items: InvitationItem[]; context: InviteContext }) {
  const router = useRouter();
  const [status, setStatus] = useUrlState("status", "pending");
  const [q, setQ] = useUrlState("q", "");
  const [newParam, setNewParam] = useUrlState("new", "");
  const [inviteOpen, setInviteOpen] = useState(() => newParam === "1");
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    // `?new=1` (e.g. from "Invite people" buttons) opens the dialog once; drop it from the URL.
    if (newParam === "1") setNewParam(null);
  }, [newParam, setNewParam]);

  const roleName = (key: string) => context.roles.find((r) => r.key === key)?.name ?? key;
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const i of items) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((i) => (status === "all" || i.status === status) && (!needle || i.email.includes(needle)));
  }, [items, status, q]);

  const act = async (key: string, fn: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>, msg: string) => {
    setBusy(key);
    try {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error);
      toast.success(msg);
      router.refresh();
      return res.data;
    } finally {
      setBusy(null);
    }
  };

  const actions = (i: InvitationItem) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Invitation actions" onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem
          disabled={i.status === "accepted" || i.status === "revoked" || busy === i.id}
          onSelect={() => act(i.id, () => resendInvitationAction(i.id), `Invitation resent to ${i.email}`)}
        >
          <Send /> Resend email
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={i.status === "accepted" || i.status === "revoked" || busy === i.id}
          onSelect={async () => {
            const data = (await act(i.id, () => regenerateInvitationLinkAction(i.id), "New link generated")) as { url: string } | undefined;
            if (data?.url) setLink({ email: i.email, url: data.url });
          }}
        >
          <Link2 /> Copy invite link
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={i.status !== "pending" || busy === i.id}
          onSelect={() => act(i.id, () => revokeInvitationAction(i.id), "Invitation revoked")}
        >
          <Ban /> Revoke
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const columns: Column<InvitationItem>[] = [
    {
      id: "email",
      header: "Email",
      sortValue: (i) => i.email,
      cell: (i) => (
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{i.email}</span>
          {i.makeInstanceAdmin && (
            <Badge variant="secondary" className="h-5 gap-1 px-1.5 text-[10px]">
              <ShieldCheck className="size-3" /> Admin
            </Badge>
          )}
        </div>
      ),
    },
    {
      id: "workspace",
      header: "Workspace · role",
      hideBelow: "md",
      sortValue: (i) => i.workspaceName,
      cell: (i) => (
        <span className="text-sm">
          {i.workspaceName} <span className="text-muted-foreground">· {roleName(i.roleKey)}</span>
          {i.projectIds.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {" "}
              · {i.projectIds.length} project{i.projectIds.length > 1 ? "s" : ""}
            </span>
          )}
        </span>
      ),
    },
    { id: "status", header: "Status", sortValue: (i) => i.status, cell: (i) => <InviteStatus status={i.status} /> },
    {
      id: "sent",
      header: "Sent",
      hideBelow: "lg",
      sortValue: (i) => new Date(i.lastSentAt ?? i.createdAt).getTime(),
      cell: (i) => (
        <span className="text-xs">
          <TimeAgo date={i.lastSentAt ?? i.createdAt} />
          {i.invitedByEmail && <span className="block truncate text-muted-foreground">by {i.invitedByEmail}</span>}
        </span>
      ),
    },
    {
      id: "expires",
      header: "Expires",
      hideBelow: "sm",
      sortValue: (i) => new Date(i.expiresAt).getTime(),
      cell: (i) =>
        i.status === "accepted" ? (
          <span className="text-xs text-muted-foreground">Accepted <TimeAgo date={i.acceptedAt} /></span>
        ) : (
          <TimeAgo date={i.expiresAt} className={cn("text-xs", i.status === "expired" && "text-muted-foreground")} />
        ),
    },
    { id: "actions", header: "", align: "right", width: "48px", cell: (i) => actions(i) },
  ];

  return (
    <div className="space-y-3">
      <div className="scrollbar-none -mx-1 flex gap-1 overflow-x-auto px-1">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setStatus(t)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-colors",
              status === t ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {t}
            <span className={cn("tabular", status === t ? "text-background/70" : "text-muted-foreground/70")}>{counts[t] ?? 0}</span>
          </button>
        ))}
      </div>
      <FilterBar
        search={<SearchInput value={q} onChange={(v) => setQ(v || null)} placeholder="Search email…" />}
        right={
          <Button size="sm" className="h-8 gap-1.5" onClick={() => setInviteOpen(true)}>
            <MailPlus className="size-3.5" /> Invite
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={filtered}
        getRowId={(i) => i.id}
        initialSort={{ id: "sent", dir: "desc" }}
        empty={
          <EmptyState
            compact
            icon={MailPlus}
            title={status === "pending" ? "No pending invitations" : "Nothing here"}
            description="Invited people show up here until they accept."
            action={{ label: "Invite people", onClick: () => setInviteOpen(true) }}
          />
        }
        mobileCard={(i) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-medium">{i.email}</span>
              <div className="flex shrink-0 items-center gap-1">
                <InviteStatus status={i.status} />
                {actions(i)}
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {i.workspaceName} · {roleName(i.roleKey)} · sent <TimeAgo date={i.lastSentAt ?? i.createdAt} />
            </div>
          </div>
        )}
      />
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} context={context} />
      <Dialog open={!!link} onOpenChange={(o) => !o && setLink(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="size-4" /> New invitation link
            </DialogTitle>
            <DialogDescription>
              Share this link with {link?.email}. Previous links for this invitation no longer work. Anyone with the link can accept
              the invitation — send it privately.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={link?.url ?? ""} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            {link && <CopyButton value={link.url} />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
