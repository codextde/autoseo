import type { SlideElement } from "../../lib/types";

export type Rect = { x: number; y: number; w: number; h: number };

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Axis-aligned bounding box of a (possibly rotated) element. */
export function aabb(e: Pick<SlideElement, "x" | "y" | "w" | "h" | "rotation">): Rect {
  if (!e.rotation) return { x: e.x, y: e.y, w: e.w, h: e.h };
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  const c = Math.abs(Math.cos(rad(e.rotation)));
  const s = Math.abs(Math.sin(rad(e.rotation)));
  const w = e.w * c + e.h * s;
  const h = e.w * s + e.h * c;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export function unionRect(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function intersects(a: Rect, b: Rect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export type SnapTargets = { xs: number[]; ys: number[] };

export function snapTargets(elements: SlideElement[], exclude: Set<string>, size: { w: number; h: number }): SnapTargets {
  const xs = [0, size.w / 2, size.w];
  const ys = [0, size.h / 2, size.h];
  for (const e of elements) {
    if (exclude.has(e.id) || e.hidden) continue;
    const r = aabb(e);
    xs.push(r.x, r.x + r.w / 2, r.x + r.w);
    ys.push(r.y, r.y + r.h / 2, r.y + r.h);
  }
  return { xs, ys };
}

function best(cands: number[], targets: number[], threshold: number): { delta: number; at: number } | null {
  let out: { delta: number; at: number } | null = null;
  for (const c of cands) {
    for (const t of targets) {
      const d = t - c;
      if (Math.abs(d) <= threshold && (!out || Math.abs(d) < Math.abs(out.delta))) out = { delta: d, at: t };
    }
  }
  return out;
}

/** Snaps a moving box to slide/element edges & centers. Returns the correction and guide lines. */
export function snapBox(box: Rect, targets: SnapTargets, threshold: number) {
  const sx = best([box.x, box.x + box.w / 2, box.x + box.w], targets.xs, threshold);
  const sy = best([box.y, box.y + box.h / 2, box.y + box.h], targets.ys, threshold);
  return { dx: sx?.delta ?? 0, dy: sy?.delta ?? 0, gx: sx ? [sx.at] : [], gy: sy ? [sy.at] : [] };
}

/** Snaps individual edges (used while resizing). */
export function snapValue(v: number, targets: number[], threshold: number): { v: number; guide: number | null } {
  const s = best([v], targets, threshold);
  return s ? { v: v + s.delta, guide: s.at } : { v, guide: null };
}

export const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type Handle = (typeof HANDLES)[number];

export const HANDLE_DIR: Record<Handle, [number, number]> = {
  nw: [-1, -1],
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
};

/**
 * Resizes a rotated box by dragging a handle: works in the element's local frame so the opposite
 * edge/corner stays fixed on screen.
 */
export function resizeRotated(
  start: Rect & { rotation: number },
  handle: Handle,
  dxWorld: number,
  dyWorld: number,
  opts: { keepAspect?: boolean; min?: number } = {},
): Rect {
  const [hx, hy] = HANDLE_DIR[handle];
  const th = rad(start.rotation);
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  // world delta → local delta
  const lx = dxWorld * cos + dyWorld * sin;
  const ly = -dxWorld * sin + dyWorld * cos;
  const min = opts.min ?? 8;
  let w = hx !== 0 ? Math.max(min, start.w + hx * lx) : start.w;
  let h = hy !== 0 ? Math.max(min, start.h + hy * ly) : start.h;
  if (opts.keepAspect && hx !== 0 && hy !== 0) {
    const ratio = start.w / start.h;
    if (w / h > ratio) h = w / ratio;
    else w = h * ratio;
  } else if (opts.keepAspect && hx !== 0) {
    h = w / (start.w / start.h);
  } else if (opts.keepAspect && hy !== 0) {
    w = h * (start.w / start.h);
  }
  // shift the center so the opposite anchor stays fixed
  const dw = w - start.w;
  const dh = h - start.h;
  const ax = (hx * dw) / 2;
  const ay = (hy * dh) / 2;
  const cx = start.x + start.w / 2 + ax * cos - ay * sin;
  const cy = start.y + start.h / 2 + ax * sin + ay * cos;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export const round = (v: number) => Math.round(v);
