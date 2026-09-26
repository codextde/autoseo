"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  FolderKanban,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { SearchInput } from "@/components/app/filters";
import { CountryFlag, TimeAgo } from "@/components/app/misc";
import { Favicon } from "@/components/app/favicon";
import { EmptyState } from "@/components/app/empty-state";
import { useUrlState } from "@/hooks/use-url-state";
import { deleteProjectAction, setProjectArchivedAction, updateProjectBasicsAction } from "../actions";
import { Segmented } from "../account/segmented";

export type ManagedProject = {
  id: string;
  name: string;
  domain: string;
  logoUrl: string | null;
  country: string;
  archived: boolean;
  isPitch: boolean;
  pitchExpiresAt: string | null;
  createdAt: string;
  workspaceName: string;
  canManage: boolean;
};

export function ProjectsManager({
  projects,
  canCreate,
  showWorkspace,
}: {
  projects: ManagedProject[];
  canCreate: boolean;
  showWorkspace: boolean;
}) {
  const [tab, setTab] = useUrlState("tab", "active");
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<ManagedProject | null>(null);
  const [del, setDel] = useState<ManagedProject | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const counts = { active: projects.filter((p) => !p.archived).length, archived: projects.filter((p) => p.archived).length };
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return projects
      .filter((p) => (tab === "archived" ? p.archived : !p.archived))
      .filter((p) => !s || p.name.toLowerCase().includes(s) || p.domain.includes(s));
  }, [projects, tab, q]);

  async function archive(p: ManagedProject, archived: boolean) {
    setBusy(p.id);
    try {
      const res = await setProjectArchivedAction({ projectId: p.id, archived });
      if (!res.ok) return void toast.error(res.error);
      toast.success(archived ? `${p.name} archived` : `${p.name} restored`);
    } finally {
      setBusy(null);
    }
  }

  const menu = (p: ManagedProject) =>
    p.canManage ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label="Project actions" disabled={busy === p.id}>
            {busy === p.id ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={() => setEdit(p)}>
            <Pencil /> Rename & domain
          </DropdownMenuItem>
          {!p.archived && (
            <DropdownMenuItem asChild>
              <Link href={`/p/${p.id}/settings`}>
                <Settings2 /> Project settings
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {p.archived ? (
            <DropdownMenuItem onSelect={() => archive(p, false)}>
              <ArchiveRestore /> Restore
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => archive(p, true)}>
              <Archive /> Archive
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" onSelect={() => setDel(p)}>
            <Trash2 /> Delete permanently
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  const nameCell = (p: ManagedProject) => (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border bg-background">
        <Favicon domain={p.domain} src={p.logoUrl} fallback={p.name} className="size-5" />
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          {p.archived ? (
            <span className="truncate text-sm font-medium">{p.name}</span>
          ) : (
            <Link href={`/p/${p.id}`} className="truncate text-sm font-medium hover:underline">
              {p.name}
            </Link>
          )}
          {p.isPitch && (
            <Badge variant="outline" className="h-5 shrink-0 text-[10px]">
              Pitch{p.pitchExpiresAt ? ` · ends ${new Date(p.pitchExpiresAt).toLocaleDateString()}` : ""}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CountryFlag iso={p.country} />
          <span className="truncate">{p.domain}</span>
        </div>
      </div>
    </div>
  );

  const columns: Column<ManagedProject>[] = [
    { id: "name", header: "Project", sortValue: (p) => p.name.toLowerCase(), cell: nameCell },
    ...(showWorkspace
      ? [{ id: "ws", header: "Workspace", hideBelow: "md" as const, sortValue: (p: ManagedProject) => p.workspaceName, cell: (p: ManagedProject) => <span className="text-sm text-muted-foreground">{p.workspaceName}</span> }]
      : []),
    {
      id: "created",
      header: "Created",
      hideBelow: "md",
      sortValue: (p) => +new Date(p.createdAt),
      cell: (p) => <TimeAgo date={p.createdAt} className="text-sm text-muted-foreground" />,
    },
    {
      id: "open",
      header: "",
      align: "right",
      width: "96px",
      cell: (p) => (
        <div className="flex items-center justify-end gap-1">
          {!p.archived && (
            <Button asChild variant="ghost" size="icon" className="size-8" aria-label="Open project">
              <Link href={`/p/${p.id}`}>
                <ArrowUpRight className="size-4" />
              </Link>
            </Button>
          )}
          {menu(p)}
        </div>
      ),
    },
  ];

  return (
    <Panel
      title="Projects"
      icon={<FolderKanban className="size-4 text-muted-foreground" />}
      description="Rename, archive or delete the websites you track."
      actions={
        canCreate && (
          <Button asChild size="sm" className="gap-1.5">
            <Link href="/onboarding">
              <Plus className="size-3.5" /> New project
            </Link>
          </Button>
        )
      }
    >
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Segmented
            size="sm"
            value={tab === "archived" ? "archived" : "active"}
            onChange={(v) => setTab(v)}
            options={[
              { value: "active", label: `Active · ${counts.active}` },
              { value: "archived", label: `Archived · ${counts.archived}` },
            ]}
          />
          <SearchInput value={q} onChange={setQ} placeholder="Search projects…" className="sm:w-64" />
        </div>
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(p) => p.id}
          initialSort={{ id: "name", dir: "asc" }}
          pageSize={25}
          empty={
            <EmptyState
              compact
              icon={tab === "archived" ? Archive : FolderKanban}
              title={tab === "archived" ? "No archived projects" : "No projects"}
              description={
                tab === "archived"
                  ? "Archived projects keep their data but stop tracking and disappear from the project switcher."
                  : canCreate
                    ? "Create a project to start tracking a website."
                    : "Ask a workspace admin to give you access to a project."
              }
            />
          }
          mobileCard={(p) => (
            <div className="flex items-center justify-between gap-2">
              {nameCell(p)}
              {menu(p)}
            </div>
          )}
        />
      </div>

      <EditDialog project={edit} onClose={() => setEdit(null)} />
      <DeleteDialog project={del} onClose={() => setDel(null)} />
    </Panel>
  );
}

function EditDialog({ project, onClose }: { project: ManagedProject | null; onClose: () => void }) {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);
  if (project && project.id !== lastId) {
    setLastId(project.id);
    setName(project.name);
    setDomain(project.domain);
  }
  return (
    <Dialog open={!!project} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
          <DialogDescription>More options (market, brand, engines) live in the project settings.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!project) return;
            setBusy(true);
            try {
              const res = await updateProjectBasicsAction({ projectId: project.id, name, domain });
              if (!res.ok) return void toast.error(res.error);
              toast.success("Project updated");
              onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="pm-name">Name</Label>
            <Input id="pm-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Acme Inc." />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pm-domain">Domain</Label>
            <Input id="pm-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" autoCapitalize="none" spellCheck={false} />
            <p className="text-xs text-muted-foreground">Bare domain without https:// or www — e.g. solakon.de</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim() || !domain.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ project, onClose }: { project: ManagedProject | null; onClose: () => void }) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const matches = project ? confirm.trim().toLowerCase() === project.domain.toLowerCase() : false;
  return (
    <Dialog
      open={!!project}
      onOpenChange={(v) => {
        if (!v) {
          setConfirm("");
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-destructive">Delete {project?.name}?</DialogTitle>
          <DialogDescription>
            This permanently deletes the project and all of its prompts, tracking history, keywords, audits, reports and
            integrations. This cannot be undone — consider archiving instead.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="pm-confirm">
            Type <span className="font-mono font-semibold">{project?.domain}</span> to confirm
          </Label>
          <Input id="pm-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" autoCapitalize="none" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={!matches || busy}
            onClick={async () => {
              if (!project) return;
              setBusy(true);
              try {
                const res = await deleteProjectAction({ projectId: project.id, confirm });
                if (!res.ok) return void toast.error(res.error);
                toast.success(`${project.name} deleted`);
                setConfirm("");
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Delete project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
