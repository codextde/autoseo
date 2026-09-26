"use client";

import { useState } from "react";
import { Check, ChevronDown, MoreHorizontal, Tag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { SavedKeywordTagSummary } from "@/server/seo/saved-keywords";
import { resolveTagColor, TAG_COLOR_HEX, TAG_COLOR_KEYS, type TagColorKey } from "@/server/seo/lib/tags";
import { deleteSavedKeywordTagAction, updateSavedKeywordTagAction } from "../../actions/saved";
import { toastError, unwrap } from "../../lib/client";
import { cn } from "@/lib/utils";

/** Tag filter dropdown: searchable list (dot + count), multi-select (ANY), per-tag manage (rename, colour, delete). */
export function TagFilter({
  projectId,
  tags,
  selected,
  onChange,
  canManage,
  onTagsChanged,
}: {
  projectId: string;
  tags: SavedKeywordTagSummary[];
  selected: string[];
  onChange: (ids: string[]) => void;
  canManage: boolean;
  onTagsChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [managing, setManaging] = useState<string | null>(null);
  const filtered = tags.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()));
  const label = selected.length === 0 ? "All tags" : selected.length === 1 ? (tags.find((t) => t.id === selected[0])?.name ?? "1 tag") : `Tags (${selected.length})`;
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setManaging(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 font-normal">
          <Tag className="size-3.5 text-muted-foreground" />
          <span className="max-w-32 truncate">{label}</span>
          <ChevronDown className="size-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        {managing ? (
          <ManageTag
            projectId={projectId}
            tag={tags.find((t) => t.id === managing)!}
            onDone={() => {
              setManaging(null);
              onTagsChanged();
            }}
            onDeleted={(id) => {
              onChange(selected.filter((s) => s !== id));
              setManaging(null);
              onTagsChanged();
            }}
          />
        ) : (
          <div>
            <div className="border-b p-2">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tags…" className="h-8" />
            </div>
            <div className="max-h-72 overflow-y-auto p-1">
              {filtered.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted-foreground">{tags.length ? "No tags match." : "No tags yet — tag keywords from the table."}</p>}
              {filtered.map((t) => {
                const checked = selected.includes(t.id);
                const hex = TAG_COLOR_HEX[resolveTagColor(t)];
                return (
                  <div key={t.id} className="group flex items-center gap-1 rounded-md hover:bg-muted">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm"
                      onClick={() => onChange(checked ? selected.filter((s) => s !== t.id) : [...selected, t.id])}
                    >
                      <span className={cn("flex size-4 items-center justify-center rounded-[4px] border", checked ? "border-foreground bg-foreground text-background" : "border-input")}>
                        {checked && <Check className="size-3" />}
                      </span>
                      <span className="size-2 shrink-0 rounded-full" style={{ background: hex }} />
                      <span className="flex-1 truncate">{t.name}</span>
                      <span className="text-xs text-muted-foreground tabular">{t.keywordCount}</span>
                    </button>
                    {canManage && (
                      <Button variant="ghost" size="icon-xs" className="mr-1 opacity-60 group-hover:opacity-100" onClick={() => setManaging(t.id)} aria-label={`Manage ${t.name}`}>
                        <MoreHorizontal />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
            {selected.length > 0 && (
              <div className="border-t p-1">
                <Button variant="ghost" size="sm" className="w-full" onClick={() => onChange([])}>
                  Clear all
                </Button>
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ManageTag({
  projectId,
  tag,
  onDone,
  onDeleted,
}: {
  projectId: string;
  tag: SavedKeywordTagSummary;
  onDone: () => void;
  onDeleted: (id: string) => void;
}) {
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState<TagColorKey>(resolveTagColor(tag));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      unwrap(await updateSavedKeywordTagAction(projectId, { tagId: tag.id, name: name.trim() !== tag.name ? name.trim() : undefined, color }));
      toast.success("Tag updated");
      onDone();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      unwrap(await deleteSavedKeywordTagAction(projectId, tag.id));
      toast.success("Tag deleted");
      onDeleted(tag.id);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3 p-3">
      <div className="text-xs font-medium text-muted-foreground">Manage tag</div>
      <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} className="h-8" aria-label="Tag name" />
      <div className="flex flex-wrap gap-1.5">
        {TAG_COLOR_KEYS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            className={cn("size-6 rounded-full ring-offset-2 ring-offset-popover transition", color === c && "ring-2 ring-foreground")}
            style={{ background: TAG_COLOR_HEX[c] }}
            aria-label={c}
          />
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={remove} title={tag.keywordCount ? "Remove the tag from its keywords first" : undefined}>
          <Trash2 /> Delete
        </Button>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" onClick={onDone}>
            Back
          </Button>
          <Button size="sm" disabled={busy || !name.trim()} onClick={save}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
