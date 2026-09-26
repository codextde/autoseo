"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import type { DataBundle } from "../../lib/bundle";
import type { Deck, DateRangeValue, Slide, SlideElement } from "../../lib/types";

/*
 * Editor state lives in a tiny external store (useSyncExternalStore) so the canvas, panels and
 * shortcuts can subscribe to slices without prop drilling. History is snapshot-based: every commit
 * pushes the previous deck; drags use begin/end gestures so a whole drag is one undo step.
 */

export type EditorState = {
  deck: Deck;
  slideId: string;
  selection: string[];
  editingId: string | null;
  past: Deck[];
  future: Deck[];
  /** increments on every deck change (autosave trigger) */
  seq: number;
  savedSeq: number;
  saving: boolean;
  saveError: string | null;
  version: number;
  savedAt: string | null;
  title: string;
  range: DateRangeValue;
  dataProjectId: string;
  bundle: DataBundle | null;
  dataLoading: boolean;
  zoom: number | "fit";
  guides: { x: number[]; y: number[] };
  leftTab: "design" | "agent" | "assets" | "data";
  clipboard: SlideElement[] | null;
};

const HISTORY_LIMIT = 150;

export class EditorStore {
  state: EditorState;
  private listeners = new Set<() => void>();
  private gestureBase: Deck | null = null;

  constructor(initial: EditorState) {
    this.state = initial;
  }

  getState = () => this.state;

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  private emit() {
    for (const l of this.listeners) l();
  }

  set(patch: Partial<EditorState>) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  /** Replaces the deck and records an undo step. */
  commit(deck: Deck, extra: Partial<EditorState> = {}) {
    if (deck === this.state.deck && !Object.keys(extra).length) return;
    const past = this.gestureBase ? this.state.past : [...this.state.past, this.state.deck].slice(-HISTORY_LIMIT);
    this.state = { ...this.state, ...extra, deck, past, future: this.gestureBase ? this.state.future : [], seq: this.state.seq + 1 };
    this.emit();
  }

  /** Updates the deck without an undo step (inside a gesture). */
  transient(deck: Deck, extra: Partial<EditorState> = {}) {
    this.state = { ...this.state, ...extra, deck, seq: this.state.seq + 1 };
    this.emit();
  }

  beginGesture() {
    this.gestureBase = this.state.deck;
  }

  endGesture() {
    const base = this.gestureBase;
    this.gestureBase = null;
    if (base && base !== this.state.deck) {
      this.state = { ...this.state, past: [...this.state.past, base].slice(-HISTORY_LIMIT), future: [], guides: { x: [], y: [] } };
    } else {
      this.state = { ...this.state, guides: { x: [], y: [] } };
    }
    this.emit();
  }

  undo() {
    const prev = this.state.past.at(-1);
    if (!prev) return;
    const slideId = prev.slides.some((s) => s.id === this.state.slideId) ? this.state.slideId : prev.slides[0]!.id;
    this.state = {
      ...this.state,
      deck: prev,
      past: this.state.past.slice(0, -1),
      future: [this.state.deck, ...this.state.future].slice(0, HISTORY_LIMIT),
      slideId,
      selection: this.state.selection.filter((id) => prev.slides.find((s) => s.id === slideId)?.elements.some((e) => e.id === id)),
      editingId: null,
      seq: this.state.seq + 1,
    };
    this.emit();
  }

  redo() {
    const next = this.state.future[0];
    if (!next) return;
    const slideId = next.slides.some((s) => s.id === this.state.slideId) ? this.state.slideId : next.slides[0]!.id;
    this.state = {
      ...this.state,
      deck: next,
      past: [...this.state.past, this.state.deck].slice(-HISTORY_LIMIT),
      future: this.state.future.slice(1),
      slideId,
      selection: this.state.selection.filter((id) => next.slides.find((s) => s.id === slideId)?.elements.some((e) => e.id === id)),
      editingId: null,
      seq: this.state.seq + 1,
    };
    this.emit();
  }

  /* ── helpers ── */

  currentSlide(): Slide {
    const s = this.state;
    return s.deck.slides.find((x) => x.id === s.slideId) ?? s.deck.slides[0]!;
  }

  selectedElements(): SlideElement[] {
    const slide = this.currentSlide();
    const sel = new Set(this.state.selection);
    return slide.elements.filter((e) => sel.has(e.id));
  }

  /** Returns a new deck with the current slide transformed. */
  withSlide(fn: (s: Slide) => Slide, deck = this.state.deck, slideId = this.state.slideId): Deck {
    return { ...deck, slides: deck.slides.map((s) => (s.id === slideId ? fn(s) : s)) };
  }

  /** Patches elements by id on the current slide. */
  withElements(ids: string[] | Set<string>, fn: (e: SlideElement) => SlideElement, deck = this.state.deck): Deck {
    const set = ids instanceof Set ? ids : new Set(ids);
    return this.withSlide((s) => ({ ...s, elements: s.elements.map((e) => (set.has(e.id) ? fn(e) : e)) }), deck);
  }

  updateElements(ids: string[] | Set<string>, fn: (e: SlideElement) => SlideElement, opts: { transient?: boolean } = {}) {
    const deck = this.withElements(ids, fn);
    if (opts.transient) this.transient(deck);
    else this.commit(deck);
  }

  select(ids: string[]) {
    this.set({ selection: ids, editingId: this.state.editingId && ids.includes(this.state.editingId) ? this.state.editingId : null });
  }
}

export const EditorContext = createContext<{
  store: EditorStore;
  projectId: string;
  reportId: string;
  assetUrl: (id: string) => string;
  canManage: boolean;
} | null>(null);

export function useEditor() {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor must be used inside the report editor");
  return ctx;
}

export function useEditorState<T>(selector: (s: EditorState) => T): T {
  const { store } = useEditor();
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}
