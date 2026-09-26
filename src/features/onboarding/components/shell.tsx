"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { CalendarClock, LogOut, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/app/logo";
import { DottedGlobe } from "@/components/app/dotted-globe";
import { logoutAction } from "@/features/shell/actions";
import { cn } from "@/lib/utils";
import type { Locale } from "../types";
import type { Translate } from "../i18n";

export function LocaleSwitch({
  locale,
  onChange,
  disabled,
}: {
  locale: Locale;
  onChange: (l: Locale) => void;
  disabled?: boolean;
}) {
  return (
    <div className="relative grid grid-cols-2 rounded-lg bg-muted p-0.5 text-xs font-medium" role="radiogroup" aria-label="Language">
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 40 }}
        className={cn(
          "absolute inset-y-0.5 w-[calc(50%-2px)] rounded-md bg-background shadow-xs",
          locale === "en" ? "left-0.5" : "left-[calc(50%)]",
        )}
      />
      {(["en", "de"] as const).map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={locale === l}
          disabled={disabled}
          onClick={() => onChange(l)}
          className={cn("relative z-10 px-2.5 py-1 uppercase", locale !== l && "text-muted-foreground")}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** Segmented progress bar — one segment per step. */
export function StepProgress({
  total,
  current,
  label,
  t,
  onJump,
  maxReachable,
}: {
  total: number;
  current: number;
  label: string;
  t: Translate;
  onJump?: (i: number) => void;
  maxReachable: number;
}) {
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5" aria-hidden>
        {Array.from({ length: total }).map((_, i) => {
          const reachable = onJump && i <= maxReachable && i !== current;
          return (
            <button
              key={i}
              type="button"
              tabIndex={-1}
              disabled={!reachable}
              onClick={() => reachable && onJump?.(i)}
              className={cn("h-1.5 flex-1 overflow-hidden rounded-full bg-muted", reachable && "cursor-pointer hover:bg-muted-foreground/25")}
            >
              <motion.span
                className="block h-full rounded-full bg-foreground"
                initial={false}
                animate={{ width: i < current ? "100%" : i === current ? "55%" : "0%" }}
                transition={{ type: "spring", stiffness: 200, damping: 30 }}
              />
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground tabular">
        {t("stepOf", { n: current + 1, total })} · <span className="font-medium text-foreground">{label}</span>
      </p>
    </div>
  );
}

/**
 * Full-screen split layout (finseo style). Uses container queries (`@container/onb`) so the
 * admin live preview renders the same breakpoints inside its device frame.
 */
export function OnboardingShell({
  appName,
  logoUrl,
  locale,
  onLocaleChange,
  t,
  preview,
  progress,
  footer,
  aside,
  tourHref,
  demoHref,
  children,
}: {
  appName: string;
  logoUrl: string;
  locale: Locale;
  onLocaleChange: (l: Locale) => void;
  t: Translate;
  preview?: boolean;
  progress?: React.ReactNode;
  footer?: React.ReactNode;
  aside?: React.ReactNode;
  tourHref?: string | null;
  demoHref?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("@container/onb relative bg-background text-foreground", preview ? "h-full" : "min-h-dvh")}>
      <div className={cn("grid @5xl/onb:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]", preview ? "h-full" : "min-h-dvh")}>
        <div className={cn("flex min-w-0 flex-col", preview && "h-full overflow-y-auto")}>
          <header className="flex items-center justify-between gap-3 px-5 pt-5 @2xl/onb:px-10 @2xl/onb:pt-7">
            {preview ? (
              <Logo name={appName} src={logoUrl || undefined} />
            ) : (
              <Link href="/" aria-label={appName}>
                <Logo name={appName} src={logoUrl || undefined} />
              </Link>
            )}
            <div className="flex items-center gap-1.5">
              <LocaleSwitch locale={locale} onChange={onLocaleChange} />
              {preview ? (
                <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground" tabIndex={-1}>
                  <LogOut className="size-3.5" />
                  <span className="hidden @md/onb:inline">{t("signOut")}</span>
                </Button>
              ) : (
                <form action={logoutAction}>
                  <Button type="submit" variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground">
                    <LogOut className="size-3.5" />
                    <span className="hidden @md/onb:inline">{t("signOut")}</span>
                  </Button>
                </form>
              )}
            </div>
          </header>

          {progress && <div className="mx-auto w-full max-w-[560px] px-5 pt-7 @2xl/onb:px-0 @2xl/onb:pt-12">{progress}</div>}

          <main className="flex flex-1 justify-center px-5 pt-6 pb-8 @2xl/onb:px-10 @2xl/onb:pt-8">
            <div className="w-full max-w-[560px]">{children}</div>
          </main>

          {footer && (
            <div className="sticky bottom-0 z-20 border-t bg-background/90 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl @2xl/onb:static @2xl/onb:border-0 @2xl/onb:bg-transparent @2xl/onb:px-10 @2xl/onb:pt-0 @2xl/onb:pb-10 @2xl/onb:backdrop-blur-none">
              <div className="mx-auto w-full max-w-[560px]">{footer}</div>
            </div>
          )}
        </div>

        <aside className="relative hidden overflow-hidden border-l bg-[oklch(0.965_0.004_95)] @5xl/onb:block dark:bg-[oklch(0.17_0.004_95)]">
          <div className="bg-dots absolute inset-0 opacity-60" />
          <div className={cn("absolute top-6 right-6 z-10 flex items-center gap-2", preview && "pointer-events-none")}>
            {tourHref && (
              <Button asChild variant="outline" size="sm" className="h-9 gap-1.5 rounded-full bg-background/80 px-4 shadow-soft backdrop-blur">
                <Link href={tourHref}>
                  <Play className="size-3 fill-current" /> {t("productTour")}
                </Link>
              </Button>
            )}
            {demoHref && (
              <Button asChild size="sm" className="h-9 gap-1.5 rounded-full px-4 shadow-soft">
                <a href={demoHref} target="_blank" rel="noreferrer">
                  <CalendarClock className="size-3.5" /> {t("bookDemo")}
                </a>
              </Button>
            )}
          </div>
          <div className="absolute inset-x-0 top-[10%] mx-auto aspect-square w-[86%] max-w-[680px]">
            <DottedGlobe />
          </div>
          <div className="absolute inset-x-8 bottom-8 z-10">{aside}</div>
        </aside>
      </div>
    </div>
  );
}
