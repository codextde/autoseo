"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Monitor, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useShell } from "@/components/app/shell-context";
import { loadDataAction, saveDeckAction, setPublishedAction } from "../../actions";
import type { DataBundle } from "../../lib/bundle";
import { elementSchema, type Deck, type DateRangeValue, type SlideElement } from "../../lib/types";
import { BrandKitDialog } from "../brand-kit-dialog";
import { downloadPptx } from "../download";
import { appAssetUrl } from "../hooks";
import { ShareDialog } from "../share-dialog";
import { SaveTemplateDialog } from "../report-dialogs";
import { ScaledSlide } from "../slide/scaled-slide";
import { Canvas } from "./canvas";
import {
  addElement,
  deleteSelection,
  duplicateSelection,
  goToSlide,
  nudge,
  pasteElements,
  reorder,
  uploadAndInsert,
} from "./commands";
import { Inspector } from "./inspector";
import { LeftRail } from "./left-rail";
import { SlideStrip } from "./slide-strip";
import { EditorContext, EditorStore } from "./store";
import { activeTextEditor } from "./text-editor";
import { TopBar } from "./top-bar";

export type EditorProps = {
  projectId: string;
  reportId: string;
  deck: Deck;
  version: number;
  title: string;
  subtitle: string | null;
  range: DateRangeValue;
  status: "draft" | "published";
  updatedAt: string;
  bundle: DataBundle | null;
  canManage: boolean;
  /** may change workspace-wide resources (templates, agency brand kit) */
  canManageWorkspace?: boolean;
};

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || !!el.closest?.("[role=dialog],[role=menu],[role=listbox]");
}

const MOBILE_QUERY = "(max-width: 767px)";
function subscribeMobile(cb: () => void) {
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function ReportEditor(props: EditorProps) {
  const mobile = useSyncExternalStore(
    subscribeMobile,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
  if (mobile) return <MobilePreview {...props} />;
  return <EditorInner {...props} />;
}

function MobilePreview({ projectId, reportId, deck, title, bundle }: EditorProps) {
  const assetUrl = useMemo(() => appAssetUrl(projectId), [projectId]);
  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-background">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-background/90 px-3 py-2 backdrop-blur">
        <Button size="sm" variant="ghost" asChild>
          <Link href={`/p/${projectId}/reports`}>← Reports</Link>
        </Button>
        <Button size="sm" asChild>
          <Link href={`/p/${projectId}/reports/${reportId}/present`}>
            <Play /> Present
          </Link>
        </Button>
      </div>
      <div className="space-y-3 p-3">
        <div className="flex gap-3 rounded-xl border bg-muted/50 p-3 text-sm">
          <Monitor className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <div className="font-medium">Editing needs a larger screen</div>
            <p className="text-xs text-muted-foreground">Open this report on a tablet or desktop (768px+) to edit. Here is a read-only preview of “{title}”.</p>
          </div>
        </div>
        {deck.slides
          .filter((s) => !s.hidden)
          .map((s) => (
            <ScaledSlide key={s.id} slide={s} ctx={{ deck, data: { bundle, report: { title } }, assetUrl, mode: "view" }} className="shadow-soft" />
          ))}
      </div>
    </div>
  );
}

function EditorInner(props: EditorProps) {
  const { projectId, reportId, canManage } = props;
  const router = useRouter();
  const shell = useShell();
  const assetUrl = useMemo(() => appAssetUrl(projectId), [projectId]);
  const [store] = useState(
    () =>
      new EditorStore({
        deck: props.deck,
        slideId: props.deck.slides[0]!.id,
        selection: [],
        editingId: null,
        past: [],
        future: [],
        seq: 0,
        savedSeq: 0,
        saving: false,
        saveError: null,
        version: props.version,
        savedAt: props.updatedAt,
        title: props.title,
        range: props.range,
        dataProjectId: projectId,
        bundle: props.bundle,
        dataLoading: false,
        zoom: "fit",
        guides: { x: [], y: [] },
        leftTab: "design",
        clipboard: null,
      }),
  );
  const [status, setStatus] = useState(props.status);
  // null = automatic (open on wide screens, closed on tablets)
  const [leftOpen, setLeftOpen] = useState<boolean | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [brandOpen, setBrandOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const conflictRef = useRef(false);
  const scheduleRef = useRef<() => void>(() => undefined);
  const saveRef = useRef<(opts?: { force?: boolean }) => Promise<boolean>>(async () => false);

  /* ─────────────── saving ─────────────── */

  const save = useCallback(
    async (opts: { force?: boolean } = {}): Promise<boolean> => {
      if (!canManage) return false;
      activeTextEditor.current?.flush();
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (savingRef.current) return false;
      const s = store.getState();
      if (s.seq === s.savedSeq && !opts.force && !s.saveError) return true;
      if (conflictRef.current && !opts.force) return false;
      savingRef.current = true;
      store.set({ saving: true });
      const seq = s.seq;
      const res = await saveDeckAction(projectId, reportId, {
        deck: s.deck,
        baseVersion: s.version,
        force: opts.force,
        title: s.title,
        dateRange: s.range as { preset: "30d" },
      });
      savingRef.current = false;
      if (res.ok) {
        conflictRef.current = false;
        store.set({ saving: false, saveError: null, version: res.data.version, savedSeq: seq, savedAt: res.data.updatedAt });
        if (store.getState().seq !== seq) scheduleRef.current();
        return true;
      }
      store.set({ saving: false, saveError: res.error });
      if (res.code === "conflict") {
        conflictRef.current = true;
        toast.error(res.error, {
          duration: 20000,
          action: { label: "Overwrite", onClick: () => void saveRef.current({ force: true }) },
          cancel: { label: "Reload", onClick: () => window.location.reload() },
        });
      } else toast.error(`Could not save: ${res.error}`);
      return false;
    },
    [canManage, projectId, reportId, store],
  );
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const schedule = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), 1500);
  }, [save]);
  useEffect(() => {
    scheduleRef.current = schedule;
  }, [schedule]);

  useEffect(() => {
    let lastSeq = store.getState().seq;
    return store.subscribe(() => {
      const s = store.getState();
      if (s.seq !== lastSeq) {
        lastSeq = s.seq;
        if (canManage && s.seq !== s.savedSeq && !conflictRef.current) schedule();
      }
    });
  }, [store, schedule, canManage]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const s = store.getState();
      if (canManage && (s.seq !== s.savedSeq || s.saving)) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [store, canManage]);

  /* ─────────────── live data (range / client switch) ─────────────── */

  useEffect(() => {
    let key = `${store.getState().dataProjectId}|${JSON.stringify(store.getState().range)}`;
    let seq = 0;
    return store.subscribe(() => {
      const s = store.getState();
      const next = `${s.dataProjectId}|${JSON.stringify(s.range)}`;
      if (next === key) return;
      key = next;
      const id = ++seq;
      store.set({ dataLoading: true });
      void loadDataAction(projectId, { dataProjectId: s.dataProjectId, dateRange: s.range as { preset: "30d" } }).then((res) => {
        if (id !== seq) return;
        if (res.ok) store.set({ bundle: res.data, dataLoading: false });
        else {
          store.set({ dataLoading: false });
          toast.error(res.error);
        }
      });
    });
  }, [store, projectId]);

  /* ─────────────── keyboard, clipboard ─────────────── */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === "s") {
        e.preventDefault();
        void save();
        return;
      }
      if (!canManage) {
        if (k === "arrowright" || k === "pagedown") goToSlide(store, 1);
        if (k === "arrowleft" || k === "pageup") goToSlide(store, -1);
        return;
      }
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (mod && k === "y") {
        e.preventDefault();
        store.redo();
        return;
      }
      if (mod && k === "a") {
        e.preventDefault();
        store.select(store.currentSlide().elements.filter((x) => !x.locked && !x.hidden).map((x) => x.id));
        return;
      }
      if (mod && k === "d") {
        e.preventDefault();
        duplicateSelection(store);
        return;
      }
      if (mod && (e.key === "]" || e.key === "}")) {
        e.preventDefault();
        reorder(store, e.shiftKey ? "front" : "forward");
        return;
      }
      if (mod && (e.key === "[" || e.key === "{")) {
        e.preventDefault();
        reorder(store, e.shiftKey ? "back" : "backward");
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (store.getState().selection.length) {
          e.preventDefault();
          deleteSelection(store);
        }
        return;
      }
      if (e.key === "Escape") {
        store.select([]);
        return;
      }
      if (e.key === "Enter") {
        const sel = store.selectedElements();
        if (sel.length === 1 && sel[0]!.type === "text") {
          e.preventDefault();
          store.set({ editingId: sel[0]!.id });
        }
        return;
      }
      if (e.key.startsWith("Arrow")) {
        const step = e.shiftKey ? 10 : 1;
        if (!store.getState().selection.length) {
          if (e.key === "ArrowRight" || e.key === "ArrowDown") goToSlide(store, 1);
          else goToSlide(store, -1);
          e.preventDefault();
          return;
        }
        e.preventDefault();
        if (e.key === "ArrowLeft") nudge(store, -step, 0);
        if (e.key === "ArrowRight") nudge(store, step, 0);
        if (e.key === "ArrowUp") nudge(store, 0, -step);
        if (e.key === "ArrowDown") nudge(store, 0, step);
        return;
      }
      if (e.key === "PageDown") goToSlide(store, 1);
      if (e.key === "PageUp") goToSlide(store, -1);
      if (!mod && !e.altKey) {
        if (k === "t") addElement(store, { kind: "text" });
        if (k === "r") addElement(store, { kind: "shape", shape: "rect" });
        if (k === "o") addElement(store, { kind: "shape", shape: "ellipse" });
        if (k === "l") addElement(store, { kind: "shape", shape: "line" });
      }
    };
    const onCopy = (e: ClipboardEvent) => {
      if (isEditable(e.target) || !store.getState().selection.length) return;
      const els = store.selectedElements();
      e.clipboardData?.setData("text/plain", `autoseo-elements:${JSON.stringify(els)}`);
      e.preventDefault();
      store.set({ clipboard: els.map((x) => structuredClone(x)) });
    };
    const onCut = (e: ClipboardEvent) => {
      if (!canManage) return;
      onCopy(e);
      if (!isEditable(e.target) && store.getState().selection.length) deleteSelection(store);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!canManage || isEditable(e.target)) return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        e.preventDefault();
        void uploadAndInsert(store, projectId, files);
        return;
      }
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (text.startsWith("autoseo-elements:")) {
        e.preventDefault();
        try {
          const parsed = elementSchema.array().parse(JSON.parse(text.slice("autoseo-elements:".length))) as SlideElement[];
          pasteElements(store, parsed);
        } catch {
          toast.error("Could not paste these elements.");
        }
        return;
      }
      if (text.trim()) {
        e.preventDefault();
        const el = addElement(store, { kind: "text" });
        store.commit(store.withElements([el.id], (x) => ({ ...(x as Extract<SlideElement, { type: "text" }>), paragraphs: text.split("\n").slice(0, 100).map((line) => ({ runs: line ? [{ text: line.slice(0, 5000) }] : [] })) })));
        return;
      }
      const clip = store.getState().clipboard;
      if (clip?.length) {
        e.preventDefault();
        pasteElements(store, clip);
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
    };
  }, [store, save, canManage, projectId]);

  /* ─────────────── actions ─────────────── */

  const present = async () => {
    await save();
    const s = store.getState();
    const idx = s.deck.slides.findIndex((x) => x.id === s.slideId);
    router.push(`/p/${projectId}/reports/${reportId}/present?slide=${idx + 1}${s.dataProjectId !== projectId ? `&client=${s.dataProjectId}` : ""}`);
  };

  const download = async (kind: "pdf" | "pptx") => {
    await save();
    const s = store.getState();
    if (kind === "pdf") {
      window.open(`/p/${projectId}/reports/${reportId}/print?auto=1${s.dataProjectId !== projectId ? `&client=${s.dataProjectId}` : ""}`, "_blank", "noopener");
      return;
    }
    const t = toast.loading("Building PowerPoint…");
    try {
      await downloadPptx({ deck: s.deck, bundle: s.bundle, title: s.title, subtitle: props.subtitle, assetUrl });
      toast.success("PowerPoint downloaded", { id: t });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed", { id: t });
    }
  };

  const togglePublish = async () => {
    await save();
    const res = await setPublishedAction(projectId, reportId, status !== "published");
    if (!res.ok) return void toast.error(res.error);
    setStatus(res.data.status);
    toast.success(res.data.status === "published" ? "Report published" : "Moved back to draft");
  };

  const ctxValue = useMemo(() => ({ store, projectId, reportId, assetUrl, canManage }), [store, projectId, reportId, assetUrl, canManage]);

  return (
    <EditorContext.Provider value={ctxValue}>
      <div className="fixed inset-0 z-40 flex flex-col bg-background">
        <TopBar
          status={status}
          onSave={() => void save()}
          onSaveTemplate={props.canManageWorkspace ? () => setTemplateOpen(true) : undefined}
          onShare={() => setShareOpen(true)}
          onBrandKit={() => setBrandOpen(true)}
          onPresent={() => void present()}
          onDownload={(k) => void download(k)}
          onTogglePublish={() => void togglePublish()}
        />
        <div className="flex min-h-0 flex-1">
          {canManage && <LeftRail open={leftOpen} onOpenChange={setLeftOpen} />}
          <div className="flex min-w-0 flex-1 flex-col bg-muted/40">
            <Canvas onDropFiles={(files, at) => canManage && void uploadAndInsert(store, projectId, files, at)} />
            <SlideStrip />
          </div>
          <aside className="hidden w-64 shrink-0 overflow-y-auto border-l bg-background md:block xl:w-72">
            <Inspector />
          </aside>
        </div>
      </div>
      <ShareDialog projectId={projectId} reportId={reportId} kind="deck" open={shareOpen} onOpenChange={setShareOpen} canManage={canManage} onChanged={(s) => setStatus(s.status)} />
      <BrandKitDialog
        projectId={projectId}
        open={brandOpen}
        onOpenChange={setBrandOpen}
        assetUrl={assetUrl}
        onApply={(theme) => store.commit({ ...store.getState().deck, theme })}
        onSaved={() => {
          const s = store.getState();
          void loadDataAction(projectId, { dataProjectId: s.dataProjectId, dateRange: s.range as { preset: "30d" } }).then((r) => r.ok && store.set({ bundle: r.data }));
        }}
      />
      <SaveTemplateDialog projectId={projectId} reportId={reportId} open={templateOpen} onOpenChange={setTemplateOpen} defaultName={store.getState().title} beforeSave={() => save()} />
      <span className="sr-only">{shell.branding.appName} report editor</span>
    </EditorContext.Provider>
  );
}
