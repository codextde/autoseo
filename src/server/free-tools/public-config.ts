import "server-only";
import { getSetting } from "@/server/settings";

export type PublicFreeToolsConfig = {
  enabled: boolean;
  /** Cloudflare Turnstile site key ("" = widget disabled). The secret never leaves the server. */
  turnstileSiteKey: string;
  cta: { href: string; label: string };
};

/** Only same-site paths or http(s) URLs are allowed as CTA targets (no `javascript:` etc.). */
function safeCtaUrl(raw: string): string {
  const v = raw.trim();
  if (v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\")) return v;
  try {
    const u = new URL(v);
    if (u.protocol === "https:" || u.protocol === "http:") return u.toString();
  } catch {
    // fall through
  }
  return "/login";
}

/** Client-safe config of the public /free-tools pages (Admin → Free SEO tools). */
export async function getPublicFreeToolsConfig(): Promise<PublicFreeToolsConfig> {
  const s = await getSetting("freeTools");
  return {
    enabled: s.publicEnabled,
    turnstileSiteKey: s.turnstileSiteKey.trim(),
    cta: { href: s.ctaUrl ? safeCtaUrl(s.ctaUrl) : "/login", label: s.ctaLabel.trim() || "Sign in" },
  };
}
