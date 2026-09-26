import { parseMarkup, uid } from "./text";
import type {
  BoxElement,
  ChartElement,
  ChartType,
  Color,
  IconElement,
  ImageElement,
  ImageSource,
  KpiElement,
  ListElement,
  ScoreElement,
  Slide,
  SlideElement,
  TableElement,
  TextElement,
} from "./types";

/* Element factories with sensible defaults — used by templates, the editor toolbar and the AI agent. */

type Box = { x: number; y: number; w: number; h: number };
type Common = Box & { name?: string; rotation?: number; opacity?: number };

function base(c: Common) {
  return {
    id: uid("el"),
    name: c.name,
    x: Math.round(c.x),
    y: Math.round(c.y),
    w: Math.max(1, Math.round(c.w)),
    h: Math.max(1, Math.round(c.h)),
    rotation: c.rotation ?? 0,
    ...(c.opacity !== undefined ? { opacity: c.opacity } : {}),
  };
}

export type TextOpts = Common & {
  size?: number;
  weight?: number;
  color?: Color;
  font?: string;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  lh?: number;
  ls?: number;
  upper?: boolean;
  italic?: boolean;
  fill?: Color;
  padding?: number;
  radius?: number;
};

export function text(markup: string, o: TextOpts): TextElement {
  return {
    ...base(o),
    type: "text",
    paragraphs: parseMarkup(markup),
    style: {
      fontFamily: o.font ?? "body",
      fontSize: o.size ?? 32,
      fontWeight: o.weight ?? 400,
      color: o.color ?? "$text",
      align: o.align ?? "left",
      valign: o.valign ?? "top",
      lineHeight: o.lh ?? 1.2,
      letterSpacing: o.ls ?? 0,
      ...(o.upper ? { uppercase: true } : {}),
      ...(o.italic ? { italic: true } : {}),
    },
    ...(o.fill ? { fill: o.fill } : {}),
    ...(o.padding !== undefined ? { padding: o.padding } : {}),
    ...(o.radius !== undefined ? { radius: o.radius } : {}),
  };
}

/** Headline preset (heading font, tight leading). */
export function heading(markup: string, o: TextOpts): TextElement {
  return text(markup, { font: "heading", weight: 700, lh: 1.05, ls: -0.02, size: 88, ...o });
}

/** Small uppercase label above headlines. */
export function eyebrow(markup: string, o: TextOpts): TextElement {
  return text(markup, { size: 22, weight: 600, ls: 0.14, upper: true, color: "$accent", ...o });
}

export type BoxOpts = Common & {
  fill?: Color;
  stroke?: Color;
  strokeWidth?: number;
  radius?: number;
  shape?: BoxElement["shape"];
  gradient?: { from: Color; to: Color; angle?: number };
  dashed?: boolean;
  shadow?: boolean;
};

export function box(o: BoxOpts): BoxElement {
  return {
    ...base(o),
    type: "box",
    shape: o.shape ?? "rect",
    fill: o.fill ?? "$surface",
    stroke: o.stroke ?? "transparent",
    strokeWidth: o.strokeWidth ?? (o.stroke ? 2 : 0),
    radius: o.radius ?? 0,
    ...(o.gradient ? { gradient: { from: o.gradient.from, to: o.gradient.to, angle: o.gradient.angle ?? 135 } } : {}),
    ...(o.dashed ? { strokeStyle: "dashed" as const } : {}),
    ...(o.shadow ? { shadow: true } : {}),
  };
}

/** Card: rounded surface with a subtle border. */
export function card(o: Common & { fill?: Color; stroke?: Color; radius?: number }): BoxElement {
  return box({ fill: "$surface", stroke: "$border", strokeWidth: 2, radius: 32, ...o });
}

export function line(o: Common & { color?: Color; thickness?: number; dashed?: boolean }): BoxElement {
  return box({ ...o, shape: "line", fill: "transparent", stroke: o.color ?? "$border", strokeWidth: o.thickness ?? 2, dashed: o.dashed });
}

export function kpi(
  metric: string,
  label: string,
  o: Common & {
    delta?: string;
    spark?: string;
    fill?: Color;
    stroke?: Color;
    radius?: number;
    valueSize?: number;
    labelSize?: number;
    valueColor?: Color;
    labelColor?: Color;
    accent?: Color;
    align?: "left" | "center";
  },
): KpiElement {
  return {
    ...base(o),
    type: "kpi",
    metric,
    label,
    ...(o.delta ? { deltaMetric: o.delta } : {}),
    ...(o.spark ? { sparkline: o.spark } : {}),
    style: {
      fontFamily: "heading",
      fill: o.fill ?? "$surface",
      stroke: o.stroke ?? "$border",
      radius: o.radius ?? 28,
      valueColor: o.valueColor ?? "$text",
      labelColor: o.labelColor ?? "$muted",
      accent: o.accent ?? "$accent",
      valueSize: o.valueSize ?? 88,
      labelSize: o.labelSize ?? 24,
      align: o.align ?? "left",
    },
  };
}

export function chart(
  metric: string,
  chartType: ChartType,
  o: Common & {
    title?: string;
    limit?: number;
    legend?: boolean;
    grid?: boolean;
    values?: boolean;
    fill?: Color;
    radius?: number;
    fontSize?: number;
    color?: Color;
  },
): ChartElement {
  return {
    ...base(o),
    type: "chart",
    metric,
    chartType,
    ...(o.title ? { title: o.title } : {}),
    options: {
      ...(o.limit ? { limit: o.limit } : {}),
      legend: o.legend ?? true,
      grid: o.grid ?? true,
      values: o.values ?? chartType !== "line",
      highlightOwn: true,
    },
    style: {
      fontFamily: "body",
      fontSize: o.fontSize ?? 22,
      color: o.color ?? "$muted",
      ...(o.fill ? { fill: o.fill } : {}),
      ...(o.radius !== undefined ? { radius: o.radius } : {}),
    },
  };
}

export function list(
  source: string,
  o: Common & {
    limit?: number;
    variant?: "rows" | "bullets" | "cards";
    size?: number;
    bar?: boolean;
    rank?: boolean;
    value?: boolean;
    fill?: Color;
    color?: Color;
  },
): ListElement {
  return {
    ...base(o),
    type: "list",
    source,
    limit: o.limit ?? 5,
    style: {
      variant: o.variant ?? "rows",
      fontFamily: "body",
      fontSize: o.size ?? 28,
      color: o.color ?? "$text",
      mutedColor: "$muted",
      accent: "$accent",
      ...(o.fill ? { fill: o.fill } : {}),
      showRank: o.rank ?? true,
      showValue: o.value ?? true,
      showBar: o.bar ?? false,
    },
  };
}

export function score(metric: string, o: Common & { label?: string; thickness?: number; color?: Color; track?: Color }): ScoreElement {
  return {
    ...base(o),
    type: "score",
    metric,
    ...(o.label ? { label: o.label } : {}),
    style: {
      fontFamily: "heading",
      color: o.color ?? "$accent",
      track: o.track ?? "$surface2",
      textColor: "$text",
      labelColor: "$muted",
      thickness: o.thickness ?? Math.round(Math.min(o.w, o.h) * 0.07),
    },
  };
}

export function table(o: Common & { source?: string; rows?: string[][]; limit?: number; size?: number; header?: boolean }): TableElement {
  return {
    ...base(o),
    type: "table",
    mode: o.source ? "live" : "static",
    rows: o.rows ?? [],
    ...(o.source ? { source: o.source } : {}),
    limit: o.limit ?? 6,
    header: o.header ?? true,
    style: {
      fontFamily: "body",
      fontSize: o.size ?? 24,
      color: "$text",
      headerColor: "$muted",
      headerFill: "transparent",
      border: "$border",
    },
  };
}

export function icon(name: string, o: Common & { color?: Color; bg?: Color; radius?: number; strokeWidth?: number }): IconElement {
  return {
    ...base(o),
    type: "icon",
    icon: name,
    color: o.color ?? "$accent",
    strokeWidth: o.strokeWidth ?? 2,
    ...(o.bg ? { bg: o.bg } : {}),
    ...(o.radius !== undefined ? { radius: o.radius } : {}),
  };
}

export function image(src: ImageSource, o: Common & { fit?: "cover" | "contain"; radius?: number }): ImageElement {
  return { ...base(o), type: "image", src, fit: o.fit ?? "contain", radius: o.radius ?? 0 };
}

export function slide(
  elements: SlideElement[],
  o: { name?: string; bg?: Color; gradient?: { from: Color; to: Color; angle?: number }; notes?: string } = {},
): Slide {
  return {
    id: uid("sl"),
    ...(o.name ? { name: o.name } : {}),
    background: {
      color: o.bg ?? "$bg",
      ...(o.gradient ? { gradient: { from: o.gradient.from, to: o.gradient.to, angle: o.gradient.angle ?? 135 } } : {}),
    },
    ...(o.notes ? { notes: o.notes } : {}),
    elements,
  };
}

/** Deep-clones a slide with fresh ids (duplicate / paste / template instantiation). */
export function cloneSlide(s: Slide): Slide {
  return { ...structuredClone(s), id: uid("sl"), elements: s.elements.map((e) => ({ ...structuredClone(e), id: uid("el") })) };
}

export function cloneElement<T extends SlideElement>(e: T, dx = 0, dy = 0): T {
  return { ...structuredClone(e), id: uid("el"), x: e.x + dx, y: e.y + dy };
}
