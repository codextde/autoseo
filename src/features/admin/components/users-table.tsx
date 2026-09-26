"use client";

import Link from "next/link";
import { useMemo } from "react";
import { MailPlus, MonitorSmartphone, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/app/data-table";
import { FilterBar, MultiSelect, SearchInput } from "@/components/app/filters";
import { StatusBadge, TimeAgo } from "@/components/app/misc";
import { EmptyState } from "@/components/app/empty-state";
import { useUrlState } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import { UserCell } from "./user-avatar";
import { UserDrawer, type RoleOption } from "./user-drawer";

export type UserRow = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  status: "active" | "disabled";
  isInstanceAdmin: boolean;
  hasAdminAccess: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  activeSessions: number;
  memberships: { workspaceId: string; workspaceName: string; roleKey: string; roleName: string }[];
};

const STATUS_TABS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "admins", label: "Admins" },
  { key: "disabled", label: "Disabled" },
  { key: "no-workspace", label: "No workspace" },
];

export function UsersTable({
  users,
  roles,
  workspaces,
  currentUserId,
}: {
  users: UserRow[];
  roles: RoleOption[];
  workspaces: { id: string; name: string }[];
  currentUserId: string;
}) {
  const [q, setQ] = useUrlState("q", "");
  const [status, setStatus] = useUrlState("status", "all");
  const [ws, setWs] = useUrlState("ws", "");
  const [openId, setOpenId] = useUrlState("user", "");

  const counts = useMemo(
    () => ({
      all: users.length,
      active: users.filter((u) => u.status === "active").length,
      admins: users.filter((u) => u.hasAdminAccess).length,
      disabled: users.filter((u) => u.status === "disabled").length,
      "no-workspace": users.filter((u) => u.memberships.length === 0).length,
    }),
    [users],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return users.filter((u) => {
      if (needle && !`${u.email} ${u.name ?? ""}`.toLowerCase().includes(needle)) return false;
      if (status === "active" && u.status !== "active") return false;
      if (status === "disabled" && u.status !== "disabled") return false;
      if (status === "admins" && !u.hasAdminAccess) return false;
      if (status === "no-workspace" && u.memberships.length > 0) return false;
      if (ws && !u.memberships.some((m) => m.workspaceId === ws)) return false;
      return true;
    });
  }, [users, q, status, ws]);

  const columns: Column<UserRow>[] = [
    {
      id: "user",
      header: "User",
      sortValue: (u) => (u.name || u.email).toLowerCase(),
      cell: (u) => (
        <UserCell
          name={u.name}
          email={u.email}
          src={u.avatarUrl}
          badges={
            <>
              {u.hasAdminAccess && (
                <Badge variant="secondary" className="h-5 gap-1 px-1.5 text-[10px]">
                  <ShieldCheck className="size-3" /> Admin
                </Badge>
              )}
              {u.id === currentUserId && (
                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                  You
                </Badge>
              )}
            </>
          }
        />
      ),
    },
    {
      id: "status",
      header: "Status",
      sortValue: (u) => u.status,
      cell: (u) => <StatusBadge status={u.status} />,
    },
    {
      id: "workspaces",
      header: "Workspaces & roles",
      hideBelow: "md",
      cell: (u) =>
        u.memberships.length ? (
          <div className="flex max-w-80 flex-wrap gap-1">
            {u.memberships.map((m) => (
              <Badge key={m.workspaceId} variant="outline" className="h-5 max-w-full gap-1 px-1.5 text-[11px] font-normal">
                <span className="truncate">{m.workspaceName}</span>
                <span className="text-muted-foreground">· {m.roleName}</span>
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">No workspace</span>
        ),
    },
    {
      id: "devices",
      header: "Devices",
      align: "right",
      hideBelow: "lg",
      sortValue: (u) => u.activeSessions,
      cell: (u) => (
        <span className={cn("inline-flex items-center gap-1 tabular", !u.activeSessions && "text-muted-foreground")}>
          <MonitorSmartphone className="size-3.5 text-muted-foreground" /> {u.activeSessions}
        </span>
      ),
    },
    {
      id: "lastLogin",
      header: "Last sign-in",
      sortValue: (u) => (u.lastLoginAt ? new Date(u.lastLoginAt).getTime() : 0),
      cell: (u) => (u.lastLoginAt ? <TimeAgo date={u.lastLoginAt} className="text-xs" /> : <span className="text-xs text-muted-foreground">Never</span>),
    },
    {
      id: "created",
      header: "Joined",
      hideBelow: "xl",
      sortValue: (u) => new Date(u.createdAt).getTime(),
      cell: (u) => <TimeAgo date={u.createdAt} className="text-xs text-muted-foreground" />,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="scrollbar-none -mx-1 flex gap-1 overflow-x-auto px-1">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setStatus(t.key)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              status === t.key ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            <span className={cn("tabular", status === t.key ? "text-background/70" : "text-muted-foreground/70")}>
              {counts[t.key as keyof typeof counts]}
            </span>
          </button>
        ))}
      </div>
      <FilterBar
        search={<SearchInput value={q} onChange={(v) => setQ(v || null)} placeholder="Search name or email…" />}
        activeCount={ws ? 1 : 0}
      >
        {workspaces.length > 1 && (
          <MultiSelect
            single
            options={workspaces.map((w) => ({ value: w.id, label: w.name }))}
            value={ws ? [ws] : []}
            onChange={(v) => setWs(v[0] ?? null)}
            placeholder="All workspaces"
            label="Workspace"
          />
        )}
      </FilterBar>
      <DataTable
        columns={columns}
        data={filtered}
        getRowId={(u) => u.id}
        initialSort={{ id: "lastLogin", dir: "desc" }}
        onRowClick={(u) => setOpenId(u.id)}
        pageSize={50}
        empty={
          <EmptyState
            compact
            icon={MailPlus}
            title={users.length ? "No users match your filters" : "No users yet"}
            description="Invite people by email — they sign in with a magic link."
            action={
              <Button asChild size="sm">
                <Link href="/admin/invitations?new=1">Invite people</Link>
              </Button>
            }
          />
        }
        mobileCard={(u) => (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <UserCell
                name={u.name}
                email={u.email}
                src={u.avatarUrl}
                badges={
                  u.hasAdminAccess ? (
                    <Badge variant="secondary" className="h-5 gap-1 px-1.5 text-[10px]">
                      <ShieldCheck className="size-3" /> Admin
                    </Badge>
                  ) : null
                }
              />
              <StatusBadge status={u.status} />
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {u.memberships.map((m) => (
                <Badge key={m.workspaceId} variant="outline" className="h-5 px-1.5 text-[11px] font-normal">
                  {m.workspaceName} · {m.roleName}
                </Badge>
              ))}
              <span className="ml-auto text-[11px] text-muted-foreground">
                {u.lastLoginAt ? <TimeAgo date={u.lastLoginAt} /> : "Never signed in"}
              </span>
            </div>
          </div>
        )}
      />
      <UserDrawer
        userId={openId || null}
        onClose={() => setOpenId(null)}
        roles={roles}
        currentUserId={currentUserId}
      />
    </div>
  );
}
