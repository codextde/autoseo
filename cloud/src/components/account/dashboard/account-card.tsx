"use client";

import { useActionState, useState } from "react";
import { LogOut, MonitorSmartphone, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ActionButton } from "@/components/account/action-button";
import { deleteAccountAction, signOutAction, signOutEverywhereAction, type ActionResult } from "@/server/actions/auth";

export function AccountCard({
  email,
  sessions,
  canDelete,
}: {
  email: string;
  sessions: number;
  canDelete: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>Signed in as {email}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            <p className="font-medium">Devices</p>
            <p className="text-muted-foreground">
              Signed in on {sessions} {sessions === 1 ? "device" : "devices"}. Sessions last a year.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton variant="outline" action={signOutAction} icon={<LogOut />}>
              Sign out
            </ActionButton>
            <ActionButton
              variant="outline"
              action={signOutEverywhereAction}
              icon={<MonitorSmartphone />}
              confirm="Sign out on all devices, including this one?"
            >
              Sign out everywhere
            </ActionButton>
          </div>
        </div>
        <Separator />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            <p className="font-medium">Delete account</p>
            <p className="text-muted-foreground">
              {canDelete
                ? "Permanently removes your account and any remaining instance data."
                : "Cancel your subscription first — you can delete your account once it has ended."}
            </p>
          </div>
          <DeleteAccountDialog email={email} disabled={!canDelete} />
        </div>
      </CardContent>
    </Card>
  );
}

function DeleteAccountDialog({ email, disabled }: { email: string; disabled: boolean }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(deleteAccountAction, {});
  const [confirm, setConfirm] = useState("");
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="destructive" disabled={disabled}>
          <Trash2 /> Delete account
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This removes your AutoSEO Cloud account and deletes any remaining instance including all of its data. This
              can&apos;t be undone. Invoices stay available from Stripe.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="confirm-email">
              Type <span className="font-mono">{email}</span> to confirm
            </Label>
            <Input id="confirm-email" name="confirm" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="destructive" disabled={pending || confirm.trim().toLowerCase() !== email}>
              {pending ? <Spinner /> : <Trash2 />} Delete forever
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
