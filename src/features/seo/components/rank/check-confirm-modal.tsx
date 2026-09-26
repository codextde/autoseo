"use client";

import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { devicesCount, estimateLiveCheckSeconds, estimateRankCheckCost, type RankDevices } from "@/server/seo/lib/rank-tracking";
import { formatUsd } from "@/server/seo/lib/costs";
import { formatDuration } from "./rank-utils";

/** Confirmation for manual checks of ≥50 keywords (live SERP endpoint). */
export function CheckConfirmModal({
  open,
  onOpenChange,
  keywordCount,
  devices,
  serpDepth,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  keywordCount: number;
  devices: RankDevices;
  serpDepth: number;
  busy: boolean;
  onConfirm: () => void;
}) {
  const d = devicesCount(devices);
  const total = keywordCount * d;
  const { costUsd } = estimateRankCheckCost(keywordCount, devices, serpDepth, "live");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Check {keywordCount.toLocaleString()} keywords</DialogTitle>
          <DialogDescription className="tabular">
            {keywordCount.toLocaleString()} keywords × {d} device{d === 1 ? "" : "s"} = {total.toLocaleString()} SERP checks
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border bg-muted/40 p-3">
            <div className="text-xs text-muted-foreground">Results in</div>
            <div className="text-lg font-semibold tabular">{formatDuration(estimateLiveCheckSeconds(total))}</div>
          </div>
          <div className="rounded-xl border bg-muted/40 p-3">
            <div className="text-xs text-muted-foreground">Estimated cost</div>
            <div className="text-lg font-semibold tabular">~{formatUsd(costUsd, 2)}</div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={busy} size="lg">
            {busy ? <Loader2 className="animate-spin" /> : <Play />}
            Run Now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
