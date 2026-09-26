"use client";

import { ClipboardList, Code2, MousePointerClick, Sparkles, Upload, Webhook } from "lucide-react";
import { EngineIcon } from "@/components/app/engine-icon";
import { cn } from "@/lib/utils";
import { AI_DETAILS, CHANNELS } from "@/server/attribution/channels";
import { getProvider } from "@/server/attribution/providers";
import type { AiDetailId, ChannelId } from "@/server/attribution/types";

export const PROVIDER_LABELS: Record<string, string> = {
  website_widget: "Website Widget",
  form_detect: "Website Form",
  api: "API",
  import: "CSV import",
  custom_webhook: "Webhook",
  custom: "Webhook",
  manual: "Manual",
};

export function providerName(provider: string): string {
  return PROVIDER_LABELS[provider] ?? getProvider(provider)?.name ?? provider.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

/** Original, logo-free source tile: lucide icon for built-in sources, colored initial for providers. */
export function SourceIcon({ provider, className, size = "sm" }: { provider: string; className?: string; size?: "sm" | "md" | "lg" }) {
  const dim = { sm: "size-6 rounded-md text-[11px]", md: "size-8 rounded-lg text-xs", lg: "size-10 rounded-xl text-sm" }[size];
  const icon = { sm: "size-3.5", md: "size-4", lg: "size-5" }[size];
  const builtin: Record<string, React.ComponentType<{ className?: string }>> = {
    website_widget: MousePointerClick,
    form_detect: ClipboardList,
    api: Code2,
    import: Upload,
    custom_webhook: Webhook,
    custom: Webhook,
  };
  const Icon = builtin[provider];
  if (Icon) {
    return (
      <span className={cn("inline-flex shrink-0 items-center justify-center border bg-background text-muted-foreground shadow-xs", dim, className)}>
        <Icon className={icon} />
      </span>
    );
  }
  const info = getProvider(provider);
  const name = info?.name ?? provider;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center font-semibold text-white shadow-xs", dim, className)}
      style={{ background: info?.color ?? "#6b7280" }}
      aria-hidden
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

const CHANNEL_DOT: Record<string, string> = {
  ai_search: "var(--brand)",
  search: "var(--chart-3)",
  social: "var(--chart-4)",
  ads: "var(--chart-1)",
  referral: "var(--chart-7)",
  content: "var(--chart-6)",
  other: "var(--chart-8)",
};

export function channelColor(channel: string) {
  return CHANNEL_DOT[channel] ?? "var(--chart-8)";
}

export function ChannelBadge({ channel, detail, className }: { channel: string; detail?: string | null; className?: string }) {
  const label = CHANNELS[channel as ChannelId]?.label ?? channel;
  if (channel === "ai_search") {
    const d = detail ? AI_DETAILS[detail as AiDetailId] : null;
    return (
      <span
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand ring-1 ring-brand/20 ring-inset",
          className,
        )}
      >
        {d?.engine ? <EngineIcon id={d.engine} size="xs" withTooltip={false} /> : <Sparkles className="size-3" />}
        <span className="truncate">{d ? `${label} · ${d.label}` : label}</span>
      </span>
    );
  }
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs text-foreground/80 ring-1 ring-border ring-inset", className)}>
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: channelColor(channel) }} />
      <span className="truncate">{label}</span>
    </span>
  );
}

export function money(value: number | null | undefined, currency: string | null | undefined, digits = 0) {
  if (value == null || Number.isNaN(value)) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "EUR", maximumFractionDigits: digits }).format(value);
  } catch {
    return `${value.toLocaleString("en-US", { maximumFractionDigits: digits })} ${currency ?? ""}`.trim();
  }
}

export function shortDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export function contactLabel(c: { emailMask: string | null; emailHash: string | null; externalId: string | null }) {
  if (c.emailMask) return c.emailMask;
  if (c.emailHash) return `#${c.emailHash.slice(0, 10)}`;
  if (c.externalId) return c.externalId;
  return null;
}
