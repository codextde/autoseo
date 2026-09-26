"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Loader2, Trash2 } from "lucide-react";
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
import { Panel } from "@/components/app/page";
import { ConfirmButton } from "@/components/app/misc";
import { deleteProjectAction, setProjectArchivedAction } from "../project-actions";
import { ReadOnlyNotice, type ProjectSettingsData } from "./shared";

export function DangerZone({ project, canManage }: { project: ProjectSettingsData; canManage: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  const archive = async (archived: boolean) => {
    const res = await setProjectArchivedAction(project.id, archived);
    if (!res.ok) return void toast.error(res.error);
    toast.success(archived ? "Project archived" : "Project restored");
    if (archived) router.push("/");
  };

  const remove = async () => {
    setDeleting(true);
    try {
      const res = await deleteProjectAction(project.id, confirm);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${project.name} was deleted`);
      setOpen(false);
      router.push("/");
      router.refresh();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      {!canManage && <ReadOnlyNotice />}
      <Panel title="Danger zone" className="border-destructive/30">
        <div className="divide-y">
          <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium">{project.archived ? "Restore project" : "Archive project"}</p>
              <p className="text-xs text-muted-foreground">
                {project.archived
                  ? "This project is archived: tracking is stopped and it's hidden from the project switcher."
                  : "Stops scheduled tracking and hides the project. All data is kept and it can be restored at any time."}
              </p>
            </div>
            {project.archived ? (
              <Button variant="outline" disabled={!canManage} className="shrink-0 gap-1.5" onClick={() => void archive(false)}>
                <ArchiveRestore className="size-4" /> Restore
              </Button>
            ) : (
              <ConfirmButton
                title={`Archive ${project.name}?`}
                description="Scheduled tracking stops and the project disappears from the switcher. You can restore it later in Settings → Projects."
                confirmLabel="Archive"
                onConfirm={() => archive(true)}
              >
                <Button variant="outline" disabled={!canManage} className="shrink-0 gap-1.5">
                  <Archive className="size-4" /> Archive
                </Button>
              </ConfirmButton>
            )}
          </div>
          <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-destructive">Delete project</p>
              <p className="text-xs text-muted-foreground">
                Permanently deletes the project with all prompts, AI answers, keywords, audits, reports and integrations. This cannot be undone.
              </p>
            </div>
            <Dialog
              open={open}
              onOpenChange={(o) => {
                setOpen(o);
                if (!o) setConfirm("");
              }}
            >
              <DialogTrigger asChild>
                <Button variant="destructive" disabled={!canManage} className="shrink-0 gap-1.5">
                  <Trash2 className="size-4" /> Delete
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Delete {project.name}?</DialogTitle>
                  <DialogDescription>
                    All data of this project is permanently deleted. Type <span className="font-mono font-medium text-foreground">{project.domain}</span> to
                    confirm.
                  </DialogDescription>
                </DialogHeader>
                <form
                  className="space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (confirm.trim().toLowerCase() === project.domain.toLowerCase()) void remove();
                  }}
                >
                  <Label htmlFor="pd-confirm" className="sr-only">
                    Domain
                  </Label>
                  <Input
                    id="pd-confirm"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={confirm}
                    placeholder={project.domain}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </form>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)} disabled={deleting}>
                    Cancel
                  </Button>
                  <Button
                    className="bg-destructive text-white hover:bg-destructive/90"
                    disabled={deleting || confirm.trim().toLowerCase() !== project.domain.toLowerCase()}
                    onClick={() => void remove()}
                  >
                    {deleting && <Loader2 className="size-4 animate-spin" />} Delete permanently
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </Panel>
    </div>
  );
}
