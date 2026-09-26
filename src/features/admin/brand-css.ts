/**
 * Builds CSS custom-property overrides for the instance branding colors (Admin → Branding).
 * Returns null when the defaults are in use so the built-in theme stays untouched.
 */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const DEFAULT_PRIMARY = "#0f0f0f";
const DEFAULT_ACCENT = "#16a34a";

function expand(hex: string) {
  const h = hex.slice(1);
  return h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
}

/** Relative luminance (WCAG) of a hex color. */
function luminance(hex: string) {
  const h = expand(hex);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function brandCss(colors: { primaryColor: string; accentColor: string }): string | null {
  const primary = HEX.test(colors.primaryColor) ? colors.primaryColor.toLowerCase() : DEFAULT_PRIMARY;
  const accent = HEX.test(colors.accentColor) ? colors.accentColor.toLowerCase() : DEFAULT_ACCENT;
  const rules: string[] = [];
  const dark: string[] = [];
  if (accent !== DEFAULT_ACCENT) {
    const onAccent = luminance(accent) > 0.45 ? "#0f0f0f" : "#ffffff";
    rules.push(
      `--brand:${accent}`,
      `--brand-foreground:${onAccent}`,
      `--brand-soft:color-mix(in oklch, ${accent} 14%, white)`,
      `--ring:color-mix(in oklch, ${accent} 70%, white)`,
      `--sidebar-ring:color-mix(in oklch, ${accent} 70%, white)`,
      `--chart-2:${accent}`,
    );
    dark.push(
      `--brand:color-mix(in oklch, ${accent} 82%, white)`,
      `--brand-soft:color-mix(in oklch, ${accent} 30%, black)`,
      `--sidebar-primary:color-mix(in oklch, ${accent} 82%, white)`,
    );
  }
  if (primary !== DEFAULT_PRIMARY) {
    const onPrimary = luminance(primary) > 0.45 ? "#0f0f0f" : "#ffffff";
    rules.push(`--primary:${primary}`, `--primary-foreground:${onPrimary}`, `--sidebar-primary:${primary}`, `--sidebar-primary-foreground:${onPrimary}`);
  }
  if (!rules.length) return null;
  // `html:root` / `html.dark` outrank the theme's `:root` / `.dark` regardless of stylesheet order.
  return `html:root{${rules.join(";")}}${dark.length ? `html.dark{${dark.join(";")}}` : ""}`;
}
