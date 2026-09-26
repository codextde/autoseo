"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FileText, Loader2, Upload, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { StatusBadge, TimeAgo } from "@/components/app/misc";
import { formatNumber } from "@/components/app/metrics";
import { cn } from "@/lib/utils";
import type { SerializedUpload } from "@/server/analytics/bots/queries";

const MAX_BYTES = 1024 * 1024 * 1024;
const FORMATS = [
  { value: "auto", label: "Auto-detect" },
  { value: "nginx", label: "nginx (combined)" },
  { value: "apache", label: "Apache (combined)" },
  { value: "cloudflare", label: "Cloudflare (Logpush JSON)" },
  { value: "akamai", label: "Akamai DataStream 2" },
  { value: "ndjson", label: "NDJSON" },
  { value: "custom", label: "Custom / other" },
];

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; percent: number }
  | { kind: "processing"; upload: SerializedUpload | null; background: boolean }
  | { kind: "done"; upload: SerializedUpload }
  | { kind: "error"; message: string };

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

async function readError(res: Response) {
  try {
    const j = (await res.json()) as { error?: string };
    return j.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export function UploadLogsDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState("auto");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [drag, setDrag] = useState(false);
  const [recent, setRecent] = useState<SerializedUpload[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const uploadIdRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadRecent = useCallback(async () => {
    const res = await fetch(`/api/integrations/bot-logs?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
    if (res.ok) setRecent(((await res.json()) as { uploads: SerializedUpload[] }).uploads);
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/api/integrations/bot-logs?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<{ uploads: SerializedUpload[] }>) : null))
      .then((j) => {
        if (!cancelled && j) setRecent(j.uploads);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  const reset = () => {
    setFile(null);
    setPhase({ kind: "idle" });
    uploadIdRef.current = null;
  };

  const pick = (f: File | null | undefined) => {
    if (!f) return;
    if (f.size > MAX_BYTES) {
      toast.error("Files up to 1 GB are supported. Split larger logs or use the ingest API.");
      return;
    }
    if (f.size === 0) {
      toast.error("The file is empty.");
      return;
    }
    setFile(f);
    setPhase({ kind: "idle" });
  };

  const poll = async (id: string, signal: AbortSignal) => {
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      if (signal.aborted) return;
      const res = await fetch(`/api/integrations/bot-logs/${id}`, { cache: "no-store", signal });
      if (!res.ok) continue;
      const { upload } = (await res.json()) as { upload: SerializedUpload };
      if (upload.status === "completed") {
        setPhase({ kind: "done", upload });
        router.refresh();
        void loadRecent();
        return;
      }
      if (upload.status === "failed") {
        setPhase({ kind: "error", message: upload.error ?? "Processing failed." });
        void loadRecent();
        return;
      }
      setPhase({ kind: "processing", upload, background: true });
    }
  };

  const start = async () => {
    if (!file) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase({ kind: "uploading", percent: 0 });
    try {
      const init = await fetch("/api/integrations/bot-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, filename: file.name, size: file.size, format }),
        signal: controller.signal,
      });
      if (!init.ok) throw new Error(await readError(init));
      const { upload, chunkSize, background } = (await init.json()) as { upload: SerializedUpload; chunkSize: number; background: boolean };
      uploadIdRef.current = upload.id;
      let offset = 0;
      while (offset < file.size) {
        const chunk = file.slice(offset, Math.min(file.size, offset + chunkSize));
        let attempt = 0;
        for (;;) {
          const res = await fetch(`/api/integrations/bot-logs/${upload.id}?offset=${offset}`, {
            method: "PUT",
            headers: { "Content-Type": "application/octet-stream" },
            body: chunk,
            signal: controller.signal,
          }).catch((err: unknown) => {
            if (controller.signal.aborted) throw err;
            return null;
          });
          if (res?.ok) {
            offset = ((await res.json()) as { receivedBytes: number }).receivedBytes;
            break;
          }
          if (res && res.status < 500 && res.status !== 429) throw new Error(await readError(res));
          if (++attempt >= 4) throw new Error(res ? await readError(res) : "Network error while uploading.");
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
        setPhase({ kind: "uploading", percent: Math.round((offset / file.size) * 100) });
      }
      setPhase({ kind: "processing", upload: null, background });
      const done = await fetch(`/api/integrations/bot-logs/${upload.id}`, { method: "POST", signal: controller.signal });
      const body = (await done.json().catch(() => ({}))) as { status?: string; upload?: SerializedUpload; error?: string };
      if (!done.ok) throw new Error(body.error ?? `HTTP ${done.status}`);
      if (body.status === "queued") {
        setPhase({ kind: "processing", upload: body.upload ?? null, background: true });
        void loadRecent();
        await poll(upload.id, controller.signal);
        return;
      }
      setPhase({ kind: "done", upload: body.upload! });
      router.refresh();
      void loadRecent();
    } catch (err) {
      if (controller.signal.aborted) return;
      setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const cancel = async () => {
    abortRef.current?.abort();
    const id = uploadIdRef.current;
    if (id && phase.kind === "uploading") await fetch(`/api/integrations/bot-logs/${id}`, { method: "DELETE" }).catch(() => {});
    reset();
  };

  const busy = phase.kind === "uploading" || (phase.kind === "processing" && !phase.background);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && busy) return;
        if (!v) {
          abortRef.current?.abort();
          reset();
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload server logs</DialogTitle>
          <DialogDescription>
            nginx, Apache, Cloudflare, Akamai or NDJSON — plain or .gz, up to 1 GB. Files over 50 MB are processed in the background.
            Only AI / search crawler requests are stored; duplicates are skipped.
          </DialogDescription>
        </DialogHeader>

        {phase.kind === "idle" || phase.kind === "error" ? (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                pick(e.dataTransfer.files?.[0]);
              }}
              className={cn(
                "flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors",
                drag ? "border-brand bg-brand-soft/40" : "border-border hover:bg-muted/50",
              )}
            >
              {file ? (
                <>
                  <FileText className="size-6 text-muted-foreground" />
                  <span className="max-w-full truncate text-sm font-medium">{file.name}</span>
                  <span className="text-xs text-muted-foreground">{fmtBytes(file.size)} · click to choose another file</span>
                </>
              ) : (
                <>
                  <UploadCloud className="size-7 text-muted-foreground" />
                  <span className="text-sm font-medium">Drop a log file here or click to browse</span>
                  <span className="text-xs text-muted-foreground">.log, .txt, .json, .ndjson, .gz</span>
                </>
              )}
            </button>
            <input ref={inputRef} type="file" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
            <div className="space-y-1.5">
              <Label className="text-xs">Log format</Label>
              <Select value={format} onValueChange={setFormat}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORMATS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {phase.kind === "error" && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{phase.message}</span>
              </div>
            )}
          </div>
        ) : phase.kind === "uploading" ? (
          <div className="space-y-3 py-2">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-medium">
                <Loader2 className="size-4 animate-spin" /> Uploading {file?.name}
              </span>
              <span className="text-muted-foreground tabular">{phase.percent}%</span>
            </div>
            <Progress value={phase.percent} />
          </div>
        ) : phase.kind === "processing" ? (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="size-4 animate-spin" /> {phase.background ? "Processing in the background…" : "Analyzing log file…"}
            </div>
            {phase.upload && phase.upload.totalLines > 0 && (
              <p className="text-xs text-muted-foreground tabular">
                {formatNumber(phase.upload.totalLines)} lines read · {formatNumber(phase.upload.botVisits)} bot requests found
              </p>
            )}
            {phase.background && <p className="text-xs text-muted-foreground">You can close this dialog — results appear on the page when processing finishes.</p>}
          </div>
        ) : (
          <div className="space-y-3 py-1">
            <div className="flex items-center gap-2 text-sm font-medium text-success">
              <CheckCircle2 className="size-4" /> {phase.upload.filename} processed
            </div>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Lines", phase.upload.totalLines],
                ["Parsed", phase.upload.parsedLines],
                ["Bot visits", phase.upload.botVisits],
                ["New saved", phase.upload.saved],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-lg bg-muted/60 p-2.5">
                  <dt className="text-[11px] text-muted-foreground">{label}</dt>
                  <dd className="text-base font-semibold tabular">{formatNumber(value as number)}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground">
              Format: {phase.upload.detectedFormat ?? phase.upload.format}
              {phase.upload.botVisits - phase.upload.saved > 0 && ` · ${formatNumber(phase.upload.botVisits - phase.upload.saved)} duplicates skipped`}
              {phase.upload.invalidLines > 0 && ` · ${formatNumber(phase.upload.invalidLines)} unparseable lines`}
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          {phase.kind === "uploading" && (
            <Button variant="ghost" onClick={cancel}>
              <X className="size-3.5" /> Cancel
            </Button>
          )}
          {phase.kind === "done" && (
            <Button variant="outline" onClick={reset}>
              Upload another file
            </Button>
          )}
          {(phase.kind === "idle" || phase.kind === "error") && (
            <Button onClick={start} disabled={!file}>
              <Upload className="size-3.5" /> Upload &amp; analyze
            </Button>
          )}
          {(phase.kind === "done" || (phase.kind === "processing" && phase.background)) && <Button onClick={() => onOpenChange(false)}>Close</Button>}
        </DialogFooter>

        {recent.length > 0 && (
          <div className="border-t pt-3">
            <h4 className="mb-2 text-xs font-medium text-muted-foreground">Recent uploads</h4>
            <ul className="space-y-1.5">
              {recent.slice(0, 5).map((u) => (
                <li key={u.id} className="flex items-center gap-2 text-xs">
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{u.filename}</span>
                  <span className="hidden text-muted-foreground tabular sm:inline">{fmtBytes(u.sizeBytes)}</span>
                  {u.status === "completed" ? (
                    <span className="text-muted-foreground tabular">{formatNumber(u.saved)} saved</span>
                  ) : (
                    <StatusBadge status={u.status === "processing" || u.status === "queued" ? "running" : u.status} label={u.status} />
                  )}
                  <TimeAgo date={u.createdAt} className="text-muted-foreground" />
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function UploadLogsButton({ projectId, className }: { projectId: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" className={cn("h-8 gap-1.5", className)} onClick={() => setOpen(true)}>
        <Upload className="size-3.5" /> Upload Logs
      </Button>
      <UploadLogsDialog projectId={projectId} open={open} onOpenChange={setOpen} />
    </>
  );
}
