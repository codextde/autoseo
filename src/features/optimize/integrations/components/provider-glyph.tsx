import { Webhook } from "lucide-react";
import { cn } from "@/lib/utils";

/** Original, brand-neutral provider marks (color + short monogram) — no third-party logo assets. */
const GLYPHS: Record<string, { bg: string; mark: string; fg?: string }> = {
  linear: { bg: "#5e6ad2", mark: "Li" },
  jira: { bg: "#0052cc", mark: "Ji" },
  asana: { bg: "#f06a6a", mark: "As" },
  clickup: { bg: "#7b68ee", mark: "Cu" },
  trello: { bg: "#0079bf", mark: "Tr" },
  monday: { bg: "#ff3d57", mark: "mo" },
  notion: { bg: "#191919", mark: "N" },
  awork: { bg: "#2e3bff", mark: "aw" },
  webhook: { bg: "#27272a", mark: "" },
  wordpress: { bg: "#21759b", mark: "W" },
  webflow: { bg: "#146ef5", mark: "Wf" },
  shopify_cms: { bg: "#5e8e3e", mark: "S" },
  framer: { bg: "#0055ff", mark: "Fr" },
};

export function ProviderGlyph({
  provider,
  size = "sm",
  className,
}: {
  provider: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const g = GLYPHS[provider] ?? { bg: "#71717a", mark: provider.slice(0, 2) };
  const dim = {
    xs: "size-4 rounded-[4px] text-[7px]",
    sm: "size-5 rounded-md text-[8.5px]",
    md: "size-8 rounded-lg text-[11px]",
    lg: "size-10 rounded-xl text-[13px]",
  }[size];
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-semibold tracking-tight text-white shadow-xs ring-1 ring-black/5 select-none",
        dim,
        className,
      )}
      style={{ background: g.bg, color: g.fg }}
    >
      {provider === "webhook" ? <Webhook className="size-[60%]" /> : g.mark}
    </span>
  );
}

/** Overlapping mini glyphs (e.g. on the "Connect PM Tool" button). */
export function ProviderGlyphStack({ providers, className }: { providers: string[]; className?: string }) {
  return (
    <span className={cn("inline-flex items-center -space-x-1", className)}>
      {providers.map((p) => (
        <ProviderGlyph key={p} provider={p} size="xs" className="ring-2 ring-background" />
      ))}
    </span>
  );
}
