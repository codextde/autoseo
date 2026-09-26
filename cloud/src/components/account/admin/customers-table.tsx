"use client";

import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { ExternalLink, MoreHorizontal, Play, Power, RefreshCw, RotateCcw, Rocket, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogClose,
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { adminDeleteInstanceAction, adminInstanceAction, type AdminActionState, type InstanceOp } from "@/server/actions/admin";
import { FormResult, useResultToast } from "./form-bits";

export type CustomerRow = {
  instanceId: string | null;
  email: string | null;
  slug: string | null;
  host: string | null;
  status: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasService: boolean;
  error: string | null;
  createdAt: string;
};

const statusStyle: Record<string, string> = {
  running: "bg-brand-soft text-brand dark:bg-brand/15",
  provisioning: "bg-info/15 text-info",
  pending_payment: "bg-muted text-muted-foreground",
  stopped: "bg-warning/15 text-foreground",
  failed: "bg-destructive/10 text-destructive",
  deleted: "bg-muted text-muted-foreground line-through",
};

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">no instance</span>;
  return <Badge className={cn("font-medium", statusStyle[status])}>{status.replace("_", " ")}</Badge>;
}

function fmt(iso: string | null) {
  return iso ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(iso)) : "—";
}

function RowActions({ row, onDelete }: { row: CustomerRow; onDelete: () => void }) {
  const [pending, start] = useTransition();
  if (!row.instanceId || row.status === "deleted") return null;
  const run = (op: InstanceOp, confirm?: string) => {
    if (confirm && !window.confirm(confirm)) return;
    start(async () => {
      const res = await adminInstanceAction(row.instanceId!, op);
      if (res.error) toast.error(res.error);
      else if (res.message) toast.success(res.message);
    });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.slug}`} disabled={pending}>
          {pending ? <Spinner /> : <MoreHorizontal />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="truncate text-xs text-muted-foreground">{row.host}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => run("provision", `Provision / retry ${row.slug}? This creates or updates the Coolify service and starts it.`)}>
          <RefreshCw /> Provision / retry
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!row.hasService} onSelect={() => run("start")}>
          <Play /> Start
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!row.hasService} onSelect={() => run("stop", `Stop ${row.slug}? The customer loses access until it is started again.`)}>
          <Power /> Stop
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!row.hasService} onSelect={() => run("restart")}>
          <RotateCcw /> Restart
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!row.hasService} onSelect={() => run("redeploy", `Redeploy ${row.slug} with the latest image?`)}>
          <Rocket /> Redeploy (latest image)
        </DropdownMenuItem>
        {row.host && (
          <DropdownMenuItem asChild>
            <a href={`https://${row.host}`} target="_blank" rel="noopener">
              <ExternalLink /> Open instance
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 /> Delete…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DeleteDialog({ row, onClose }: { row: CustomerRow; onClose: () => void }) {
  const [state, action, pending] = useActionState<AdminActionState, FormData>(async (prev, fd) => {
    const res = await adminDeleteInstanceAction(prev, fd);
    if (res.ok) onClose();
    return res;
  }, {});
  const [confirm, setConfirm] = useState("");
  useResultToast(state);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form action={action} className="space-y-4">
          <input type="hidden" name="instanceId" value={row.instanceId ?? ""} />
          <DialogHeader>
            <DialogTitle>Delete {row.host}?</DialogTitle>
            <DialogDescription>
              Removes the Coolify service including its volumes (database and uploads) and cancels a still-active subscription
              immediately. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="confirmSlug">
              Type <span className="font-mono">{row.slug}</span> to confirm
            </Label>
            <Input id="confirmSlug" name="confirmSlug" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <FormResult state={state.error ? state : {}} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="destructive" disabled={pending || confirm !== row.slug}>
              {pending ? <Spinner /> : <Trash2 />} Delete instance
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CustomersTable({ rows }: { rows: CustomerRow[] }) {
  const [deleting, setDeleting] = useState<CustomerRow | null>(null);
  if (!rows.length) return <p className="py-10 text-center text-sm text-muted-foreground">No customers yet.</p>;
  return (
    <>
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Instance</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Subscription</TableHead>
              <TableHead>Period end</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.instanceId ?? `user-${row.email}`}>
                <TableCell className="max-w-56 truncate font-medium">{row.email ?? <span className="text-muted-foreground">deleted user</span>}</TableCell>
                <TableCell className="font-mono text-xs">
                  {row.host ? (
                    <a href={`https://${row.host}`} target="_blank" rel="noopener" className="hover:underline">
                      {row.slug}
                    </a>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  {row.error && row.status !== "running" ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex cursor-help">
                          <StatusBadge status={row.status} />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-sm">{row.error}</TooltipContent>
                    </Tooltip>
                  ) : (
                    <StatusBadge status={row.status} />
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  {row.subscriptionStatus ?? "—"}
                  {row.cancelAtPeriodEnd && <span className="ml-1 text-muted-foreground">(canceling)</span>}
                </TableCell>
                <TableCell className="text-xs">{fmt(row.currentPeriodEnd)}</TableCell>
                <TableCell className="text-xs">{fmt(row.createdAt)}</TableCell>
                <TableCell>
                  <RowActions row={row} onDelete={() => setDeleting(row)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {deleting && <DeleteDialog row={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
}
