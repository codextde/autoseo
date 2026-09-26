"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Crown, Download, FileJson, Loader2, ShieldAlert, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Panel } from "@/components/app/page";
import { ErasureInventoryList, type InventoryItemView } from "./erasure-inventory";
import { deleteMyAccountAction, getMyErasureInventoryAction, transferOwnershipAction } from "./privacy-actions";

type Inventory = {
  items: InventoryItemView[];
  blockers: { code: string; message: string }[];
  transfer: {
    workspace: { id: string; name: string; members: number };
    candidates: { id: string; email: string; name: string | null; roleKey: string }[];
  }[];
};

function TransferRow({ entry, onDone }: { entry: Inventory["transfer"][number]; onDone: () => void }) {
  const [target, setTarget] = useState(entry.candidates[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-background/60 p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Crown className="size-3.5 text-warning" /> {entry.workspace.name}
        </div>
        <div className="text-xs text-muted-foreground">
          {entry.workspace.members} other member{entry.workspace.members === 1 ? "" : "s"} · choose the new owner
        </div>
      </div>
      <Select value={target} onValueChange={setTarget}>
        <SelectTrigger size="sm" className="h-8 w-full sm:w-56">
          <SelectValue placeholder="Choose a member" />
        </SelectTrigger>
        <SelectContent>
          {entry.candidates.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name ? `${c.name} · ${c.email}` : c.email}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        className="h-8"
        disabled={!target || busy}
        onClick={async () => {
          setBusy(true);
          const res = await transferOwnershipAction({ workspaceId: entry.workspace.id, userId: target });
          setBusy(false);
          if (!res.ok) return void toast.error(res.error);
          toast.success(`Ownership of ${entry.workspace.name} transferred`);
          onDone();
        }}
      >
        {busy && <Loader2 className="size-3.5 animate-spin" />} Make owner
      </Button>
    </div>
  );
}

export function PrivacyPanel({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setError(null);
    const res = await getMyErasureInventoryAction();
    if (res.ok) setInventory(res.data);
    else setError(res.error);
  };

  const blocked = (inventory?.blockers.length ?? 0) > 0;
  const confirmed = confirm.trim().toLowerCase() === email.toLowerCase();

  return (
    <Panel
      title="Privacy & data"
      icon={<ShieldAlert className="size-4 text-muted-foreground" />}
      description="Download everything stored about you, or permanently delete your account (GDPR)."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-xl border bg-background/50 p-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
              <FileJson className="size-4" />
            </span>
            <div>
              <div className="text-sm font-medium">Export my data</div>
              <p className="text-xs text-muted-foreground">
                Profile, memberships, devices, API keys (without secrets), bookmarks, notifications, feedback, chats, activity log and
                what you created — as one JSON file.
              </p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm" className="mt-auto w-fit gap-1.5">
            <a href="/settings/account/export" download>
              <Download className="size-3.5" /> Download JSON
            </a>
          </Button>
        </div>
        <div className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <Trash2 className="size-4" />
            </span>
            <div>
              <div className="text-sm font-medium">Delete my account</div>
              <p className="text-xs text-muted-foreground">
                Removes your account and personal data everywhere. Projects and reports you created stay with your team as “Deleted user”.
              </p>
            </div>
          </div>
          <Button
            variant="destructive"
            size="sm"
            className="mt-auto w-fit gap-1.5"
            onClick={() => {
              setOpen(true);
              setInventory(null);
              setConfirm("");
              void load();
            }}
          >
            <Trash2 className="size-3.5" /> Delete account…
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This can&apos;t be undone. Download your data first if you want to keep a copy.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!inventory && !error ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-32 rounded-xl" />
              <Skeleton className="h-32 rounded-xl" />
            </div>
          ) : inventory ? (
            <div className="space-y-4">
              {blocked && (
                <div className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-3">
                  <p className="flex items-start gap-1.5 text-sm font-medium text-warning">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" /> Before you can delete your account
                  </p>
                  {inventory.blockers.map((b) => (
                    <p key={b.code} className="text-xs text-muted-foreground">
                      {b.message}
                    </p>
                  ))}
                  {inventory.transfer.map((t) => (
                    <TransferRow key={t.workspace.id} entry={t} onDone={() => void load()} />
                  ))}
                </div>
              )}
              <ErasureInventoryList items={inventory.items} />
              <div className="space-y-1.5">
                <Label htmlFor="erase-confirm">
                  Type <span className="font-semibold">{email}</span> to confirm
                </Label>
                <Input id="erase-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={email} autoComplete="off" disabled={blocked} />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!inventory || blocked || !confirmed || deleting}
              onClick={async () => {
                setDeleting(true);
                const res = await deleteMyAccountAction(confirm);
                if (!res.ok) {
                  setDeleting(false);
                  toast.error(res.error);
                  void load();
                  return;
                }
                window.location.href = res.data.redirectTo;
              }}
            >
              {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Delete my account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
