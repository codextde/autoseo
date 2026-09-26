"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  ArrowRightLeft,
  Building2,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Presentation,
  Trash2,
  Users,
} from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Panel, TabNav } from "@/components/app/page";
import { DataTable, type Column } from "@/components/app/data-table";
import { FilterBar, MultiSelect, SearchInput } from "@/components/app/filters";
import { CountryFlag, TimeAgo } from "@/components/app/misc";
import { Favicon } from "@/components/app/favicon";
import { EmptyState } from "@/components/app/empty-state";
import { useUrlState } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import {
  createWorkspaceAction,
  deleteProjectAction,
  deleteWorkspaceAction,
  moveProjectAction,
  renameWorkspaceAction,
  setProjectArchivedAction,
  setProjectPitchAction,
} from "../actions/workspaces";

export type WorkspaceItem = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  isDefault: boolean;
  members: number;
  owners: string[];
  projects: { active: number; archived: number };
};

export type ProjectItem = {
  id: string;
  name: string;
  domain: string;
  logoUrl: string | null;
  country: string;
  workspaceId: string;
  workspaceName: string;
  archived: boolean;
  isPitch: boolean;
  pitchExpiresAt: string | null;
  trackingFrequency: string;
  createdAt: string;
  createdByEmail: string | null;
};

type Result = { ok: true; data: unknown } | { ok: false; error: string };

type AdminUserOption = { id: string; email: string; name: string | null; isInstanceAdmin: boolean };

export function WorkspacesAdmin({
  workspaces,
  projects,
  users,
  currentUserId,
  ownerGrantsAdmin,
}: {
  workspaces: WorkspaceItem[];
  projects: ProjectItem[];
  users: AdminUserOption[];
  currentUserId: string;
  ownerGrantsAdmin: boolean;
}) {
  const [tab] = useUrlState("tab", "workspaces");
  return (
    <div className="space-y-4">
      <TabNav
        active={tab}
        tabs={[
          { key: "workspaces", label: `Workspaces (${workspaces.length})`, href: "?tab=workspaces" },
          { key: "projects", label: `Projects (${projects.length})`, href: "?tab=projects" },
        ]}
      />
      {tab === "projects" ? (
        <ProjectsTab projects={projects} workspaces={workspaces} />
      ) : (
        <WorkspacesTab workspaces={workspaces} users={users} currentUserId={currentUserId} ownerGrantsAdmin={ownerGrantsAdmin} />
      )}
    </div>
  );
}

function useRunner() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<Result>, msg: string) => {
    setBusy(key);
    try {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error);
        return false;
      }
      toast.success(msg);
      router.refresh();
      return true;
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

/* ───────────────────────────── Workspaces ───────────────────────────── */

function WorkspacesTab({
  workspaces,
  users,
  currentUserId,
  ownerGrantsAdmin,
}: {
  workspaces: WorkspaceItem[];
  users: AdminUserOption[];
  currentUserId: string;
  ownerGrantsAdmin: boolean;
}) {
  const { busy, run } = useRunner();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [owner, setOwner] = useState(currentUserId);
  const [rename, setRename] = useState<WorkspaceItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [del, setDel] = useState<WorkspaceItem | null>(null);
  const [confirm, setConfirm] = useState("");

  return (
    <>
      <div className="flex justify-end">
        <Button size="sm" className="h-8 gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="size-3.5" /> New workspace
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {workspaces.map((w) => (
          <Panel key={w.id} className="flex flex-col" contentClassName="flex flex-1 flex-col gap-3">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-sm font-semibold">
                {w.name.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate font-semibold">{w.name}</h3>
                  {w.isDefault && (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                      Default
                    </Badge>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  /{w.slug} · created <TimeAgo date={w.createdAt} />
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-7" aria-label="Workspace actions">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => {
                      setRename(w);
                      setRenameValue(w.name);
                    }}
                  >
                    <Pencil /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={`/admin/users?ws=${w.id}`}>
                      <Users /> View members
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={`/admin/workspaces?tab=projects&ws=${w.id}`}>
                      <Building2 /> View projects
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={w.isDefault}
                    onSelect={() => {
                      setDel(w);
                      setConfirm("");
                    }}
                  >
                    <Trash2 /> Delete workspace
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <dl className="grid grid-cols-3 gap-2 rounded-xl bg-muted/40 p-3 text-center">
              <div>
                <dt className="text-[11px] text-muted-foreground">Members</dt>
                <dd className="text-lg font-semibold tabular">{w.members}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">Projects</dt>
                <dd className="text-lg font-semibold tabular">{w.projects.active}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">Archived</dt>
                <dd className="text-lg font-semibold text-muted-foreground tabular">{w.projects.archived}</dd>
              </div>
            </dl>
            <p className="mt-auto truncate text-xs text-muted-foreground">
              Owner{w.owners.length > 1 ? "s" : ""}: {w.owners.length ? w.owners.join(", ") : "none"}
            </p>
          </Panel>
        ))}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
            <DialogDescription>Workspaces group projects and people — e.g. one per client or business unit.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ws-name">Name</Label>
              <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme GmbH" maxLength={80} />
            </div>
            <div className="space-y-1.5">
              <Label>Owner</Label>
              <Select value={owner} onValueChange={setOwner}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name ? `${u.name} · ${u.email}` : u.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {ownerGrantsAdmin && !users.find((u) => u.id === owner)?.isInstanceAdmin && (
                <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
                  The Owner role includes admin panel access, so this person becomes an instance admin. Remove “Access the admin
                  panel” from the Owner role in Roles &amp; Permissions if workspace owners shouldn&apos;t administer the instance.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!name.trim() || busy === "create"}
              onClick={async () => {
                if (await run("create", () => createWorkspaceAction(name, owner), "Workspace created")) {
                  setCreateOpen(false);
                  setName("");
                }
              }}
            >
              {busy === "create" && <Loader2 className="size-4 animate-spin" />} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rename} onOpenChange={(o) => !o && setRename(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename workspace</DialogTitle>
          </DialogHeader>
          <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} maxLength={80} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRename(null)}>
              Cancel
            </Button>
            <Button
              disabled={!renameValue.trim() || busy === "rename"}
              onClick={async () => {
                if (rename && (await run("rename", () => renameWorkspaceAction(rename.id, renameValue), "Workspace renamed"))) setRename(null);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{del?.name}”?</DialogTitle>
            <DialogDescription>
              This permanently deletes the workspace, its {(del?.projects.active ?? 0) + (del?.projects.archived ?? 0)} project(s) with
              all their data, and removes {del?.members ?? 0} membership(s). Type the workspace name to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={del?.name} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDel(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!del || confirm.trim() !== del.name || busy === "delete"}
              onClick={async () => {
                if (del && (await run("delete", () => deleteWorkspaceAction(del.id, confirm), "Workspace deleted"))) setDel(null);
              }}
            >
              Delete workspace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ───────────────────────────── Projects ───────────────────────────── */

const PITCH_DAYS = [7, 14, 30, 60, 90];

function ProjectsTab({ projects, workspaces }: { projects: ProjectItem[]; workspaces: WorkspaceItem[] }) {
  const { busy, run } = useRunner();
  const [q, setQ] = useUrlState("q", "");
  const [ws, setWs] = useUrlState("ws", "");
  const [status, setStatus] = useUrlState("status", "active");
  const [move, setMove] = useState<ProjectItem | null>(null);
  const [moveTarget, setMoveTarget] = useState("");
  const [pitch, setPitch] = useState<ProjectItem | null>(null);
  const [pitchOn, setPitchOn] = useState(false);
  const [pitchDays, setPitchDays] = useState(30);
  const [del, setDel] = useState<ProjectItem | null>(null);
  const [confirm, setConfirm] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return projects.filter((p) => {
      if (needle && !`${p.name} ${p.domain}`.toLowerCase().includes(needle)) return false;
      if (ws && p.workspaceId !== ws) return false;
      if (status === "active" && p.archived) return false;
      if (status === "archived" && !p.archived) return false;
      if (status === "pitch" && !p.isPitch) return false;
      return true;
    });
  }, [projects, q, ws, status]);

  const menu = (p: ProjectItem) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Project actions" onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {!p.archived && (
          <DropdownMenuItem asChild>
            <Link href={`/p/${p.id}`}>
              <ExternalLink /> Open project
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onSelect={() => {
            setMove(p);
            setMoveTarget(workspaces.find((w) => w.id !== p.workspaceId)?.id ?? "");
          }}
          disabled={workspaces.length < 2}
        >
          <ArrowRightLeft /> Move to workspace…
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            setPitch(p);
            setPitchOn(p.isPitch);
            setPitchDays(30);
          }}
        >
          <Presentation /> Pitch settings…
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            run(p.id, () => setProjectArchivedAction(p.id, !p.archived), p.archived ? "Project restored" : "Project archived")
          }
        >
          {p.archived ? <ArchiveRestore /> : <Archive />} {p.archived ? "Restore" : "Archive"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => {
            setDel(p);
            setConfirm("");
          }}
        >
          <Trash2 /> Delete permanently
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const badges = (p: ProjectItem) => (
    <>
      {p.archived && (
        <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">
          Archived
        </Badge>
      )}
      {p.isPitch && (
        <Badge variant="secondary" className="h-5 gap-1 bg-warning/15 px-1.5 text-[10px] text-warning">
          Pitch{p.pitchExpiresAt ? ` · ${new Date(p.pitchExpiresAt) < new Date() ? "expired" : `${formatDistanceToNowStrict(new Date(p.pitchExpiresAt))} left`}` : ""}
        </Badge>
      )}
    </>
  );

  const columns: Column<ProjectItem>[] = [
    {
      id: "project",
      header: "Project",
      sortValue: (p) => p.name.toLowerCase(),
      cell: (p) => (
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background">
            <Favicon domain={p.domain} src={p.logoUrl} fallback={p.name} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={cn("truncate font-medium", p.archived && "text-muted-foreground")}>{p.name}</span>
              {badges(p)}
            </div>
            <div className="truncate text-xs text-muted-foreground">{p.domain}</div>
          </div>
        </div>
      ),
    },
    { id: "workspace", header: "Workspace", hideBelow: "md", sortValue: (p) => p.workspaceName, cell: (p) => <span className="text-sm">{p.workspaceName}</span> },
    { id: "market", header: "Market", hideBelow: "lg", sortValue: (p) => p.country, cell: (p) => <CountryFlag iso={p.country} withName /> },
    {
      id: "tracking",
      header: "Tracking",
      hideBelow: "xl",
      sortValue: (p) => p.trackingFrequency,
      cell: (p) => <span className="text-xs capitalize text-muted-foreground">{p.trackingFrequency}</span>,
    },
    {
      id: "created",
      header: "Created",
      hideBelow: "sm",
      sortValue: (p) => new Date(p.createdAt).getTime(),
      cell: (p) => (
        <span className="text-xs">
          <TimeAgo date={p.createdAt} />
          {p.createdByEmail && <span className="block truncate text-muted-foreground">{p.createdByEmail}</span>}
        </span>
      ),
    },
    { id: "actions", header: "", align: "right", width: "48px", cell: (p) => (busy === p.id ? <Loader2 className="ml-auto size-4 animate-spin" /> : menu(p)) },
  ];

  return (
    <>
      <FilterBar
        search={<SearchInput value={q} onChange={(v) => setQ(v || null)} placeholder="Search projects or domains…" />}
        activeCount={(ws ? 1 : 0) + (status !== "active" ? 1 : 0)}
      >
        <MultiSelect
          single
          options={[
            { value: "active", label: "Active" },
            { value: "pitch", label: "Pitch projects" },
            { value: "archived", label: "Archived" },
            { value: "all", label: "All" },
          ]}
          value={[status]}
          onChange={(v) => setStatus(v[0] ?? "active")}
          label="Status"
        />
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
        getRowId={(p) => p.id}
        initialSort={{ id: "created", dir: "desc" }}
        empty={<EmptyState compact icon={Building2} title="No projects found" description="Projects are created through the onboarding wizard." action={{ label: "New project", href: "/onboarding" }} />}
        mobileCard={(p) => (
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background">
              <Favicon domain={p.domain} src={p.logoUrl} fallback={p.name} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate font-medium">{p.name}</span>
                {badges(p)}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {p.domain} · {p.workspaceName}
              </div>
            </div>
            {menu(p)}
          </div>
        )}
      />

      <Dialog open={!!move} onOpenChange={(o) => !o && setMove(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move “{move?.name}”</DialogTitle>
            <DialogDescription>Members of the target workspace get access according to their role. Explicit access of people outside it is removed.</DialogDescription>
          </DialogHeader>
          <Select value={moveTarget} onValueChange={setMoveTarget}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose workspace" />
            </SelectTrigger>
            <SelectContent>
              {workspaces
                .filter((w) => w.id !== move?.workspaceId)
                .map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMove(null)}>
              Cancel
            </Button>
            <Button
              disabled={!moveTarget || busy === "move"}
              onClick={async () => {
                if (move && (await run("move", () => moveProjectAction(move.id, moveTarget), "Project moved"))) setMove(null);
              }}
            >
              Move project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pitch} onOpenChange={(o) => !o && setPitch(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pitch settings</DialogTitle>
            <DialogDescription>
              Pitch projects are temporary (e.g. for sales pitches) and are archived automatically when they expire.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
              <div>
                <div className="text-sm font-medium">Pitch project</div>
                <div className="text-xs text-muted-foreground">
                  {pitch?.isPitch && pitch.pitchExpiresAt
                    ? `Currently expires ${new Date(pitch.pitchExpiresAt).toLocaleDateString("en-US", { dateStyle: "medium" })}`
                    : "Regular project without expiry"}
                </div>
              </div>
              <Switch checked={pitchOn} onCheckedChange={setPitchOn} />
            </div>
            {pitchOn && (
              <div className="space-y-1.5">
                <Label>Expires in</Label>
                <div className="flex flex-wrap gap-1.5">
                  {PITCH_DAYS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setPitchDays(d)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium",
                        pitchDays === d ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground",
                      )}
                    >
                      {d} days
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPitch(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy === "pitch"}
              onClick={async () => {
                if (
                  pitch &&
                  (await run("pitch", () => setProjectPitchAction(pitch.id, pitchOn, pitchOn ? pitchDays : null), pitchOn ? "Pitch expiry set" : "Converted to a regular project"))
                )
                  setPitch(null);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{del?.name}” permanently?</DialogTitle>
            <DialogDescription>
              All prompts, tracking results, reports, audits and integrations of this project are deleted. This can&apos;t be undone.
              Type <span className="font-medium text-foreground">{del?.domain}</span> to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={del?.domain} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDel(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!del || confirm.trim().toLowerCase() !== del.domain || busy === "delete"}
              onClick={async () => {
                if (del && (await run("delete", () => deleteProjectAction(del.id, confirm), "Project deleted"))) setDel(null);
              }}
            >
              Delete project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
