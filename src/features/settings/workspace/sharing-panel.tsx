"use client";

import { useState } from "react";
import { Loader2, Share2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Panel } from "@/components/app/page";
import { DataTable, type Column } from "@/components/app/data-table";
import { ConfirmButton, StatusBadge, TimeAgo } from "@/components/app/misc";
import { Favicon } from "@/components/app/favicon";
import { revokeShareAction, shareProjectAction } from "../actions";
import { emailProblem } from "./domain-check";
import type { ShareRow, WorkspaceView } from "./queries";

export function SharingPanel({
  view,
  workspaceId,
  canManage,
}: {
  view: WorkspaceView;
  workspaceId: string;
  canManage: boolean;
}) {
  const columns: Column<ShareRow>[] = [
    {
      id: "email",
      header: "Email",
      sortValue: (s) => s.email,
      cell: (s) => <span className="truncate text-sm font-medium">{s.email}</span>,
    },
    {
      id: "project",
      header: "Project",
      sortValue: (s) => s.projectName,
      cell: (s) => (
        <span className="flex min-w-0 items-center gap-2 text-sm">
          <Favicon domain={s.projectDomain} src={s.projectLogoUrl} fallback={s.projectName} />
          <span className="truncate">{s.projectName}</span>
        </span>
      ),
    },
    { id: "status", header: "Status", cell: (s) => <StatusBadge status={s.status} /> },
    {
      id: "created",
      header: "Shared",
      hideBelow: "md",
      sortValue: (s) => +new Date(s.createdAt),
      cell: (s) => <TimeAgo date={s.createdAt} className="text-sm text-muted-foreground" />,
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (s) => (canManage && s.status !== "revoked" ? <RevokeShare share={s} workspaceId={workspaceId} /> : null),
    },
  ];

  return (
    <Panel
      title="Project sharing"
      icon={<Share2 className="size-4 text-muted-foreground" />}
      description="Give clients read-only access to a single project."
      actions={
        canManage &&
        view.projects.length > 0 && (
          <ShareDialog view={view} workspaceId={workspaceId}>
            <Button size="sm" variant="outline" className="gap-1.5">
              <Share2 className="size-3.5" /> Share project
            </Button>
          </ShareDialog>
        )
      }
    >
      <DataTable
        columns={columns}
        data={view.shares}
        getRowId={(s) => s.id}
        pageSize={10}
        initialSort={{ id: "created", dir: "desc" }}
        empty={
          <div className="py-8 text-center text-sm text-muted-foreground">
            No shared projects yet. Shared users join as <span className="font-medium text-foreground">Client</span> and
            only see the project you share.
          </div>
        }
        mobileCard={(s) => (
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <div className="truncate text-sm font-medium">{s.email}</div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Favicon domain={s.projectDomain} src={s.projectLogoUrl} fallback={s.projectName} />
                <span className="truncate">{s.projectName}</span>
                <StatusBadge status={s.status} />
              </div>
            </div>
            {canManage && s.status !== "revoked" && <RevokeShare share={s} workspaceId={workspaceId} />}
          </div>
        )}
      />
    </Panel>
  );
}

function RevokeShare({ share, workspaceId }: { share: ShareRow; workspaceId: string }) {
  return (
    <ConfirmButton
      title="Stop sharing?"
      description={`${share.email} loses access to ${share.projectName}. Pending invitations for this share are revoked.`}
      confirmLabel="Stop sharing"
      destructive
      onConfirm={async () => {
        const res = await revokeShareAction({ workspaceId, shareId: share.id });
        if (!res.ok) return void toast.error(res.error);
        toast.success("Sharing stopped");
      }}
    >
      <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
        Revoke
      </Button>
    </ConfirmButton>
  );
}

function ShareDialog({ view, workspaceId, children }: { view: WorkspaceView; workspaceId: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState(view.projects[0]?.id ?? "");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const problem = email.trim() ? emailProblem(email.trim().toLowerCase(), view.allowedDomains) : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share a project</DialogTitle>
          <DialogDescription>The recipient gets read-only Client access to this one project.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (problem) return;
            setBusy(true);
            try {
              const res = await shareProjectAction({ workspaceId, projectId, email: email.trim() });
              if (!res.ok) return void toast.error(res.error);
              toast.success(res.data.mode === "granted" ? "Access granted" : "Invitation sent");
              setEmail("");
              setOpen(false);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="space-y-1.5">
            <Label>Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {view.projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <Favicon domain={p.domain} src={p.logoUrl} fallback={p.name} />
                    {p.name} <span className="text-xs text-muted-foreground">{p.domain}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="share-email">Email</Label>
            <Input
              id="share-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="client@company.com"
              aria-invalid={Boolean(problem)}
              autoComplete="off"
            />
            {problem ? (
              <p className="text-xs text-destructive">{problem}</p>
            ) : (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5 text-brand" />
                {view.allowedDomains.length
                  ? `Allowed domains: ${view.allowedDomains.map((d) => `@${d}`).join(", ")}`
                  : "Any email domain can be invited."}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !email.trim() || Boolean(problem) || !projectId}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Share project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
