"use client";

import { useMemo, useState } from "react";
import { Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { SavedKeywordRow, SavedKeywordTagSummary } from "@/server/seo/saved-keywords";
import { normalizeTag, resolveTagColor, TAG_COLOR_HEX } from "@/server/seo/lib/tags";
import { updateSavedKeywordTagsAction } from "../../actions/saved";
import { toastError, unwrap } from "../../lib/client";
import { TagPill } from "../shared/badges";
import { cn } from "@/lib/utils";

/** "Apply or remove tags across N selected keywords" (Add / Remove modes). */
export function BulkTagDialog({
  projectId,
  open,
  onOpenChange,
  selectedRows,
  tags,
  onApplied,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  selectedRows: SavedKeywordRow[];
  tags: SavedKeywordTagSummary[];
  onApplied: () => void;
}) {
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [pending, setPending] = useState<string[]>([]);
  const [removeIds, setRemoveIds] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const onRows = useMemo(() => {
    const ids = new Set(selectedRows.flatMap((r) => r.tags.map((t) => t.id)));
    return tags.filter((t) => ids.has(t.id));
  }, [selectedRows, tags]);
  const normalizedQ = normalizeTag(q)?.normalizedName;
  const matches = tags.filter((t) => !q || t.normalizedName.includes(q.trim().toLowerCase()));
  const canCreate = normalizedQ && !tags.some((t) => t.normalizedName === normalizedQ) && !pending.some((p) => p.toLowerCase() === normalizedQ);
  const togglePending = (name: string) => setPending((p) => (p.includes(name) ? p.filter((x) => x !== name) : [...p, name].slice(0, 20)));
  const apply = async () => {
    setBusy(true);
    try {
      const res = unwrap(
        await updateSavedKeywordTagsAction(projectId, {
          savedKeywordIds: selectedRows.map((r) => r.id),
          addTags: mode === "add" ? pending : undefined,
          removeTagIds: mode === "remove" ? removeIds : undefined,
        }),
      );
      toast.success(`Updated tags for ${res.taggedCount} keyword${res.taggedCount === 1 ? "" : "s"}`);
      setPending([]);
      setRemoveIds([]);
      setQ("");
      onOpenChange(false);
      onApplied();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  const count = mode === "add" ? pending.length : removeIds.length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tag keywords</DialogTitle>
          <DialogDescription>
            Apply or remove tags across {selectedRows.length} selected keyword{selectedRows.length === 1 ? "" : "s"}.
          </DialogDescription>
        </DialogHeader>
        <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as "add" | "remove")} variant="outline" className="w-full">
          <ToggleGroupItem value="add" className="flex-1">
            Add tags ({pending.length})
          </ToggleGroupItem>
          <ToggleGroupItem value="remove" className="flex-1">
            Remove tags ({removeIds.length})
          </ToggleGroupItem>
        </ToggleGroup>
        {mode === "add" ? (
          <div className="space-y-3">
            {pending.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {pending.map((p) => {
                  const existing = tags.find((t) => t.normalizedName === p.toLowerCase());
                  return <TagPill key={p} tag={existing ?? { id: p, name: p }} onRemove={() => togglePending(p)} />;
                })}
              </div>
            )}
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search or create…"
              maxLength={64}
              onKeyDown={(e) => {
                if (e.key === "Enter" && q.trim()) {
                  e.preventDefault();
                  const existing = tags.find((t) => t.normalizedName === normalizedQ);
                  togglePending(existing?.name ?? normalizeTag(q)!.name);
                  setQ("");
                }
              }}
            />
            <div className="max-h-56 space-y-0.5 overflow-y-auto">
              {canCreate && (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    togglePending(normalizeTag(q)!.name);
                    setQ("");
                  }}
                >
                  <Plus className="size-3.5" /> Create “{normalizeTag(q)!.name}”
                </button>
              )}
              {matches.map((t) => {
                const checked = pending.includes(t.name);
                return (
                  <button key={t.id} type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={() => togglePending(t.name)}>
                    <span className={cn("flex size-4 items-center justify-center rounded-[4px] border", checked ? "border-foreground bg-foreground text-background" : "border-input")}>
                      {checked && <Check className="size-3" />}
                    </span>
                    <span className="size-2 rounded-full" style={{ background: TAG_COLOR_HEX[resolveTagColor(t)] }} />
                    <span className="flex-1 truncate">{t.name}</span>
                    <span className="text-xs text-muted-foreground">{t.keywordCount}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : onRows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">The selected keywords don&apos;t have any tags to remove.</p>
        ) : (
          <div className="max-h-64 space-y-0.5 overflow-y-auto">
            {onRows.map((t) => {
              const checked = removeIds.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => setRemoveIds((r) => (checked ? r.filter((x) => x !== t.id) : [...r, t.id]))}
                >
                  <span className={cn("flex size-4 items-center justify-center rounded-[4px] border", checked ? "border-foreground bg-foreground text-background" : "border-input")}>
                    {checked && <Check className="size-3" />}
                  </span>
                  <TagPill tag={t} />
                </button>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || count === 0} onClick={apply}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
