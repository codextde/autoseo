"use client";

import { useEffect, useRef, useState } from "react";
import {
  BarChart3,
  Bot,
  ChevronRight,
  Circle,
  Database,
  Eye,
  EyeOff,
  Gauge,
  Hash,
  Image as ImageIcon,
  Layers,
  List,
  Loader2,
  Lock,
  Minus,
  PanelLeftClose,
  Shapes,
  Sparkles,
  Square,
  Table2,
  Trash2,
  Triangle,
  Type,
  Unlock,
  Upload,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ConfirmButton } from "@/components/app/misc";
import { cn } from "@/lib/utils";
import { deleteAssetAction, listAssetsAction, pollAgentAction, startAgentAction } from "../../actions";
import { CHARTS, FEATURED_TOKENS, LISTS, TOKENS, resolveToken } from "../../lib/catalog";
import { ICON_NAMES, ICONS } from "../../lib/icons";
import { parseMarkup, toMarkup } from "../../lib/text";
import { slideSchema, type Slide, type SlideElement, type TextElement } from "../../lib/types";
import { addElement, addSlide, uploadAsset } from "./commands";
import { MetricsBrowser } from "./metrics-browser";
import { useEditor, useEditorState, type EditorState } from "./store";
import { activeTextEditor } from "./text-editor";

const TABS: { key: EditorState["leftTab"]; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "design", label: "Design", icon: Layers },
  { key: "agent", label: "Agent", icon: Bot },
  { key: "assets", label: "Assets", icon: Shapes },
  { key: "data", label: "Data", icon: Database },
];

const AUTO_OPEN_MIN_WIDTH = 1100;

/** `open = null` means automatic: panel shown on wide screens, collapsed on tablets. */
export function LeftRail({ open: openSetting, onOpenChange }: { open: boolean | null; onOpenChange: (v: boolean) => void }) {
  const { store } = useEditor();
  const tab = useEditorState((s) => s.leftTab);
  const isOpenNow = () => openSetting ?? window.innerWidth >= AUTO_OPEN_MIN_WIDTH;
  const open = openSetting !== false;
  return (
    <div className="flex h-full shrink-0 border-r bg-background">
      <nav className="flex w-14 flex-col items-center gap-1 border-r py-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              if (tab === t.key && isOpenNow()) onOpenChange(false);
              else {
                store.set({ leftTab: t.key });
                onOpenChange(true);
              }
            }}
            className={cn(
              "flex w-12 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] font-medium transition-colors",
              tab === t.key && openSetting === true ? "bg-muted text-foreground" : tab === t.key && openSetting === null ? "text-muted-foreground hover:bg-muted/60 hover:text-foreground min-[1100px]:bg-muted min-[1100px]:text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <t.icon className="size-4" />
            {t.label}
          </button>
        ))}
      </nav>
      {open && (
        <div className={cn("w-64 min-w-0 flex-col xl:w-72", openSetting === null ? "hidden min-[1100px]:flex" : "flex")}>
          <div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
            <span className="text-sm font-semibold">{TABS.find((t) => t.key === tab)?.label}</span>
            <Button size="icon-xs" variant="ghost" onClick={() => onOpenChange(false)} aria-label="Close panel">
              <PanelLeftClose />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === "design" && <LayersPanel />}
            {tab === "agent" && <AgentPanel />}
            {tab === "assets" && <AssetsPanel />}
            {tab === "data" && <DataPanel />}
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── Layers ───────────────────────────── */

const TYPE_ICON: Record<SlideElement["type"], React.ComponentType<{ className?: string }>> = {
  text: Type,
  box: Square,
  image: ImageIcon,
  icon: Sparkles,
  chart: BarChart3,
  list: List,
  kpi: Hash,
  score: Gauge,
  table: Table2,
};

function elementLabel(e: SlideElement): string {
  if (e.name) return e.name;
  if (e.type === "text") {
    const t = e.paragraphs
      .flatMap((p) => p.runs.map((r) => (r.token ? `{${TOKENS[r.token]?.label ?? r.token}}` : r.text)))
      .join("")
      .trim();
    return t.slice(0, 40) || "Text";
  }
  if (e.type === "chart") return CHARTS[e.metric]?.label ?? "Chart";
  if (e.type === "list") return LISTS[e.source]?.label ?? "List";
  if (e.type === "kpi") return `KPI · ${e.label}`;
  return e.type[0]!.toUpperCase() + e.type.slice(1);
}

function LayersPanel() {
  const { store } = useEditor();
  const deck = useEditorState((s) => s.deck);
  const slideId = useEditorState((s) => s.slideId);
  const selection = useEditorState((s) => s.selection);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<{ id: string; over: string | null } | null>(null);

  const toggleEl = (sid: string, id: string, key: "locked" | "hidden") =>
    store.commit(store.withSlide((s) => ({ ...s, elements: s.elements.map((e) => (e.id === id ? { ...e, [key]: e[key] ? undefined : true } : e)) }), deck, sid));

  const dropOn = (sid: string, targetId: string) => {
    if (!drag || drag.id === targetId) return;
    store.commit(
      store.withSlide(
        (s) => {
          const els = [...s.elements];
          const from = els.findIndex((e) => e.id === drag.id);
          if (from < 0) return s;
          const [item] = els.splice(from, 1);
          const to = els.findIndex((e) => e.id === targetId);
          // list is shown top-first, so dropping "on" an item puts the dragged one above it
          els.splice(to + 1, 0, item!);
          return { ...s, elements: els };
        },
        deck,
        sid,
      ),
    );
  };

  return (
    <div className="py-1">
      {deck.slides.map((s, i) => {
        const open = s.id === slideId ? !collapsed.has(s.id) : collapsed.has(`open:${s.id}`);
        return (
          <div key={s.id}>
            <button
              type="button"
              onClick={() => {
                if (s.id !== slideId) store.set({ slideId: s.id, selection: [], editingId: null });
                setCollapsed((prev) => {
                  const n = new Set(prev);
                  const k = s.id === slideId ? s.id : `open:${s.id}`;
                  if (n.has(k)) n.delete(k);
                  else n.add(k);
                  return n;
                });
              }}
              className={cn("flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs font-medium hover:bg-muted/60", s.id === slideId && "text-foreground")}
            >
              <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
              <span className="w-5 shrink-0 text-muted-foreground tabular">{i + 1}</span>
              <span className={cn("truncate", s.hidden && "text-muted-foreground line-through")}>{s.name ?? `Slide ${i + 1}`}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">{s.elements.length}</span>
            </button>
            {open && (
              <div className="pb-1">
                {[...s.elements].reverse().map((e) => {
                  const Icon = TYPE_ICON[e.type];
                  const active = s.id === slideId && selection.includes(e.id);
                  return (
                    <div
                      key={e.id}
                      draggable
                      onDragStart={() => setDrag({ id: e.id, over: null })}
                      onDragOver={(ev) => {
                        ev.preventDefault();
                        if (drag) setDrag({ ...drag, over: e.id });
                      }}
                      onDrop={(ev) => {
                        ev.preventDefault();
                        dropOn(s.id, e.id);
                        setDrag(null);
                      }}
                      onDragEnd={() => setDrag(null)}
                      onClick={(ev) => {
                        if (s.id !== slideId) store.set({ slideId: s.id, selection: [e.id], editingId: null });
                        else if (ev.shiftKey) store.select(selection.includes(e.id) ? selection.filter((x) => x !== e.id) : [...selection, e.id]);
                        else store.select([e.id]);
                      }}
                      className={cn(
                        "group flex cursor-default items-center gap-1.5 py-1 pr-1.5 pl-9 text-xs",
                        active ? "bg-brand-soft text-foreground" : "hover:bg-muted/60",
                        drag?.over === e.id && "shadow-[inset_0_-2px_0_var(--brand)]",
                        e.hidden && "opacity-50",
                      )}
                    >
                      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{elementLabel(e)}</span>
                      <button
                        type="button"
                        aria-label={e.locked ? "Unlock" : "Lock"}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          toggleEl(s.id, e.id, "locked");
                        }}
                        className={cn("rounded p-0.5 hover:bg-background", !e.locked && "opacity-0 group-hover:opacity-100")}
                      >
                        {e.locked ? <Lock className="size-3" /> : <Unlock className="size-3" />}
                      </button>
                      <button
                        type="button"
                        aria-label={e.hidden ? "Show" : "Hide"}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          toggleEl(s.id, e.id, "hidden");
                        }}
                        className={cn("rounded p-0.5 hover:bg-background", !e.hidden && "opacity-0 group-hover:opacity-100")}
                      >
                        {e.hidden ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                      </button>
                    </div>
                  );
                })}
                {!s.elements.length && <div className="py-1 pl-9 text-xs text-muted-foreground">Empty slide</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ───────────────────────────── Agent ───────────────────────────── */

type AgentMsg = { role: "user" | "agent"; text: string; status?: "running" | "done" | "error" };

const SLIDE_IDEAS = [
  "A slide comparing our visibility with the top 3 competitors, with a clear headline and a bar chart",
  "An executive summary with 4 KPI tiles and three key takeaways",
  "A slide about the prompts where we are invisible and what to do about them",
  "A citations slide: top sources AI relies on and our share of citations",
];

function AgentPanel() {
  const { store, projectId } = useEditor();
  const range = useEditorState((s) => s.range);
  const dataProjectId = useEditorState((s) => s.dataProjectId);
  const selection = useEditorState((s) => s.selection);
  const deck = useEditorState((s) => s.deck);
  const [prompt, setPrompt] = useState("");
  const [msgs, setMsgs] = useState<AgentMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const cancelled = useRef(false);
  useEffect(() => () => void (cancelled.current = true), []);

  const selectedText = store.selectedElements().find((e) => e.type === "text") as TextElement | undefined;
  void selection;

  const run = async (input: Parameters<typeof startAgentAction>[1], label: string, onResult: (r: Record<string, unknown>) => void) => {
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", text: label }, { role: "agent", text: "Thinking…", status: "running" }]);
    const finish = (text: string, status: "done" | "error") =>
      setMsgs((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: "agent", text, status };
        return copy;
      });
    const start = await startAgentAction(projectId, { ...input, dateRange: range as { preset: "30d" }, dataProjectId, size: deck.size });
    if (!start.ok) {
      finish(start.error, "error");
      setBusy(false);
      return;
    }
    // poll every 1.5 s for up to 12 minutes
    for (let attempt = 0; attempt < 480 && !cancelled.current; attempt++) {
      await new Promise((r) => setTimeout(r, 1500));
      const res = await pollAgentAction(projectId, start.data.jobId);
      if (!res.ok) {
        finish(res.error, "error");
        break;
      }
      if (res.data.status === "succeeded" && res.data.result) {
        try {
          onResult(res.data.result);
          finish("Done — inserted into your deck.", "done");
        } catch (err) {
          finish(err instanceof Error ? err.message : "Could not use the result.", "error");
        }
        break;
      }
      if (res.data.status === "failed" || res.data.status === "cancelled") {
        finish(res.data.error ?? "The agent failed.", "error");
        break;
      }
      setMsgs((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: "agent", text: res.data.progress ? `${res.data.progress[0]!.toUpperCase()}${res.data.progress.slice(1)}…` : "Queued…", status: "running" };
        return copy;
      });
    }
    setBusy(false);
  };

  const designSlide = (text: string) =>
    run({ action: "slide", prompt: text }, text, (r) => {
      const parsed = slideSchema.parse((r as { slide: unknown }).slide) as Slide;
      addSlide(store, parsed);
    });

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <div className="rounded-xl bg-gradient-to-br from-brand-soft to-muted/60 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Wand2 className="size-4 text-brand" /> AI slide designer
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Describe a slide — the agent builds it with live data tokens, charts and lists. Runs on your local agent first, API keys as fallback.</p>
        </div>
        {msgs.length === 0 && (
          <div className="space-y-1.5">
            {SLIDE_IDEAS.map((idea) => (
              <button key={idea} type="button" disabled={busy} onClick={() => designSlide(idea)} className="w-full rounded-lg border px-2.5 py-2 text-left text-xs hover:bg-muted/60 disabled:opacity-50">
                {idea}
              </button>
            ))}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={cn("rounded-xl px-3 py-2 text-xs", m.role === "user" ? "ml-6 bg-muted" : m.status === "error" ? "mr-6 bg-destructive/10 text-destructive" : "mr-6 border")}>
            {m.status === "running" && <Loader2 className="mr-1.5 inline size-3 animate-spin" />}
            {m.text}
          </div>
        ))}
        <div className="space-y-1.5 border-t pt-3">
          <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Quick actions</div>
          <Button
            size="sm"
            variant="outline"
            className="w-full justify-start"
            disabled={busy || !selectedText}
            onClick={() => {
              if (!selectedText) return;
              activeTextEditor.current?.flush();
              const el = store.currentSlide().elements.find((e) => e.id === selectedText.id) as TextElement;
              run({ action: "rewrite", markup: toMarkup(el.paragraphs), instruction: prompt.trim() || "Make it shorter, clearer and more persuasive for a client." }, "Rewrite the selected text", (r) => {
                const paragraphs = parseMarkup(String((r as { text?: string }).text ?? ""));
                store.commit(store.withElements([el.id], (e) => ({ ...(e as TextElement), paragraphs })));
              });
            }}
          >
            <Type /> Rewrite selected text
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="w-full justify-start"
            disabled={busy}
            onClick={() =>
              run({ action: "summarize", focus: prompt.trim() || undefined }, "Summarize the findings", (r) => {
                const el = addElement(store, { kind: "text" }) as TextElement;
                const paragraphs = parseMarkup(String((r as { text?: string }).text ?? ""));
                const size = Math.round(28 * (deck.size.w / 1920));
                store.commit(
                  store.withElements([el.id], (e) => ({
                    ...(e as TextElement),
                    w: Math.round(deck.size.w * 0.6),
                    h: Math.round(deck.size.h * 0.45),
                    x: Math.round(deck.size.w * 0.2),
                    y: Math.round(deck.size.h * 0.28),
                    paragraphs,
                    name: "Key findings",
                    style: { ...(e as TextElement).style, fontSize: size, lineHeight: 1.5 },
                  })),
                );
              })
            }
          >
            <Sparkles /> Summarize findings
          </Button>
          {!selectedText && <p className="text-[11px] text-muted-foreground">Select a text box to rewrite it. The prompt below is used as instruction.</p>}
        </div>
      </div>
      <div className="border-t p-3">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && prompt.trim() && !busy) {
              designSlide(prompt.trim());
              setPrompt("");
            }
          }}
          rows={3}
          placeholder="Describe a slide… e.g. “Competitor gap with a bar chart and 3 action items”"
          className="text-xs"
        />
        <Button
          size="sm"
          className="mt-2 w-full"
          disabled={busy || !prompt.trim()}
          onClick={() => {
            designSlide(prompt.trim());
            setPrompt("");
          }}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Wand2 />} Design slide
        </Button>
      </div>
    </div>
  );
}

/* ───────────────────────────── Assets ───────────────────────────── */

type AssetItem = { id: string; kind: string; fileName: string; width: number | null; height: number | null; scope: "project" | "workspace" };

function AssetsPanel() {
  const { store, projectId, assetUrl } = useEditor();
  const [assets, setAssets] = useState<AssetItem[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const reload = () => void listAssetsAction(projectId).then((r) => setAssets(r.ok ? r.data : []));
  useEffect(reload, [projectId]);

  const upload = async (files: File[]) => {
    setUploading(true);
    for (const f of files) {
      try {
        const a = await uploadAsset(projectId, f);
        addElement(store, { kind: "image", assetId: a.id, w: a.width, h: a.height });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed");
      }
    }
    setUploading(false);
    reload();
  };

  return (
    <div className="space-y-4 p-3">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void upload([...e.dataTransfer.files].filter((f) => f.type.startsWith("image/")));
        }}
        className="flex w-full flex-col items-center gap-1 rounded-xl border-2 border-dashed p-4 text-center text-xs text-muted-foreground hover:border-foreground/30 hover:bg-muted/40"
      >
        {uploading ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
        <span className="font-medium text-foreground">Upload images</span>
        PNG, JPEG, WebP, GIF, SVG · max 8 MB
      </button>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) void upload(files);
        }}
      />
      <div>
        <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Logos (live)</div>
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" variant="outline" onClick={() => addElement(store, { kind: "image", token: "client.logo" })}>
            Client logo
          </Button>
          <Button size="sm" variant="outline" onClick={() => addElement(store, { kind: "image", token: "agency.logo" })}>
            Agency logo
          </Button>
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Uploaded</div>
        {assets === null ? (
          <div className="grid grid-cols-3 gap-1.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="aspect-square animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : assets.length === 0 ? (
          <p className="text-xs text-muted-foreground">No images yet. Upload logos, screenshots or photos — they are shared across this workspace.</p>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {assets.map((a) => (
              <div key={a.id} className="group relative aspect-square overflow-hidden rounded-lg border bg-[repeating-conic-gradient(#8881_0%_25%,transparent_0%_50%)] [background-size:12px_12px]">
                <button type="button" className="size-full" title={a.fileName} onClick={() => addElement(store, { kind: "image", assetId: a.id, w: a.width, h: a.height })}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={assetUrl(a.id)} alt={a.fileName} className="size-full object-contain p-1" loading="lazy" />
                </button>
                <ConfirmButton
                  title="Delete image?"
                  description="Slides that use it will show an empty image."
                  confirmLabel="Delete"
                  destructive
                  onConfirm={async () => {
                    const r = await deleteAssetAction(projectId, a.id);
                    if (!r.ok) toast.error(r.error);
                    reload();
                  }}
                >
                  <button type="button" aria-label="Delete image" className="absolute top-1 right-1 hidden rounded-md bg-background/90 p-1 shadow group-hover:block">
                    <Trash2 className="size-3" />
                  </button>
                </ConfirmButton>
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Shapes</div>
        <div className="grid grid-cols-4 gap-1.5">
          {(
            [
              ["rect", Square],
              ["ellipse", Circle],
              ["triangle", Triangle],
              ["line", Minus],
            ] as const
          ).map(([shape, Icon]) => (
            <button key={shape} type="button" onClick={() => addElement(store, { kind: "shape", shape })} className="flex aspect-square items-center justify-center rounded-lg border hover:bg-muted/60" aria-label={shape}>
              <Icon className="size-5" />
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Icons</div>
        <div className="grid grid-cols-6 gap-1">
          {ICON_NAMES.map((n) => (
            <button key={n} type="button" title={n} onClick={() => addElement(store, { kind: "icon", icon: n })} className="flex aspect-square items-center justify-center rounded-md hover:bg-muted">
              <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                {ICONS[n]!.map(([tag, attrs], i) => {
                  const Tag = tag as "path";
                  return <Tag key={i} {...(attrs as Record<string, string>)} />;
                })}
              </svg>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── Data ───────────────────────────── */

function DataPanel() {
  const { store } = useEditor();
  const bundle = useEditorState((s) => s.bundle);
  const title = useEditorState((s) => s.title);
  const editingId = useEditorState((s) => s.editingId);
  const [browse, setBrowse] = useState(false);
  const ctx = { bundle, report: { title } };

  const insertToken = (key: string) => {
    if (editingId && activeTextEditor.current) {
      activeTextEditor.current.insertToken(key);
      return;
    }
    const sel = store.selectedElements();
    const text = sel.length === 1 && sel[0]!.type === "text" ? (sel[0] as TextElement) : null;
    if (text) {
      store.commit(
        store.withElements([text.id], (e) => {
          const t = e as TextElement;
          const paragraphs = t.paragraphs.length ? [...t.paragraphs] : [{ runs: [] }];
          const last = paragraphs[paragraphs.length - 1]!;
          paragraphs[paragraphs.length - 1] = { ...last, runs: [...last.runs, ...(last.runs.length ? [{ text: " " }] : []), { text: "", token: key }] };
          return { ...t, paragraphs };
        }),
      );
      return;
    }
    const el = addElement(store, { kind: "text" }) as TextElement;
    store.commit(store.withElements([el.id], (e) => ({ ...(e as TextElement), paragraphs: [{ runs: [{ text: "", token: key }] }], name: TOKENS[key]?.label })));
  };

  return (
    <div className="space-y-4 p-3">
      <div>
        <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Live data fields</div>
        <div className="space-y-1">
          {FEATURED_TOKENS.map((k) => (
            <Tooltip key={k}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertToken(k)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs hover:bg-muted/60"
                >
                  <span className="truncate">{TOKENS[k]!.label}</span>
                  <span className="shrink-0 rounded bg-violet-500/12 px-1.5 py-0.5 font-mono text-[11px] text-violet-600 tabular dark:text-violet-300">{resolveToken(k, ctx).text.slice(0, 18)}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Insert into the selected text (or as a new text box)</TooltipContent>
            </Tooltip>
          ))}
        </div>
        <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => setBrowse(true)}>
          <Database className="text-violet-500" /> Browse all metrics…
        </Button>
      </div>
      <div>
        <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Live lists</div>
        <div className="space-y-1">
          {Object.entries(LISTS).map(([k, d]) => (
            <button key={k} type="button" onClick={() => addElement(store, { kind: "list", source: k })} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-muted/60">
              <List className="size-3.5 text-muted-foreground" /> {d.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Charts</div>
        <div className="space-y-1">
          {Object.entries(CHARTS).map(([k, d]) => (
            <button key={k} type="button" onClick={() => addElement(store, { kind: "chart", metric: k })} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-muted/60">
              <BarChart3 className="size-3.5 text-muted-foreground" /> {d.label}
            </button>
          ))}
        </div>
      </div>
      <MetricsBrowser open={browse} onOpenChange={setBrowse} ctx={ctx} onInsertToken={insertToken} onInsertKpi={(k) => addElement(store, { kind: "kpi", metric: k })} />
    </div>
  );
}
