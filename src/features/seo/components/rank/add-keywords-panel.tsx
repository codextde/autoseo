"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MAX_TRACKED_KEYWORD_LENGTH } from "@/server/seo/lib/rank-tracking";
import { addTrackingKeywordsAction } from "../../actions/rank";
import { toastError, unwrap } from "../../lib/client";

/** Bulk-paste keywords (one per line). Adding triggers a live subset check + a metrics refresh server-side. */
export function AddKeywordsPanel({
  projectId,
  configId,
  open,
  onClose,
  onAdded,
}: {
  projectId: string;
  configId: string;
  open: boolean;
  onClose: () => void;
  onAdded: (result: { added: number; checkTriggered: boolean; metricsJobId: string | null }) => void;
}) {
  const [text, setText] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const submit = async () => {
    const tooLong = lines.findIndex((l) => l.length > MAX_TRACKED_KEYWORD_LENGTH);
    if (tooLong >= 0) {
      setError(`Line ${tooLong + 1} is longer than ${MAX_TRACKED_KEYWORD_LENGTH} characters.`);
      return;
    }
    if (!lines.length) {
      setError("Enter at least one keyword.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = unwrap(await addTrackingKeywordsAction(projectId, { configId, keywords: lines, matchCase }));
      toast.success(`${res.added} keyword${res.added === 1 ? "" : "s"} added`);
      if (res.added > 0 && !res.checkTriggered) toast.message("Use “Check rankings” to check these keywords");
      setText("");
      onAdded(res);
      onClose();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
          <div className="space-y-3 rounded-2xl border bg-card p-4 shadow-soft">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Add keywords</span>
              <span className="text-xs text-muted-foreground tabular">{lines.length} keyword{lines.length === 1 ? "" : "s"}</span>
            </div>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Enter keywords, one per line" rows={5} className="font-mono text-sm" autoFocus />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={matchCase} onCheckedChange={(v) => setMatchCase(v === true)} />
                    Match case
                  </label>
                </TooltipTrigger>
                <TooltipContent className="max-w-64">
                  Track these keywords exactly as typed instead of lowercasing them. “Nodex” and “nodex” then become two separately tracked (and billed) keywords.
                </TooltipContent>
              </Tooltip>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={onClose}>
                  Cancel
                </Button>
                <Button size="sm" onClick={submit} disabled={busy || lines.length === 0}>
                  {busy && <Loader2 className="animate-spin" />}
                  Add
                </Button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
