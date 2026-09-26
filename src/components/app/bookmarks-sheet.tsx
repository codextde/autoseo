"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Bookmark, BookmarkPlus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { deleteBookmarkAction, listBookmarksAction, saveBookmarkAction } from "@/features/shell/actions";
import { useShell } from "./shell-context";

type Row = { id: string; name: string; path: string; shared: boolean; own: boolean };

export function BookmarksSheet() {
  const shell = useShell();
  const pathname = usePathname();
  const search = useSearchParams();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [pending, start] = useTransition();
  const fullPath = pathname + (search.toString() ? `?${search.toString()}` : "");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void listBookmarksAction(shell.currentProjectId).then((r) => {
      if (alive && r.ok) setRows(r.data as Row[]);
    });
    return () => {
      alive = false;
    };
  }, [open, shell.currentProjectId]);

  const onOpenChange = (v: boolean) => {
    if (v) setName(document.title.split("·")[0]?.trim() || "Saved view");
    setOpen(v);
  };

  const save = () =>
    start(async () => {
      const res = await saveBookmarkAction({ name, path: fullPath, projectId: shell.currentProjectId, shared });
      if (!res.ok) return void toast.error(res.error);
      setRows((r) => [{ ...(res.data as unknown as Row), own: true }, ...r]);
      toast.success("View saved");
    });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="size-9" aria-label="Bookmarks">
              <Bookmark className="size-[18px]" />
            </Button>
          </SheetTrigger>
        </TooltipTrigger>
        <TooltipContent>Bookmarks</TooltipContent>
      </Tooltip>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Bookmark className="size-4 text-brand" /> Bookmarks
          </SheetTitle>
          <SheetDescription>Save any view — filters, tabs and open panels are restored from the URL.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          <div className="space-y-3 rounded-xl border bg-muted/40 p-3">
            <Label className="text-xs text-muted-foreground">Save current view</Label>
            <div className="flex gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
              <Button onClick={save} disabled={pending || !name.trim()} className="gap-1.5">
                <BookmarkPlus className="size-4" /> Save
              </Button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-[11px] text-muted-foreground">{fullPath}</span>
              <label className="flex shrink-0 items-center gap-2 text-xs">
                <Switch checked={shared} onCheckedChange={setShared} /> Share with team
              </label>
            </div>
          </div>
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center">
              <Bookmark className="mx-auto mb-2 size-5 text-muted-foreground" />
              <p className="text-sm font-medium">No bookmarks yet</p>
              <p className="text-xs text-muted-foreground">Shared bookmarks from teammates also show up here.</p>
            </div>
          ) : (
            <ul className="divide-y rounded-xl border">
              {rows.map((b) => (
                <li key={b.id} className="flex items-center gap-2 px-3 py-2.5">
                  <Link href={b.path} onClick={() => setOpen(false)} className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 truncate text-sm font-medium">
                      {b.name} {b.shared && <Users className="size-3 text-muted-foreground" />}
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">{b.path}</div>
                  </Link>
                  {b.own && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={async () => {
                        const r = await deleteBookmarkAction(b.id);
                        if (r.ok) setRows((rows) => rows.filter((x) => x.id !== b.id));
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
