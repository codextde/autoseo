"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SlideView, type RenderCtx } from "../slide/slide-view";
import { useElementSize } from "../slide/scaled-slide";
import type { Slide, SlideElement, TextElement } from "../../lib/types";
import { HANDLES, aabb, intersects, resizeRotated, snapBox, snapTargets, snapValue, unionRect, type Handle, type Rect } from "./geometry";
import { useEditor, useEditorState } from "./store";
import { TextEditorOverlay, activeTextEditor } from "./text-editor";
import { CanvasToolbar } from "./toolbar";

const PAD = 56;
const GUIDE = "#FF3EA5";
const SELECT = "#3DDC84";

const CURSORS: Record<Handle, string> = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };

function track(onMove: (e: PointerEvent) => void, onUp: (e: PointerEvent) => void) {
  const move = (e: PointerEvent) => onMove(e);
  const up = (e: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    onUp(e);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

export function Canvas({ onDropFiles }: { onDropFiles: (files: File[], at?: { x: number; y: number }) => void }) {
  const { store, assetUrl, canManage } = useEditor();
  const deck = useEditorState((s) => s.deck);
  const slideId = useEditorState((s) => s.slideId);
  const selection = useEditorState((s) => s.selection);
  const editingId = useEditorState((s) => s.editingId);
  const zoomSetting = useEditorState((s) => s.zoom);
  const guides = useEditorState((s) => s.guides);
  const bundle = useEditorState((s) => s.bundle);
  const title = useEditorState((s) => s.title);
  const slide: Slide = deck.slides.find((s) => s.id === slideId) ?? deck.slides[0]!;
  const [vpRef, vp] = useElementSize<HTMLDivElement>();
  const slideRef = useRef<HTMLDivElement>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [rotateLabel, setRotateLabel] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const { w: W, h: H } = deck.size;
  const fit = vp.w ? Math.max(0.05, Math.min((vp.w - PAD * 2) / W, (vp.h - PAD * 2 - 56) / H)) : 0.4;
  const z = zoomSetting === "fit" ? fit : zoomSetting;
  const stageW = Math.max(vp.w, W * z + PAD * 2);
  const stageH = Math.max(vp.h, H * z + PAD * 2 + 56);
  const left = (stageW - W * z) / 2;
  const top = Math.max(PAD, (stageH - 56 - H * z) / 2);

  // pinch / ctrl+wheel zoom (native listener: React wheel handlers are passive)
  const zoomRef = useRef(z);
  useEffect(() => {
    zoomRef.current = z;
  }, [z]);
  useEffect(() => {
    const node = vpRef.current;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const next = Math.max(0.1, Math.min(3, zoomRef.current * Math.exp(-e.deltaY * 0.01)));
      store.set({ zoom: Math.round(next * 100) / 100 });
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [store, vpRef]);

  const skip = useMemo(() => (editingId ? new Set([editingId]) : undefined), [editingId]);
  const ctx: RenderCtx = useMemo(
    () => ({ deck: { theme: deck.theme, size: deck.size }, data: { bundle, report: { title } }, assetUrl, mode: "edit", skip }),
    [deck.theme, deck.size, bundle, title, assetUrl, skip],
  );

  const toSlide = useCallback(
    (cx: number, cy: number) => {
      const r = slideRef.current!.getBoundingClientRect();
      return { x: (cx - r.left) / z, y: (cy - r.top) / z };
    },
    [z],
  );

  const hitTest = useCallback(
    (cx: number, cy: number): SlideElement | null => {
      const slideEl = slideRef.current;
      if (!slideEl) return null;
      const byId = new Map(slide.elements.map((e) => [e.id, e]));
      for (const node of document.elementsFromPoint(cx, cy)) {
        if (!slideEl.contains(node)) continue;
        const host = (node as HTMLElement).closest?.("[data-el-id]") as HTMLElement | null;
        const el = host ? byId.get(host.dataset.elId!) : undefined;
        if (el && !el.locked && !el.hidden) return el;
      }
      return null;
    },
    [slide.elements],
  );

  /* ─────────────── move / select / marquee ─────────────── */

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !canManage) return;
    if ((e.target as HTMLElement).closest("[data-handle],[data-text-editor],[data-toolbar]")) return;
    if (editingId) activeTextEditor.current?.finish();
    const hit = hitTest(e.clientX, e.clientY);
    const state = store.getState();
    if (!hit) {
      // marquee on empty canvas
      const start = toSlide(e.clientX, e.clientY);
      const base = e.shiftKey ? state.selection : [];
      let moved = false;
      track(
        (ev) => {
          const p = toSlide(ev.clientX, ev.clientY);
          if (!moved && Math.hypot(p.x - start.x, p.y - start.y) * z < 4) return;
          moved = true;
          const r = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
          setMarquee(r);
          const inside = store
            .currentSlide()
            .elements.filter((el) => !el.locked && !el.hidden && intersects(r, aabb(el)))
            .map((el) => el.id);
          store.select([...new Set([...base, ...inside])]);
        },
        () => {
          setMarquee(null);
          if (!moved && !e.shiftKey) store.select([]);
        },
      );
      return;
    }
    let sel = state.selection;
    const wasSelected = sel.includes(hit.id);
    if (e.shiftKey) sel = wasSelected ? sel : [...sel, hit.id];
    else if (!wasSelected) sel = [hit.id];
    store.select(sel);
    const cur = store.currentSlide();
    const moving = cur.elements.filter((el) => sel.includes(el.id) && !el.locked);
    if (!moving.length) return;
    const starts = new Map(moving.map((el) => [el.id, { x: el.x, y: el.y }]));
    const startBox = unionRect(moving.map(aabb))!;
    const targets = snapTargets(cur.elements, new Set(sel), deck.size);
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    store.beginGesture();
    track(
      (ev) => {
        let dx = (ev.clientX - sx) / z;
        let dy = (ev.clientY - sy) / z;
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
        moved = true;
        if (ev.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        let gx: number[] = [];
        let gy: number[] = [];
        if (!ev.altKey && !ev.metaKey && !ev.ctrlKey) {
          if (deck.grid) {
            dx = Math.round((startBox.x + dx) / deck.grid) * deck.grid - startBox.x;
            dy = Math.round((startBox.y + dy) / deck.grid) * deck.grid - startBox.y;
          } else {
            const snap = snapBox({ ...startBox, x: startBox.x + dx, y: startBox.y + dy }, targets, 7 / z);
            dx += snap.dx;
            dy += snap.dy;
            gx = snap.gx;
            gy = snap.gy;
          }
        }
        const ids = new Set(starts.keys());
        store.transient(
          store.withElements(ids, (el) => {
            const st = starts.get(el.id)!;
            return { ...el, x: Math.round(st.x + dx), y: Math.round(st.y + dy) };
          }),
          { guides: { x: gx, y: gy } },
        );
      },
      () => {
        store.endGesture();
        if (!moved && e.shiftKey && wasSelected) store.select(sel.filter((id) => id !== hit.id));
      },
    );
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!canManage) return;
    const hit = hitTest(e.clientX, e.clientY);
    if (hit?.type === "text") store.set({ selection: [hit.id], editingId: hit.id });
  };

  /* ─────────────── resize / rotate ─────────────── */

  const selected = slide.elements.filter((el) => selection.includes(el.id));
  const single = selected.length === 1 ? selected[0]! : null;
  const groupBox = selected.length > 1 ? unionRect(selected.map(aabb)) : null;

  const startResize = (handle: Handle, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const cur = store.currentSlide();
    const sel = store.getState().selection;
    const els = cur.elements.filter((el) => sel.includes(el.id) && !el.locked);
    if (!els.length) return;
    const targets = snapTargets(cur.elements, new Set(sel), deck.size);
    store.beginGesture();
    if (els.length === 1) {
      const start = els[0]!;
      const aspect = start.type === "image" || start.type === "score" || start.type === "icon";
      track(
        (ev) => {
          const dx = (ev.clientX - sx) / z;
          const dy = (ev.clientY - sy) / z;
          const r = resizeRotated({ x: start.x, y: start.y, w: start.w, h: start.h, rotation: start.rotation }, handle, dx, dy, { keepAspect: ev.shiftKey !== aspect && handle.length === 2 });
          const gx: number[] = [];
          const gy: number[] = [];
          if (!start.rotation && !ev.altKey) {
            const th = 7 / z;
            if (handle.includes("e")) {
              const s = snapValue(r.x + r.w, targets.xs, th);
              if (s.guide !== null) {
                r.w = s.v - r.x;
                gx.push(s.guide);
              }
            }
            if (handle.includes("w")) {
              const s = snapValue(r.x, targets.xs, th);
              if (s.guide !== null) {
                r.w += r.x - s.v;
                r.x = s.v;
                gx.push(s.guide);
              }
            }
            if (handle.includes("s")) {
              const s = snapValue(r.y + r.h, targets.ys, th);
              if (s.guide !== null) {
                r.h = s.v - r.y;
                gy.push(s.guide);
              }
            }
            if (handle.startsWith("n")) {
              const s = snapValue(r.y, targets.ys, th);
              if (s.guide !== null) {
                r.h += r.y - s.v;
                r.y = s.v;
                gy.push(s.guide);
              }
            }
          }
          store.transient(
            store.withElements([start.id], (el) => ({ ...el, x: Math.round(r.x), y: Math.round(r.y), w: Math.max(4, Math.round(r.w)), h: Math.max(4, Math.round(r.h)) })),
            { guides: { x: gx, y: gy } },
          );
        },
        () => store.endGesture(),
      );
      return;
    }
    const U = unionRect(els.map(aabb))!;
    const starts = new Map(els.map((el) => [el.id, { x: el.x, y: el.y, w: el.w, h: el.h }]));
    track(
      (ev) => {
        const dx = (ev.clientX - sx) / z;
        const dy = (ev.clientY - sy) / z;
        const r = resizeRotated({ ...U, rotation: 0 }, handle, dx, dy, { keepAspect: ev.shiftKey && handle.length === 2 });
        const kx = r.w / U.w;
        const ky = r.h / U.h;
        store.transient(
          store.withElements(new Set(starts.keys()), (el) => {
            const st = starts.get(el.id)!;
            return { ...el, x: Math.round(r.x + (st.x - U.x) * kx), y: Math.round(r.y + (st.y - U.y) * ky), w: Math.max(4, Math.round(st.w * kx)), h: Math.max(4, Math.round(st.h * ky)) };
          }),
        );
      },
      () => store.endGesture(),
    );
  };

  const startRotate = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!single || single.locked) return;
    const r = slideRef.current!.getBoundingClientRect();
    const cx = r.left + (single.x + single.w / 2) * z;
    const cy = r.top + (single.y + single.h / 2) * z;
    const a0 = Math.atan2(e.clientY - cy, e.clientX - cx);
    const rot0 = single.rotation;
    store.beginGesture();
    track(
      (ev) => {
        let deg = rot0 + ((Math.atan2(ev.clientY - cy, ev.clientX - cx) - a0) * 180) / Math.PI;
        if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
        else {
          const nearest = Math.round(deg / 90) * 90;
          if (Math.abs(deg - nearest) < 4) deg = nearest;
        }
        deg = ((((deg + 180) % 360) + 360) % 360) - 180;
        deg = Math.round(deg * 10) / 10;
        setRotateLabel(deg);
        store.transient(store.withElements([single.id], (el) => ({ ...el, rotation: deg })));
      },
      () => {
        setRotateLabel(null);
        store.endGesture();
      },
    );
  };

  const editing = editingId ? (slide.elements.find((e) => e.id === editingId) as TextElement | undefined) : undefined;

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={vpRef}
        className="absolute inset-0 overflow-auto bg-[radial-gradient(circle,oklch(0.5_0_0/0.13)_1px,transparent_1px)] [background-size:18px_18px]"
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
        onDragOver={(e) => {
          if ([...e.dataTransfer.types].includes("Files")) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          setDragOver(false);
          const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
          if (!files.length) return;
          e.preventDefault();
          onDropFiles(files, slideRef.current ? toSlide(e.clientX, e.clientY) : undefined);
        }}
      >
        <div style={{ position: "relative", width: stageW, height: stageH }}>
          <div
            ref={slideRef}
            style={{ position: "absolute", left, top, width: W * z, height: H * z, boxShadow: "0 1px 2px rgba(0,0,0,0.12), 0 24px 64px -24px rgba(0,0,0,0.35)" }}
          >
            <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, transform: `scale(${z})`, transformOrigin: "0 0" }}>
              <SlideView slide={slide} ctx={ctx} />
              {editing && editing.type === "text" && <TextEditorOverlay el={editing} theme={deck.theme} data={ctx.data} />}
            </div>
            {deck.grid ? (
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  backgroundImage: `linear-gradient(to right, rgba(127,127,127,0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(127,127,127,0.12) 1px, transparent 1px)`,
                  backgroundSize: `${deck.grid * z * 5}px ${deck.grid * z * 5}px`,
                }}
              />
            ) : null}
            {/* guides */}
            {guides.x.map((gx, i) => (
              <div key={`gx${i}`} className="pointer-events-none absolute top-0 bottom-0" style={{ left: gx * z, width: 1, background: GUIDE }} />
            ))}
            {guides.y.map((gy, i) => (
              <div key={`gy${i}`} className="pointer-events-none absolute right-0 left-0" style={{ top: gy * z, height: 1, background: GUIDE }} />
            ))}
            {/* multi-selection outlines */}
            {selected.length > 1 &&
              selected.map((el) => (
                <div
                  key={el.id}
                  className="pointer-events-none absolute"
                  style={{ left: el.x * z, top: el.y * z, width: el.w * z, height: el.h * z, transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined, outline: `1px solid ${SELECT}` }}
                />
              ))}
            {single && !editing && (
              <SelectionBox
                rect={{ x: single.x * z, y: single.y * z, w: single.w * z, h: single.h * z }}
                rotation={single.rotation}
                label={rotateLabel !== null ? `${rotateLabel}°` : `${Math.round(single.w)} × ${Math.round(single.h)}`}
                locked={!!single.locked}
                onResize={startResize}
                onRotate={startRotate}
              />
            )}
            {groupBox && (
              <SelectionBox
                rect={{ x: groupBox.x * z, y: groupBox.y * z, w: groupBox.w * z, h: groupBox.h * z }}
                rotation={0}
                label={`${selected.length} selected · ${Math.round(groupBox.w)} × ${Math.round(groupBox.h)}`}
                locked={false}
                onResize={startResize}
              />
            )}
            {marquee && (
              <div
                className="pointer-events-none absolute rounded-sm"
                style={{ left: marquee.x * z, top: marquee.y * z, width: marquee.w * z, height: marquee.h * z, border: `1px solid ${SELECT}`, background: "rgba(61,220,132,0.08)" }}
              />
            )}
          </div>
        </div>
      </div>
      {dragOver && (
        <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand bg-brand/5 text-sm font-medium text-brand">
          Drop images to upload them to this slide
        </div>
      )}
      <CanvasToolbar zoom={z} fit={fit} />
    </div>
  );
}

function SelectionBox({
  rect,
  rotation,
  label,
  locked,
  onResize,
  onRotate,
}: {
  rect: Rect;
  rotation: number;
  label: string;
  locked: boolean;
  onResize: (h: Handle, e: React.PointerEvent) => void;
  onRotate?: (e: React.PointerEvent) => void;
}) {
  const pos: Record<Handle, React.CSSProperties> = {
    nw: { left: -5, top: -5 },
    n: { left: rect.w / 2 - 5, top: -5 },
    ne: { right: -5, top: -5 },
    e: { right: -5, top: rect.h / 2 - 5 },
    se: { right: -5, bottom: -5 },
    s: { left: rect.w / 2 - 5, bottom: -5 },
    sw: { left: -5, bottom: -5 },
    w: { left: -5, top: rect.h / 2 - 5 },
  };
  const small = rect.w < 40 || rect.h < 40;
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
        outline: `1.5px solid ${locked ? "#9CA3AF" : SELECT}`,
      }}
    >
      {!locked &&
        HANDLES.filter((h) => !small || h.length === 2).map((h) => (
          <div
            key={h}
            data-handle={h}
            onPointerDown={(e) => onResize(h, e)}
            className="pointer-events-auto absolute size-2.5 rounded-[3px] border-[1.5px] bg-white shadow-sm"
            style={{ ...pos[h], borderColor: SELECT, cursor: CURSORS[h] }}
          />
        ))}
      {!locked && onRotate && (
        <>
          <div className="pointer-events-none absolute left-1/2 w-px" style={{ top: -22, height: 18, background: SELECT }} />
          <div
            data-handle="rotate"
            onPointerDown={onRotate}
            title="Rotate (Shift snaps to 15°)"
            className="pointer-events-auto absolute left-1/2 size-3 -translate-x-1/2 rounded-full border-[1.5px] bg-white shadow-sm"
            style={{ top: -30, borderColor: SELECT, cursor: "grab" }}
          />
        </>
      )}
      <div
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-md px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-black tabular"
        style={{ top: rect.h + 8, background: SELECT }}
      >
        {locked ? "Locked" : label}
      </div>
    </div>
  );
}
