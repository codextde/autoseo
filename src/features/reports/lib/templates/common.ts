import { box, card, eyebrow, heading, icon, image, kpi, line, text } from "../build";
import type { SlideElement } from "../types";

/* Layout constants for the 1920×1080 canvas. */
export const W = 1920;
export const H = 1080;
export const M = 112;
export const CW = W - M * 2;

/** Section eyebrow + headline at the top of a content slide. */
export function header(label: string, title: string, o: { w?: number; size?: number; h?: number; y?: number } = {}): SlideElement[] {
  const y = o.y ?? 92;
  return [
    eyebrow(label, { x: M, y, w: 1200, h: 32, name: "Eyebrow" }),
    heading(title, { x: M, y: y + 46, w: o.w ?? 1480, h: o.h ?? 170, size: o.size ?? 68, name: "Headline" }),
  ];
}

/** Footer: agency name left, client · period right, thin rule. */
export function footer(): SlideElement[] {
  return [
    line({ x: M, y: 990, w: CW, h: 2, color: "$border", name: "Footer rule" }),
    text("{{agency.name}}", { x: M, y: 1008, w: 800, h: 32, size: 20, color: "$muted", weight: 500, name: "Footer agency" }),
    text("{{client.name}} · {{report.period}}", { x: W - M - 900, y: 1008, w: 900, h: 32, size: 20, color: "$muted", align: "right", name: "Footer client" }),
  ];
}

/** Client logo in the top-right corner (renders nothing until a logo is set in the brand kit). */
export function clientLogo(x = W - M - 220, y = 84, w = 220, h = 72): SlideElement {
  return image({ kind: "token", token: "client.logo" }, { x, y, w, h, fit: "contain", name: "Client logo" });
}

export function agencyLogo(x = M, y = 84, w = 200, h = 64): SlideElement {
  return image({ kind: "token", token: "agency.logo" }, { x, y, w, h, fit: "contain", name: "Agency logo" });
}

/** Decorative rings + glow used on cover slides (centered at cx, cy). */
export function coverDecor(cx = 1560, cy = 430): SlideElement[] {
  const ring = (d: number, name: string, extra: Partial<Parameters<typeof box>[0]> = {}) =>
    box({ x: cx - d / 2, y: cy - d / 2, w: d, h: d, shape: "ellipse", fill: "transparent", stroke: "$border", strokeWidth: 3, name, ...extra });
  // decorative layers are locked so clicks on empty canvas areas don't grab them (unlock in Layers)
  return [
    box({ x: cx - 560, y: cy - 560, w: 1120, h: 1120, shape: "ellipse", fill: "$accent", opacity: 0.06, name: "Glow" }),
    ring(960, "Ring outer"),
    ring(700, "Ring middle"),
    ring(1240, "Ring far", { opacity: 0.5 }),
    box({ x: 0, y: 1068, w: W, h: 12, gradient: { from: "$accent", to: "$accent2", angle: 90 }, fill: "$accent", name: "Accent bar" }),
  ].map((e) => ({ ...e, locked: true }));
}

/** Four KPI tiles in a row. */
export function kpiRow(
  items: { metric: string; label: string; delta?: string; spark?: string }[],
  y: number,
  h = 250,
  o: { x?: number; w?: number; gap?: number; valueSize?: number } = {},
): SlideElement[] {
  const x0 = o.x ?? M;
  const total = o.w ?? CW;
  const gap = o.gap ?? 32;
  const w = (total - gap * (items.length - 1)) / items.length;
  return items.map((it, i) =>
    kpi(it.metric, it.label, {
      x: x0 + i * (w + gap),
      y,
      w,
      h,
      delta: it.delta,
      spark: it.spark,
      valueSize: o.valueSize ?? (items.length > 4 ? 64 : 80),
      labelSize: 24,
      name: `KPI · ${it.label}`,
    }),
  );
}

/** Numbered step card (icon, title, body). */
export function stepCard(n: number, title: string, body: string, x: number, y: number, w: number, h: number, iconName = "circle-check"): SlideElement[] {
  return [
    card({ x, y, w, h, name: `Step ${n}` }),
    icon(iconName, { x: x + 44, y: y + 44, w: 72, h: 72, bg: "$surface2", color: "$accent", name: `Step ${n} icon` }),
    text(`0${n}`, { x: x + w - 140, y: y + 52, w: 96, h: 48, size: 32, weight: 700, color: "$muted", align: "right", font: "heading", name: `Step ${n} number` }),
    text(`**${title}**`, { x: x + 44, y: y + 150, w: w - 88, h: 90, size: 34, lh: 1.15, font: "heading", name: `Step ${n} title` }),
    text(body, { x: x + 44, y: y + 250, w: w - 88, h: h - 290, size: 24, color: "$muted", lh: 1.4, name: `Step ${n} body` }),
  ];
}

/** Callout card with a big token value and caption. */
export function callout(value: string, caption: string, x: number, y: number, w: number, h: number, o: { accent?: boolean; valueSize?: number } = {}): SlideElement[] {
  return [
    card({ x, y, w, h, fill: o.accent ? "$accent" : "$surface", stroke: o.accent ? "transparent" : "$border", name: "Callout" }),
    text(value, {
      x: x + 44,
      y: y + 40,
      w: w - 88,
      h: 110,
      size: o.valueSize ?? 84,
      weight: 700,
      font: "heading",
      ls: -0.03,
      color: o.accent ? "$bg" : "$text",
      name: "Callout value",
    }),
    text(caption, { x: x + 44, y: y + 160, w: w - 88, h: h - 190, size: 26, lh: 1.35, color: o.accent ? "$bg" : "$muted", name: "Callout caption" }),
  ];
}
