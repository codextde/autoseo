"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { KeywordResearchRow } from "@/server/seo/lib/keywords";
import { saveKeywordsAction } from "../../actions/keywords";
import { toastError, unwrap } from "../../lib/client";

/** "Save N Keywords — These keywords will be saved to your current project." */
export function SaveKeywordsDialog({
  projectId,
  open,
  onOpenChange,
  rows,
  locationCode,
  languageCode,
  onSaved,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rows: KeywordResearchRow[];
  locationCode: number;
  languageCode: string;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const res = unwrap(
        await saveKeywordsAction(projectId, {
          keywords: rows.map((r) => r.keyword),
          locationCode,
          languageCode,
          metrics: rows.map((r) => ({
            keyword: r.keyword,
            searchVolume: r.searchVolume,
            cpc: r.cpc,
            competition: r.competition,
            keywordDifficulty: r.keywordDifficulty,
            intent: r.intent,
            monthlySearches: r.trend,
          })),
        }),
      );
      toast.success(`Saved ${res.savedCount} keyword${res.savedCount === 1 ? "" : "s"}`);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toastError(err, "Save failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Save {rows.length} Keyword{rows.length === 1 ? "" : "s"}
          </DialogTitle>
          <DialogDescription>These keywords will be saved to your current project.</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
          {rows.slice(0, 60).map((r) => (
            <span key={r.keyword} className="rounded-full bg-muted px-2 py-0.5 text-xs">
              {r.keyword}
            </span>
          ))}
          {rows.length > 60 && <span className="px-1 text-xs text-muted-foreground">+{rows.length - 60} more</span>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || rows.length === 0}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
