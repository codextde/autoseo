"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useShell } from "@/components/app/shell-context";
import { duplicateReportAction, renameReportAction, saveAsTemplateAction } from "../actions";

/* Dialog bodies are separate components so their state starts fresh every time a dialog opens. */

export function RenameDialog(props: {
  projectId: string;
  reportId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: { title: string; subtitle: string | null };
  onDone?: (v: { title: string; subtitle: string | null }) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename report</DialogTitle>
        </DialogHeader>
        {props.open && <RenameBody {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function RenameBody({ projectId, reportId, onOpenChange, initial, onDone }: Parameters<typeof RenameDialog>[0]) {
  const [title, setTitle] = useState(initial.title);
  const [subtitle, setSubtitle] = useState(initial.subtitle ?? "");
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const res = await renameReportAction(projectId, reportId, { title, subtitle: subtitle || null });
      if (!res.ok) return void toast.error(res.error);
      onDone?.({ title: title.trim(), subtitle: subtitle.trim() || null });
      onOpenChange(false);
    });
  return (
    <>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="rn-title">Title</Label>
          <Input id="rn-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} onKeyDown={(e) => e.key === "Enter" && submit()} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rn-sub">Subtitle</Label>
          <Input id="rn-sub" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} maxLength={200} placeholder="Optional" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={pending || !title.trim()}>
          {pending && <Loader2 className="animate-spin" />} Save
        </Button>
      </DialogFooter>
    </>
  );
}

export function SaveTemplateDialog(props: {
  projectId: string;
  reportId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultName: string;
  /** e.g. the editor flushes unsaved changes first */
  beforeSave?: () => Promise<boolean>;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save as template</DialogTitle>
          <DialogDescription>Reuse this design for every client. Live data tokens stay live.</DialogDescription>
        </DialogHeader>
        {props.open && <SaveTemplateBody {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function SaveTemplateBody({ projectId, reportId, onOpenChange, defaultName, beforeSave }: Parameters<typeof SaveTemplateDialog>[0]) {
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState("");
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      if (beforeSave && !(await beforeSave())) return;
      const res = await saveAsTemplateAction(projectId, reportId, { name, description: description || null });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Saved to My Templates");
      onOpenChange(false);
    });
  return (
    <>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="tp-name">Template name</Label>
          <Input id="tp-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tp-desc">Description</Label>
          <Input id="tp-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder="Optional" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={pending || !name.trim()}>
          {pending && <Loader2 className="animate-spin" />} Save template
        </Button>
      </DialogFooter>
    </>
  );
}

export function DuplicateDialog(props: {
  projectId: string;
  reportId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone?: (r: { id: string; projectId: string }) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Duplicate report</DialogTitle>
          <DialogDescription>One deck, every client — copy it to another project and all live data re-resolves for that client.</DialogDescription>
        </DialogHeader>
        {props.open && <DuplicateBody {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function DuplicateBody({ projectId, reportId, onOpenChange, onDone }: Parameters<typeof DuplicateDialog>[0]) {
  const shell = useShell();
  const [target, setTarget] = useState(projectId);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const res = await duplicateReportAction(projectId, reportId, target);
      if (!res.ok) return void toast.error(res.error);
      toast.success(target === projectId ? "Report duplicated" : "Copied to the other client");
      onDone?.(res.data);
      onOpenChange(false);
    });
  return (
    <>
      <div className="space-y-1.5">
        <Label>Project</Label>
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {shell.projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name} <span className="text-muted-foreground">· {p.domain}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Duplicate
        </Button>
      </DialogFooter>
    </>
  );
}
