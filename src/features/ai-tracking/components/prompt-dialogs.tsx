"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AlertCircle, FileUp, Loader2, Plus, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { EngineIcon } from "@/components/app/engine-icon";
import { MultiSelect } from "@/components/app/filters";
import { CountryFlag } from "@/components/app/misc";
import { COUNTRIES, flagEmoji } from "@/lib/countries";
import { ENGINES } from "@/lib/engines";
import { cn } from "@/lib/utils";
import { addPromptsAction, importPromptsCsvAction } from "../actions";
import { parsePromptCsv } from "../csv";
import type { EngineAvailabilityView, TagOption } from "../types";
import { TagInput } from "./tag-input";

const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({ value: c.iso, label: c.name, icon: <span>{flagEmoji(c.iso)}</span> }));

function FrequencyNote({ frequency, modelsHref }: { frequency: string; modelsHref: string }) {
  const label = frequency === "paused" ? "Tracking is paused" : `Tracked ${frequency}`;
  return (
    <p className="text-xs text-muted-foreground">
      {label} —{" "}
      <Link href={modelsHref} className="underline underline-offset-2 hover:text-foreground">
        change in Model Settings
      </Link>
    </p>
  );
}

export function AddPromptDialog({
  open,
  onOpenChange,
  projectId,
  defaultCountry,
  tags,
  engines,
  enabledEngines,
  frequency,
  modelsHref,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  defaultCountry: string;
  tags: TagOption[];
  engines: EngineAvailabilityView[];
  enabledEngines: string[];
  frequency: string;
  modelsHref: string;
}) {
  const [country, setCountry] = useState(defaultCountry);
  const [tagNames, setTagNames] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<string[]>(enabledEngines);
  const [pending, start] = useTransition();
  const lines = useMemo(
    () => [...new Set(text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length >= 3))],
    [text],
  );
  const availMap = new Map(engines.map((e) => [e.id, e]));
  const allEnabled = enabledEngines.length > 0 && enabledEngines.every((e) => selected.includes(e));
  const runnable = selected.filter((e) => enabledEngines.includes(e));

  const submit = () =>
    start(async () => {
      const res = await addPromptsAction(projectId, {
        texts: lines,
        country,
        tags: tagNames,
        engines: allEnabled ? null : runnable,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const { created, duplicates, skippedOverLimit, run } = res.data;
      toast.success(`${created.length} prompt${created.length === 1 ? "" : "s"} added`, {
        description: [
          duplicates ? `${duplicates} already tracked` : null,
          skippedOverLimit ? `${skippedOverLimit} over the prompt limit` : null,
          run?.tasks ? `${run.tasks} answers queued` : run?.error ? `Not run yet: ${run.error}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || undefined,
      });
      setText("");
      setTagNames([]);
      onOpenChange(false);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Tracking Prompt</DialogTitle>
          <DialogDescription>Prompts are asked to every selected AI model on each tracking run.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Location</Label>
              <MultiSelect
                single
                options={COUNTRY_OPTIONS}
                value={[country]}
                onChange={(v) => v[0] && setCountry(v[0])}
                placeholder="Country"
                className="h-8 w-full"
              />
              <p className="text-[11px] text-muted-foreground">Location to use for AI search</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tags</Label>
              <TagInput value={tagNames} onChange={setTagNames} options={tags} />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">AI Models</Label>
              <Link href={modelsHref} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                <Settings2 className="size-3" /> Manage in Settings
              </Link>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ENGINES.map((e) => {
                const enabled = enabledEngines.includes(e.id);
                const on = enabled && selected.includes(e.id);
                const avail = availMap.get(e.id);
                return (
                  <button
                    key={e.id}
                    type="button"
                    disabled={!enabled}
                    title={!enabled ? `${e.name} is not enabled for this project` : !avail?.configured ? `${e.name}: ${avail?.reason ?? "not configured"}` : e.name}
                    onClick={() => setSelected(on ? selected.filter((x) => x !== e.id) : [...selected, e.id])}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                      on ? "border-brand/50 bg-brand/10 text-foreground ring-1 ring-brand/30" : "bg-background hover:bg-muted",
                    )}
                  >
                    <EngineIcon id={e.id} size="xs" withTooltip={false} active={on} />
                    {e.shortName}
                    {enabled && avail && !avail.configured && <AlertCircle className="size-3 text-warning" />}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {allEnabled ? "Will run on all enabled models." : `Will run on ${runnable.length} of ${enabledEngines.length} enabled models.`}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="prompt-text">
              Prompts
            </Label>
            <Textarea
              id="prompt-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              placeholder={"What is the best balcony power plant with storage?\nWhich solar kit is easiest to install?"}
              className="text-sm"
            />
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Add multiple prompts with line breaks.</span>
              <span className="tabular">
                {lines.length} prompt{lines.length === 1 ? "" : "s"} detected
              </span>
            </div>
          </div>
          <FrequencyNote frequency={frequency} modelsHref={modelsHref} />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !lines.length || !runnable.length} className="bg-brand text-brand-foreground hover:bg-brand/90">
            {pending ? <Loader2 className="animate-spin" /> : <Plus />}
            Add Prompt{lines.length > 1 ? "s" : ""} to {runnable.length} Model{runnable.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ImportCsvDialog({
  open,
  onOpenChange,
  projectId,
  defaultCountry,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  defaultCountry: string;
}) {
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const rows = useMemo(() => (csv.trim() ? parsePromptCsv(csv, defaultCountry) : []), [csv, defaultCountry]);
  const valid = rows.filter((r) => !r.error);
  const invalid = rows.length - valid.length;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2_000_000) {
      toast.error("The file is too large (max 2 MB).");
      return;
    }
    setFileName(file.name);
    setCsv(await file.text());
  };

  const submit = () =>
    start(async () => {
      const res = await importPromptsCsvAction(projectId, csv);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${res.data.created.length} prompts imported`, {
        description:
          [res.data.duplicates ? `${res.data.duplicates} duplicates skipped` : null, res.data.skippedOverLimit ? `${res.data.skippedOverLimit} over the limit` : null]
            .filter(Boolean)
            .join(" · ") || undefined,
      });
      setCsv("");
      setFileName(null);
      onOpenChange(false);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import prompts from CSV</DialogTitle>
          <DialogDescription>
            Columns: <code className="rounded bg-muted px-1">prompt</code>, <code className="rounded bg-muted px-1">tags</code> (separated by | or ;),{" "}
            <code className="rounded bg-muted px-1">country</code> (ISO code, defaults to {defaultCountry}). A header row is optional.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div
            className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed bg-muted/30 px-4 py-6 text-center text-sm hover:bg-muted/50"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void onFile(e.dataTransfer.files[0]);
            }}
          >
            <FileUp className="size-5 text-muted-foreground" />
            <span className="font-medium">{fileName ?? "Choose a CSV file or drop it here"}</span>
            <span className="text-xs text-muted-foreground">…or paste the CSV below</span>
            <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
          </div>
          <Textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={4} placeholder={'prompt,tags,country\n"Best solar kit for balconies?",Solar|Balcony,DE'} className="font-mono text-xs" />
          {rows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-xs">
                <span className="font-medium text-success">{valid.length} valid</span>
                {invalid > 0 && <span className="font-medium text-destructive">{invalid} with errors (skipped)</span>}
              </div>
              <div className="max-h-64 overflow-auto rounded-xl border">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th className="px-2.5 py-1.5 font-medium">#</th>
                      <th className="px-2.5 py-1.5 font-medium">Prompt</th>
                      <th className="px-2.5 py-1.5 font-medium">Tags</th>
                      <th className="px-2.5 py-1.5 font-medium">Country</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 200).map((r) => (
                      <tr key={r.line} className={cn("border-t", r.error && "bg-destructive/5")}>
                        <td className="px-2.5 py-1.5 text-muted-foreground tabular">{r.line}</td>
                        <td className="px-2.5 py-1.5">
                          <div className="line-clamp-2">{r.text || "—"}</div>
                          {r.error && <div className="text-destructive">{r.error}</div>}
                        </td>
                        <td className="px-2.5 py-1.5">{r.tags.join(", ")}</td>
                        <td className="px-2.5 py-1.5">{r.country ? <CountryFlag iso={r.country} withName /> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 200 && <p className="text-xs text-muted-foreground">Showing the first 200 of {rows.length} rows.</p>}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !valid.length}>
            {pending ? <Loader2 className="animate-spin" /> : <FileUp />}
            Import {valid.length || ""} prompt{valid.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
