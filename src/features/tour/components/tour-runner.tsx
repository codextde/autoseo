"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, Loader2, Play, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useShell } from "@/components/app/shell-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { getTourStateAction, saveTourStateAction } from "../actions";
import { getServerTourSnapshot, getTourSnapshot, publishTourState, subscribeTour } from "../store";
import { stepAnchor, stepHref, stepsForTrack, TOUR_TOPICS, type TourState } from "../steps";

const CARD_W = 360;

type Rect = { top: number; left: number; width: number; height: number };

function samePath(a: string, b: string) {
  const norm = (s: string) => (s.length > 1 ? s.replace(/\/+$/, "") : s);
  return norm(a) === norm(b);
}

/** Finds the step's anchor element (it may render after navigation) and tracks its position. */
function useAnchorRect(selector: string | null, enabled: boolean) {
  const [found, setFound] = useState<{ selector: string; rect: Rect } | null>(null);
  useEffect(() => {
    if (!selector || !enabled) return;
    let el: Element | null = null;
    let tries = 0;
    let raf = 0;
    const measure = () => {
      if (!el || !el.isConnected) {
        try {
          el = document.querySelector(selector);
        } catch {
          el = null;
        }
      }
      const r = el?.getBoundingClientRect();
      if (!r || r.width === 0 || r.height === 0) return setFound(null);
      setFound((prev) =>
        prev && prev.selector === selector && prev.rect.top === r.top && prev.rect.left === r.left && prev.rect.width === r.width && prev.rect.height === r.height
          ? prev
          : { selector, rect: { top: r.top, left: r.left, width: r.width, height: r.height } },
      );
    };
    const poll = setInterval(() => {
      tries++;
      measure();
      if (el && tries === 3) {
        const r = el.getBoundingClientRect();
        if (r.top < 0 || r.bottom > window.innerHeight) (el as HTMLElement).scrollIntoView?.({ block: "nearest", behavior: "smooth" });
      }
      if (tries > 40) clearInterval(poll);
    }, 200);
    const onChange = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    raf = requestAnimationFrame(measure);
    return () => {
      clearInterval(poll);
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
    };
  }, [selector, enabled]);
  return enabled && found && found.selector === selector ? found.rect : null;
}

/**
 * Global product tour overlay (mounted in the app shell). Reads progress from the server, shows a
 * step card on the page each step belongs to and navigates between real pages.
 */
export function TourRunner() {
  const shell = useShell();
  const pathname = usePathname();
  const router = useRouter();
  const isMobile = useIsMobile();
  const state = useSyncExternalStore(subscribeTour, getTourSnapshot, getServerTourSnapshot);
  const [enabled, setEnabled] = useState(shell.branding.showProductTour);
  /** Navigation started from `from` towards `href` (card shows a spinner until the page changes). */
  const [pending, setPending] = useState<{ href: string; from: string } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cardH, setCardH] = useState(240);
  const cardRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const ro = new ResizeObserver(() => setCardH(node.offsetHeight));
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!shell.branding.showProductTour) return;
    let alive = true;
    void getTourStateAction().then((res) => {
      if (!alive || !res.ok) return;
      setEnabled(res.data.enabled);
      publishTourState(res.data.state);
    });
    return () => {
      alive = false;
    };
  }, [shell.branding.showProductTour]);

  const persist = useCallback((next: TourState, immediate = false) => {
    publishTourState(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const run = () => void saveTourStateAction(next).then((r) => !r.ok && console.warn("[tour] save failed", r.error));
    if (immediate) run();
    else saveTimer.current = setTimeout(run, 400);
  }, []);

  const steps = useMemo(() => (state ? stepsForTrack(state.track) : []), [state]);
  const active = Boolean(enabled && state?.active && steps.length);
  const index = state ? Math.min(Math.max(0, state.stepIndex), Math.max(0, steps.length - 1)) : 0;
  const step = active ? steps[index] : undefined;
  const projectId = state?.projectId ?? shell.currentProjectId;
  const href = step ? stepHref(step, projectId) : null;
  const onPage = Boolean(href && samePath(pathname, href));

  const loading = Boolean(pending && samePath(pathname, pending.from) && !samePath(pathname, pending.href));

  // Give up on a pending navigation after a while (e.g. the page 404'd or redirected).
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(null), 8000);
    return () => clearTimeout(t);
  }, [pending]);

  const anchorRect = useAnchorRect(step && onPage ? stepAnchor(step, projectId) : null, active && onPage && !isMobile);

  const goTo = useCallback(
    (nextIndex: number) => {
      if (!state || !step) return;
      const completed = nextIndex > index && !state.completed.includes(step.id) ? [...state.completed, step.id] : state.completed;
      const target = steps[nextIndex];
      if (!target) return;
      persist({ ...state, stepIndex: nextIndex, completed, projectId });
      const nextHref = stepHref(target, projectId);
      if (!samePath(pathname, nextHref)) {
        setPending({ href: nextHref, from: pathname });
        router.push(nextHref);
      }
    },
    [state, step, index, steps, persist, projectId, pathname, router],
  );

  const close = useCallback(() => {
    if (!state) return;
    persist({ ...state, active: false }, true);
    toast("Tour paused", { description: "Resume any time from Product Tour in the sidebar." });
  }, [state, persist]);

  const finish = useCallback(() => {
    if (!state || !step) return;
    const completed = state.completed.includes(step.id) ? state.completed : [...state.completed, step.id];
    persist({ ...state, active: false, completed, stepIndex: 0 }, true);
    toast.success("Tour complete 🎉", { description: "Restart it any time from Product Tour in the sidebar." });
  }, [state, step, persist]);

  const resume = useCallback(() => {
    if (!href) return;
    setPending({ href, from: pathname });
    router.push(href);
  }, [href, router, pathname]);

  // Keyboard navigation while a step card is visible.
  useEffect(() => {
    if (!active || !onPage) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (document.querySelector("[role=dialog][data-state=open]")) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (index < steps.length - 1) goTo(index + 1);
        else finish();
      } else if (e.key === "ArrowLeft" && index > 0) {
        e.preventDefault();
        goTo(index - 1);
      } else if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onPage, index, steps.length, goTo, finish, close]);

  if (!active || !step || !state) return null;

  const topic = TOUR_TOPICS.find((t) => t.key === step.topic);
  const isLast = index === steps.length - 1;

  // Not on the step's page (user wandered off) → compact resume pill.
  if (!onPage && !loading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="fixed right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[70] flex items-center gap-1 rounded-full border bg-popover/95 p-1 pl-3 shadow-lg backdrop-blur-xl sm:right-5 sm:bottom-5"
      >
        <span className="size-1.5 rounded-full bg-brand" />
        <span className="px-1 text-xs">
          Tour paused · <span className="tabular">{index + 1}/{steps.length}</span>
        </span>
        <Button size="sm" className="h-7 rounded-full px-3" onClick={resume}>
          <Play className="size-3 fill-current" /> Resume
        </Button>
        <Button size="icon-sm" variant="ghost" className="rounded-full" aria-label="End tour" onClick={close}>
          <X className="size-3.5" />
        </Button>
      </motion.div>
    );
  }

  // Placement: next to a sidebar anchor, below a topbar anchor, else bottom-right.
  let style: React.CSSProperties | undefined;
  let arrow: "left" | "top" | null = null;
  if (!isMobile && anchorRect && typeof window !== "undefined") {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (anchorRect.left + anchorRect.width < vw / 2) {
      const top = Math.min(Math.max(16, anchorRect.top + anchorRect.height / 2 - 40), vh - cardH - 16);
      style = { left: anchorRect.left + anchorRect.width + 16, top };
      arrow = "left";
    } else if (anchorRect.top < 120) {
      style = { top: anchorRect.top + anchorRect.height + 14, left: Math.min(Math.max(16, anchorRect.left + anchorRect.width - CARD_W), vw - CARD_W - 16) };
      arrow = "top";
    }
  }
  const arrowTop = anchorRect && style?.top != null ? anchorRect.top + anchorRect.height / 2 - Number(style.top) - 6 : 24;

  return (
    <>
      {anchorRect && !isMobile && (
        <motion.div
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, top: anchorRect.top - 4, left: anchorRect.left - 4, width: anchorRect.width + 8, height: anchorRect.height + 8 }}
          transition={{ type: "spring", stiffness: 400, damping: 36 }}
          className="pointer-events-none fixed z-[65] rounded-xl ring-2 ring-brand shadow-[0_0_0_6px_color-mix(in_oklch,var(--brand)_18%,transparent)]"
        />
      )}
      <motion.div
        ref={cardRef}
        role="dialog"
        aria-label={`Product tour: ${step.title}`}
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        style={style}
        className={cn(
          "fixed z-[70] rounded-2xl border bg-popover text-popover-foreground shadow-2xl",
          isMobile
            ? "inset-x-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))]"
            : style
              ? "w-[360px]"
              : "right-5 bottom-5 w-[360px]",
        )}
      >
        {arrow === "left" && (
          <span
            aria-hidden
            className="absolute -left-[7px] size-3 rotate-45 border-b border-l bg-popover"
            style={{ top: Math.min(Math.max(16, arrowTop), cardH - 28) }}
          />
        )}
        {arrow === "top" && <span aria-hidden className="absolute -top-[7px] right-8 size-3 rotate-45 border-t border-l bg-popover" />}
        <div className="p-4 pb-3">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand">
              {topic?.title ?? "Product tour"}
            </span>
            <button
              type="button"
              onClick={close}
              aria-label="Close tour"
              className="-mr-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step.id}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.18 }}
              className="mt-3 space-y-1.5"
            >
              <h2 className="text-[15px] leading-snug font-semibold tracking-tight">{step.title}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="h-1 bg-muted">
          <motion.div
            className="h-full bg-brand"
            initial={false}
            animate={{ width: `${((index + 1) / steps.length) * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
        <div className="flex items-center justify-between gap-2 p-3">
          <Button variant="ghost" size="sm" className="h-8" disabled={index === 0 || loading} onClick={() => goTo(index - 1)}>
            <ArrowLeft className="size-3.5" /> Back
          </Button>
          <span className="text-xs text-muted-foreground tabular">
            {index + 1} of {steps.length}
          </span>
          {isLast ? (
            <Button size="sm" className="h-8 px-3" disabled={loading} onClick={finish}>
              <Check className="size-3.5" /> Finish
            </Button>
          ) : (
            <Button size="sm" className="h-8 px-3" disabled={loading} onClick={() => goTo(index + 1)}>
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : null} Next {!loading && <ArrowRight className="size-3.5" />}
            </Button>
          )}
        </div>
      </motion.div>
    </>
  );
}
