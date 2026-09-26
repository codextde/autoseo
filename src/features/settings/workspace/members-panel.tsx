"use client";

import { useMemo, useState } from "react";
import { FolderLock, Loader2, MoreHorizontal, UserMinus, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Panel } from "@/components/app/page";
import { DataTable, type Column } from "@/components/app/data-table";
import { SearchInput } from "@/components/app/filters";
import { StatusBadge, TimeAgo } from "@/components/app/misc";
import { initials } from "@/components/app/user-menu";
import { changeMemberRoleAction, removeMemberAction, setMemberProjectsAction } from "../actions";
import { InviteDialog } from "./invite-dialog";
import { ProjectPicker } from "./project-picker";
import type { WorkspaceView } from "./queries";

type Member = WorkspaceView["members"][number];

export function MembersPanel({
  view,
  workspace,
  canManage,
  currentUserId,
  assignable,
  pendingCount,
}: {
  view: WorkspaceView;
  workspace: { id: string; name: string };
  canManage: boolean;
  currentUserId: string;
  assignable: string[];
  pendingCount: number;
}) {
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [accessFor, setAccessFor] = useState<Member | null>(null);
  const [accessIds, setAccessIds] = useState<string[]>([]);
  const [removeFor, setRemoveFor] = useState<Member | null>(null);
  const [saving, setSaving] = useState(false);
  const roleByKey = useMemo(() => new Map(view.roles.map((r) => [r.key, r])), [view.roles]);

  const members = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s
      ? view.members.filter((m) => m.email.includes(s) || (m.name ?? "").toLowerCase().includes(s) || m.roleName.toLowerCase().includes(s))
      : view.members;
  }, [view.members, q]);
  const activeCount = view.members.filter((m) => m.status === "active").length;

  const canEdit = (m: Member) => canManage && m.userId !== currentUserId && assignable.includes(m.roleKey);

  async function changeRole(m: Member, roleKey: string) {
    setBusyId(m.userId);
    try {
      const res = await changeMemberRoleAction({ workspaceId: workspace.id, userId: m.userId, roleKey });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${m.name || m.email} is now ${roleByKey.get(roleKey)?.name ?? roleKey}`);
    } finally {
      setBusyId(null);
    }
  }

  const accessLabel = (m: Member) =>
    m.allProjects ? "All projects" : m.projectIds.length === 0 ? "No projects" : `${m.projectIds.length} ${m.projectIds.length === 1 ? "project" : "projects"}`;

  const columns: Column<Member>[] = [
    {
      id: "member",
      header: "Member",
      sortValue: (m) => (m.name || m.email).toLowerCase(),
      cell: (m) => <MemberCell m={m} you={m.userId === currentUserId} />,
    },
    {
      id: "role",
      header: "Role",
      sortValue: (m) => roleByKey.get(m.roleKey)?.name ?? m.roleKey,
      cell: (m) =>
        canEdit(m) ? (
          <Select value={m.roleKey} onValueChange={(v) => changeRole(m, v)} disabled={busyId === m.userId}>
            <SelectTrigger size="sm" className="h-8 w-36">
              {busyId === m.userId ? <Loader2 className="size-3.5 animate-spin" /> : <SelectValue />}
            </SelectTrigger>
            <SelectContent>
              {view.roles.map((r) => (
                <SelectItem key={r.key} value={r.key} disabled={!assignable.includes(r.key)}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Badge variant="secondary">{m.roleName}</Badge>
        ),
    },
    {
      id: "access",
      header: "Project access",
      hideBelow: "md",
      cell: (m) =>
        !m.allProjects && canEdit(m) ? (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 h-7 gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setAccessFor(m);
              setAccessIds(m.projectIds);
            }}
          >
            <FolderLock className="size-3.5" /> {accessLabel(m)}
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground">{accessLabel(m)}</span>
        ),
    },
    {
      id: "status",
      header: "Status",
      hideBelow: "lg",
      cell: (m) => <StatusBadge status={m.status} />,
    },
    {
      id: "last",
      header: "Last sign-in",
      hideBelow: "lg",
      sortValue: (m) => (m.lastLoginAt ? +new Date(m.lastLoginAt) : 0),
      cell: (m) => <TimeAgo date={m.lastLoginAt} className="text-sm text-muted-foreground" />,
    },
    {
      id: "actions",
      header: "",
      align: "right",
      width: "48px",
      cell: (m) => (canEdit(m) ? <RowMenu m={m} onAccess={() => { setAccessFor(m); setAccessIds(m.projectIds); }} onRemove={() => setRemoveFor(m)} /> : null),
    },
  ];

  return (
    <Panel
      title="Team members"
      icon={<Users className="size-4 text-muted-foreground" />}
      description={`${activeCount} active · ${pendingCount} pending`}
      actions={
        canManage && (
          <InviteDialog
            workspaceId={workspace.id}
            workspaceName={workspace.name}
            roles={view.roles}
            projects={view.projects}
            allowedDomains={view.allowedDomains}
            assignable={assignable}
          >
            <Button size="sm" className="gap-1.5">
              <UserPlus className="size-3.5" /> Invite member
            </Button>
          </InviteDialog>
        )
      }
    >
      <div className="space-y-3">
        {view.members.length > 6 && <SearchInput value={q} onChange={setQ} placeholder="Search members…" className="sm:max-w-72" />}
        <DataTable
          columns={columns}
          data={members}
          getRowId={(m) => m.userId}
          pageSize={25}
          initialSort={{ id: "member", dir: "asc" }}
          mobileCard={(m) => (
            <div className="space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <MemberCell m={m} you={m.userId === currentUserId} />
                {canEdit(m) && <RowMenu m={m} onAccess={() => { setAccessFor(m); setAccessIds(m.projectIds); }} onRemove={() => setRemoveFor(m)} />}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {canEdit(m) ? (
                  <Select value={m.roleKey} onValueChange={(v) => changeRole(m, v)} disabled={busyId === m.userId}>
                    <SelectTrigger size="sm" className="h-8 w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {view.roles.map((r) => (
                        <SelectItem key={r.key} value={r.key} disabled={!assignable.includes(r.key)}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant="secondary">{m.roleName}</Badge>
                )}
                <span className="text-muted-foreground">{accessLabel(m)}</span>
                {m.status !== "active" && <StatusBadge status={m.status} />}
              </div>
            </div>
          )}
        />
      </div>

      <Dialog open={!!accessFor} onOpenChange={(v) => !v && setAccessFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Project access</DialogTitle>
            <DialogDescription>
              {accessFor?.name || accessFor?.email} ({accessFor?.roleName}) can only open the projects selected here.
            </DialogDescription>
          </DialogHeader>
          <ProjectPicker projects={view.projects} value={accessIds} onChange={setAccessIds} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAccessFor(null)}>
              Cancel
            </Button>
            <Button
              disabled={saving}
              onClick={async () => {
                if (!accessFor) return;
                setSaving(true);
                try {
                  const res = await setMemberProjectsAction({ workspaceId: workspace.id, userId: accessFor.userId, projectIds: accessIds });
                  if (!res.ok) return void toast.error(res.error);
                  toast.success("Project access updated");
                  setAccessFor(null);
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : "Save access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removeFor} onOpenChange={(v) => !v && setRemoveFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeFor?.name || removeFor?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              They lose access to {workspace.name} and all of its projects immediately. Their account stays active in
              other workspaces.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async (e) => {
                e.preventDefault();
                if (!removeFor) return;
                setSaving(true);
                try {
                  const res = await removeMemberAction({ workspaceId: workspace.id, userId: removeFor.userId });
                  if (!res.ok) return void toast.error(res.error);
                  toast.success("Member removed");
                  setRemoveFor(null);
                } finally {
                  setSaving(false);
                }
              }}
            >
              Remove member
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}

function MemberCell({ m, you }: { m: Member; you: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar className="size-8">
        {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt="" className="object-cover" />}
        <AvatarFallback className="bg-brand-soft text-[11px] font-semibold text-brand">{initials(m.name, m.email)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 truncate text-sm font-medium">
          <span className="truncate">{m.name || m.email.split("@")[0]}</span>
          {you && (
            <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
              You
            </Badge>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">{m.email}</div>
      </div>
    </div>
  );
}

function RowMenu({ m, onAccess, onRemove }: { m: Member; onAccess: () => void; onRemove: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label="Member actions">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {!m.allProjects && (
          <DropdownMenuItem onSelect={onAccess}>
            <FolderLock /> Edit project access
          </DropdownMenuItem>
        )}
        {!m.allProjects && <DropdownMenuSeparator />}
        <DropdownMenuItem variant="destructive" onSelect={onRemove}>
          <UserMinus /> Remove from workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
