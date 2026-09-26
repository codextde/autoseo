import { area as d3area, arc as d3arc, curveMonotoneX, line as d3line, pie as d3pie } from "d3-shape";
import { format as formatDate, parseISO } from "date-fns";
import { formatValue, type ChartCategoryData, type ChartData, type ChartSeriesData } from "../../lib/catalog";
import { mix } from "../../lib/theme";
import type { ChartType, Theme } from "../../lib/types";

/*
 * Pure SVG charts sized in slide pixels (no hooks, no measuring) so they render identically in the
 * editor, thumbnails, present mode, public share pages and print/PDF.
 */

export type ChartPalette = {
  accent: string;
  neutral: string;
  grid: string;
  text: string;
  muted: string;
  series: string[];
  bg: string;
};

export function chartPalette(theme: Theme, overrides?: string[]): ChartPalette {
  const c = theme.colors;
  return {
    accent: overrides?.[0] ?? c.accent,
    neutral: mix(c.muted, c.bg, 0.45),
    grid: mix(c.border, c.bg, 0.15),
    text: c.text,
    muted: c.muted,
    series: overrides?.length ? overrides : theme.chart,
    bg: c.bg,
  };
}

type Props = {
  id: string;
  data: ChartData;
  type: ChartType;
  w: number;
  h: number;
  fontSize: number;
  fontFamily: string;
  textColor: string;
  palette: ChartPalette;
  legend?: boolean;
  grid?: boolean;
  values?: boolean;
  highlightOwn?: boolean;
};

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nf * exp;
}

function shortLabel(v: string, max: number) {
  return v.length > max ? `${v.slice(0, Math.max(1, max - 1))}…` : v;
}

function axisValue(v: number, format: ChartSeriesData["format"]) {
  if (format === "percent") return `${Math.round(v)}%`;
  if (format === "position") return `#${Math.round(v * 10) / 10}`;
  return formatValue(v, v >= 10000 ? "compact" : "number");
}

function dateLabel(iso: string) {
  try {
    return formatDate(parseISO(iso), "MMM d");
  } catch {
    return iso;
  }
}

export function SlideChart(p: Props) {
  if (p.data.kind === "series") {
    return p.type === "bar" ? <SeriesBars {...p} data={p.data} /> : <SeriesLines {...p} data={p.data} filled={p.type === "area"} />;
  }
  if (p.type === "donut") return <Donut {...p} data={p.data} />;
  if (p.type === "bar") return <CategoryColumns {...p} data={p.data} />;
  return <CategoryRows {...p} data={p.data} />;
}

/* ─────────────── Series: line / area ─────────────── */

function SeriesLines(p: Props & { data: ChartSeriesData; filled: boolean }) {
  const { data, w, h, fontSize: fs } = p;
  const multi = data.series.length > 1;
  const legendH = multi && p.legend !== false ? fs * 2 : 0;
  const invert = data.format === "position";
  const all = data.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const rawMax = all.length ? Math.max(...all) : 1;
  const max = data.format === "percent" ? Math.min(100, niceMax(rawMax * 1.1)) || 100 : niceMax(rawMax * 1.1);
  const min = invert ? 1 : 0;
  const yTicks = 4;
  const labelW = fs * (data.format === "percent" ? 2.6 : 3.2);
  const left = labelW + fs * 0.6;
  const right = fs * 0.8;
  const top = legendH + fs * 0.6;
  const bottom = fs * 2.2;
  const iw = Math.max(10, w - left - right);
  const ih = Math.max(10, h - top - bottom);
  const n = data.x.length;
  const xAt = (i: number) => left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const yAt = (v: number) => {
    const t = (v - min) / Math.max(0.0001, max - min);
    return invert ? top + t * ih : top + ih - t * ih;
  };
  const colorFor = (i: number, isOwn?: boolean) =>
    i === 0 || isOwn ? p.palette.accent : p.palette.series[(i % (p.palette.series.length - 1)) + 1] ?? p.palette.neutral;
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / (fs * 5)))));
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block", overflow: "visible" }}>
      <defs>
        {data.series.map((s, i) => (
          <linearGradient key={s.key} id={`${p.id}-g${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colorFor(i, s.isOwn)} stopOpacity={0.38} />
            <stop offset="100%" stopColor={colorFor(i, s.isOwn)} stopOpacity={0} />
          </linearGradient>
        ))}
      </defs>
      {multi && p.legend !== false && (
        <g>
          {data.series.map((s, i) => {
            const x = left + i * Math.min(iw / data.series.length, fs * 12);
            return (
              <g key={s.key} transform={`translate(${x},${fs * 0.2})`}>
                <rect width={fs * 0.9} height={fs * 0.9} rx={fs * 0.2} fill={colorFor(i, s.isOwn)} y={fs * 0.1} />
                <text x={fs * 1.3} y={fs * 0.9} fontSize={fs * 0.95} fill={p.textColor} fontFamily={p.fontFamily} fontWeight={s.isOwn ? 700 : 500}>
                  {shortLabel(s.label, 18)}
                </text>
              </g>
            );
          })}
        </g>
      )}
      {Array.from({ length: yTicks + 1 }, (_, i) => {
        const v = min + ((max - min) * i) / yTicks;
        const y = yAt(v);
        return (
          <g key={i}>
            {p.grid !== false && <line x1={left} x2={left + iw} y1={y} y2={y} stroke={p.palette.grid} strokeWidth={Math.max(1, fs * 0.06)} strokeDasharray={i === 0 ? undefined : `${fs * 0.25} ${fs * 0.3}`} />}
            <text x={left - fs * 0.5} y={y + fs * 0.33} fontSize={fs * 0.85} textAnchor="end" fill={p.textColor} fontFamily={p.fontFamily} style={{ fontVariantNumeric: "tabular-nums" }}>
              {axisValue(v, data.format)}
            </text>
          </g>
        );
      })}
      {data.x.map((d, i) =>
        i % labelEvery === 0 || i === n - 1 ? (
          <text key={d + i} x={xAt(i)} y={top + ih + fs * 1.5} fontSize={fs * 0.85} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fill={p.textColor} fontFamily={p.fontFamily}>
            {dateLabel(d)}
          </text>
        ) : null,
      )}
      {[...data.series]
        .map((s, i) => ({ s, i }))
        .reverse()
        .map(({ s, i }) => {
          const pts = s.values.map((v, j) => [xAt(j), v === null ? null : yAt(v)] as const);
          const lineGen = d3line<readonly [number, number | null]>()
            .defined((d) => d[1] !== null)
            .x((d) => d[0])
            .y((d) => d[1] as number)
            .curve(curveMonotoneX);
          const areaGen = d3area<readonly [number, number | null]>()
            .defined((d) => d[1] !== null)
            .x((d) => d[0])
            .y0(invert ? top : top + ih)
            .y1((d) => d[1] as number)
            .curve(curveMonotoneX);
          const color = colorFor(i, s.isOwn);
          const sw = Math.max(2, fs * (i === 0 || s.isOwn ? 0.2 : 0.13));
          const last = [...pts].reverse().find((pt) => pt[1] !== null);
          return (
            <g key={s.key}>
              {p.filled && <path d={areaGen(pts) ?? ""} fill={`url(#${p.id}-g${i})`} />}
              <path d={lineGen(pts) ?? ""} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" opacity={i === 0 || s.isOwn ? 1 : 0.85} />
              {pts.length === 1 && pts[0]![1] !== null && <circle cx={pts[0]![0]} cy={pts[0]![1]!} r={sw * 1.6} fill={color} />}
              {last && (i === 0 || s.isOwn) && (
                <>
                  <circle cx={last[0]} cy={last[1]!} r={sw * 2.2} fill={p.palette.bg} stroke={color} strokeWidth={sw} />
                  {p.values !== false && (
                    <text x={last[0] - sw * 3} y={last[1]! - sw * 3.2} textAnchor="end" fontSize={fs * 1.05} fontWeight={700} fill={p.palette.text} fontFamily={p.fontFamily}>
                      {formatValue(s.values.filter((v) => v !== null).at(-1) ?? null, data.format)}
                    </text>
                  )}
                </>
              )}
            </g>
          );
        })}
    </svg>
  );
}

/* ─────────────── Series: bars ─────────────── */

function SeriesBars(p: Props & { data: ChartSeriesData }) {
  const { data, w, h, fontSize: fs } = p;
  const s = data.series[0];
  if (!s) return null;
  const vals = s.values.map((v) => v ?? 0);
  const max = data.format === "percent" ? Math.min(100, niceMax(Math.max(...vals, 1) * 1.1)) : niceMax(Math.max(...vals, 1) * 1.1);
  const left = fs * 3;
  const top = fs * 0.6;
  const bottom = fs * 2.2;
  const iw = Math.max(10, w - left - fs * 0.5);
  const ih = Math.max(10, h - top - bottom);
  const n = vals.length;
  const slot = iw / Math.max(1, n);
  const bw = Math.max(2, slot * 0.64);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / (fs * 5)))));
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      {[0, 0.5, 1].map((t) => {
        const y = top + ih - t * ih;
        return (
          <g key={t}>
            {p.grid !== false && <line x1={left} x2={left + iw} y1={y} y2={y} stroke={p.palette.grid} strokeWidth={Math.max(1, fs * 0.06)} />}
            <text x={left - fs * 0.5} y={y + fs * 0.33} fontSize={fs * 0.85} textAnchor="end" fill={p.textColor} fontFamily={p.fontFamily}>
              {axisValue(max * t, data.format)}
            </text>
          </g>
        );
      })}
      {vals.map((v, i) => {
        const bh = (v / max) * ih;
        const x = left + i * slot + (slot - bw) / 2;
        return (
          <g key={i}>
            <rect x={x} y={top + ih - bh} width={bw} height={Math.max(0, bh)} rx={Math.min(bw / 2, fs * 0.3)} fill={i === n - 1 ? p.palette.accent : mix(p.palette.accent, p.palette.bg, 0.45)} />
            {(i % labelEvery === 0 || i === n - 1) && (
              <text x={x + bw / 2} y={top + ih + fs * 1.5} fontSize={fs * 0.85} textAnchor="middle" fill={p.textColor} fontFamily={p.fontFamily}>
                {dateLabel(data.x[i] ?? "")}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ─────────────── Categories ─────────────── */

function catColor(p: Props, items: ChartCategoryData["items"], i: number): string {
  const hasOwn = p.highlightOwn !== false && items.some((it) => it.isOwn);
  if (hasOwn) return items[i]?.isOwn ? p.palette.accent : p.palette.neutral;
  return p.palette.accent;
}

function CategoryRows(p: Props & { data: ChartCategoryData }) {
  const { data, w, h, fontSize: fs } = p;
  const items = data.items;
  const max = Math.max(...items.map((i) => i.value), 0.0001);
  const rowH = Math.min(h / Math.max(1, items.length), fs * 3.4);
  const barH = Math.max(4, Math.min(rowH * 0.34, fs * 0.9));
  const valueW = fs * 4.2;
  const labelW = Math.min(w * 0.36, fs * 11);
  const trackX = labelW + fs * 0.8;
  const trackW = Math.max(10, w - trackX - valueW);
  const maxChars = Math.max(6, Math.floor(labelW / (fs * 0.56)));
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      {items.map((it, i) => {
        const y = i * rowH + rowH / 2;
        const bw = (it.value / max) * trackW;
        const color = catColor(p, items, i);
        return (
          <g key={it.label + i}>
            <text x={0} y={y + fs * 0.36} fontSize={fs} fill={it.isOwn ? p.palette.text : p.textColor} fontWeight={it.isOwn ? 700 : 500} fontFamily={p.fontFamily}>
              {shortLabel(it.label, maxChars)}
            </text>
            <rect x={trackX} y={y - barH / 2} width={trackW} height={barH} rx={barH / 2} fill={p.palette.grid} opacity={0.6} />
            <rect x={trackX} y={y - barH / 2} width={Math.max(barH, bw)} height={barH} rx={barH / 2} fill={color} />
            {p.values !== false && (
              <text x={w} y={y + fs * 0.36} fontSize={fs} textAnchor="end" fill={it.isOwn ? p.palette.text : p.textColor} fontWeight={700} fontFamily={p.fontFamily} style={{ fontVariantNumeric: "tabular-nums" }}>
                {formatValue(it.value, data.format)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function CategoryColumns(p: Props & { data: ChartCategoryData }) {
  const { data, w, h, fontSize: fs } = p;
  const items = data.items;
  const max = data.format === "percent" ? Math.min(100, niceMax(Math.max(...items.map((i) => i.value), 1) * 1.15)) : niceMax(Math.max(...items.map((i) => i.value), 1) * 1.15);
  const top = fs * 1.8;
  const bottom = fs * 2.4;
  const ih = Math.max(10, h - top - bottom);
  const slot = w / Math.max(1, items.length);
  const bw = Math.min(slot * 0.62, fs * 6);
  const maxChars = Math.max(4, Math.floor(slot / (fs * 0.55)));
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      {p.grid !== false && <line x1={0} x2={w} y1={top + ih} y2={top + ih} stroke={p.palette.grid} strokeWidth={Math.max(1, fs * 0.08)} />}
      {items.map((it, i) => {
        const bh = (it.value / max) * ih;
        const x = i * slot + (slot - bw) / 2;
        const color = catColor(p, items, i);
        return (
          <g key={it.label + i}>
            <rect x={x} y={top + ih - bh} width={bw} height={Math.max(0, bh)} rx={Math.min(bw / 4, fs * 0.5)} fill={color} />
            {p.values !== false && (
              <text x={x + bw / 2} y={top + ih - bh - fs * 0.5} fontSize={fs * 1.05} textAnchor="middle" fontWeight={700} fill={p.palette.text} fontFamily={p.fontFamily} style={{ fontVariantNumeric: "tabular-nums" }}>
                {formatValue(it.value, data.format)}
              </text>
            )}
            <text x={x + bw / 2} y={top + ih + fs * 1.5} fontSize={fs * 0.9} textAnchor="middle" fill={it.isOwn ? p.palette.text : p.textColor} fontWeight={it.isOwn ? 700 : 500} fontFamily={p.fontFamily}>
              {shortLabel(it.label, maxChars)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Donut(p: Props & { data: ChartCategoryData }) {
  const { data, w, h, fontSize: fs } = p;
  const items = data.items.filter((i) => i.value > 0);
  const total = items.reduce((s, i) => s + i.value, 0);
  const side = w > h * 1.25;
  const showLegend = p.legend !== false;
  const d = showLegend ? (side ? Math.min(h, w * 0.5) : Math.min(w, h * 0.62)) : Math.min(w, h);
  const r = d / 2;
  const cx = side || !showLegend ? r : w / 2;
  const cy = side || !showLegend ? h / 2 : r;
  const inner = r * 0.64;
  const pieGen = d3pie<{ label: string; value: number; isOwn?: boolean }>()
    .value((i) => i.value)
    .sort(null)
    .padAngle(items.length > 1 ? 0.012 : 0);
  const arcs = pieGen(items);
  const arcGen = d3arc<{ startAngle: number; endAngle: number; padAngle: number }>()
    .innerRadius(inner)
    .outerRadius(r)
    .cornerRadius(Math.min(r * 0.04, 8));
  const hasOwn = items.some((i) => i.isOwn);
  const colors = items.map((it, i) =>
    hasOwn && p.highlightOwn !== false
      ? it.isOwn
        ? p.palette.accent
        : p.palette.series[(i % (p.palette.series.length - 1)) + 1] ?? p.palette.neutral
      : p.palette.series[i % p.palette.series.length] ?? p.palette.accent,
  );
  const lead = hasOwn ? items.find((i) => i.isOwn) : items[0];
  const pct = (v: number) => (total ? Math.round((v / total) * 1000) / 10 : 0);
  const legendX = side ? d + fs * 1.4 : fs * 0.5;
  const legendY = side ? Math.max(0, h / 2 - (items.length * fs * 1.7) / 2) : d + fs * 1.2;
  const legendW = side ? w - legendX : w - fs;
  const maxChars = Math.max(6, Math.floor((legendW - fs * 5.5) / (fs * 0.55)));
  const cols = side ? 1 : items.length > 4 ? 2 : 1;
  const rowsPerCol = Math.ceil(items.length / cols);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <g transform={`translate(${cx},${cy})`}>
        {items.length === 0 ? (
          <circle r={(r + inner) / 2} fill="none" stroke={p.palette.grid} strokeWidth={r - inner} />
        ) : (
          arcs.map((a, i) => <path key={i} d={arcGen(a) ?? ""} fill={colors[i]} />)
        )}
        {lead && (
          <>
            <text textAnchor="middle" y={fs * 0.3} fontSize={Math.max(fs, inner * 0.42)} fontWeight={700} fill={p.palette.text} fontFamily={p.fontFamily} style={{ fontVariantNumeric: "tabular-nums" }}>
              {data.format === "percent" ? formatValue(lead.value, "percent") : `${pct(lead.value)}%`}
            </text>
            <text textAnchor="middle" y={fs * 0.3 + Math.max(fs, inner * 0.42) * 0.62} fontSize={Math.max(fs * 0.7, inner * 0.14)} fill={p.textColor} fontFamily={p.fontFamily}>
              {shortLabel(lead.label, 16)}
            </text>
          </>
        )}
      </g>
      {showLegend &&
        items.map((it, i) => {
          const col = Math.floor(i / rowsPerCol);
          const row = i % rowsPerCol;
          const x = legendX + col * (legendW / cols);
          const y = legendY + row * fs * 1.7;
          return (
            <g key={it.label + i} transform={`translate(${x},${y})`}>
              <rect width={fs * 0.8} height={fs * 0.8} rx={fs * 0.2} y={fs * 0.1} fill={colors[i]} />
              <text x={fs * 1.2} y={fs * 0.82} fontSize={fs * 0.95} fill={it.isOwn ? p.palette.text : p.textColor} fontWeight={it.isOwn ? 700 : 500} fontFamily={p.fontFamily}>
                {shortLabel(it.label, cols > 1 ? Math.floor(maxChars / 2) : maxChars)}
              </text>
              <text x={legendW / cols - fs * 0.6} y={fs * 0.82} textAnchor="end" fontSize={fs * 0.95} fontWeight={700} fill={p.palette.text} fontFamily={p.fontFamily} style={{ fontVariantNumeric: "tabular-nums" }}>
                {data.format === "percent" ? formatValue(it.value, "percent") : `${pct(it.value)}%`}
              </text>
            </g>
          );
        })}
    </svg>
  );
}

/** Tiny sparkline for KPI tiles. */
export function Sparkline({ values, w, h, color, id }: { values: (number | null)[]; w: number; h: number; color: string; id: string }) {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, v === null ? null : h - ((v - min) / span) * (h * 0.85) - h * 0.075] as const);
  const lineGen = d3line<readonly [number, number | null]>()
    .defined((d) => d[1] !== null)
    .x((d) => d[0])
    .y((d) => d[1] as number)
    .curve(curveMonotoneX);
  const areaGen = d3area<readonly [number, number | null]>()
    .defined((d) => d[1] !== null)
    .x((d) => d[0])
    .y0(h)
    .y1((d) => d[1] as number)
    .curve(curveMonotoneX);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={`${id}-sp`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaGen(pts) ?? ""} fill={`url(#${id}-sp)`} />
      <path d={lineGen(pts) ?? ""} fill="none" stroke={color} strokeWidth={Math.max(2, h * 0.05)} strokeLinecap="round" />
    </svg>
  );
}

/** Score ring (0–100). */
export function Ring({
  value,
  size,
  thickness,
  color,
  track,
}: {
  value: number | null;
  size: number;
  thickness: number;
  color: string;
  track: string;
}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const v = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={thickness} />
      {v > 0 && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`${(v / 100) * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
    </svg>
  );
}
