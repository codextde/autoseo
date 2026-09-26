"use client";

import { toast } from "sonner";
import { cloneElement, cloneSlide, slide as makeSlide } from "../../lib/build";
import { uid } from "../../lib/text";
import type { Slide, SlideElement } from "../../lib/types";
import { makeElement, type AddKind } from "./factories";
import { aabb, unionRect } from "./geometry";
import type { EditorStore } from "./store";

/* Editor commands shared by shortcuts, toolbar, panels and context menus. */

export function addElement(store: EditorStore, a: AddKind, at?: { x: number; y: number }) {
  const { deck } = store.getState();
  const count = store.currentSlide().elements.length;
  const el = makeElement(a, deck.size, (count % 6) * 24);
  if (at) {
    el.x = Math.round(Math.max(0, Math.min(deck.size.w - el.w, at.x - el.w / 2)));
    el.y = Math.round(Math.max(0, Math.min(deck.size.h - el.h, at.y - el.h / 2)));
  }
  store.commit(store.withSlide((s) => ({ ...s, elements: [...s.elements, el] })), { selection: [el.id], editingId: null });
  return el;
}

export function insertElements(store: EditorStore, els: SlideElement[]) {
  store.commit(store.withSlide((s) => ({ ...s, elements: [...s.elements, ...els] })), { selection: els.map((e) => e.id), editingId: null });
}

export function deleteSelection(store: EditorStore) {
  const sel = new Set(store.getState().selection);
  if (!sel.size) return;
  store.commit(store.withSlide((s) => ({ ...s, elements: s.elements.filter((e) => !sel.has(e.id) || e.locked) })), { selection: [], editingId: null });
}

export function duplicateSelection(store: EditorStore) {
  const els = store.selectedElements();
  if (!els.length) return;
  insertElements(store, els.map((e) => cloneElement(e, 24, 24)));
}

export function copySelection(store: EditorStore, cut = false) {
  const els = store.selectedElements();
  if (!els.length) return false;
  store.set({ clipboard: els.map((e) => structuredClone(e)) });
  try {
    void navigator.clipboard?.writeText(`autoseo-elements:${JSON.stringify(els)}`);
  } catch {
    // clipboard permission denied: internal clipboard still works
  }
  if (cut) deleteSelection(store);
  return true;
}

export function pasteElements(store: EditorStore, els: SlideElement[]) {
  if (!els.length) return;
  const existing = new Set(store.currentSlide().elements.map((e) => e.id));
  const offset = els.some((e) => existing.has(e.id)) ? 24 : 0;
  insertElements(
    store,
    els.map((e) => cloneElement(e, offset, offset)),
  );
}

export function nudge(store: EditorStore, dx: number, dy: number) {
  const sel = store.selectedElements().filter((e) => !e.locked);
  if (!sel.length) return;
  store.updateElements(
    sel.map((e) => e.id),
    (e) => ({ ...e, x: e.x + dx, y: e.y + dy }),
  );
}

export type ZOrder = "forward" | "backward" | "front" | "back";

export function reorder(store: EditorStore, dir: ZOrder) {
  const sel = new Set(store.getState().selection);
  if (!sel.size) return;
  store.commit(
    store.withSlide((s) => {
      const els = [...s.elements];
      const picked = els.filter((e) => sel.has(e.id));
      const rest = els.filter((e) => !sel.has(e.id));
      if (dir === "front") return { ...s, elements: [...rest, ...picked] };
      if (dir === "back") return { ...s, elements: [...picked, ...rest] };
      if (dir === "forward") {
        for (let i = els.length - 2; i >= 0; i--) {
          if (sel.has(els[i]!.id) && !sel.has(els[i + 1]!.id)) [els[i], els[i + 1]] = [els[i + 1]!, els[i]!];
        }
      } else {
        for (let i = 1; i < els.length; i++) {
          if (sel.has(els[i]!.id) && !sel.has(els[i - 1]!.id)) [els[i], els[i - 1]] = [els[i - 1]!, els[i]!];
        }
      }
      return { ...s, elements: els };
    }),
  );
}

export type AlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom" | "hdistribute" | "vdistribute";

export function align(store: EditorStore, mode: AlignMode) {
  const els = store.selectedElements().filter((e) => !e.locked);
  if (!els.length) return;
  const { size } = store.getState().deck;
  const ref = els.length === 1 ? { x: 0, y: 0, w: size.w, h: size.h } : unionRect(els.map(aabb))!;
  const updates = new Map<string, { x?: number; y?: number }>();
  if (mode === "hdistribute" || mode === "vdistribute") {
    if (els.length < 3) return;
    const horiz = mode === "hdistribute";
    const sorted = [...els].sort((a, b) => (horiz ? aabb(a).x - aabb(b).x : aabb(a).y - aabb(b).y));
    const total = sorted.reduce((s, e) => s + (horiz ? aabb(e).w : aabb(e).h), 0);
    const span = horiz ? ref.w : ref.h;
    const gap = (span - total) / (sorted.length - 1);
    let pos = horiz ? ref.x : ref.y;
    for (const e of sorted) {
      const b = aabb(e);
      if (horiz) updates.set(e.id, { x: Math.round(e.x + (pos - b.x)) });
      else updates.set(e.id, { y: Math.round(e.y + (pos - b.y)) });
      pos += (horiz ? b.w : b.h) + gap;
    }
  } else {
    for (const e of els) {
      const b = aabb(e);
      const u: { x?: number; y?: number } = {};
      if (mode === "left") u.x = e.x + (ref.x - b.x);
      if (mode === "hcenter") u.x = e.x + (ref.x + ref.w / 2 - (b.x + b.w / 2));
      if (mode === "right") u.x = e.x + (ref.x + ref.w - (b.x + b.w));
      if (mode === "top") u.y = e.y + (ref.y - b.y);
      if (mode === "vcenter") u.y = e.y + (ref.y + ref.h / 2 - (b.y + b.h / 2));
      if (mode === "bottom") u.y = e.y + (ref.y + ref.h - (b.y + b.h));
      if (u.x !== undefined) u.x = Math.round(u.x);
      if (u.y !== undefined) u.y = Math.round(u.y);
      updates.set(e.id, u);
    }
  }
  store.updateElements([...updates.keys()], (e) => ({ ...e, ...updates.get(e.id) }));
}

/* ─────────────── slides ─────────────── */

export function addSlide(store: EditorStore, s?: Slide, afterId?: string) {
  const { deck, slideId } = store.getState();
  const next = s ?? makeSlide([], { name: `Slide ${deck.slides.length + 1}` });
  const idx = deck.slides.findIndex((x) => x.id === (afterId ?? slideId));
  const slides = [...deck.slides];
  slides.splice(idx + 1, 0, next);
  store.commit({ ...deck, slides }, { slideId: next.id, selection: [], editingId: null });
}

export function duplicateSlide(store: EditorStore, id?: string) {
  const { deck, slideId } = store.getState();
  const src = deck.slides.find((s) => s.id === (id ?? slideId));
  if (!src) return;
  const copy = cloneSlide(src);
  copy.name = src.name ? `${src.name} (copy)` : undefined;
  addSlide(store, copy, src.id);
}

export function deleteSlide(store: EditorStore, id?: string) {
  const { deck, slideId } = store.getState();
  if (deck.slides.length <= 1) {
    toast.info("A report needs at least one slide.");
    return;
  }
  const target = id ?? slideId;
  const idx = deck.slides.findIndex((s) => s.id === target);
  const slides = deck.slides.filter((s) => s.id !== target);
  const nextId = target === slideId ? slides[Math.max(0, idx - 1)]!.id : slideId;
  store.commit({ ...deck, slides }, { slideId: nextId, selection: [], editingId: null });
}

export function moveSlide(store: EditorStore, id: string, toIndex: number) {
  const { deck } = store.getState();
  const from = deck.slides.findIndex((s) => s.id === id);
  if (from < 0) return;
  const slides = [...deck.slides];
  const [item] = slides.splice(from, 1);
  slides.splice(Math.max(0, Math.min(slides.length, toIndex)), 0, item!);
  store.commit({ ...deck, slides });
}

export function goToSlide(store: EditorStore, delta: number) {
  const { deck, slideId } = store.getState();
  const idx = deck.slides.findIndex((s) => s.id === slideId);
  const next = deck.slides[Math.max(0, Math.min(deck.slides.length - 1, idx + delta))];
  if (next && next.id !== slideId) store.set({ slideId: next.id, selection: [], editingId: null });
}

/* ─────────────── uploads ─────────────── */

export type UploadedAsset = { id: string; width: number | null; height: number | null; fileName: string; mimeType: string };

export async function uploadAsset(projectId: string, file: File, kind: "image" | "logo" | "icon" = "image", scope: "project" | "workspace" = "project"): Promise<UploadedAsset> {
  const form = new FormData();
  form.set("file", file);
  form.set("kind", kind);
  form.set("scope", scope);
  const res = await fetch(`/p/${projectId}/reports/assets`, { method: "POST", body: form });
  const json = (await res.json().catch(() => ({}))) as { asset?: UploadedAsset; error?: string };
  if (!res.ok || !json.asset) throw new Error(json.error ?? `Upload failed (${res.status})`);
  return json.asset;
}

export async function uploadAndInsert(store: EditorStore, projectId: string, files: File[], at?: { x: number; y: number }) {
  for (const file of files) {
    const t = toast.loading(`Uploading ${file.name}…`);
    try {
      const asset = await uploadAsset(projectId, file);
      addElement(store, { kind: "image", assetId: asset.id, w: asset.width, h: asset.height }, at);
      toast.success("Image added", { id: t });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed", { id: t });
    }
  }
}

export const newSlideId = () => uid("sl");
