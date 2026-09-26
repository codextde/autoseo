import { z } from "zod";

/*
 * Deck document model (isomorphic). A deck is a list of slides with absolutely positioned
 * elements on a fixed-size canvas (1920×1080 for slide decks, 1240×1754 for the classic widget
 * canvas). Colors are either literal hex values or theme references (`$accent`, `$text` …) so a
 * brand kit can re-theme a whole deck. Live data is referenced by token keys (see catalog.ts).
 */

export const SLIDE_W = 1920;
export const SLIDE_H = 1080;
export const CLASSIC_W = 1240;
export const CLASSIC_H = 1754;

const hex = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const themeRef = /^\$[a-z][a-z0-9]{0,15}$/;
export const colorSchema = z
  .string()
  .max(16)
  .refine((v) => v === "transparent" || hex.test(v) || themeRef.test(v), "Invalid color");
export type Color = string;

const fontSchema = z
  .string()
  .max(60)
  .regex(/^[A-Za-z0-9 ,'-]+$/, "Invalid font");

const tokenKey = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9_.]*$/, "Invalid token");

const num = (min = -100000, max = 100000) => z.number().finite().min(min).max(max);

export const runSchema = z.object({
  text: z.string().max(5000),
  b: z.boolean().optional(),
  i: z.boolean().optional(),
  u: z.boolean().optional(),
  color: colorSchema.optional(),
  /** Live data token key; when set, `text` is ignored and the resolved value is shown. */
  token: tokenKey.optional(),
});
export type Run = z.infer<typeof runSchema>;

export const paragraphSchema = z.object({
  runs: z.array(runSchema).max(200),
  bullet: z.boolean().optional(),
});
export type Paragraph = z.infer<typeof paragraphSchema>;

const baseShape = {
  id: z.string().min(1).max(40),
  name: z.string().max(80).optional(),
  x: num(),
  y: num(),
  w: num(1, 20000),
  h: num(1, 20000),
  rotation: num(-3600, 3600).default(0),
  opacity: z.number().min(0).max(1).optional(),
  locked: z.boolean().optional(),
  hidden: z.boolean().optional(),
};

export const textStyleSchema = z.object({
  fontFamily: fontSchema.default("body"),
  fontSize: num(4, 800).default(32),
  fontWeight: z.number().int().min(100).max(900).default(400),
  color: colorSchema.default("$text"),
  align: z.enum(["left", "center", "right"]).default("left"),
  valign: z.enum(["top", "middle", "bottom"]).default("top"),
  lineHeight: z.number().min(0.6).max(4).default(1.2),
  letterSpacing: z.number().min(-0.5).max(2).default(0),
  uppercase: z.boolean().optional(),
  italic: z.boolean().optional(),
});
export type TextStyle = z.infer<typeof textStyleSchema>;

export const textElementSchema = z.object({
  ...baseShape,
  type: z.literal("text"),
  paragraphs: z.array(paragraphSchema).max(200),
  style: textStyleSchema,
  fill: colorSchema.optional(),
  padding: num(0, 400).optional(),
  radius: num(0, 2000).optional(),
});

export const gradientSchema = z.object({ from: colorSchema, to: colorSchema, angle: num(-360, 360).default(135) });

export const boxElementSchema = z.object({
  ...baseShape,
  type: z.literal("box"),
  shape: z.enum(["rect", "ellipse", "line", "triangle"]).default("rect"),
  fill: colorSchema.default("$surface"),
  gradient: gradientSchema.optional(),
  stroke: colorSchema.default("transparent"),
  strokeWidth: num(0, 200).default(0),
  strokeStyle: z.enum(["solid", "dashed"]).optional(),
  radius: num(0, 2000).default(0),
  shadow: z.boolean().optional(),
});

export const imageSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("asset"), assetId: z.string().max(40) }),
  z.object({
    kind: z.literal("url"),
    url: z
      .string()
      .max(2000)
      .regex(/^https?:\/\//i, "Only http(s) image URLs are allowed"),
  }),
  z.object({ kind: z.literal("token"), token: z.enum(["agency.logo", "client.logo"]) }),
]);
export type ImageSource = z.infer<typeof imageSourceSchema>;

export const imageElementSchema = z.object({
  ...baseShape,
  type: z.literal("image"),
  src: imageSourceSchema,
  fit: z.enum(["cover", "contain"]).default("cover"),
  radius: num(0, 2000).default(0),
  stroke: colorSchema.optional(),
  strokeWidth: num(0, 200).optional(),
  alt: z.string().max(200).optional(),
});

export const iconElementSchema = z.object({
  ...baseShape,
  type: z.literal("icon"),
  icon: z.string().max(40),
  color: colorSchema.default("$accent"),
  strokeWidth: num(0.5, 4).default(2),
  bg: colorSchema.optional(),
  radius: num(0, 2000).optional(),
});

export const CHART_TYPES = ["line", "area", "bar", "hbar", "donut"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const chartElementSchema = z.object({
  ...baseShape,
  type: z.literal("chart"),
  metric: tokenKey,
  chartType: z.enum(CHART_TYPES),
  title: z.string().max(120).optional(),
  options: z
    .object({
      limit: z.number().int().min(1).max(30).optional(),
      legend: z.boolean().optional(),
      grid: z.boolean().optional(),
      values: z.boolean().optional(),
      colors: z.array(colorSchema).max(12).optional(),
      highlightOwn: z.boolean().optional(),
    })
    .default({}),
  style: z
    .object({
      fontFamily: fontSchema.default("body"),
      fontSize: num(6, 120).default(22),
      color: colorSchema.default("$muted"),
      titleColor: colorSchema.optional(),
      fill: colorSchema.optional(),
      radius: num(0, 2000).optional(),
    })
    .default({ fontFamily: "body", fontSize: 22, color: "$muted" }),
});

export const LIST_VARIANTS = ["rows", "bullets", "cards"] as const;

export const listElementSchema = z.object({
  ...baseShape,
  type: z.literal("list"),
  source: tokenKey,
  limit: z.number().int().min(1).max(30).default(5),
  style: z
    .object({
      variant: z.enum(LIST_VARIANTS).default("rows"),
      fontFamily: fontSchema.default("body"),
      fontSize: num(6, 200).default(28),
      color: colorSchema.default("$text"),
      mutedColor: colorSchema.default("$muted"),
      accent: colorSchema.default("$accent"),
      fill: colorSchema.optional(),
      showRank: z.boolean().default(true),
      showValue: z.boolean().default(true),
      showBar: z.boolean().default(false),
    })
    .default({
      variant: "rows",
      fontFamily: "body",
      fontSize: 28,
      color: "$text",
      mutedColor: "$muted",
      accent: "$accent",
      showRank: true,
      showValue: true,
      showBar: false,
    }),
});

export const kpiElementSchema = z.object({
  ...baseShape,
  type: z.literal("kpi"),
  metric: tokenKey,
  label: z.string().max(120),
  deltaMetric: tokenKey.optional(),
  /** Trend chart metric drawn as a sparkline under the value. */
  sparkline: tokenKey.optional(),
  style: z
    .object({
      fontFamily: fontSchema.default("heading"),
      fill: colorSchema.default("$surface"),
      stroke: colorSchema.default("$border"),
      radius: num(0, 2000).default(28),
      valueColor: colorSchema.default("$text"),
      labelColor: colorSchema.default("$muted"),
      accent: colorSchema.default("$accent"),
      valueSize: num(8, 600).default(96),
      labelSize: num(6, 200).default(26),
      align: z.enum(["left", "center"]).default("left"),
    })
    .default({
      fontFamily: "heading",
      fill: "$surface",
      stroke: "$border",
      radius: 28,
      valueColor: "$text",
      labelColor: "$muted",
      accent: "$accent",
      valueSize: 96,
      labelSize: 26,
      align: "left",
    }),
});

export const scoreElementSchema = z.object({
  ...baseShape,
  type: z.literal("score"),
  metric: tokenKey,
  label: z.string().max(80).optional(),
  style: z
    .object({
      fontFamily: fontSchema.default("heading"),
      color: colorSchema.default("$accent"),
      track: colorSchema.default("$surface2"),
      textColor: colorSchema.default("$text"),
      labelColor: colorSchema.default("$muted"),
      thickness: num(1, 400).default(28),
    })
    .default({
      fontFamily: "heading",
      color: "$accent",
      track: "$surface2",
      textColor: "$text",
      labelColor: "$muted",
      thickness: 28,
    }),
});

export const tableElementSchema = z.object({
  ...baseShape,
  type: z.literal("table"),
  mode: z.enum(["static", "live"]).default("static"),
  /** Static cells; may contain {{token}} placeholders. First row is the header when `header`. */
  rows: z.array(z.array(z.string().max(500)).max(12)).max(60).default([]),
  source: tokenKey.optional(),
  limit: z.number().int().min(1).max(30).default(6),
  header: z.boolean().default(true),
  style: z
    .object({
      fontFamily: fontSchema.default("body"),
      fontSize: num(6, 120).default(24),
      color: colorSchema.default("$text"),
      headerColor: colorSchema.default("$muted"),
      headerFill: colorSchema.default("transparent"),
      border: colorSchema.default("$border"),
      stripe: colorSchema.optional(),
    })
    .default({
      fontFamily: "body",
      fontSize: 24,
      color: "$text",
      headerColor: "$muted",
      headerFill: "transparent",
      border: "$border",
    }),
});

export const elementSchema = z.discriminatedUnion("type", [
  textElementSchema,
  boxElementSchema,
  imageElementSchema,
  iconElementSchema,
  chartElementSchema,
  listElementSchema,
  kpiElementSchema,
  scoreElementSchema,
  tableElementSchema,
]);

export type TextElement = z.infer<typeof textElementSchema>;
export type BoxElement = z.infer<typeof boxElementSchema>;
export type ImageElement = z.infer<typeof imageElementSchema>;
export type IconElement = z.infer<typeof iconElementSchema>;
export type ChartElement = z.infer<typeof chartElementSchema>;
export type ListElement = z.infer<typeof listElementSchema>;
export type KpiElement = z.infer<typeof kpiElementSchema>;
export type ScoreElement = z.infer<typeof scoreElementSchema>;
export type TableElement = z.infer<typeof tableElementSchema>;
export type SlideElement = z.infer<typeof elementSchema>;
export type ElementType = SlideElement["type"];

export const slideSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().max(80).optional(),
  background: z
    .object({
      color: colorSchema.default("$bg"),
      gradient: gradientSchema.optional(),
      image: imageSourceSchema.optional(),
      imageOpacity: z.number().min(0).max(1).optional(),
    })
    .default({ color: "$bg" }),
  notes: z.string().max(10000).optional(),
  hidden: z.boolean().optional(),
  elements: z.array(elementSchema).max(400),
});
export type Slide = z.infer<typeof slideSchema>;

export const THEME_COLOR_KEYS = [
  "bg",
  "surface",
  "surface2",
  "text",
  "muted",
  "accent",
  "accent2",
  "border",
  "positive",
  "negative",
] as const;
export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];

const hexColor = z.string().regex(hex, "Invalid color");

export const themeSchema = z.object({
  name: z.string().max(60).optional(),
  mode: z.enum(["dark", "light"]).default("dark"),
  colors: z.object({
    bg: hexColor,
    surface: hexColor,
    surface2: hexColor,
    text: hexColor,
    muted: hexColor,
    accent: hexColor,
    accent2: hexColor,
    border: hexColor,
    positive: hexColor,
    negative: hexColor,
  }),
  chart: z.array(hexColor).min(1).max(12),
  fonts: z.object({ heading: fontSchema, body: fontSchema }),
});
export type Theme = z.infer<typeof themeSchema>;

export const deckSchema = z.object({
  version: z.literal(1),
  format: z.enum(["slides", "classic"]).default("slides"),
  size: z.object({ w: z.number().int().min(320).max(8000), h: z.number().int().min(320).max(8000) }),
  theme: themeSchema,
  /** Grid snapping for the classic widget canvas (px). 0 = off. */
  grid: z.number().int().min(0).max(200).optional(),
  slides: z.array(slideSchema).min(1).max(200),
});
export type Deck = z.infer<typeof deckSchema>;
export type DeckInput = z.input<typeof deckSchema>;

/** Parses a stored/untrusted deck. Returns null when invalid. */
export function parseDeck(value: unknown): Deck | null {
  const res = deckSchema.safeParse(value);
  return res.success ? res.data : null;
}

export function countDeck(deck: Deck): { slides: number; charts: number } {
  let charts = 0;
  for (const s of deck.slides) for (const e of s.elements) if (e.type === "chart" || e.type === "score") charts++;
  return { slides: deck.slides.length, charts };
}

export type DateRangeValue = { preset: string; from?: string; to?: string };
