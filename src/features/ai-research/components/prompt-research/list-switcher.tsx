"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, ListPlus, Loader2, Pencil, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { createListAction, deleteListAction, renameListAction, setDefaultListAction } from "../../actions/research";
import type { ResearchList } from "../../types";

export function ListSwitcher({ projectId, lists, active, canManage }: { projectId: string; lists: ResearchList[]; active: ResearchList; canManage: boolean }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"create" | "rename" | "delete" | null>(null);
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const go = (id: string) => router.replace(`/p/${projectId}/ai/prompt-research?list=${id}`, { scroll: false });

  const submit = () =>
    start(async () => {
      if (dialog === "create") {
        const res = await createListAction(projectId, name);
        if (!res.ok) return void toast.error(res.error);
        toast.success("List created");
        setDialog(null);
        go(res.data.id);
      } else if (dialog === "rename") {
        const res = await renameListAction(projectId, active.id, name);
        if (!res.ok) return void toast.error(res.error);
        setDialog(null);
        router.refresh();
      } else if (dialog === "delete") {
        const res = await deleteListAction(projectId, active.id);
        if (!res.ok) return void toast.error(res.error);
        toast.success("List deleted");
        setDialog(null);
        router.replace(`/p/${projectId}/ai/prompt-research`, { scroll: false });
        router.refresh();
      }
    });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="max-w-56 justify-between gap-1.5">
            <span className="truncate">{active.name}</span>
            <span className="text-xs text-muted-foreground tabular">{active.itemCount}</span>
            <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Prompt lists</DropdownMenuLabel>
          {lists.map((l) => (
            <DropdownMenuItem key={l.id} onSelect={() => go(l.id)} className="gap-2">
              <Check className={l.id === active.id ? "size-3.5" : "size-3.5 opacity-0"} />
              <span className="min-w-0 flex-1 truncate">{l.name}</span>
              {l.isDefault && <Star className="size-3 fill-current text-muted-foreground" />}
              {l.status === "generating" && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
              <span className="text-xs text-muted-foreground tabular">{l.itemCount}</span>
            </DropdownMenuItem>
          ))}
          {canManage && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  setName("");
                  setDialog("create");
                }}
              >
                <ListPlus className="size-3.5" /> New list
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setName(active.name);
                  setDialog("rename");
                }}
              >
                <Pencil className="size-3.5" /> Rename “{active.name}”
              </DropdownMenuItem>
              {!active.isDefault && (
                <DropdownMenuItem
                  onSelect={() =>
                    start(async () => {
                      const res = await setDefaultListAction(projectId, active.id);
                      if (!res.ok) toast.error(res.error);
                      else router.refresh();
                    })
                  }
                >
                  <Star className="size-3.5" /> Set as default
                </DropdownMenuItem>
              )}
              <DropdownMenuItem variant="destructive" onSelect={() => setDialog("delete")}>
                <Trash2 className="size-3.5" /> Delete list
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialog === "create" || dialog === "rename"} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog === "create" ? "New prompt list" : "Rename list"}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="space-y-4"
          >
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="List name" maxLength={120} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !name.trim()}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                {dialog === "create" ? "Create list" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={dialog === "delete"} onOpenChange={(v) => !v && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{active.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The list and its {active.itemCount} researched prompts are deleted. Prompts already added to the tracker stay tracked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              Delete list
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
