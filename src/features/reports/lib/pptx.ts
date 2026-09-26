import type PptxGenJS from "pptxgenjs";
import { format as formatDate, parseISO } from "date-fns";
import { CHARTS, TABLES, chartFor, chartIsEmpty, deltaTone, formatValue, hasData, interpolate, listFor, logoFor, resolveToken, tableFor, type ResolveCtx } from "./catalog";
import { iconSvg } from "./icons";
import { fontFamilyName, mix, resolveColor } from "./theme";
import type { Deck, ImageSource, Paragraph, Slide, SlideElement, Theme } from "./types";

/*
 * PPTX export (isomorphic). Text, shapes, images, native charts (line/area/bar/doughnut), tables,
 * KPI tiles and score rings. The browser passes an SVG rasterizer so icons become PNGs; on the
 * server icons are embedded as SVG.
 */

type Pptx = InstanceType<typeof PptxGenJS>;
type PSlide = ReturnType<Pptx["addSlide"]>;

export type PptxEnv = {
  /** Resolves an image to a data URL (or null when it can't be loaded). */
  loadImage: (src: string) => Promise<string | null>;
  /** Converts SVG markup to a data URL (PNG in the browser). Defaults to an SVG data URL. */
  svgToImage?: (svg: string, w: number, h: number) => Promise<string>;
  assetUrl: (assetId: string) => string;
};

const hexOnly = (c: string) => c.replace("#", "").slice(0, 6).toUpperCase();

function color(c: string | undefined | null, theme: Theme): { color: string; transparency?: number } | null {
  if (!c) return null;
  const v = resolveColor(c, theme);
  if (!v || v === "transparent") return null;
  if (/^#[0-9a-fA-F]{3}$/.test(v)) return { color: v.slice(1).split("").map((x) => x + x).join("").toUpperCase() };
  if (/^#[0-9a-fA-F]{8}$/.test(v)) {
    const alpha = parseInt(v.slice(7, 9), 16) / 255;
    return { color: hexOnly(v), transparency: Math.round((1 - alpha) * 100) };
  }
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return { color: hexOnly(v) };
  return null;
}

function svgDataUrl(svg: string): string {
  const b64 = typeof Buffer !== "undefined" ? Buffer.from(svg, "utf8").toString("base64") : btoa(unescape(encodeURIComponent(svg)));
  return `data:image/svg+xml;base64,${b64}`;
}

function dateLabel(iso: string) {
  try {
    return formatDate(parseISO(iso), "MMM d");
  } catch {
    return iso;
  }
}

function imageSrc(src: ImageSource | undefined, ctx: ResolveCtx, env: PptxEnv): string | null {
  if (!src) return null;
  if (src.kind === "asset") return env.assetUrl(src.assetId);
  if (src.kind === "url") return src.url;
  const raw = logoFor(ctx, src.token);
  if (!raw) return null;
  if (raw.startsWith("asset:")) return env.assetUrl(raw.slice(6));
  return /^https?:\/\//i.test(raw) ? raw : null;
}

type Geo = { k: number; pt: (px: number) => number; box: (e: { x: number; y: number; w: number; h: number }) => { x: number; y: number; w: number; h: number } };

function textRuns(paragraphs: Paragraph[], ctx: ResolveCtx, theme: Theme, base: { fontSize: number; color: string; bold: boolean; italic?: boolean; face: string; align?: string }, uppercase?: boolean) {
  const runs: PptxGenJS.TextProps[] = [];
  paragraphs.forEach((p, pi) => {
    const last = pi === paragraphs.length - 1;
    const items = p.runs.length ? p.runs : [{ text: "" }];
    items.forEach((r, ri) => {
      let t = r.token ? resolveToken(r.token, ctx).text : r.text;
      if (uppercase) t = t.toUpperCase();
      const c = r.color ? color(r.color, theme) : null;
      runs.push({
        text: t,
        options: {
          bold: r.b ? true : base.bold,
          italic: r.i ? true : base.italic,
          underline: r.u ? { style: "sng" } : undefined,
          color: c?.color ?? base.color,
          fontSize: base.fontSize,
          fontFace: base.face,
          ...(p.bullet ? { bullet: { indent: base.fontSize * 1.1 } } : {}),
          breakLine: ri === items.length - 1 && !last,
        },
      });
    });
  });
  return runs;
}

async function addElement(pptx: Pptx, s: PSlide, el: SlideElement, deck: Deck, ctx: ResolveCtx, env: PptxEnv, g: Geo) {
  const theme = deck.theme;
  const b = g.box(el);
  const rotate = el.rotation || undefined;
  const transparency = el.opacity !== undefined && el.opacity < 1 ? Math.round((1 - el.opacity) * 100) : undefined;
  const radiusFrac = (r: number) => Math.max(0, Math.min(1, r / Math.max(1, Math.min(el.w, el.h) / 2)));
  const fillOf = (c: string | undefined) => {
    const v = color(c, theme);
    return v ? { color: v.color, transparency: v.transparency ?? transparency } : undefined;
  };

  switch (el.type) {
    case "box": {
      const fill = el.gradient ? fillOf(el.gradient.from) : fillOf(el.fill);
      const line = el.strokeWidth ? color(el.stroke, theme) : null;
      if (el.shape === "line") {
        const lc = color(el.stroke, theme) ?? color("$border", theme)!;
        s.addShape(pptx.ShapeType.line, {
          x: b.x,
          y: b.y + b.h / 2,
          w: b.w,
          h: 0,
          line: { color: lc.color, width: Math.max(0.5, g.pt(el.strokeWidth || 2)), dashType: el.strokeStyle === "dashed" ? "dash" : "solid" },
          rotate,
        });
        return;
      }
      const shape = el.shape === "ellipse" ? pptx.ShapeType.ellipse : el.shape === "triangle" ? pptx.ShapeType.triangle : el.radius > 0 ? pptx.ShapeType.roundRect : pptx.ShapeType.rect;
      s.addShape(shape, {
        ...b,
        fill: fill ?? { color: "FFFFFF", transparency: 100 },
        line: line ? { color: line.color, width: g.pt(el.strokeWidth), dashType: el.strokeStyle === "dashed" ? "dash" : "solid" } : undefined,
        rectRadius: shape === pptx.ShapeType.roundRect ? radiusFrac(el.radius) : undefined,
        rotate,
      });
      return;
    }
    case "text": {
      if (el.fill && color(el.fill, theme)) {
        s.addShape(el.radius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
          ...b,
          fill: fillOf(el.fill),
          rectRadius: el.radius ? radiusFrac(el.radius) : undefined,
          rotate,
        });
      }
      const st = el.style;
      const base = {
        fontSize: g.pt(st.fontSize),
        color: color(st.color, theme)?.color ?? hexOnly(theme.colors.text),
        bold: st.fontWeight >= 600,
        italic: st.italic,
        face: fontFamilyName(st.fontFamily, theme),
      };
      s.addText(textRuns(el.paragraphs, ctx, theme, base, st.uppercase), {
        ...b,
        align: st.align,
        valign: st.valign,
        margin: g.pt(el.padding ?? 0),
        lineSpacingMultiple: st.lineHeight,
        charSpacing: st.letterSpacing ? g.pt(st.letterSpacing * st.fontSize) : undefined,
        fontFace: base.face,
        rotate,
        transparency,
        fit: "none",
      });
      return;
    }
    case "image": {
      const src = imageSrc(el.src, ctx, env);
      if (!src) return;
      const data = await env.loadImage(src);
      if (!data) return;
      s.addImage({ data, ...b, sizing: { type: el.fit === "cover" ? "cover" : "contain", w: b.w, h: b.h }, rotate, transparency });
      return;
    }
    case "icon": {
      if (el.bg) s.addShape(pptx.ShapeType.roundRect, { ...b, fill: fillOf(el.bg), rectRadius: radiusFrac(el.radius ?? Math.min(el.w, el.h) * 0.28), rotate });
      const pad = el.bg ? Math.min(el.w, el.h) * 0.22 : 0;
      const size = Math.min(el.w, el.h) - pad * 2;
      const svg = iconSvg(el.icon, resolveColor(el.color, theme), el.strokeWidth, Math.round(size));
      const data = env.svgToImage ? await env.svgToImage(svg, Math.round(size * 2), Math.round(size * 2)) : svgDataUrl(svg);
      s.addImage({
        data,
        x: b.x + g.pt(0) + (el.w - size) / 2 * g.k,
        y: b.y + (el.h - size) / 2 * g.k,
        w: size * g.k,
        h: size * g.k,
        rotate,
      });
      return;
    }
    case "kpi": {
      const st = el.style;
      const fill = fillOf(st.fill);
      const line = color(st.stroke, theme);
      s.addShape(pptx.ShapeType.roundRect, { ...b, fill: fill ?? { color: "FFFFFF", transparency: 100 }, line: line ? { color: line.color, width: g.pt(2) } : undefined, rectRadius: radiusFrac(st.radius) });
      const pad = Math.max(16, Math.min(56, Math.min(el.w, el.h) * 0.11));
      const face = fontFamilyName(st.fontFamily, theme);
      const value = resolveToken(el.metric, ctx);
      const delta = el.deltaMetric ? resolveToken(el.deltaMetric, ctx) : null;
      const tone = el.deltaMetric && delta ? deltaTone(el.deltaMetric, delta.value) : 0;
      const align = st.align === "center" ? "center" : "left";
      s.addText(interpolate(el.label, ctx), {
        x: b.x + pad * g.k,
        y: b.y + pad * g.k,
        w: (el.w - pad * 2) * g.k,
        h: st.labelSize * 1.5 * g.k,
        fontSize: g.pt(st.labelSize),
        color: color(st.labelColor, theme)?.color,
        fontFace: fontFamilyName("body", theme),
        align,
        margin: 0,
      });
      const sparkH = el.sparkline ? Math.max(20, el.h * 0.24) : 0;
      const valueY = el.y + el.h - pad - sparkH - st.valueSize * 1.15 - (delta && delta.value !== null ? st.labelSize * 1.5 : 0);
      s.addText(value.text, {
        x: b.x + pad * g.k,
        y: g.box({ x: 0, y: Math.max(el.y + pad + st.labelSize * 1.6, valueY), w: 1, h: 1 }).y,
        w: (el.w - pad * 2) * g.k,
        h: st.valueSize * 1.15 * g.k,
        fontSize: g.pt(st.valueSize),
        bold: true,
        color: color(st.valueColor, theme)?.color,
        fontFace: face,
        align,
        margin: 0,
      });
      if (delta && delta.value !== null) {
        const tc = tone > 0 ? theme.colors.positive : tone < 0 ? theme.colors.negative : theme.colors.muted;
        s.addText(`${tone > 0 ? "▲ " : tone < 0 ? "▼ " : ""}${delta.text}`, {
          x: b.x + pad * g.k,
          y: g.box({ x: 0, y: el.y + el.h - pad - sparkH - st.labelSize * 1.4, w: 1, h: 1 }).y,
          w: (el.w - pad * 2) * g.k,
          h: st.labelSize * 1.4 * g.k,
          fontSize: g.pt(st.labelSize * 0.95),
          bold: true,
          color: hexOnly(tc),
          fontFace: fontFamilyName("body", theme),
          align,
          margin: 0,
        });
      }
      if (el.sparkline) {
        const data = chartFor(ctx, el.sparkline);
        if (data?.kind === "series" && !chartIsEmpty(data)) {
          const vals = fillNulls(data.series[0]?.values ?? []);
          s.addChart(pptx.ChartType.line, [{ name: "trend", labels: data.x.map(dateLabel), values: vals }], {
            x: b.x + pad * g.k,
            y: b.y + (el.h - pad - sparkH) * g.k,
            w: (el.w - pad * 2) * g.k,
            h: sparkH * g.k,
            chartColors: [hexOnly(resolveColor(st.accent, theme))],
            lineSize: 2,
            lineDataSymbol: "none",
            showLegend: false,
            valAxisHidden: true,
            catAxisHidden: true,
            valGridLine: { style: "none" },
            catGridLine: { style: "none" },
          });
        }
      }
      return;
    }
    case "score": {
      const st = el.style;
      const size = Math.min(el.w, el.h);
      const v = resolveToken(el.metric, ctx);
      const num = typeof v.value === "number" ? Math.max(0, Math.min(100, v.value)) : 0;
      const x = el.x + (el.w - size) / 2;
      const y = el.y + (el.h - size) / 2;
      const box = g.box({ x, y, w: size, h: size });
      s.addChart(pptx.ChartType.doughnut, [{ name: "score", labels: ["score", "rest"], values: [num, 100 - num] }], {
        ...box,
        holeSize: Math.round(Math.max(50, Math.min(90, 100 - (st.thickness / size) * 200))),
        chartColors: [hexOnly(resolveColor(st.color, theme)), hexOnly(resolveColor(st.track, theme))],
        showLegend: false,
        showValue: false,
        showPercent: false,
        showLabel: false,
        firstSliceAng: 0,
      });
      s.addText(
        [
          { text: typeof v.value === "number" ? String(Math.round(v.value)) : "—", options: { fontSize: g.pt(size * 0.3), bold: true, color: color(st.textColor, theme)?.color, breakLine: !!el.label } },
          ...(el.label ? [{ text: interpolate(el.label, ctx), options: { fontSize: g.pt(Math.max(12, size * 0.075)), color: color(st.labelColor, theme)?.color } }] : []),
        ],
        { ...box, align: "center", valign: "middle", fontFace: fontFamilyName(st.fontFamily, theme), margin: 0 },
      );
      return;
    }
    case "chart": {
      await addChart(pptx, s, el, theme, ctx, g);
      return;
    }
    case "list": {
      const st = el.style;
      const { rows, empty } = listFor(ctx, el.source, el.limit);
      const face = fontFamilyName(st.fontFamily, theme);
      const fs = st.fontSize;
      const text = color(st.color, theme)?.color;
      const muted = color(st.mutedColor, theme)?.color;
      const accent = hexOnly(resolveColor(st.accent, theme));
      if (!rows.length) {
        s.addText(empty, { ...b, fontSize: g.pt(fs * 0.8), color: muted, fontFace: face, align: "center", valign: "middle" });
        return;
      }
      if (st.fill && st.variant !== "cards") s.addShape(pptx.ShapeType.roundRect, { ...b, fill: fillOf(st.fill), rectRadius: radiusFrac(24) });
      const pad = st.fill && st.variant !== "cards" ? fs * 0.6 : 0;
      const gap = st.variant === "cards" ? fs * 0.45 : 0;
      const rowH = Math.min((el.h - pad * 2 - gap * (rows.length - 1)) / rows.length, st.variant === "bullets" ? fs * 3 : fs * 2.6);
      rows.forEach((r, i) => {
        const y = el.y + pad + i * (rowH + gap);
        const x = el.x + pad;
        const w = el.w - pad * 2;
        if (st.variant === "bullets") {
          s.addText([{ text: r.label, options: { bullet: { indent: g.pt(fs) }, color: text } }], {
            ...g.box({ x, y, w, h: rowH }),
            fontSize: g.pt(fs),
            fontFace: face,
            valign: "top",
            margin: 0,
          });
          return;
        }
        if (st.variant === "cards") {
          s.addShape(pptx.ShapeType.roundRect, {
            ...g.box({ x, y, w, h: rowH }),
            fill: { color: r.highlight ? hexOnly(mix(resolveColor(st.accent, theme), theme.colors.bg, 0.82)) : hexOnly(st.fill ? resolveColor(st.fill, theme) : theme.colors.surface) },
            line: r.highlight ? { color: accent, width: g.pt(2) } : undefined,
            rectRadius: radiusFrac(fs * 0.6),
          });
        } else if (i < rows.length - 1) {
          s.addShape(pptx.ShapeType.line, { ...g.box({ x, y: y + rowH, w, h: 0 }), h: 0, line: { color: hexOnly(mix(theme.colors.border, theme.colors.bg, 0.1)), width: g.pt(2) } });
        }
        const innerX = x + (st.variant === "cards" ? fs * 0.7 : 0);
        const innerW = w - (st.variant === "cards" ? fs * 1.4 : 0);
        const rankW = st.showRank ? fs * 1.5 : 0;
        const valueW = st.showValue && r.value ? fs * 4.5 : 0;
        if (st.showRank) s.addText(String(i + 1), { ...g.box({ x: innerX, y, w: rankW, h: rowH }), fontSize: g.pt(fs), bold: true, color: r.highlight ? accent : muted, fontFace: face, valign: "middle", margin: 0 });
        s.addText(r.label, {
          ...g.box({ x: innerX + rankW + fs * 0.3, y, w: innerW - rankW - valueW - fs * 0.6, h: rowH }),
          fontSize: g.pt(fs),
          bold: !!r.highlight,
          color: r.highlight ? accent : text,
          fontFace: face,
          valign: "middle",
          margin: 0,
          fit: "shrink",
        });
        if (valueW) s.addText(r.value!, { ...g.box({ x: innerX + innerW - valueW, y, w: valueW, h: rowH }), fontSize: g.pt(fs), bold: true, color: r.highlight ? accent : text, fontFace: face, align: "right", valign: "middle", margin: 0 });
      });
      return;
    }
    case "table": {
      const st = el.style;
      const face = fontFamilyName(st.fontFamily, theme);
      let header: string[] | null = null;
      let body: { cells: string[]; highlight?: boolean }[] = [];
      let align: ("left" | "right")[] = [];
      if (el.mode === "live" && el.source) {
        const def = TABLES[el.source];
        if (def && hasData(ctx)) {
          header = el.header ? def.columns : null;
          body = tableFor(ctx, el.source, el.limit);
          align = def.align;
        }
      } else {
        const all = el.rows.map((r) => r.map((c) => interpolate(c, ctx)));
        header = el.header && all.length ? all[0]! : null;
        body = (el.header ? all.slice(1) : all).map((cells) => ({ cells }));
      }
      const cols = Math.max(header?.length ?? 0, ...body.map((r) => r.cells.length), 1);
      if (!body.length && !header) return;
      const border = { type: "solid" as const, pt: 1, color: color(st.border, theme)?.color ?? "CCCCCC" };
      const rowsOut: PptxGenJS.TableRow[] = [];
      if (header)
        rowsOut.push(
          Array.from({ length: cols }, (_, j) => ({
            text: (header![j] ?? "").toUpperCase(),
            options: { bold: true, color: color(st.headerColor, theme)?.color, fill: color(st.headerFill, theme) ?? undefined, align: align[j] ?? "left", fontSize: g.pt(st.fontSize * 0.82) },
          })),
        );
      for (const r of body)
        rowsOut.push(
          Array.from({ length: cols }, (_, j) => ({
            text: r.cells[j] ?? "",
            options: {
              color: r.highlight && j === 0 ? hexOnly(theme.colors.accent) : color(st.color, theme)?.color,
              bold: !!r.highlight,
              align: align[j] ?? "left",
              fill: r.highlight ? { color: hexOnly(mix(theme.colors.accent, theme.colors.bg, 0.86)) } : undefined,
            },
          })),
        );
      const firstW = el.w * (cols > 2 ? 0.4 : 0.55);
      const restW = cols > 1 ? (el.w - firstW) / (cols - 1) : 0;
      s.addTable(rowsOut, {
        x: b.x,
        y: b.y,
        w: b.w,
        colW: Array.from({ length: cols }, (_, j) => (j === 0 ? firstW : restW) * g.k),
        fontSize: g.pt(st.fontSize),
        fontFace: face,
        border: [{ type: "none" }, { type: "none" }, border, { type: "none" }],
        margin: g.pt(st.fontSize * 0.45),
        autoPage: false,
      });
      return;
    }
  }
}

function fillNulls(values: (number | null)[]): number[] {
  const first = values.find((v) => v !== null) ?? 0;
  let last = first;
  return values.map((v) => (v === null ? last : (last = v)));
}

async function addChart(pptx: Pptx, s: PSlide, el: Extract<SlideElement, { type: "chart" }>, theme: Theme, ctx: ResolveCtx, g: Geo) {
  const def = CHARTS[el.metric];
  const data = chartFor(ctx, el.metric, { limit: el.options.limit });
  const fs = el.style.fontSize;
  const b = g.box(el);
  const fillC = el.style.fill ? color(el.style.fill, theme) : null;
  const pad = fillC ? Math.max(16, fs * 1.2) : 0;
  if (fillC) s.addShape(pptx.ShapeType.roundRect, { ...b, fill: { color: fillC.color }, rectRadius: Math.max(0, Math.min(1, (el.style.radius ?? 28) / Math.max(1, Math.min(el.w, el.h) / 2))) });
  const titleH = el.title ? fs * 2 : 0;
  if (el.title) {
    s.addText(el.title, {
      ...g.box({ x: el.x + pad, y: el.y + pad, w: el.w - pad * 2, h: titleH }),
      fontSize: g.pt(fs * 1.1),
      bold: true,
      color: color(el.style.titleColor ?? "$text", theme)?.color,
      fontFace: fontFamilyName(el.style.fontFamily, theme),
      margin: 0,
      valign: "top",
    });
  }
  const area = g.box({ x: el.x + pad, y: el.y + pad + titleH, w: el.w - pad * 2, h: el.h - pad * 2 - titleH });
  const muted = hexOnly(resolveColor(el.style.color, theme));
  if (!def || !data || chartIsEmpty(data)) {
    s.addText(`${def?.label ?? "Chart"}: no data for this period yet`, { ...area, fontSize: g.pt(fs), color: muted, align: "center", valign: "middle" });
    return;
  }
  const type = def.types.includes(el.chartType) ? el.chartType : def.defaultType;
  const accent = hexOnly(el.options.colors?.[0] ? resolveColor(el.options.colors[0], theme) : theme.colors.accent);
  const palette = (el.options.colors?.length ? el.options.colors.map((c) => resolveColor(c, theme)) : theme.chart).map(hexOnly);
  const neutral = hexOnly(mix(theme.colors.muted, theme.colors.bg, 0.45));
  const grid = hexOnly(mix(theme.colors.border, theme.colors.bg, 0.15));
  const font = fontFamilyName(el.style.fontFamily, theme);
  const common = {
    ...area,
    catAxisLabelColor: muted,
    valAxisLabelColor: muted,
    catAxisLabelFontSize: g.pt(fs * 0.85),
    valAxisLabelFontSize: g.pt(fs * 0.85),
    catAxisLabelFontFace: font,
    valAxisLabelFontFace: font,
    legendFontFace: font,
    legendColor: muted,
    legendFontSize: g.pt(fs * 0.9),
    dataLabelColor: hexOnly(theme.colors.text),
    dataLabelFontSize: g.pt(fs * 0.9),
    valGridLine: el.options.grid === false ? { style: "none" as const } : { color: grid, size: 1 },
    catGridLine: { style: "none" as const },
    catAxisLineShow: false,
    valAxisLineShow: false,
  };
  const fmtCode = data.format === "percent" ? '0"%"' : data.format === "position" ? '"#"0.0' : "#,##0";

  if (data.kind === "series") {
    const labels = data.x.map(dateLabel);
    if (type === "bar") {
      const vals = data.series[0]?.values.map((v) => v ?? 0) ?? [];
      s.addChart(pptx.ChartType.bar, [{ name: data.series[0]?.label ?? "", labels, values: vals }], {
        ...common,
        barDir: "col",
        chartColors: [accent],
        showLegend: false,
        valAxisLabelFormatCode: fmtCode,
        barGapWidthPct: 40,
      });
      return;
    }
    const series = data.series.map((sr) => ({ name: sr.label, labels, values: fillNulls(sr.values) }));
    const colors = data.series.map((sr, i) => (i === 0 || sr.isOwn ? accent : (palette[(i % Math.max(1, palette.length - 1)) + 1] ?? neutral)));
    s.addChart(type === "area" ? pptx.ChartType.area : pptx.ChartType.line, series, {
      ...common,
      chartColors: colors,
      chartColorsOpacity: type === "area" ? 45 : undefined,
      lineSize: 3,
      lineDataSymbol: "none",
      showLegend: data.series.length > 1 && el.options.legend !== false,
      legendPos: "t",
      valAxisLabelFormatCode: fmtCode,
      valAxisMaxVal: data.format === "percent" ? 100 : undefined,
      valAxisMinVal: 0,
      // runtime accepts "maxMin" (typings only list minMax): lower positions are better
      valAxisOrientation: (data.format === "position" ? "maxMin" : "minMax") as "minMax",
    });
    return;
  }

  // pptx draws horizontal bars bottom-up, so reverse to keep the ranking top-down.
  const items = type === "hbar" ? [...data.items].reverse() : data.items;
  const labels = items.map((i) => i.label);
  const hasOwn = el.options.highlightOwn !== false && items.some((i) => i.isOwn);
  if (type === "donut") {
    const colors = items.map((it, i) => (hasOwn ? (it.isOwn ? accent : (palette[(i % Math.max(1, palette.length - 1)) + 1] ?? neutral)) : (palette[i % palette.length] ?? accent)));
    s.addChart(pptx.ChartType.doughnut, [{ name: def.label, labels, values: items.map((i) => i.value) }], {
      ...area,
      holeSize: 62,
      chartColors: colors,
      showLegend: el.options.legend !== false,
      legendPos: el.w > el.h * 1.25 ? "r" : "b",
      legendColor: muted,
      legendFontSize: g.pt(fs * 0.9),
      legendFontFace: font,
      showPercent: data.format !== "percent",
      showValue: data.format === "percent",
      dataLabelColor: hexOnly(theme.colors.text),
      dataLabelFontSize: g.pt(fs * 0.8),
      dataLabelFormatCode: data.format === "percent" ? '0.0"%"' : undefined,
    });
    return;
  }
  const horizontal = type === "hbar";
  const valueFormat = fmtCode;
  if (hasOwn) {
    // Two stacked series so the own brand can be highlighted in the accent color.
    s.addChart(
      pptx.ChartType.bar,
      [
        { name: "You", labels, values: items.map((i) => (i.isOwn ? i.value : 0)) },
        { name: "Others", labels, values: items.map((i) => (i.isOwn ? 0 : i.value)) },
      ],
      {
        ...common,
        barDir: horizontal ? "bar" : "col",
        barGrouping: "stacked",
        chartColors: [accent, neutral],
        showLegend: false,
        showValue: el.options.values !== false,
        dataLabelFormatCode: data.format === "percent" ? '0.0"%";;' : "#,##0;;",
        valAxisLabelFormatCode: valueFormat,
        barGapWidthPct: 45,
      },
    );
    return;
  }
  s.addChart(pptx.ChartType.bar, [{ name: def.label, labels, values: items.map((i) => i.value) }], {
    ...common,
    barDir: horizontal ? "bar" : "col",
    chartColors: [accent],
    showLegend: false,
    showValue: el.options.values !== false,
    dataLabelFormatCode: data.format === "percent" ? '0.0"%"' : "#,##0",
    valAxisLabelFormatCode: valueFormat,
    barGapWidthPct: 45,
  });
}

/** Builds the presentation. Returns the pptxgenjs instance (caller decides the output type). */
export async function buildPptx(Ctor: typeof PptxGenJS, deck: Deck, ctx: ResolveCtx, env: PptxEnv, meta: { title: string; author?: string; company?: string }): Promise<Pptx> {
  const pptx = new Ctor();
  const widthIn = deck.format === "classic" ? 8.27 : 13.333;
  const heightIn = (widthIn * deck.size.h) / deck.size.w;
  pptx.defineLayout({ name: "AUTOSEO", width: widthIn, height: heightIn });
  pptx.layout = "AUTOSEO";
  pptx.title = meta.title;
  pptx.author = meta.author ?? "AutoSEO";
  pptx.company = meta.company ?? "";
  const k = widthIn / deck.size.w;
  const g: Geo = {
    k,
    pt: (px: number) => Math.max(1, Math.round(px * k * 72 * 10) / 10),
    box: (e) => ({ x: e.x * k, y: e.y * k, w: Math.max(0.01, e.w * k), h: Math.max(0.01, e.h * k) }),
  };
  for (const sl of deck.slides) {
    if (sl.hidden) continue;
    await addSlide(pptx, sl, deck, ctx, env, g);
  }
  return pptx;
}

async function addSlide(pptx: Pptx, sl: Slide, deck: Deck, ctx: ResolveCtx, env: PptxEnv, g: Geo) {
  const s = pptx.addSlide();
  const theme = deck.theme;
  const bg = color(sl.background.gradient?.from ?? sl.background.color, theme) ?? { color: hexOnly(theme.colors.bg) };
  s.background = { color: bg.color };
  const bgImg = imageSrc(sl.background.image, ctx, env);
  if (bgImg) {
    const data = await env.loadImage(bgImg);
    if (data)
      s.addImage({
        data,
        x: 0,
        y: 0,
        w: deck.size.w * g.k,
        h: deck.size.h * g.k,
        sizing: { type: "cover", w: deck.size.w * g.k, h: deck.size.h * g.k },
        transparency: sl.background.imageOpacity !== undefined ? Math.round((1 - sl.background.imageOpacity) * 100) : undefined,
      });
  }
  for (const el of sl.elements) {
    if (el.hidden) continue;
    try {
      await addElement(pptx, s, el, deck, ctx, env, g);
    } catch (err) {
      console.warn("[pptx] skipped element", el.type, err);
    }
  }
  if (sl.notes) s.addNotes(interpolate(sl.notes, ctx));
}

export function pptxFileName(title: string): string {
  return `${title.replace(/[^\w\s.-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "report"}.pptx`;
}

export { formatValue };
