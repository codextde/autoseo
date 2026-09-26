"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { createCompetitorAction, updateCompetitorAction } from "../../actions";

export type CompetitorFormValue = { id?: string; name: string; domain: string | null; aliases: string[]; tracked: boolean };

export function CompetitorDialog({
  projectId,
  open,
  onOpenChange,
  initial,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: CompetitorFormValue | null;
}) {
  const editing = !!initial?.id;
  const [name, setName] = useState(initial?.name ?? "");
  const [domain, setDomain] = useState(initial?.domain ?? "");
  const [aliases, setAliases] = useState((initial?.aliases ?? []).join(", "));
  const [tracked, setTracked] = useState(initial?.tracked ?? true);
  const [pending, start] = useTransition();

  // Reset the form whenever the dialog is (re)opened for another competitor.
  const [key, setKey] = useState<string | null>(null);
  const currentKey = open ? (initial?.id ?? "new") : null;
  if (currentKey !== key) {
    setKey(currentKey);
    if (open) {
      setName(initial?.name ?? "");
      setDomain(initial?.domain ?? "");
      setAliases((initial?.aliases ?? []).join(", "));
      setTracked(initial?.tracked ?? true);
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      name,
      domain: domain.trim() || null,
      aliases: aliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean),
      tracked,
    };
    start(async () => {
      const res = editing ? await updateCompetitorAction(projectId, initial!.id!, payload) : await createCompetitorAction(projectId, payload);
      if (!res.ok) return void toast.error(res.error);
      toast.success(editing ? "Competitor updated" : "Competitor added");
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit competitor" : "Add competitor"}</DialogTitle>
            <DialogDescription>
              Answers are matched by name and aliases; citations by domain. Existing answers that already name this brand are linked automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cmp-name">Brand name</Label>
            <Input id="cmp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme" required maxLength={80} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cmp-domain">Domain</Label>
            <Input id="cmp-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="acme.com" maxLength={253} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cmp-aliases">Aliases</Label>
            <Input id="cmp-aliases" value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="Acme Inc, Acme Sports (comma-separated)" />
            <p className="text-xs text-muted-foreground">Alternative spellings or product lines that count as this brand.</p>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <span>
              <span className="block text-sm font-medium">My List</span>
              <span className="text-xs text-muted-foreground">Show in charts and comparisons by default.</span>
            </span>
            <Switch checked={tracked} onCheckedChange={setTracked} />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? "Saving…" : editing ? "Save changes" : "Add competitor"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
