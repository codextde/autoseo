"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Gauge, Globe, Loader2, Play, Zap } from "lucide-react";
import { toast } from "sonner";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { Panel } from "@/components/app/page";
import { startAuditAction } from "../actions";

export function LaunchForm({
  projectId,
  defaultUrl,
  limits,
  providers,
  canRun,
  runningAuditId,
}: {
  projectId: string;
  defaultUrl: string;
  limits: { minPages: number; maxPages: number; defaultPages: number };
  providers: { psiKey: boolean; dataforseo: boolean };
  canRun: boolean;
  runningAuditId: string | null;
}) {
  const router = useRouter();
  const [url, setUrl] = useState(defaultUrl);
  const [pagesInput, setPagesInput] = useState(String(limits.defaultPages));
  const [lighthouse, setLighthouse] = useState(false);
  const [provider, setProvider] = useState<"psi" | "dataforseo">("psi");
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, start] = useTransition();

  const clamp = (v: string) => {
    const n = Number(v || limits.defaultPages);
    return Math.min(Math.max(Number.isFinite(n) ? Math.round(n) : limits.defaultPages, limits.minPages), limits.maxPages);
  };

  const submit = () => {
    setError(null);
    const maxPages = clamp(pagesInput);
    setPagesInput(String(maxPages));
    start(async () => {
      const res = await startAuditAction(projectId, { startUrl: url, maxPages, lighthouse, lighthouseProvider: provider });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success("Audit started", { description: res.data.startUrl });
      router.push(`/p/${projectId}/seo/audit/${res.data.auditId}`);
    });
  };

  const onStart = () => {
    if (!url.trim()) {
      setError("Please enter a URL.");
      return;
    }
    if (clamp(pagesInput) > 500) setConfirmOpen(true);
    else submit();
  };

  return (
    <Panel
      title="Start new audit"
      description="Crawls your site like a search engine — plain HTML, robots.txt respected — and checks 29 technical SEO rules."
      icon={<Zap className="size-4 text-brand" />}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onStart();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px]">
          <div className="space-y-1.5">
            <Label htmlFor="audit-url">Website URL</Label>
            <div className="relative">
              <Globe className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="audit-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
                className="h-10 pl-9"
                inputMode="url"
                autoComplete="off"
                disabled={!canRun}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audit-pages">Max pages</Label>
            <Input
              id="audit-pages"
              value={pagesInput}
              onChange={(e) => /^\d*$/.test(e.target.value) && setPagesInput(e.target.value)}
              onBlur={() => setPagesInput(String(clamp(pagesInput)))}
              inputMode="numeric"
              className="h-10 tabular"
              disabled={!canRun}
            />
            <p className="text-[11px] text-muted-foreground">
              {limits.minPages.toLocaleString()}–{limits.maxPages.toLocaleString()} pages
            </p>
          </div>
        </div>

        <div className="rounded-xl border bg-muted/30 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Label htmlFor="audit-lh" className="flex items-center gap-2 text-sm font-medium">
                <Gauge className="size-4 text-muted-foreground" /> Include Lighthouse
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Runs Lighthouse on up to 10 representative pages (homepage + one per URL template) on mobile and desktop.
              </p>
            </div>
            <Switch id="audit-lh" checked={lighthouse} onCheckedChange={setLighthouse} disabled={!canRun} />
          </div>
          {lighthouse && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-3 grid gap-2 sm:grid-cols-[220px_1fr] sm:items-center">
              <Select value={provider} onValueChange={(v) => setProvider(v as "psi" | "dataforseo")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="psi">PageSpeed Insights (free)</SelectItem>
                  <SelectItem value="dataforseo" disabled={!providers.dataforseo}>
                    DataForSEO Lighthouse{providers.dataforseo ? " (billed)" : " — not configured"}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {provider === "psi"
                  ? providers.psiKey
                    ? "Using your PageSpeed Insights API key."
                    : "No API key configured — Google's shared anonymous quota is often exhausted. Add a free key in Admin → Google."
                  : "≈ $0.004 per check, up to 20 checks. Billed calls are never retried."}
              </p>
            </motion.div>
          )}
        </div>

        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        {runningAuditId && (
          <p className="rounded-lg bg-info/10 px-3 py-2 text-sm text-info">
            An audit is currently running.{" "}
            <button type="button" className="font-medium underline underline-offset-2" onClick={() => router.push(`/p/${projectId}/seo/audit/${runningAuditId}`)}>
              View progress
            </button>
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {canRun ? "User agent: AutoSEO-Audit · robots.txt & crawl-delay respected · 429s back off automatically." : "You need the “Run SEO research” permission to start audits."}
          </p>
          <Button type="submit" disabled={!canRun || pending || !!runningAuditId} className="h-9 gap-2">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            {pending ? "Starting…" : "Start audit"}
          </Button>
        </div>
      </form>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Crawl {clamp(pagesInput).toLocaleString()} pages?</AlertDialogTitle>
            <AlertDialogDescription>This is okay, but it may take a while. You can leave the page — the audit keeps running in the background.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                submit();
              }}
            >
              Start audit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}
