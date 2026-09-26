"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { parseCsv } from "../../lib/csv";
import { importPromptsAction } from "../../actions/research";
import { ToggleChip } from "../shared/bits";
import type { ResearchList } from "../../types";

type Field = "text" | "topic" | "funnelStage" | "persona" | "volume" | "branded" | "intent" | "keyword";

const FIELDS: { key: Field; label: string; required?: boolean; aliases: string[] }[] = [
  { key: "text", label: "Prompt", required: true, aliases: ["prompt", "prompts", "text", "query", "question", "frage", "keyword", "suchanfrage"] },
  { key: "topic", label: "Topic", aliases: ["topic", "thema", "tag", "tags", "category", "kategorie", "cluster", "group"] },
  { key: "funnelStage", label: "Funnel stage", aliases: ["funnel", "funnel stage", "funnel_stage", "stage", "phase"] },
  { key: "persona", label: "Persona", aliases: ["persona", "audience", "zielgruppe"] },
  { key: "volume", label: "Volume", aliases: ["volume", "search volume", "search_volume", "suchvolumen", "searches"] },
  { key: "branded", label: "Branded", aliases: ["branded", "brand", "marke"] },
  { key: "intent", label: "Intent", aliases: ["intent", "search intent", "absicht"] },
  { key: "keyword", label: "Topic keyword", aliases: ["topic keyword", "seed", "seed keyword", "main keyword"] },
];

function autoMap(header: string[]): Record<Field, number> {
  const map = {} as Record<Field, number>;
  const used = new Set<number>();
  for (const f of FIELDS) {
    const idx = header.findIndex((h, i) => !used.has(i) && f.aliases.includes(h.trim().toLowerCase()));
    map[f.key] = idx;
    if (idx >= 0) used.add(idx);
  }
  if (map.text < 0) map.text = 0;
  return map;
}

export function ImportDialog({ projectId, activeList, disabled }: { projectId: string; activeList: ResearchList; disabled?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<Record<Field, number> | null>(null);
  const [target, setTarget] = useState<"current" | "new">("current");
  const [newName, setNewName] = useState("");
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<"csv" | "lines">("csv");
  const rows = useMemo(() => {
    if (!raw.trim()) return [];
    if (mode === "lines")
      return raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 5001)
        .map((l) => [l]);
    return parseCsv(raw, { maxRows: 5001 });
  }, [raw, mode]);
  const header = useMemo(() => (hasHeader && rows[0] ? rows[0] : (rows[0] ?? []).map((_, i) => `Column ${i + 1}`)), [rows, hasHeader]);
  const body = hasHeader ? rows.slice(1) : rows;
  const map = mapping ?? autoMap(hasHeader ? header : []);
  const mapped = body
    .map((r) => {
      const get = (f: Field) => (map[f] >= 0 ? (r[map[f]] ?? "").trim() : "");
      return {
        text: get("text"),
        topic: get("topic") || null,
        funnelStage: get("funnelStage") || null,
        persona: get("persona") || null,
        volume: get("volume") || null,
        branded: get("branded") || null,
        intent: get("intent") || null,
        keyword: get("keyword") || null,
      };
    })
    .filter((r) => r.text.length >= 3);

  const detect = (text: string, isCsvFile: boolean) => {
    const first = parseCsv(text, { maxRows: 1 })[0] ?? [];
    const header = first.some((h) => FIELDS.some((fd) => fd.aliases.includes(h.trim().toLowerCase())));
    setHasHeader(header);
    setMode(header || isCsvFile ? "csv" : "lines");
  };

  const reset = () => {
    setMode("csv");
    setRaw("");
    setFileName(null);
    setMapping(null);
    setHasHeader(true);
    setNewName("");
    setTarget("current");
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      toast.error("File is larger than 5 MB.");
      return;
    }
    const text = await f.text();
    setFileName(f.name);
    setMapping(null);
    detect(text, /\.(csv|tsv)$/i.test(f.name));
    setRaw(text);
  };

  const submit = () =>
    start(async () => {
      if (!mapped.length) {
        toast.error("No prompts found — check the column mapping.");
        return;
      }
      if (target === "new" && !newName.trim()) {
        toast.error("Please name the new list.");
        return;
      }
      const res = await importPromptsAction(projectId, target === "new" ? { newListName: newName.trim() } : { listId: activeList.id }, mapped.slice(0, 5000));
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `Imported ${res.data.imported} prompts${res.data.duplicates ? ` (${res.data.duplicates} duplicates skipped)` : ""}${res.data.enriching ? " — volumes are being fetched." : "."}`,
      );
      setOpen(false);
      reset();
      router.replace(`/p/${projectId}/ai/prompt-research?list=${res.data.listId}`, { scroll: false });
      router.refresh();
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <Upload className="size-3.5" /> <span className="hidden sm:inline">Import List</span>
          <span className="sm:hidden">Import</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b p-4 sm:p-5">
          <DialogTitle>Import prompt list</DialogTitle>
          <DialogDescription>Upload a CSV or paste prompts (one per line or CSV with header). Map the columns, check the preview and import.</DialogDescription>
        </DialogHeader>
        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-6 py-5 text-sm text-muted-foreground hover:border-foreground/40 hover:text-foreground"
            >
              <FileUp className="size-5" />
              {fileName ? <span className="max-w-40 truncate font-medium text-foreground">{fileName}</span> : "Upload CSV"}
              <span className="text-[11px]">.csv · .tsv · .txt (max 5 MB)</span>
            </button>
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
            <Textarea
              value={raw}
              onChange={(e) => {
                const text = e.target.value;
                if (!raw.trim() && text.trim()) detect(text, false);
                setRaw(text);
                setFileName(null);
                setMapping(null);
              }}
              rows={5}
              placeholder={"Paste prompts, one per line…\nor CSV: prompt,topic,funnel stage,volume"}
              className="font-mono text-xs"
            />
          </div>

          {rows.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex gap-1.5">
                  <ToggleChip active={mode === "lines"} onClick={() => { setMode("lines"); setHasHeader(false); setMapping(null); }}>
                    One prompt per line
                  </ToggleChip>
                  <ToggleChip active={mode === "csv"} onClick={() => { setMode("csv"); setMapping(null); }}>
                    CSV columns
                  </ToggleChip>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={hasHeader} onCheckedChange={(v) => { setHasHeader(!!v); setMapping(null); }} />
                  First row is a header
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {FIELDS.map((f) => (
                  <div key={f.key} className="space-y-1">
                    <Label className="text-xs">
                      {f.label}
                      {f.required && <span className="text-destructive"> *</span>}
                    </Label>
                    <NativeSelect
                      size="sm"
                      className="w-full"
                      value={String(map[f.key])}
                      onChange={(e) => setMapping({ ...map, [f.key]: Number(e.target.value) })}
                    >
                      {!f.required && <NativeSelectOption value="-1">—</NativeSelectOption>}
                      {header.map((h, i) => (
                        <NativeSelectOption key={i} value={String(i)}>
                          {h || `Column ${i + 1}`}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </div>
                ))}
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  Preview · <b className="text-foreground tabular">{mapped.length.toLocaleString("en-US")}</b> prompts detected
                  {body.length - mapped.length > 0 && ` · ${body.length - mapped.length} empty rows skipped`}
                  {mapped.length > 5000 && " · only the first 5,000 will be imported"}
                </p>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/60 text-left text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">Prompt</th>
                        <th className="px-2 py-1.5 font-medium">Topic</th>
                        <th className="px-2 py-1.5 font-medium">Funnel</th>
                        <th className="px-2 py-1.5 font-medium">Volume</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mapped.slice(0, 8).map((r, i) => (
                        <tr key={i} className="border-t">
                          <td className="max-w-72 truncate px-2 py-1.5">{r.text}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{r.topic ?? "—"}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{r.funnelStage ?? "—"}</td>
                          <td className="px-2 py-1.5 text-muted-foreground tabular">{r.volume ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label className="text-sm">Import into</Label>
            <div className="flex flex-wrap gap-2">
              <ToggleChip active={target === "current"} onClick={() => setTarget("current")}>
                “{activeList.name}”
              </ToggleChip>
              <ToggleChip active={target === "new"} onClick={() => setTarget("new")}>
                New list
              </ToggleChip>
            </div>
            {target === "new" && <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="List name" maxLength={120} />}
          </div>
        </div>
        <DialogFooter className="m-0 rounded-b-xl border-t bg-muted/50 p-4">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || mapped.length === 0}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Import {mapped.length ? Math.min(mapped.length, 5000).toLocaleString("en-US") : ""} prompts
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
