"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErasureInventoryList, type InventoryItemView } from "@/features/settings/account/erasure-inventory";
import { eraseUserAction, getUserErasureInventoryAction } from "../actions/users";

type Inventory = { items: InventoryItemView[]; blockers: { code: string; message: string }[] };

/** "Erase user": dry-run inventory (counts per table) → type the email → GDPR erasure. */
export function EraseUserDialog({
  user,
  onErased,
}: {
  user: { id: string; email: string; name: string | null };
  onErased: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setError(null);
    setInventory(null);
    const res = await getUserErasureInventoryAction(user.id);
    if (res.ok) setInventory(res.data);
    else setError(res.error);
  };

  const blocked = (inventory?.blockers.length ?? 0) > 0;
  const confirmed = confirm.trim().toLowerCase() === user.email.toLowerCase();

  return (
    <>
      <Button
        variant="destructive"
        size="sm"
        className="h-8 gap-1.5"
        onClick={() => {
          setOpen(true);
          setConfirm("");
          void load();
        }}
      >
        <Trash2 className="size-3.5" /> Erase user…
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Erase {user.name || user.email}?</DialogTitle>
            <DialogDescription>
              Dry run below — nothing has been changed yet. Erasure is permanent (GDPR “right to be forgotten”): personal data is
              deleted, activity is anonymized, workspace resources stay with the team.
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
                <div className="space-y-1 rounded-xl border border-warning/40 bg-warning/10 p-3">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-warning">
                    <AlertTriangle className="size-4" /> Can&apos;t erase yet
                  </p>
                  {inventory.blockers.map((b) => (
                    <p key={b.code} className="text-xs text-muted-foreground">
                      {b.message} Change roles in the Workspaces section of this drawer.
                    </p>
                  ))}
                </div>
              )}
              <ErasureInventoryList items={inventory.items} />
              <div className="space-y-1.5">
                <Label htmlFor="admin-erase-confirm">
                  Type <span className="font-semibold">{user.email}</span> to confirm
                </Label>
                <Input
                  id="admin-erase-confirm"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder={user.email}
                  autoComplete="off"
                  disabled={blocked}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!inventory || blocked || !confirmed || busy}
              onClick={async () => {
                setBusy(true);
                const res = await eraseUserAction(user.id, confirm);
                setBusy(false);
                if (!res.ok) {
                  toast.error(res.error);
                  void load();
                  return;
                }
                toast.success("User erased");
                setOpen(false);
                onErased();
              }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Erase permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
