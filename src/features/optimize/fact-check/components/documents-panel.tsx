"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ChevronRight, ExternalLink, FileText, FileUp, Globe, Loader2, MoreHorizontal, Plus, RotateCcw, Trash2, Type } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/app/empty-state";
import { StatusBadge } from "@/components/app/misc";
import { Panel } from "@/components/app/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { flagEmoji } from "@/lib/countries";
import { cn } from "@/lib/utils";
import {
  addTextDocumentAction,
  addUrlDocumentAction,
  deleteDocumentAction,
  retryDocumentAction,
  setDocumentSupersededAction,
  uploadPdfDocumentAction,
} from "../actions";
import type { DocumentView, FcMarketView } from "../types";

const KIND_ICON = { pdf: FileText, text: Type, url: Globe } as const;

function AddDocumentDialog({ projectId, assetId, markets }: { projectId: string; assetId: string; markets: FcMarketView[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"pdf" | "text" | "url">("pdf");
  const [title, setTitle] = useState("");
  const [market, setMarket] = useState("all");
  const [version, setVersion] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pending, start] = useTransition();

  const reset = () => {
    setTitle("");
    setMarket("all");
    setVersion("");
    setEffectiveDate("");
    setText("");
    setUrl("");
    setFile(null);
  };

  const meta = { title, market: market === "all" ? null : market, version: version || null, effectiveDate: effectiveDate || null };
  const canSubmit = mode === "pdf" ? !!file : mode === "text" ? text.trim().length >= 20 : url.trim().length > 3;

  const submit = () =>
    start(async () => {
      let res;
      if (mode === "pdf") {
        if (!file) return;
        if (file.size > 20 * 1024 * 1024) return void toast.error("PDFs up to 20 MB are supported.");
        const fd = new FormData();
        fd.set("file", file);
        fd.set("title", title);
        if (meta.market) fd.set("market", meta.market);
        if (version) fd.set("version", version);
        if (effectiveDate) fd.set("effectiveDate", effectiveDate);
        res = await uploadPdfDocumentAction(projectId, assetId, fd);
      } else if (mode === "text") res = await addTextDocumentAction(projectId, assetId, { ...meta, text });
      else res = await addUrlDocumentAction(projectId, assetId, { ...meta, url });
      if (!res.ok) return void toast.error(res.error);
      toast.success(mode === "text" ? "Reference text added — checking statements…" : "Document added — extracting text…");
      setOpen(false);
      reset();
      router.refresh();
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-3.5" /> Add reference document
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add reference document</DialogTitle>
          <DialogDescription>The label AI statements are compared with — e.g. SmPC, package leaflet, spec sheet, terms.</DialogDescription>
        </DialogHeader>
        <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
          <TabsList className="w-full">
            <TabsTrigger value="pdf">
              <FileUp className="size-3.5" /> Upload PDF
            </TabsTrigger>
            <TabsTrigger value="text">
              <Type className="size-3.5" /> Paste text
            </TabsTrigger>
            <TabsTrigger value="url">
              <Globe className="size-3.5" /> URL
            </TabsTrigger>
          </TabsList>
          <TabsContent value="pdf" className="mt-2">
            <label
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-4 py-6 text-center text-sm transition-colors hover:bg-muted/40",
                file && "border-solid bg-muted/30",
              )}
            >
              <FileUp className="size-5 text-muted-foreground" />
              {file ? (
                <span className="font-medium">
                  {file.name} <span className="text-muted-foreground">· {(file.size / 1024 / 1024).toFixed(1)} MB</span>
                </span>
              ) : (
                <>
                  <span className="font-medium">Choose a PDF</span>
                  <span className="text-xs text-muted-foreground">Up to 20 MB · text is extracted automatically</span>
                </>
              )}
              <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          </TabsContent>
          <TabsContent value="text" className="mt-2">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              className="max-h-72 text-xs"
              placeholder={"4.1 Therapeutic indications\n…\n\n4.2 Posology and method of administration\n…"}
            />
            <p className="mt-1 text-xs text-muted-foreground tabular">{text.length.toLocaleString()} characters · headings become label sections</p>
          </TabsContent>
          <TabsContent value="url" className="mt-2">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/product/label.pdf" />
            <p className="mt-1 text-xs text-muted-foreground">HTML pages and PDFs are supported. Private network addresses are blocked.</p>
          </TabsContent>
        </Tabs>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="d-title">Title</Label>
            <Input id="d-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. SmPC (EMA)" maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label>Market</Label>
            <Select value={market} onValueChange={setMarket}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All markets</SelectItem>
                {markets.map((m) => (
                  <SelectItem key={m.country} value={m.country}>
                    {flagEmoji(m.country)} {m.country} · {m.regulator}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-version">Version</Label>
            <Input id="d-version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="optional" maxLength={60} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-date">Effective date</Label>
            <Input id="d-date" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Uploading a document with the same title as an existing one marks the older one as superseded — statements that only match it are reported as “Outdated”.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit || pending}>
            {pending && <Loader2 className="size-3.5 animate-spin" />} Add document
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocumentRow({ doc, projectId, canEdit }: { doc: DocumentView; projectId: string; canEdit: boolean }) {
  const router = useRouter();
  const [openSections, setOpenSections] = useState(false);
  const [pending, start] = useTransition();
  const Icon = KIND_ICON[doc.kind];
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? "Failed");
      toast.success(msg);
      router.refresh();
    });

  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
          <Icon className="size-4 text-muted-foreground" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("truncate font-medium", doc.superseded && "text-muted-foreground line-through decoration-1")}>{doc.title}</span>
            {doc.superseded && <Badge variant="outline">Superseded</Badge>}
            {doc.status !== "ready" && <StatusBadge status={doc.status === "processing" ? "running" : "failed"} label={doc.status === "processing" ? "Processing" : "Failed"} />}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular">
            <span className="uppercase">{doc.kind}</span>
            <span>{doc.market ? `${flagEmoji(doc.market)} ${doc.market}` : "All markets"}</span>
            {doc.version && <span>v{doc.version}</span>}
            {doc.effectiveDate && <span>effective {doc.effectiveDate}</span>}
            {doc.status === "ready" && <span>{doc.charCount.toLocaleString()} chars</span>}
            {doc.status === "ready" && (
              <button type="button" className="inline-flex items-center gap-0.5 hover:text-foreground" onClick={() => setOpenSections((v) => !v)}>
                <ChevronRight className={cn("size-3 transition-transform", openSections && "rotate-90")} />
                {doc.sections.length} sections
              </button>
            )}
            <span>added {format(new Date(doc.createdAt), "MMM d, yyyy")}</span>
            {doc.sourceUrl && (
              <a href={doc.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 hover:text-foreground">
                source <ExternalLink className="size-3" />
              </a>
            )}
          </div>
          {doc.error && <p className="mt-1 text-xs text-destructive">{doc.error}</p>}
          {openSections && (
            <ol className="mt-2 max-h-56 space-y-0.5 overflow-y-auto rounded-lg border bg-muted/20 p-2 text-xs">
              {doc.sections.map((s) => (
                <li key={s.id} className="truncate">
                  {s.heading}
                </li>
              ))}
            </ol>
          )}
        </div>
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" disabled={pending} aria-label="Document actions">
                {pending ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuCheckboxItem
                checked={doc.superseded}
                onCheckedChange={(v) => act(() => setDocumentSupersededAction(projectId, doc.id, !!v), v ? "Marked as superseded" : "Marked as current")}
              >
                Superseded (older version)
              </DropdownMenuCheckboxItem>
              {doc.status === "failed" && doc.kind !== "text" && (
                <DropdownMenuItem onClick={() => act(() => retryDocumentAction(projectId, doc.id), "Retrying extraction")}>
                  <RotateCcw className="size-3.5" /> Retry extraction
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => act(() => deleteDocumentAction(projectId, doc.id), "Document deleted")}>
                <Trash2 className="size-3.5" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  );
}

export function DocumentsPanel({
  projectId,
  assetId,
  documents,
  markets,
  canEdit,
}: {
  projectId: string;
  assetId: string;
  documents: DocumentView[];
  markets: FcMarketView[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const processing = documents.some((d) => d.status === "processing");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!processing) return;
    timer.current = setInterval(() => router.refresh(), 3000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [processing, router]);

  return (
    <Panel
      title="Reference documents"
      description="The label: statements are compared word-for-word against these texts"
      actions={canEdit ? <AddDocumentDialog projectId={projectId} assetId={assetId} markets={markets} /> : null}
      contentClassName="py-1"
    >
      {documents.length === 0 ? (
        <EmptyState
          compact
          icon={FileText}
          title="No reference documents yet"
          description="Upload the label as PDF, paste its text or link it by URL. Sections (e.g. “4.1 Therapeutic indications”) are detected automatically."
        />
      ) : (
        <ul className="divide-y">
          {documents.map((d) => (
            <DocumentRow key={d.id} doc={d} projectId={projectId} canEdit={canEdit} />
          ))}
        </ul>
      )}
    </Panel>
  );
}
