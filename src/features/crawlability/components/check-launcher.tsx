"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { startCrawlabilityCheckAction } from "../actions";

export function CheckLauncher({ projectId, domain, canRun, running, label = "Run check", size = "sm" }: { projectId: string; domain: string; canRun: boolean; running: boolean; label?: string; size?: "sm" | "default" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [urls, setUrls] = useState("");
  const [pending, start] = useTransition();

  const run = (list: string[]) =>
    start(async () => {
      const res = await startCrawlabilityCheckAction(projectId, { urls: list });
      if (!res.ok) return void toast.error(res.error);
      setOpen(false);
      toast.success("Crawlability check started");
      router.push(`/p/${projectId}/crawlability/${res.data.checkId}`);
    });

  return (
    <div className="flex items-center gap-1.5">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size={size} className="gap-1.5" disabled={!canRun || running}>
            <Plus className="size-3.5" /> Pages
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Check specific pages</DialogTitle>
            <DialogDescription>
              The homepage of {domain} is always checked. Add up to 10 key pages (pricing, product, docs…) — otherwise we sample pages from your sitemap.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="crawl-urls">URLs (one per line)</Label>
            <Textarea id="crawl-urls" rows={5} value={urls} onChange={(e) => setUrls(e.target.value)} placeholder={`https://${domain}/pricing\nhttps://${domain}/blog/...`} />
          </div>
          <DialogFooter>
            <Button onClick={() => run(urls.split(/\s+/).filter(Boolean))} disabled={pending} className="gap-1.5">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Run check
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Button size={size} className="gap-1.5" onClick={() => run([])} disabled={!canRun || running || pending}>
        {pending || running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
        {running ? "Checking…" : label}
      </Button>
    </div>
  );
}
