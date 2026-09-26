"use client";

import { BarChart3, House, Mail, Radar, Sparkles } from "lucide-react";
import { LogoMark } from "@/components/app/logo";
import { cn } from "@/lib/utils";

/** Readable text color (black/white) for a hex background. */
export function contrastText(hex: string): string {
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return "#ffffff";
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#111111" : "#ffffff";
}

function Logo({ src, className }: { src: string; className?: string }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className={cn("size-6 rounded-md object-contain", className)} />;
  }
  return <LogoMark className={cn("size-6", className)} />;
}

/** Live preview of the instance branding: app shell, sign-in card and email button. */
export function BrandingPreview({
  appName,
  tagline,
  logoUrl,
  primaryColor,
  accentColor,
}: {
  appName: string;
  tagline: string;
  logoUrl: string;
  primaryColor: string;
  accentColor: string;
}) {
  const primaryText = contrastText(primaryColor);
  const name = appName || "AutoSEO";
  const nav = [
    { icon: House, label: "Home" },
    { icon: Sparkles, label: "AI Visibility", active: true },
    { icon: Radar, label: "Rank Tracking" },
    { icon: BarChart3, label: "Analytics" },
  ];
  return (
    <div className="space-y-3">
      {/* App shell */}
      <div className="overflow-hidden rounded-xl border bg-background shadow-soft">
        <div className="flex h-44">
          <div className="flex w-[44%] flex-col gap-1 border-r bg-sidebar p-2.5">
            <div className="mb-1.5 flex min-w-0 items-center gap-1.5 px-1">
              <Logo src={logoUrl} className="size-5" />
              <span className="truncate text-xs font-semibold">{name}</span>
            </div>
            {nav.map((n) => (
              <div
                key={n.label}
                className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px]"
                style={n.active ? { background: `color-mix(in oklch, ${accentColor} 14%, transparent)`, color: accentColor } : undefined}
              >
                <n.icon className="size-3 shrink-0" />
                <span className={cn("truncate", !n.active && "text-muted-foreground")}>{n.label}</span>
              </div>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
            <div className="h-2 w-2/3 rounded-full bg-muted" />
            <div className="flex items-end gap-1 pt-2">
              {[40, 65, 50, 80, 62, 90, 74].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-sm"
                  style={{ height: `${h * 0.55}px`, background: i === 5 ? accentColor : `color-mix(in oklch, ${accentColor} 30%, transparent)` }}
                />
              ))}
            </div>
            <div
              className="mt-auto inline-flex h-6 w-fit items-center rounded-md px-2.5 text-[10px] font-medium"
              style={{ background: primaryColor, color: primaryText }}
            >
              Open Tasks
            </div>
          </div>
        </div>
      </div>

      {/* Sign-in card */}
      <div className="rounded-xl border bg-card p-4 shadow-soft">
        <div className="flex items-center gap-2">
          <Logo src={logoUrl} />
          <span className="truncate text-sm font-semibold">{name}</span>
        </div>
        <div className="mt-3 text-base font-semibold tracking-tight">Welcome back</div>
        <p className="line-clamp-2 text-xs text-muted-foreground">{tagline || "Sign in with a magic link."}</p>
        <div className="mt-3 h-7 rounded-md border bg-background px-2 text-[11px] leading-7 text-muted-foreground">you@company.com</div>
        <div
          className="mt-2 flex h-7 items-center justify-center rounded-md text-[11px] font-medium"
          style={{ background: primaryColor, color: primaryText }}
        >
          Continue with email
        </div>
      </div>

      {/* Email */}
      <div className="rounded-xl border bg-[#f5f4f0] p-3 text-[#141414]">
        <div className="rounded-lg border border-[#e7e5df] bg-white p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-bold">
            <Mail className="size-3" /> {name}
          </div>
          <div className="mt-1.5 text-xs font-semibold">Sign in to {name}</div>
          <div
            className="mt-2 inline-flex h-6 items-center rounded-md px-2.5 text-[10px] font-semibold"
            style={{ background: primaryColor, color: "#ffffff" }}
          >
            Sign in
          </div>
        </div>
      </div>
    </div>
  );
}
