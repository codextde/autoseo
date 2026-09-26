import type { Color, Theme, ThemeColorKey } from "./types";

/** Brand kit as edited in the Brand kit dialog (workspace = agency, project = client). */
export type BrandKit = {
  agencyName?: string;
  agencyWebsite?: string;
  agencyEmail?: string;
  agencyLogo?: string;
  clientName?: string;
  clientLogo?: string;
  clientColor?: string;
  mode?: "dark" | "light";
  accentColor?: string;
  secondaryColor?: string;
  backgroundColor?: string;
  textColor?: string;
  headingFont?: string;
  bodyFont?: string;
};

/** The default "pitch" look: near-black green canvas, mint accent (finseo-like). */
export const PITCH_THEME: Theme = {
  name: "Pitch dark",
  mode: "dark",
  colors: {
    bg: "#07100B",
    surface: "#0F1A14",
    surface2: "#1A2A21",
    text: "#F4F7F5",
    muted: "#8FA398",
    accent: "#3DDC84",
    accent2: "#A3F7C4",
    border: "#22352A",
    positive: "#3DDC84",
    negative: "#FF6B6B",
  },
  chart: ["#3DDC84", "#7CC4FF", "#F5B454", "#C792EA", "#FF8A80", "#5EEAD4", "#FDE68A", "#94A3B8"],
  fonts: { heading: "Geist", body: "Geist" },
};

export const LIGHT_THEME: Theme = {
  name: "Clean light",
  mode: "light",
  colors: {
    bg: "#FAFAF7",
    surface: "#FFFFFF",
    surface2: "#EEF1EC",
    text: "#101512",
    muted: "#66706A",
    accent: "#16A34A",
    accent2: "#0F7A37",
    border: "#E3E7E2",
    positive: "#16A34A",
    negative: "#DC2626",
  },
  chart: ["#16A34A", "#2563EB", "#F59E0B", "#9333EA", "#EF4444", "#0D9488", "#CA8A04", "#64748B"],
  fonts: { heading: "Geist", body: "Geist" },
};

export const THEME_PRESETS: Theme[] = [
  PITCH_THEME,
  LIGHT_THEME,
  {
    name: "Midnight blue",
    mode: "dark",
    colors: {
      bg: "#070B16",
      surface: "#0F1628",
      surface2: "#1A2440",
      text: "#F3F6FF",
      muted: "#8D99B8",
      accent: "#6EA8FF",
      accent2: "#B8D3FF",
      border: "#212C47",
      positive: "#4ADE80",
      negative: "#FB7185",
    },
    chart: ["#6EA8FF", "#4ADE80", "#FBBF24", "#C084FC", "#FB7185", "#2DD4BF", "#FDE68A", "#94A3B8"],
    fonts: { heading: "Geist", body: "Geist" },
  },
  {
    name: "Warm paper",
    mode: "light",
    colors: {
      bg: "#F6F1E7",
      surface: "#FFFDF8",
      surface2: "#ECE4D3",
      text: "#1F1A14",
      muted: "#7A6F60",
      accent: "#D9480F",
      accent2: "#9C3408",
      border: "#E2D8C5",
      positive: "#2F9E44",
      negative: "#C92A2A",
    },
    chart: ["#D9480F", "#1971C2", "#2F9E44", "#AE3EC9", "#F59F00", "#0C8599", "#E64980", "#868E96"],
    fonts: { heading: "Georgia", body: "Geist" },
  },
];

export const FONT_OPTIONS: { value: string; label: string; stack: string; google?: string }[] = [
  { value: "Geist", label: "Geist", stack: "var(--font-sans), 'Geist', ui-sans-serif, system-ui, sans-serif" },
  { value: "System", label: "System UI", stack: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  { value: "Inter", label: "Inter", stack: "'Inter', ui-sans-serif, system-ui, sans-serif", google: "Inter:wght@400;500;600;700;800" },
  { value: "Manrope", label: "Manrope", stack: "'Manrope', ui-sans-serif, system-ui, sans-serif", google: "Manrope:wght@400;500;600;700;800" },
  { value: "DM Sans", label: "DM Sans", stack: "'DM Sans', ui-sans-serif, system-ui, sans-serif", google: "DM+Sans:wght@400;500;600;700;800" },
  { value: "Space Grotesk", label: "Space Grotesk", stack: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif", google: "Space+Grotesk:wght@400;500;600;700" },
  { value: "Plus Jakarta Sans", label: "Plus Jakarta Sans", stack: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif", google: "Plus+Jakarta+Sans:wght@400;500;600;700;800" },
  { value: "Poppins", label: "Poppins", stack: "'Poppins', ui-sans-serif, system-ui, sans-serif", google: "Poppins:wght@400;500;600;700;800" },
  { value: "Montserrat", label: "Montserrat", stack: "'Montserrat', ui-sans-serif, system-ui, sans-serif", google: "Montserrat:wght@400;500;600;700;800" },
  { value: "IBM Plex Sans", label: "IBM Plex Sans", stack: "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif", google: "IBM+Plex+Sans:wght@400;500;600;700" },
  { value: "Playfair Display", label: "Playfair Display", stack: "'Playfair Display', Georgia, serif", google: "Playfair+Display:wght@400;600;700;800" },
  { value: "Georgia", label: "Georgia (serif)", stack: "Georgia, 'Times New Roman', serif" },
  { value: "Mono", label: "Monospace", stack: "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace" },
];

/** CSS font stack for a font key ("heading" | "body" | "mono" | concrete family). */
export function fontStack(font: string | undefined, theme: Theme): string {
  let family = font ?? "body";
  if (family === "heading") family = theme.fonts.heading;
  else if (family === "body") family = theme.fonts.body;
  else if (family === "mono") family = "Mono";
  const opt = FONT_OPTIONS.find((f) => f.value === family);
  if (opt) return opt.stack;
  return `'${family.replace(/'/g, "")}', ui-sans-serif, system-ui, sans-serif`;
}

/** Plain family name (for PPTX export). */
export function fontFamilyName(font: string | undefined, theme: Theme): string {
  let family = font ?? "body";
  if (family === "heading") family = theme.fonts.heading;
  else if (family === "body") family = theme.fonts.body;
  else if (family === "mono") return "Consolas";
  if (family === "Geist" || family === "System") return "Arial";
  if (family === "Mono") return "Consolas";
  return family;
}

/** Google font families used by a theme (loaded on demand in the browser). */
export function googleFontsFor(theme: Theme): string[] {
  const out = new Set<string>();
  for (const f of [theme.fonts.heading, theme.fonts.body]) {
    const opt = FONT_OPTIONS.find((o) => o.value === f);
    if (opt?.google) out.add(opt.google);
  }
  return [...out];
}

export function googleFontsHref(theme: Theme): string | null {
  const families = googleFontsFor(theme);
  if (!families.length) return null;
  return `https://fonts.googleapis.com/css2?${families.map((f) => `family=${f}`).join("&")}&display=swap`;
}

/** Resolves a color reference against the theme. */
export function resolveColor(color: Color | undefined | null, theme: Theme, fallback = "transparent"): string {
  if (!color) return fallback;
  if (color.startsWith("$")) {
    const key = color.slice(1);
    if (key.startsWith("chart")) {
      const idx = Number(key.slice(5)) || 0;
      return theme.chart[idx % theme.chart.length] ?? fallback;
    }
    return (theme.colors as Record<string, string>)[key] ?? fallback;
  }
  return color;
}

export const THEME_COLOR_LABELS: Record<ThemeColorKey, string> = {
  bg: "Background",
  surface: "Surface",
  surface2: "Surface 2",
  text: "Text",
  muted: "Muted text",
  accent: "Accent",
  accent2: "Accent 2",
  border: "Border",
  positive: "Positive",
  negative: "Negative",
};

function clampByte(n: number) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => clampByte(v).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** Mixes two hex colors (t = 0 → a, 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const isHex = (v: string | undefined): v is string => !!v && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v);

/** Builds a deck theme from the workspace + client brand kit. */
export function themeFromBrandKit(kit: BrandKit, base?: Theme): Theme {
  const mode = kit.mode ?? base?.mode ?? "dark";
  const start = base ?? (mode === "light" ? LIGHT_THEME : PITCH_THEME);
  const theme: Theme = JSON.parse(JSON.stringify(start));
  theme.mode = mode;
  if (mode !== start.mode) {
    const other = mode === "light" ? LIGHT_THEME : PITCH_THEME;
    theme.colors = { ...other.colors };
    theme.chart = [...other.chart];
  }
  const accent = isHex(kit.accentColor) ? kit.accentColor.toUpperCase() : null;
  if (accent) {
    theme.colors.accent = accent;
    theme.colors.positive = accent;
    theme.colors.accent2 = mode === "dark" ? mix(accent, "#FFFFFF", 0.55) : mix(accent, "#000000", 0.3);
    theme.chart = [accent, ...theme.chart.filter((c) => c.toUpperCase() !== accent).slice(0, 7)];
  }
  if (isHex(kit.secondaryColor)) {
    theme.colors.accent2 = kit.secondaryColor.toUpperCase();
    theme.chart = [theme.chart[0]!, kit.secondaryColor.toUpperCase(), ...theme.chart.slice(1, 7)];
  }
  if (isHex(kit.backgroundColor)) {
    const bg = kit.backgroundColor.toUpperCase();
    const dark = luminance(bg) < 0.3;
    theme.colors.bg = bg;
    theme.colors.surface = mix(bg, dark ? "#FFFFFF" : "#000000", dark ? 0.05 : 0.02);
    theme.colors.surface2 = mix(bg, dark ? "#FFFFFF" : "#000000", dark ? 0.1 : 0.06);
    theme.colors.border = mix(bg, dark ? "#FFFFFF" : "#000000", dark ? 0.12 : 0.1);
  }
  if (isHex(kit.textColor)) {
    theme.colors.text = kit.textColor.toUpperCase();
    theme.colors.muted = mix(kit.textColor, theme.colors.bg, 0.42);
  }
  if (kit.headingFont) theme.fonts.heading = kit.headingFont;
  if (kit.bodyFont) theme.fonts.body = kit.bodyFont;
  return theme;
}

/** Colors shown as "Branding" dots in the reports list. */
export function brandDots(theme: Theme): string[] {
  return [theme.colors.bg, theme.colors.accent, theme.colors.text, theme.colors.accent2];
}
