"use client";

import { useMemo, useState } from "react";
import { geoEqualEarth, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import countriesTopo from "world-atlas/countries-110m.json";
import { cn } from "@/lib/utils";
import { fmt, type ValueFormat } from "./charts";

// ISO 3166-1 numeric → alpha-2 for the countries we care about (world-atlas uses numeric ids).
const NUMERIC_TO_ALPHA2: Record<string, string> = {
  "004": "AF", "008": "AL", "012": "DZ", "024": "AO", "032": "AR", "036": "AU", "040": "AT", "031": "AZ", "048": "BH",
  "050": "BD", "056": "BE", "068": "BO", "070": "BA", "076": "BR", "100": "BG", "854": "BF", "116": "KH", "120": "CM",
  "124": "CA", "152": "CL", "156": "CN", "170": "CO", "188": "CR", "384": "CI", "191": "HR", "196": "CY", "203": "CZ",
  "208": "DK", "218": "EC", "818": "EG", "222": "SV", "233": "EE", "246": "FI", "250": "FR", "276": "DE", "288": "GH",
  "300": "GR", "320": "GT", "344": "HK", "348": "HU", "356": "IN", "360": "ID", "372": "IE", "376": "IL", "380": "IT",
  "392": "JP", "400": "JO", "398": "KZ", "404": "KE", "428": "LV", "440": "LT", "458": "MY", "470": "MT", "484": "MX",
  "498": "MD", "492": "MC", "504": "MA", "104": "MM", "528": "NL", "554": "NZ", "558": "NI", "566": "NG", "807": "MK",
  "578": "NO", "586": "PK", "591": "PA", "600": "PY", "604": "PE", "608": "PH", "616": "PL", "620": "PT", "642": "RO",
  "643": "RU", "682": "SA", "686": "SN", "688": "RS", "702": "SG", "703": "SK", "705": "SI", "710": "ZA", "410": "KR",
  "724": "ES", "144": "LK", "752": "SE", "756": "CH", "158": "TW", "764": "TH", "788": "TN", "792": "TR", "804": "UA",
  "784": "AE", "826": "GB", "840": "US", "858": "UY", "862": "VE", "704": "VN", "352": "IS", "442": "LU", "364": "IR",
  "368": "IQ", "414": "KW", "634": "QA", "512": "OM", "422": "LB", "268": "GE", "051": "AM", "112": "BY", "496": "MN",
  "524": "NP", "231": "ET", "834": "TZ", "800": "UG", "894": "ZM", "716": "ZW", "508": "MZ", "450": "MG", "516": "NA",
  "072": "BW", "192": "CU", "214": "DO", "332": "HT", "340": "HN", "388": "JM", "780": "TT", "328": "GY", "740": "SR",
  "499": "ME", "008A": "AL", "418": "LA", "096": "BN", "598": "PG", "242": "FJ", "417": "KG", "762": "TJ", "795": "TM",
  "860": "UZ", "646": "RW", "180": "CD", "178": "CG", "434": "LY", "729": "SD", "728": "SS", "706": "SO", "232": "ER",
  "262": "DJ", "466": "ML", "478": "MR", "562": "NE", "148": "TD", "140": "CF", "266": "GA", "226": "GQ", "324": "GN",
  "694": "SL", "430": "LR", "624": "GW", "270": "GM", "204": "BJ", "768": "TG", "454": "MW", "426": "LS", "748": "SZ",
  "408": "KP", "760": "SY", "887": "YE", "304": "GL", "010": "AQ", "090": "SB", "548": "VU", "540": "NC", "626": "TL",
  "275": "PS", "760A": "SY",
};

type Geo = FeatureCollection<Geometry, { name: string }>;

export function WorldMap({
  values,
  format = "number",
  className,
  height = 360,
  onSelect,
  selected,
  label = "Value",
}: {
  /** Keyed by ISO alpha-2 ("UK" accepted). */
  values: Record<string, number>;
  format?: ValueFormat;
  className?: string;
  height?: number;
  onSelect?: (iso: string) => void;
  selected?: string | null;
  label?: string;
}) {
  const [hover, setHover] = useState<{ iso: string; name: string; x: number; y: number } | null>(null);
  const width = 960;
  const mapH = 500;
  const { paths } = useMemo(() => {
    const topo = countriesTopo as unknown as Parameters<typeof feature>[0];
    const geo = feature(topo, (topo as unknown as { objects: { countries: never } }).objects.countries) as unknown as Geo;
    const projection = geoEqualEarth().fitSize([width, mapH], geo);
    const path = geoPath(projection);
    return {
      paths: geo.features
        .filter((f) => f.properties.name !== "Antarctica")
        .map((f) => ({
          id: String(f.id ?? ""),
          iso: NUMERIC_TO_ALPHA2[String(f.id ?? "")] ?? "",
          name: f.properties.name,
          d: path(f) ?? "",
        })),
    };
  }, []);

  const norm: Record<string, number> = {};
  for (const [k, v] of Object.entries(values)) norm[k.toUpperCase() === "UK" ? "GB" : k.toUpperCase()] = v;
  const max = Math.max(1, ...Object.values(norm));

  return (
    <div className={cn("relative w-full", className)} style={{ height }}>
      <svg viewBox={`0 0 ${width} ${mapH}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
        {paths.map((p) => {
          const v = norm[p.iso];
          const t = v ? Math.sqrt(v / max) : 0;
          const isSel = selected && (selected.toUpperCase() === p.iso || (selected.toUpperCase() === "UK" && p.iso === "GB"));
          return (
            <path
              key={p.id + p.name}
              d={p.d}
              onMouseMove={(e) => {
                const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                setHover({ iso: p.iso, name: p.name, x: e.clientX - rect.left, y: e.clientY - rect.top });
              }}
              onMouseLeave={() => setHover(null)}
              onClick={() => p.iso && onSelect?.(p.iso === "GB" ? "UK" : p.iso)}
              className={cn("stroke-background transition-[fill] duration-200", onSelect && v ? "cursor-pointer" : "")}
              strokeWidth={0.6}
              style={{
                fill: v
                  ? `color-mix(in oklch, var(--brand) ${Math.round(18 + t * 72)}%, var(--muted))`
                  : "var(--muted)",
                stroke: isSel ? "var(--foreground)" : undefined,
                strokeWidth: isSel ? 1.6 : undefined,
              }}
            />
          );
        })}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border bg-popover px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: Math.min(hover.x + 12, 9999), top: hover.y + 12 }}
        >
          <div className="font-medium">{hover.name}</div>
          <div className="text-muted-foreground">
            {label}: {fmt(norm[hover.iso] ?? 0, format)}
          </div>
        </div>
      )}
    </div>
  );
}
