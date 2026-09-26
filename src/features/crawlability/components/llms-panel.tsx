"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Loader2, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/app/page";
import { cn } from "@/lib/utils";
import { SeverityIcon } from "@/features/audit/components/bits";
import type { LlmsFileCheck } from "@/server/crawlability/types";
import { generateLlmsTxtAction } from "../actions";
import { CodeBlock } from "./findings-list";

function FileStatus({ label, file }: { label: string; file: LlmsFileCheck }) {
  const v = file.validation;
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-mono text-sm font-medium">
            <FileText className="size-4 text-muted-foreground" /> {label}
          </p>
          <a href={file.url} target="_blank" rel="noopener noreferrer nofollow" className="block truncate text-xs text-muted-foreground hover:underline">
            {file.url}
          </a>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
            file.present && v?.valid ? "bg-success/12 text-success" : file.present ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground",
          )}
        >
          {file.present ? (v?.valid ? "Valid" : "Has problems") : file.status ? `Missing (${file.status})` : "Missing"}
        </span>
      </div>
      {file.present && v && (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-muted/50 py-1.5">
              <div className="text-[10px] text-muted-foreground">Size</div>
              <div className="text-sm font-semibold tabular">{Math.max(1, Math.round(file.bytes / 1024))} KB</div>
            </div>
            <div className="rounded-lg bg-muted/50 py-1.5">
              <div className="text-[10px] text-muted-foreground">Sections</div>
              <div className="text-sm font-semibold tabular">{v.sections.length}</div>
            </div>
            <div className="rounded-lg bg-muted/50 py-1.5">
              <div className="text-[10px] text-muted-foreground">Links</div>
              <div className="text-sm font-semibold tabular">{v.linkCount}</div>
            </div>
          </div>
          {v.title && (
            <p className="text-sm">
              <span className="font-medium">{v.title}</span>
              {v.summary && <span className="text-muted-foreground"> — {v.summary}</span>}
            </p>
          )}
          {[...v.errors.map((m) => ({ s: "critical" as const, m })), ...v.warnings.map((m) => ({ s: "warning" as const, m }))].map((x, i) => (
            <p key={i} className="flex gap-2 text-xs">
              <SeverityIcon severity={x.s} className="size-3.5 shrink-0" /> {x.m}
            </p>
          ))}
          {file.preview && (
            <details className="rounded-lg border bg-muted/30">
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium">Preview</summary>
              <pre className="max-h-72 overflow-auto px-3 pb-3 font-mono text-[11px] whitespace-pre-wrap">{file.preview}</pre>
            </details>
          )}
        </>
      )}
    </div>
  );
}

export function LlmsPanel({
  projectId,
  checkId,
  txt,
  full,
  draft,
  draftSource,
  aiStatus,
  aiError,
  aiAvailable,
  canRun,
}: {
  projectId: string;
  checkId: string;
  txt: LlmsFileCheck;
  full: LlmsFileCheck;
  draft: string | null;
  draftSource: "template" | "ai" | null;
  aiStatus: "idle" | "running" | "failed";
  aiError: string | null;
  aiAvailable: boolean;
  canRun: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState(draft);
  const [source, setSource] = useState(draftSource);
  const [running, setRunning] = useState(aiStatus === "running");
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!running) return;
    let alive = true;
    const t = setInterval(async () => {
      const res = await fetch(`/p/${projectId}/crawlability/${checkId}/status`, { cache: "no-store" }).catch(() => null);
      if (!res?.ok || !alive) return;
      const data = (await res.json()) as { llmsTxtStatus: string; llmsTxtError: string | null };
      if (data.llmsTxtStatus !== "running") {
        setRunning(false);
        if (data.llmsTxtStatus === "failed") toast.error(data.llmsTxtError ?? "AI generation failed");
        else toast.success("AI llms.txt draft ready");
        router.refresh();
      }
    }, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [running, projectId, checkId, router]);

  const generate = (mode: "template" | "ai") =>
    start(async () => {
      const res = await generateLlmsTxtAction(projectId, checkId, mode);
      if (!res.ok) return void toast.error(res.error);
      if (res.data.status === "done") {
        setText(res.data.text);
        setSource("template");
        toast.success("llms.txt draft generated");
      } else {
        setRunning(true);
        toast.info("Writing llms.txt with AI — this can take a minute");
      }
    });

  const downloadDraft = () => {
    if (!text) return;
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "llms.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <FileStatus label="/llms.txt" file={txt} />
        <FileStatus label="/llms-full.txt" file={full} />
      </div>
      <Panel
        title="llms.txt generator"
        description="Builds an llmstxt.org-formatted file from your sitemap and crawled pages. Review it, then publish it at your domain root."
        icon={<Wand2 className="size-4 text-brand" />}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => generate("template")} disabled={!canRun || pending || running}>
              {pending && !running ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />} From site structure
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => generate("ai")} disabled={!canRun || !aiAvailable || pending || running} title={aiAvailable ? undefined : "Connect a local agent or add an API key in Admin → AI Providers"}>
              {running ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} {running ? "Writing…" : "Write with AI"}
            </Button>
          </div>
        }
      >
        {!aiAvailable && <p className="mb-3 text-xs text-muted-foreground">AI generation needs a connected local agent (Claude Code / Codex) or an API key in Admin → AI Providers.</p>}
        {aiStatus === "failed" && aiError && !running && <p className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{aiError}</p>}
        {text ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{source === "ai" ? "AI-written draft" : "Generated from site structure"} — review before publishing</span>
              <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={downloadDraft}>
                <Download className="size-3.5" /> Download
              </Button>
            </div>
            <CodeBlock code={text} filename="llms.txt" />
          </div>
        ) : (
          <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            {running ? "The AI is writing your llms.txt…" : "No draft yet. Generate one from your site structure or let AI write it."}
          </p>
        )}
      </Panel>
    </div>
  );
}
