"use client";

import { memo, useMemo, useState } from "react";
import { Copy, EyeOff, MoreHorizontal, Plus, Trash2, ArrowLeft, ArrowRight, Eye, LayoutTemplate } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { cloneSlide } from "../../lib/build";
import { LIBRARY_TEMPLATES, buildLibraryDeck } from "../../lib/templates/library";
import type { Slide } from "../../lib/types";
import { ScaledSlide } from "../slide/scaled-slide";
import type { RenderCtx } from "../slide/slide-view";
import { addSlide, deleteSlide, duplicateSlide, moveSlide } from "./commands";
import { useEditor, useEditorState } from "./store";

const Thumb = memo(function Thumb({ slide, ctx }: { slide: Slide; ctx: RenderCtx }) {
  return <ScaledSlide slide={slide} ctx={ctx} rounded={false} />;
});

export function SlideStrip() {
  const { store, assetUrl, canManage } = useEditor();
  const deck = useEditorState((s) => s.deck);
  const slideId = useEditorState((s) => s.slideId);
  const bundle = useEditorState((s) => s.bundle);
  const title = useEditorState((s) => s.title);
  const [drag, setDrag] = useState<{ id: string; over: number | null } | null>(null);
  const ctx: RenderCtx = useMemo(() => ({ deck: { theme: deck.theme, size: deck.size }, data: { bundle, report: { title } }, assetUrl, mode: "view" }), [deck.theme, deck.size, bundle, title, assetUrl]);
  const idx = deck.slides.findIndex((s) => s.id === slideId);
  const layouts = useMemo(
    () =>
      LIBRARY_TEMPLATES.filter((t) => t.format === "slides" && t.key !== "blank").map((t) => ({
        key: t.key,
        name: t.name,
        slides: buildLibraryDeck(t.key, deck.theme).slides,
      })),
    [deck.theme],
  );
  const portrait = deck.size.h > deck.size.w;

  return (
    <div className="flex h-[112px] shrink-0 items-center gap-2 border-t bg-background px-3">
      <div className="hidden w-14 shrink-0 text-center text-xs text-muted-foreground tabular sm:block">
        {idx + 1} / {deck.slides.length}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-2 scrollbar-none">
        {deck.slides.map((s, i) => (
          <div
            key={s.id}
            draggable={canManage}
            onDragStart={() => setDrag({ id: s.id, over: null })}
            onDragOver={(e) => {
              e.preventDefault();
              if (drag) setDrag({ ...drag, over: i });
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (drag) moveSlide(store, drag.id, i);
              setDrag(null);
            }}
            onDragEnd={() => setDrag(null)}
            className={cn("group relative shrink-0", drag?.over === i && "before:absolute before:-left-1.5 before:inset-y-0 before:w-0.5 before:rounded before:bg-brand")}
          >
            <button
              type="button"
              onClick={() => store.set({ slideId: s.id, selection: [], editingId: null })}
              className={cn(
                "block overflow-hidden rounded-md ring-offset-2 ring-offset-background transition-shadow",
                portrait ? "w-[52px]" : "w-[132px]",
                s.id === slideId ? "ring-2 ring-brand" : "ring-1 ring-border hover:ring-foreground/30",
                s.hidden && "opacity-40",
              )}
            >
              <Thumb slide={s} ctx={ctx} />
            </button>
            <span className="absolute bottom-1 left-1 rounded bg-black/55 px-1 text-[10px] font-medium text-white tabular">{i + 1}</span>
            {s.hidden && <EyeOff className="absolute top-1 left-1 size-3 text-white drop-shadow" />}
            {canManage && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label="Slide actions" className="absolute top-1 right-1 hidden rounded bg-background/90 p-0.5 shadow group-hover:block data-[state=open]:block">
                    <MoreHorizontal className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start">
                  <DropdownMenuItem onClick={() => duplicateSlide(store, s.id)}>
                    <Copy /> Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => store.commit({ ...deck, slides: deck.slides.map((x) => (x.id === s.id ? { ...x, hidden: x.hidden ? undefined : true } : x)) })}>
                    {s.hidden ? <Eye /> : <EyeOff />} {s.hidden ? "Show slide" : "Hide slide"}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={i === 0} onClick={() => moveSlide(store, s.id, i - 1)}>
                    <ArrowLeft /> Move left
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={i === deck.slides.length - 1} onClick={() => moveSlide(store, s.id, i + 1)}>
                    <ArrowRight /> Move right
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" disabled={deck.slides.length <= 1} onClick={() => deleteSlide(store, s.id)}>
                    <Trash2 /> Delete slide
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ))}
        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className={cn("h-[74px] shrink-0 border-dashed", portrait ? "w-[52px]" : "w-[132px]")} aria-label="Add slide">
                <Plus />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="w-56">
              <DropdownMenuItem onClick={() => addSlide(store)}>
                <Plus /> Blank slide
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => duplicateSlide(store)}>
                <Copy /> Duplicate current
              </DropdownMenuItem>
              {!portrait && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs text-muted-foreground">From a template</DropdownMenuLabel>
                  {layouts.map((l) => (
                    <DropdownMenuSub key={l.key}>
                      <DropdownMenuSubTrigger>
                        <LayoutTemplate /> {l.name}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="max-h-96 w-56 overflow-y-auto">
                        {l.slides.map((s, i) => (
                          <DropdownMenuItem key={s.id} onClick={() => addSlide(store, cloneSlide(s))}>
                            <span className="w-5 text-muted-foreground tabular">{i + 1}</span> {s.name ?? `Slide ${i + 1}`}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
