"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Globe, Loader2, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { defaultRegulator } from "@/features/optimize/constants";
import { createAssetsAction, getDiscoverResultAction, startDiscoverAction } from "../actions";
import type { AssetCandidateView, DiscoverResult, FcMarketView } from "../types";
import { MarketPicker } from "./market-picker";

type Mode = "single" | "list" | "discover";

function splitAliases(s: string) {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Parses "Name; alias1, alias2; active ingredient" lines. */
function parseList(text: string) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [name = "", aliases = "", ingredient = ""] = line.split(/[;\t]/).map((x) => x.trim());
      return { name, aliases: splitAliases(aliases), activeIngredient: ingredient || null };
    })
    .filter((a) => a.name.length >= 2);
}

export function NewAssetDialog({
  projectId,
  defaultCountry,
  trigger,
}: {
  projectId: string;
  defaultCountry: string;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("single");
  const [markets, setMarkets] = useState<FcMarketView[]>([{ country: defaultCountry, regulator: defaultRegulator(defaultCountry) }]);
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
  const [ingredient, setIngredient] = useState("");
  const [list, setList] = useState("");
  const [url, setUrl] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoverResult | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [attachDoc, setAttachDoc] = useState(true);
  const [pending, start] = useTransition();
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => void (poll.current && clearInterval(poll.current)), []);

  const parsed = useMemo(() => parseList(list), [list]);

  const reset = () => {
    setName("");
    setAliases("");
    setIngredient("");
    setList("");
    setUrl("");
    setDiscovered(null);
    setPicked(new Set());
    setDiscovering(false);
    if (poll.current) clearInterval(poll.current);
  };

  const discover = () =>
    start(async () => {
      setDiscovered(null);
      const res = await startDiscoverAction(projectId, url);
      if (!res.ok) return void toast.error(res.error);
      setDiscovering(true);
      const jobId = res.data.jobId;
      if (poll.current) clearInterval(poll.current);
      poll.current = setInterval(async () => {
        const r = await getDiscoverResultAction(projectId, jobId);
        if (!r.ok) {
          clearInterval(poll.current!);
          setDiscovering(false);
          return void toast.error(r.error);
        }
        if (r.data.status === "running") return;
        clearInterval(poll.current!);
        setDiscovering(false);
        if (r.data.status === "failed") return void toast.error(r.data.error ?? "Discovery failed.");
        const result = r.data.result!;
        setDiscovered(result);
        setPicked(new Set(result.candidates.map((_, i) => i).filter((i) => result.candidates[i]!.source !== "heading" || i < 3)));
      }, 1500);
    });

  const assetsToCreate: { name: string; aliases: string[]; activeIngredient: string | null }[] =
    mode === "single"
      ? name.trim().length >= 2
        ? [{ name: name.trim(), aliases: splitAliases(aliases), activeIngredient: ingredient.trim() || null }]
        : []
      : mode === "list"
        ? parsed
        : (discovered?.candidates ?? []).filter((_, i) => picked.has(i)).map((c: AssetCandidateView) => ({ name: c.name, aliases: c.aliases, activeIngredient: c.activeIngredient }));

  const submit = () =>
    start(async () => {
      const res = await createAssetsAction(projectId, {
        assets: assetsToCreate,
        markets,
        sourceUrl: mode === "discover" ? (discovered?.url ?? null) : null,
        attachUrlAsDocument: mode === "discover" && attachDoc,
      });
      if (!res.ok) return void toast.error(res.error);
      const { created, skipped } = res.data;
      if (created) toast.success(`${created} asset${created === 1 ? "" : "s"} created`);
      if (skipped.length) toast.warning(`Already exists: ${skipped.join(", ")}`);
      setOpen(false);
      reset();
      router.refresh();
      if (created === 1 && res.data.ids[0] && mode !== "list") router.push(`/p/${projectId}/fact-check/assets/${res.data.ids[0]}`);
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
        {trigger ?? (
          <Button size="sm">
            <Plus className="size-3.5" /> New Asset
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New asset</DialogTitle>
          <DialogDescription>
            An asset is a product whose AI statements are checked against your reference documents (the label).
          </DialogDescription>
        </DialogHeader>
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList className="w-full">
            <TabsTrigger value="single">Single product</TabsTrigger>
            <TabsTrigger value="list">Paste list</TabsTrigger>
            <TabsTrigger value="discover">
              <span className="hidden sm:inline">Discover from URL</span>
              <span className="sm:hidden">From URL</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="single" className="mt-2 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="fc-name">Asset name *</Label>
              <Input id="fc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Examplol 500 mg" maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fc-aliases">Aliases</Label>
              <Input
                id="fc-aliases"
                value={aliases}
                onChange={(e) => setAliases(e.target.value)}
                placeholder="Comma-separated spelling variants, e.g. Examplol, Examplol forte"
              />
              <p className="text-xs text-muted-foreground">AI answers mentioning any of these names are checked.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fc-ingredient">Active ingredient (optional)</Label>
              <Input id="fc-ingredient" value={ingredient} onChange={(e) => setIngredient(e.target.value)} placeholder="e.g. Paracetamol" maxLength={200} />
            </div>
          </TabsContent>

          <TabsContent value="list" className="mt-2 space-y-2">
            <Label htmlFor="fc-list">One asset per line</Label>
            <Textarea
              id="fc-list"
              value={list}
              onChange={(e) => setList(e.target.value)}
              rows={7}
              className="font-mono text-xs"
              placeholder={"Name; alias1, alias2; active ingredient\nExamplol 500; Examplol, Examplol forte; Paracetamol\nSolarbox Pro; Solar Box Pro"}
            />
            <p className="text-xs text-muted-foreground tabular">
              {parsed.length} asset{parsed.length === 1 ? "" : "s"} detected · separate columns with “;” or tabs
            </p>
          </TabsContent>

          <TabsContent value="discover" className="mt-2 space-y-3">
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Globe className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && url.trim()) {
                      e.preventDefault();
                      discover();
                    }
                  }}
                  placeholder="https://example.com/products"
                  className="pl-8"
                />
              </div>
              <Button variant="outline" onClick={discover} disabled={!url.trim() || discovering || pending}>
                {discovering ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                Discover
              </Button>
            </div>
            {discovering && <p className="text-xs text-muted-foreground">Reading the page and looking for products…</p>}
            {discovered && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {discovered.candidates.length} candidate{discovered.candidates.length === 1 ? "" : "s"} on{" "}
                  <span className="font-medium text-foreground">{discovered.title}</span>
                  {discovered.usedAi ? " · extracted with AI" : " · from structured data & headings"}
                </p>
                {discovered.candidates.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                    No products found on this page. Try a product detail page, or add the asset manually.
                  </p>
                ) : (
                  <ul className="max-h-60 divide-y overflow-y-auto rounded-lg border">
                    {discovered.candidates.map((c, i) => (
                      <li key={`${c.name}-${i}`}>
                        <label className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-muted/40">
                          <Checkbox
                            className="mt-0.5"
                            checked={picked.has(i)}
                            onCheckedChange={(v) => {
                              const next = new Set(picked);
                              if (v) next.add(i);
                              else next.delete(i);
                              setPicked(next);
                            }}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{c.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {[c.activeIngredient, c.aliases.join(", ")].filter(Boolean).join(" · ") || (c.source === "heading" ? "Page heading" : "Product")}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox checked={attachDoc} onCheckedChange={(v) => setAttachDoc(!!v)} />
                  Attach this page as a reference document
                </label>
                {discovered.aiError && <p className="text-xs text-warning">AI extraction unavailable: {discovered.aiError}</p>}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <div className="space-y-1.5">
          <Label>Markets *</Label>
          <MarketPicker value={markets} onChange={setMarkets} />
          <p className="text-xs text-muted-foreground">Only AI answers from these markets are checked. The regulator is shown next to each market.</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !assetsToCreate.length || !markets.length}>
            {pending && !discovering ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {assetsToCreate.length > 1 ? `Create ${assetsToCreate.length} assets` : "Create asset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
