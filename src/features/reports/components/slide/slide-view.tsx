import { memo, type CSSProperties } from "react";
import {
  CHARTS,
  TABLES,
  chartFor,
  chartIsEmpty,
  deltaTone,
  hasData,
  interpolate,
  listFor,
  logoFor,
  resolveToken,
  tableFor,
  type ResolveCtx,
} from "../../lib/catalog";
import { ICONS } from "../../lib/icons";
import { fontStack, googleFontsHref, mix, resolveColor } from "../../lib/theme";
import type {
  BoxElement,
  ChartElement,
  Deck,
  IconElement,
  ImageElement,
  ImageSource,
  KpiElement,
  ListElement,
  Paragraph,
  Run,
  ScoreElement,
  Slide,
  SlideElement,
  TableElement,
  TextElement,
  Theme,
} from "../../lib/types";
import { Ring, SlideChart, Sparkline, chartPalette } from "./charts";

/*
 * Renders one slide at its native size (e.g. 1920×1080 px). Pure (no hooks) so it works in server
 * and client components; scaling is done by the caller with a CSS transform.
 */

export type RenderCtx = {
  deck: Pick<Deck, "theme" | "size">;
  data: ResolveCtx;
  /** URL for an uploaded asset (differs for the app vs. public share pages). */
  assetUrl: (assetId: string) => string;
  /** edit = show token chips and placeholders for empty images */
  mode: "edit" | "view";
  /** Element ids not to render (e.g. the text box currently being edited in place). */
  skip?: ReadonlySet<string>;
};

export const TOKEN_CHIP_STYLE: CSSProperties = {
  color: "#C4B5FD",
  background: "rgba(139, 92, 246, 0.22)",
  boxShadow: "inset 0 0 0 1px rgba(167, 139, 250, 0.55)",
  borderRadius: "0.18em",
  padding: "0 0.14em",
};

export function resolveImageSrc(src: ImageSource | undefined, ctx: RenderCtx): string | null {
  if (!src) return null;
  if (src.kind === "asset") return ctx.assetUrl(src.assetId);
  if (src.kind === "url") return src.url;
  const raw = logoFor(ctx.data, src.token);
  if (!raw) return null;
  if (raw.startsWith("asset:")) return ctx.assetUrl(raw.slice(6));
  if (/^https?:\/\//i.test(raw)) return raw;
  return null;
}

function backgroundStyle(slide: Slide, theme: Theme): CSSProperties {
  const bg = slide.background;
  const color = resolveColor(bg.color, theme, theme.colors.bg);
  if (bg.gradient) {
    return {
      backgroundColor: color,
      backgroundImage: `linear-gradient(${bg.gradient.angle}deg, ${resolveColor(bg.gradient.from, theme)}, ${resolveColor(bg.gradient.to, theme)})`,
    };
  }
  return { backgroundColor: color };
}

export function SlideView({ slide, ctx, className, style }: { slide: Slide; ctx: RenderCtx; className?: string; style?: CSSProperties }) {
  const { theme, size } = ctx.deck;
  const fontsHref = googleFontsHref(theme);
  const bgImage = resolveImageSrc(slide.background.image, ctx);
  return (
    <div
      className={className}
      data-slide-id={slide.id}
      style={{
        position: "relative",
        width: size.w,
        height: size.h,
        overflow: "hidden",
        color: theme.colors.text,
        fontFamily: fontStack("body", theme),
        ...backgroundStyle(slide, theme),
        ...style,
      }}
    >
      {fontsHref && <link rel="stylesheet" href={fontsHref} precedence="report-fonts" />}
      {bgImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={bgImage}
          alt=""
          draggable={false}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: slide.background.imageOpacity ?? 1 }}
        />
      )}
      {slide.elements.map((el) => (el.hidden || ctx.skip?.has(el.id) ? null : <ElementFrame key={el.id} el={el} ctx={ctx} />))}
    </div>
  );
}

const ElementFrame = memo(function ElementFrame({ el, ctx }: { el: SlideElement; ctx: RenderCtx }) {
  return (
    <div
      data-el-id={el.id}
      style={{
        position: "absolute",
        left: el.x,
        top: el.y,
        width: el.w,
        height: el.h,
        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
        opacity: el.opacity ?? 1,
      }}
    >
      <ElementBody el={el} ctx={ctx} />
    </div>
  );
});

export function ElementBody({ el, ctx }: { el: SlideElement; ctx: RenderCtx }) {
  switch (el.type) {
    case "text":
      return <TextBody el={el} ctx={ctx} />;
    case "box":
      return <BoxBody el={el} theme={ctx.deck.theme} />;
    case "image":
      return <ImageBody el={el} ctx={ctx} />;
    case "icon":
      return <IconBody el={el} theme={ctx.deck.theme} />;
    case "chart":
      return <ChartBody el={el} ctx={ctx} />;
    case "list":
      return <ListBody el={el} ctx={ctx} />;
    case "kpi":
      return <KpiBody el={el} ctx={ctx} />;
    case "score":
      return <ScoreBody el={el} ctx={ctx} />;
    case "table":
      return <TableBody el={el} ctx={ctx} />;
    default:
      return null;
  }
}

/* ───────────────────────────── Text ───────────────────────────── */

export function textBoxStyle(el: TextElement, theme: Theme): CSSProperties {
  const s = el.style;
  return {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    justifyContent: s.valign === "middle" ? "center" : s.valign === "bottom" ? "flex-end" : "flex-start",
    padding: el.padding ?? 0,
    background: el.fill ? resolveColor(el.fill, theme) : undefined,
    borderRadius: el.radius ?? 0,
    fontFamily: fontStack(s.fontFamily, theme),
    fontSize: s.fontSize,
    fontWeight: s.fontWeight,
    color: resolveColor(s.color, theme, theme.colors.text),
    textAlign: s.align,
    lineHeight: s.lineHeight,
    letterSpacing: `${s.letterSpacing}em`,
    textTransform: s.uppercase ? "uppercase" : undefined,
    fontStyle: s.italic ? "italic" : undefined,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    wordBreak: "normal",
    boxSizing: "border-box",
  };
}

export function runStyle(r: Run, baseWeight: number, theme: Theme): CSSProperties | undefined {
  if (!r.b && !r.i && !r.u && !r.color) return undefined;
  return {
    fontWeight: r.b ? Math.max(700, Math.min(900, baseWeight + 200)) : undefined,
    fontStyle: r.i ? "italic" : undefined,
    textDecoration: r.u ? "underline" : undefined,
    color: r.color ? resolveColor(r.color, theme) : undefined,
  };
}

export function paragraphStyle(p: Paragraph): CSSProperties {
  return p.bullet ? { margin: 0, paddingLeft: "1.1em", textIndent: "-1.1em" } : { margin: 0 };
}

function TextBody({ el, ctx }: { el: TextElement; ctx: RenderCtx }) {
  const theme = ctx.deck.theme;
  return (
    <div style={textBoxStyle(el, theme)}>
      {el.paragraphs.map((p, i) => (
        <p key={i} style={paragraphStyle(p)}>
          {p.bullet && <span style={{ color: resolveColor("$accent", theme) }}>•&nbsp;</span>}
          {p.runs.length === 0 ? <br /> : p.runs.map((r, j) => <RunView key={j} run={r} ctx={ctx} baseWeight={el.style.fontWeight} />)}
        </p>
      ))}
    </div>
  );
}

function RunView({ run, ctx, baseWeight }: { run: Run; ctx: RenderCtx; baseWeight: number }) {
  const style = runStyle(run, baseWeight, ctx.deck.theme);
  if (run.token) {
    const { text } = resolveToken(run.token, ctx.data);
    const chip = ctx.mode === "edit" ? TOKEN_CHIP_STYLE : undefined;
    return (
      <span data-token={run.token} style={{ ...style, ...chip }}>
        {text}
      </span>
    );
  }
  return style ? <span style={style}>{run.text}</span> : <>{run.text}</>;
}

/* ───────────────────────────── Box / image / icon ───────────────────────────── */

function BoxBody({ el, theme }: { el: BoxElement; theme: Theme }) {
  const fill = resolveColor(el.fill, theme);
  const stroke = resolveColor(el.stroke, theme);
  const sw = el.strokeWidth;
  if (el.shape === "line") {
    return (
      <svg width="100%" height="100%" viewBox={`0 0 ${el.w} ${el.h}`} preserveAspectRatio="none" style={{ display: "block", overflow: "visible" }}>
        <line
          x1={0}
          y1={el.h / 2}
          x2={el.w}
          y2={el.h / 2}
          stroke={stroke === "transparent" ? resolveColor("$border", theme) : stroke}
          strokeWidth={Math.max(1, sw)}
          strokeDasharray={el.strokeStyle === "dashed" ? `${sw * 3} ${sw * 2.5}` : undefined}
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (el.shape === "triangle") {
    return (
      <svg width="100%" height="100%" viewBox={`0 0 ${el.w} ${el.h}`} preserveAspectRatio="none" style={{ display: "block", overflow: "visible" }}>
        <polygon points={`${el.w / 2},0 ${el.w},${el.h} 0,${el.h}`} fill={fill} stroke={sw ? stroke : "none"} strokeWidth={sw} />
      </svg>
    );
  }
  const style: CSSProperties = {
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    backgroundColor: fill,
    borderRadius: el.shape === "ellipse" ? "50%" : el.radius,
    border: sw ? `${sw}px ${el.strokeStyle ?? "solid"} ${stroke}` : undefined,
    boxShadow: el.shadow ? "0 24px 60px -20px rgba(0,0,0,0.45)" : undefined,
  };
  if (el.gradient) {
    style.backgroundImage = `linear-gradient(${el.gradient.angle}deg, ${resolveColor(el.gradient.from, theme)}, ${resolveColor(el.gradient.to, theme)})`;
  }
  return <div style={style} />;
}

function ImageBody({ el, ctx }: { el: ImageElement; ctx: RenderCtx }) {
  const src = resolveImageSrc(el.src, ctx);
  const theme = ctx.deck.theme;
  if (!src) {
    if (ctx.mode !== "edit") return null;
    const label = el.src.kind === "token" ? (el.src.token === "agency.logo" ? "Agency logo" : "Client logo") : "Image";
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: `3px dashed ${mix(theme.colors.muted, theme.colors.bg, 0.4)}`,
          borderRadius: el.radius,
          color: theme.colors.muted,
          fontSize: Math.max(14, Math.min(el.h * 0.22, 28)),
          boxSizing: "border-box",
          textAlign: "center",
          padding: 8,
        }}
      >
        {label}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={el.alt ?? ""}
      draggable={false}
      style={{
        width: "100%",
        height: "100%",
        objectFit: el.fit,
        borderRadius: el.radius,
        border: el.strokeWidth ? `${el.strokeWidth}px solid ${resolveColor(el.stroke, theme)}` : undefined,
        boxSizing: "border-box",
        display: "block",
      }}
    />
  );
}

function IconBody({ el, theme }: { el: IconElement; theme: Theme }) {
  const node = ICONS[el.icon] ?? ICONS["sparkles"]!;
  const pad = el.bg ? Math.min(el.w, el.h) * 0.22 : 0;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: el.bg ? resolveColor(el.bg, theme) : undefined,
        borderRadius: el.radius ?? (el.bg ? Math.min(el.w, el.h) * 0.28 : 0),
        padding: pad,
        boxSizing: "border-box",
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 24 24"
        fill="none"
        stroke={resolveColor(el.color, theme)}
        strokeWidth={el.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ display: "block" }}
      >
        {node.map(([tag, attrs], i) => {
          const Tag = tag as "path";
          return <Tag key={i} {...(attrs as Record<string, string>)} />;
        })}
      </svg>
    </div>
  );
}

/* ───────────────────────────── Chart ───────────────────────────── */

function EmptyData({ label, theme, fontSize, mode }: { label: string; theme: Theme; fontSize: number; mode: RenderCtx["mode"] }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        color: theme.colors.muted,
        fontSize,
        border: mode === "edit" ? `2px dashed ${mix(theme.colors.muted, theme.colors.bg, 0.55)}` : undefined,
        borderRadius: 16,
        boxSizing: "border-box",
        padding: 12,
      }}
    >
      {label}
    </div>
  );
}

function ChartBody({ el, ctx }: { el: ChartElement; ctx: RenderCtx }) {
  const theme = ctx.deck.theme;
  const def = CHARTS[el.metric];
  const data = chartFor(ctx.data, el.metric, { limit: el.options.limit });
  const fs = el.style.fontSize;
  const fill = el.style.fill ? resolveColor(el.style.fill, theme) : undefined;
  const pad = fill ? Math.max(16, fs * 1.2) : 0;
  const titleH = el.title ? fs * 2 : 0;
  const innerW = Math.max(10, el.w - pad * 2);
  const innerH = Math.max(10, el.h - pad * 2 - titleH);
  const overrides = el.options.colors?.map((c) => resolveColor(c, theme));
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: fill,
        borderRadius: el.style.radius ?? (fill ? 28 : 0),
        padding: pad,
        boxSizing: "border-box",
        fontFamily: fontStack(el.style.fontFamily, theme),
      }}
    >
      {el.title && (
        <div style={{ height: titleH, fontSize: fs * 1.1, fontWeight: 600, color: resolveColor(el.style.titleColor ?? "$text", theme), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {el.title}
        </div>
      )}
      {!def ? (
        <EmptyData label="Unknown chart metric" theme={theme} fontSize={fs} mode={ctx.mode} />
      ) : !hasData(ctx.data) ? (
        <EmptyData label="Loading…" theme={theme} fontSize={fs} mode={ctx.mode} />
      ) : chartIsEmpty(data) ? (
        <div style={{ width: innerW, height: innerH }}>
          <EmptyData label={`${def.label}: no data for this period yet`} theme={theme} fontSize={fs} mode={ctx.mode} />
        </div>
      ) : (
        <SlideChart
          id={el.id}
          data={data!}
          type={def.types.includes(el.chartType) ? el.chartType : def.defaultType}
          w={innerW}
          h={innerH}
          fontSize={fs}
          fontFamily={fontStack(el.style.fontFamily, theme)}
          textColor={resolveColor(el.style.color, theme)}
          palette={chartPalette(theme, overrides)}
          legend={el.options.legend}
          grid={el.options.grid}
          values={el.options.values}
          highlightOwn={el.options.highlightOwn}
        />
      )}
    </div>
  );
}

/* ───────────────────────────── List ───────────────────────────── */

function ListBody({ el, ctx }: { el: ListElement; ctx: RenderCtx }) {
  const theme = ctx.deck.theme;
  const s = el.style;
  const { rows, empty } = hasData(ctx.data) ? listFor(ctx.data, el.source, el.limit) : { rows: [], empty: "Loading…" };
  const fs = s.fontSize;
  const color = resolveColor(s.color, theme);
  const muted = resolveColor(s.mutedColor, theme);
  const accent = resolveColor(s.accent, theme);
  const fill = s.fill ? resolveColor(s.fill, theme) : undefined;
  if (!rows.length) {
    return <EmptyData label={empty} theme={theme} fontSize={fs * 0.8} mode={ctx.mode} />;
  }
  const gap = s.variant === "cards" ? fs * 0.45 : s.variant === "bullets" ? fs * 0.55 : 0;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap,
        overflow: "hidden",
        fontFamily: fontStack(s.fontFamily, theme),
        fontSize: fs,
        color,
        background: s.variant === "cards" ? undefined : fill,
        borderRadius: fill && s.variant !== "cards" ? 24 : undefined,
        padding: fill && s.variant !== "cards" ? fs * 0.6 : 0,
        boxSizing: "border-box",
      }}
    >
      {rows.map((r, i) => {
        if (s.variant === "bullets") {
          return (
            <div key={i} style={{ display: "flex", gap: fs * 0.55, alignItems: "baseline", lineHeight: 1.3 }}>
              <span style={{ flex: "none", width: fs * 0.42, height: fs * 0.42, borderRadius: 99, background: accent, transform: `translateY(-${fs * 0.1}px)` }} />
              <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{r.label}</span>
            </div>
          );
        }
        const isCard = s.variant === "cards";
        return (
          <div
            key={i}
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              gap: fs * 0.6,
              flex: isCard ? "1 1 0" : "none",
              minHeight: fs * 2.1,
              padding: isCard ? `${fs * 0.35}px ${fs * 0.7}px` : `${fs * 0.42}px 0`,
              borderBottom: !isCard && i < rows.length - 1 ? `2px solid ${mix(theme.colors.border, theme.colors.bg, 0.1)}` : undefined,
              background: isCard ? (r.highlight ? mix(accent, theme.colors.bg, 0.82) : (fill ?? theme.colors.surface)) : undefined,
              borderRadius: isCard ? fs * 0.6 : undefined,
              boxShadow: isCard && r.highlight ? `inset 0 0 0 2px ${accent}` : undefined,
              boxSizing: "border-box",
            }}
          >
            {s.showRank && (
              <span style={{ flex: "none", width: fs * 1.5, color: r.highlight ? accent : muted, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{i + 1}</span>
            )}
            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: r.highlight ? 700 : 500, color: r.highlight ? accent : color }}>{r.label}</div>
              {s.showBar && (
                <div style={{ marginTop: fs * 0.25, height: fs * 0.28, borderRadius: 99, background: mix(theme.colors.border, theme.colors.bg, 0.2) }}>
                  <div style={{ width: `${Math.max(2, (r.ratio ?? 0) * 100)}%`, height: "100%", borderRadius: 99, background: r.highlight ? accent : mix(accent, theme.colors.bg, 0.35) }} />
                </div>
              )}
            </div>
            {s.showValue && r.value && (
              <span style={{ flex: "none", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: r.highlight ? accent : color }}>{r.value}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ───────────────────────────── KPI tile ───────────────────────────── */

function KpiBody({ el, ctx }: { el: KpiElement; ctx: RenderCtx }) {
  const theme = ctx.deck.theme;
  const s = el.style;
  const value = resolveToken(el.metric, ctx.data);
  const delta = el.deltaMetric ? resolveToken(el.deltaMetric, ctx.data) : null;
  const tone = el.deltaMetric && delta ? deltaTone(el.deltaMetric, delta.value) : 0;
  const pad = Math.max(16, Math.min(56, Math.min(el.w, el.h) * 0.11));
  const fill = resolveColor(s.fill, theme);
  const stroke = resolveColor(s.stroke, theme);
  const spark = el.sparkline ? chartFor(ctx.data, el.sparkline) : null;
  const sparkValues = spark?.kind === "series" ? (spark.series[0]?.values ?? []) : [];
  const sparkH = el.sparkline ? Math.max(20, el.h * 0.24) : 0;
  const toneColor = tone > 0 ? theme.colors.positive : tone < 0 ? theme.colors.negative : theme.colors.muted;
  const center = s.align === "center";
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        background: fill,
        border: stroke !== "transparent" ? `2px solid ${stroke}` : undefined,
        borderRadius: s.radius,
        padding: pad,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        alignItems: center ? "center" : "stretch",
        textAlign: center ? "center" : "left",
        overflow: "hidden",
        fontFamily: fontStack(s.fontFamily, theme),
      }}
    >
      <div style={{ fontSize: s.labelSize, color: resolveColor(s.labelColor, theme), fontWeight: 500, lineHeight: 1.2, fontFamily: fontStack("body", theme) }}>{interpolate(el.label, ctx.data)}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: s.labelSize * 0.6, flexWrap: "wrap", justifyContent: center ? "center" : "flex-start" }}>
        <span
          data-token={ctx.mode === "edit" ? el.metric : undefined}
          style={{ fontSize: s.valueSize, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.03em", color: resolveColor(s.valueColor, theme), fontVariantNumeric: "tabular-nums" }}
        >
          {value.text}
        </span>
        {delta && delta.value !== null && (
          <span
            style={{
              fontSize: s.labelSize * 0.95,
              fontWeight: 700,
              color: toneColor,
              background: mix(toneColor, fill === "transparent" ? theme.colors.bg : fill, 0.84),
              borderRadius: 999,
              padding: `${s.labelSize * 0.18}px ${s.labelSize * 0.55}px`,
              whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
              fontFamily: fontStack("body", theme),
            }}
          >
            {tone > 0 ? "▲ " : tone < 0 ? "▼ " : ""}
            {delta.text}
          </span>
        )}
      </div>
      {el.sparkline && (
        <div style={{ height: sparkH, width: "100%" }}>
          <Sparkline id={el.id} values={sparkValues} w={el.w - pad * 2} h={sparkH} color={resolveColor(s.accent, theme)} />
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── Score ring ───────────────────────────── */

function ScoreBody({ el, ctx }: { el: ScoreElement; ctx: RenderCtx }) {
  const theme = ctx.deck.theme;
  const s = el.style;
  const size = Math.min(el.w, el.h);
  const v = resolveToken(el.metric, ctx.data);
  const num = typeof v.value === "number" ? v.value : null;
  const t = Math.min(s.thickness, size / 3);
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <Ring value={num} size={size} thickness={t} color={resolveColor(s.color, theme)} track={resolveColor(s.track, theme)} />
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: fontStack(s.fontFamily, theme),
          }}
        >
          <span style={{ fontSize: size * 0.3, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.03em", color: resolveColor(s.textColor, theme), fontVariantNumeric: "tabular-nums" }}>
            {num === null ? "—" : Math.round(num)}
          </span>
          {el.label && (
            <span style={{ marginTop: size * 0.03, fontSize: Math.max(12, size * 0.075), color: resolveColor(s.labelColor, theme), fontWeight: 500, fontFamily: fontStack("body", theme), textAlign: "center", maxWidth: size * 0.62 }}>
              {interpolate(el.label, ctx.data)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── Table ───────────────────────────── */

export function tableRows(el: TableElement, data: ResolveCtx): { header: string[] | null; rows: { cells: string[]; highlight?: boolean }[]; align: ("left" | "right")[] } {
  if (el.mode === "live" && el.source) {
    const def = TABLES[el.source];
    if (!def) return { header: null, rows: [], align: [] };
    return { header: el.header ? def.columns : null, rows: tableFor(data, el.source, el.limit), align: def.align };
  }
  const all = el.rows.map((r) => r.map((c) => interpolate(c, data)));
  const header = el.header && all.length ? all[0]! : null;
  const body = (el.header ? all.slice(1) : all).map((cells) => ({ cells }));
  return { header, rows: body, align: [] };
}

function TableBody({ el, ctx }: { el: TableElement; ctx: RenderCtx }) {
  const theme = ctx.deck.theme;
  const s = el.style;
  const { header, rows, align } = tableRows(el, ctx.data);
  const fs = s.fontSize;
  const border = resolveColor(s.border, theme);
  const stripe = s.stripe ? resolveColor(s.stripe, theme) : undefined;
  const accent = theme.colors.accent;
  const cols = Math.max(header?.length ?? 0, ...rows.map((r) => r.cells.length), 1);
  if (!rows.length && el.mode === "live") {
    return <EmptyData label="No data for this table yet" theme={theme} fontSize={fs} mode={ctx.mode} />;
  }
  return (
    <div style={{ width: "100%", height: "100%", overflow: "hidden", fontFamily: fontStack(s.fontFamily, theme) }}>
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: fs, color: resolveColor(s.color, theme) }}>
        <colgroup>
          {Array.from({ length: cols }, (_, i) => (
            <col key={i} style={{ width: i === 0 ? `${cols > 2 ? 40 : 55}%` : undefined }} />
          ))}
        </colgroup>
        {header && (
          <thead>
            <tr style={{ background: resolveColor(s.headerFill, theme) }}>
              {header.map((h, i) => (
                <th
                  key={i}
                  style={{
                    textAlign: align[i] ?? "left",
                    fontWeight: 600,
                    fontSize: fs * 0.82,
                    color: resolveColor(s.headerColor, theme),
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    padding: `${fs * 0.45}px ${fs * 0.5}px`,
                    borderBottom: `2px solid ${border}`,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ background: stripe && i % 2 === 1 ? stripe : r.highlight ? mix(accent, theme.colors.bg, 0.86) : undefined }}>
              {Array.from({ length: cols }, (_, j) => (
                <td
                  key={j}
                  style={{
                    textAlign: align[j] ?? "left",
                    padding: `${fs * 0.5}px ${fs * 0.5}px`,
                    borderBottom: `1px solid ${border}`,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    fontWeight: r.highlight || (j === 0 && el.mode === "live") ? 600 : 400,
                    color: r.highlight && j === 0 ? accent : undefined,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {r.cells[j] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
