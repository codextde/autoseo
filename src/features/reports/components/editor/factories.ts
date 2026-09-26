"use client";

import { box, chart, heading, icon, image, kpi, list, score, table, text } from "../../lib/build";
import { CHARTS, LISTS, TABLES, TOKENS } from "../../lib/catalog";
import type { SlideElement } from "../../lib/types";

/** Default elements added from the toolbar / panels, centered on a canvas of the given size. */
export function centered(w: number, h: number, size: { w: number; h: number }, offset = 0) {
  return { x: Math.round((size.w - w) / 2 + offset), y: Math.round((size.h - h) / 2 + offset), w, h };
}

export type AddKind =
  | { kind: "text" }
  | { kind: "heading" }
  | { kind: "shape"; shape: "rect" | "ellipse" | "line" | "triangle" }
  | { kind: "image"; assetId?: string; url?: string; token?: "agency.logo" | "client.logo"; w?: number | null; h?: number | null }
  | { kind: "icon"; icon: string }
  | { kind: "chart"; metric: string }
  | { kind: "kpi"; metric: string }
  | { kind: "score"; metric: string }
  | { kind: "list"; source: string }
  | { kind: "table"; source?: string };

export function makeElement(a: AddKind, size: { w: number; h: number }, offset = 0): SlideElement {
  const s = size.w / 1920;
  const c = (w: number, h: number) => centered(Math.round(w * s), Math.round(h * s), size, offset);
  switch (a.kind) {
    case "text":
      return text("Double-click to edit text", { ...c(820, 90), size: Math.round(40 * s), name: "Text" });
    case "heading":
      return heading("Your ==headline== here", { ...c(1200, 120), size: Math.round(72 * s), name: "Heading" });
    case "shape":
      if (a.shape === "line") return box({ ...c(600, 8), shape: "line", fill: "transparent", stroke: "$accent", strokeWidth: 4, name: "Line" });
      return box({
        ...c(a.shape === "ellipse" ? 360 : 520, 360),
        shape: a.shape,
        fill: "$surface",
        stroke: a.shape === "rect" ? "$border" : "transparent",
        strokeWidth: a.shape === "rect" ? 2 : 0,
        radius: a.shape === "rect" ? 28 : 0,
        name: a.shape === "rect" ? "Box" : a.shape === "ellipse" ? "Ellipse" : "Triangle",
      });
    case "image": {
      let w = 720 * s;
      let h = 480 * s;
      if (a.w && a.h) {
        const max = Math.min((size.w * 0.6) / a.w, (size.h * 0.6) / a.h, 1.5);
        w = a.w * max;
        h = a.h * max;
      }
      if (a.token) {
        w = 280 * s;
        h = 96 * s;
      }
      const src = a.assetId ? { kind: "asset" as const, assetId: a.assetId } : a.url ? { kind: "url" as const, url: a.url } : { kind: "token" as const, token: a.token ?? "client.logo" };
      return image(src, { ...c(w, h), fit: a.token ? "contain" : "cover", name: a.token === "agency.logo" ? "Agency logo" : a.token === "client.logo" ? "Client logo" : "Image" });
    }
    case "icon":
      return icon(a.icon, { ...c(120, 120), bg: "$surface2", name: `Icon · ${a.icon}` });
    case "chart": {
      const def = CHARTS[a.metric];
      return chart(a.metric, def?.defaultType ?? "line", { ...c(1040, 580), fill: "$surface", radius: 32, title: def?.label, fontSize: Math.round(22 * s), name: def?.label ?? "Chart" });
    }
    case "kpi": {
      const def = TOKENS[a.metric];
      const delta = TOKENS[`${a.metric}_delta`] ? `${a.metric}_delta` : undefined;
      return kpi(a.metric, def?.label ?? a.metric, { ...c(420, 280), delta, valueSize: Math.round(84 * s), labelSize: Math.round(24 * s), name: `KPI · ${def?.label ?? a.metric}` });
    }
    case "score":
      return score(a.metric, { ...c(420, 420), label: TOKENS[a.metric]?.label, name: `Score · ${TOKENS[a.metric]?.label ?? a.metric}` });
    case "list":
      return list(a.source, { ...c(820, 520), limit: 6, fill: "$surface", size: Math.round(26 * s), bar: a.source !== "list.gap_prompts" && a.source !== "list.praise" && a.source !== "list.criticism", name: LISTS[a.source]?.label ?? "List" });
    case "table":
      return a.source
        ? table({ ...c(1400, 560), source: a.source, limit: 6, size: Math.round(24 * s), name: TABLES[a.source]?.label ?? "Table" })
        : table({
            ...c(1200, 420),
            rows: [
              ["Metric", "Value", "Change"],
              ["Visibility", "{{ai.visibility}}", "{{ai.visibility_delta}}"],
              ["Mention rate", "{{ai.mention_rate}}", "{{ai.mention_rate_delta}}"],
              ["Citation rate", "{{ai.citation_rate}}", "{{ai.citation_rate_delta}}"],
            ],
            size: Math.round(26 * s),
            name: "Table",
          });
  }
}
