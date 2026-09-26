"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { createAgentAction, type InstallResult } from "../actions";
import { InstallResultDialog } from "./install-commands";

export function CreateAgentButton({
  workspaces,
  defaultWorkspaceId,
  size = "default",
  label = "Install agent",
}: {
  workspaces: { id: string; name: string }[];
  defaultWorkspaceId: string | null;
  size?: "default" | "sm" | "lg";
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [labels, setLabels] = useState("");
  const [workspaceId, setWorkspaceId] = useState(defaultWorkspaceId ?? workspaces[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InstallResult | null>(null);
  const [resultOpen, setResultOpen] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !workspaceId) return;
    setBusy(true);
    try {
      const res = await createAgentAction({
        name: name.trim(),
        workspaceId,
        labels: labels
          .split(",")
          .map((l) => l.trim())
          .filter(Boolean),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setResult(res.data);
      setOpen(false);
      setResultOpen(true);
      setName("");
      setLabels("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size={size} disabled={!workspaces.length}>
            <Plus className="size-4" /> {label}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Install a local agent</DialogTitle>
              <DialogDescription>
                Give the machine a name. You get a one-line install command with a token that never expires — it is shown only once.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="agent-name">Name</Label>
              <Input id="agent-name" autoFocus placeholder="e.g. Daniel's MacBook" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </div>
            {workspaces.length > 1 && (
              <div className="grid gap-1.5">
                <Label htmlFor="agent-ws">Workspace</Label>
                <NativeSelect id="agent-ws" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
                  {workspaces.map((w) => (
                    <NativeSelectOption key={w.id} value={w.id}>
                      {w.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <p className="text-xs text-muted-foreground">The agent runs AI work for projects of this workspace.</p>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="agent-labels">
                Labels <span className="font-normal text-muted-foreground">(optional, comma separated)</span>
              </Label>
              <Input id="agent-labels" placeholder="office, gpu, team-seo" value={labels} onChange={(e) => setLabels(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !name.trim()}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                Create &amp; show command
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <InstallResultDialog
        mode="create"
        result={result}
        open={resultOpen}
        onOpenChange={(v) => {
          setResultOpen(v);
          if (!v) router.refresh();
        }}
      />
    </>
  );
}
