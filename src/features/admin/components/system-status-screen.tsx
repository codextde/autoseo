"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/app/logo";
import { cn } from "@/lib/utils";

/**
 * Branded full-screen (or in-shell) status page used by not-found, forbidden and error
 * boundaries. Pure client component so it also works inside error boundaries.
 */
export function StatusScreen({
  code,
  icon,
  title,
  description,
  actions,
  footer,
  brand,
  inline,
  tone = "neutral",
}: {
  code?: string;
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  /** Shows the logo header (full-screen variant only). */
  brand?: { appName: string; logoUrl?: string };
  /** Render inside the app shell instead of full screen. */
  inline?: boolean;
  tone?: "neutral" | "warning" | "destructive";
}) {
  const ring = {
    neutral: "bg-muted text-muted-foreground ring-border",
    warning: "bg-warning/12 text-warning ring-warning/25",
    destructive: "bg-destructive/10 text-destructive ring-destructive/20",
  }[tone];
  const body = (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="relative w-full max-w-md text-center"
    >
      {code && (
        <div
          aria-hidden
          className="pointer-events-none mb-2 bg-gradient-to-b from-foreground/80 to-foreground/5 bg-clip-text text-[92px] leading-none font-semibold tracking-tighter text-transparent tabular select-none sm:text-[120px]"
        >
          {code}
        </div>
      )}
      {icon && (
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.08, type: "spring", stiffness: 380, damping: 24 }}
          className={cn("mx-auto mb-5 flex size-12 items-center justify-center rounded-2xl ring-1 ring-inset", ring, code && "-mt-8 shadow-soft")}
        >
          {icon}
        </motion.div>
      )}
      <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{title}</h1>
      {description && <div className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-balance text-muted-foreground sm:text-base">{description}</div>}
      {actions && <div className="mt-8 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">{actions}</div>}
      {footer && <div className="mt-8 text-xs text-muted-foreground">{footer}</div>}
    </motion.div>
  );

  if (inline) {
    return (
      <div className="relative flex min-h-[70dvh] flex-1 items-center justify-center overflow-hidden px-5 py-16">
        <div className="bg-dots pointer-events-none absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
        {body}
      </div>
    );
  }

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-background">
      <div className="bg-dots pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_center,black_25%,transparent_75%)]" />
      <header className="relative flex items-center justify-between px-5 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8">
        {brand ? (
          <Link href="/" aria-label={`${brand.appName} home`}>
            <Logo name={brand.appName} src={brand.logoUrl || undefined} />
          </Link>
        ) : (
          <span />
        )}
      </header>
      <main className="relative flex flex-1 items-center justify-center px-5 pt-10 pb-[max(4rem,env(safe-area-inset-bottom))]">{body}</main>
    </div>
  );
}

/** Goes back in history, or to `fallback` when there is nothing to go back to. */
export function BackButton({ fallback = "/", label = "Go back", className }: { fallback?: string; label?: string; className?: string }) {
  const router = useRouter();
  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      className={cn("h-10 px-4", className)}
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(fallback);
      }}
    >
      <ArrowLeft className="size-4" /> {label}
    </Button>
  );
}
