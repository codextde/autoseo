"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { optimizeUrlAction } from "../actions";

export function OptimizeUrlDialog({
  projectId,
  domain,
  aiAvailable,
  open,
  onOpenChange,
}: {
  projectId: string;
  domain: string;
  aiAvailable: boolean;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [url, setUrl] = useState("");
  const [keyword, setKeyword] = useState("");
  const [prompt, setPrompt] = useState("");
  const [rewrite, setRewrite] = useState(aiAvailable);

  const submit = () =>
    start(async () => {
      const res = await optimizeUrlAction(projectId, { url, keyword, targetPrompt: prompt, rewrite });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Analyzing the page…", { description: res.data.rewrite ? "We'll score it and draft an optimized rewrite." : "We'll score it and list concrete fixes." });
      onOpenChange(false);
      router.push(`/p/${projectId}/content/${res.data.id}`);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanSearch className="size-4" /> Optimize an existing page
          </DialogTitle>
          <DialogDescription>We fetch the page, score it on the six AEO pillars and suggest (or draft) a rewrite.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="o-url">Page URL</Label>
            <Input id="o-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={`https://${domain}/…`} inputMode="url" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="o-kw">Target keyword</Label>
              <Input id="o-kw" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="optional" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="o-q">Question it should answer</Label>
              <Input id="o-q" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="optional" />
            </div>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-3 py-2.5">
            <span>
              <span className="block text-sm font-medium">Draft an optimized rewrite</span>
              <span className="block text-xs text-muted-foreground">
                {aiAvailable ? "Keeps every fact of the original, fixes structure, metadata and FAQs." : "Needs an AI provider — without one you get the score and a fix list."}
              </span>
            </span>
            <Switch checked={rewrite && aiAvailable} onCheckedChange={setRewrite} disabled={!aiAvailable} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || url.trim().length < 4}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <ScanSearch className="size-3.5" />} Analyze page
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
