"use client";

import "@xterm/xterm/css/xterm.css";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ITheme, Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { cn } from "@/lib/utils";

export type TerminalHandle = {
  write(data: string): void;
  writeln(data: string): void;
  clear(): void;
  reset(): void;
  scrollToBottom(): void;
  fit(): void;
};

/** Dark terminal palette tuned to the app's brand colours (used in light and dark mode). */
const TERMINAL_THEME: ITheme = {
  background: "#0c0c0d",
  foreground: "#d8d7d2",
  cursor: "#3ecf7a",
  cursorAccent: "#0c0c0d",
  selectionBackground: "rgba(62, 207, 122, 0.28)",
  selectionInactiveBackground: "rgba(216, 215, 210, 0.14)",
  black: "#1d1d20",
  red: "#ef6a5e",
  green: "#3ec479",
  yellow: "#e5b84f",
  blue: "#5f9cf2",
  magenta: "#c486f2",
  cyan: "#4cc3cf",
  white: "#d8d7d2",
  brightBlack: "#6d6c71",
  brightRed: "#ff8a7f",
  brightGreen: "#62dc95",
  brightYellow: "#f4cf72",
  brightBlue: "#86b7ff",
  brightMagenta: "#d9a7ff",
  brightCyan: "#78dbe5",
  brightWhite: "#f6f5f1",
  scrollbarSliderBackground: "rgba(216, 215, 210, 0.16)",
  scrollbarSliderHoverBackground: "rgba(216, 215, 210, 0.28)",
  scrollbarSliderActiveBackground: "rgba(216, 215, 210, 0.36)",
};

const FALLBACK_FONTS = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace";

function resolveFontFamily(): string {
  const root = getComputedStyle(document.documentElement);
  const mono = (root.getPropertyValue("--font-geist-mono") || root.getPropertyValue("--font-mono")).trim();
  return mono ? `${mono}, ${FALLBACK_FONTS}` : FALLBACK_FONTS;
}

type Refs = {
  term: React.RefObject<Terminal | null>;
  fit: React.RefObject<FitAddon | null>;
  pending: React.RefObject<string[]>;
};

function safeFit(refs: Refs) {
  const fit = refs.fit.current;
  const term = refs.term.current;
  if (!fit || !term?.element) return;
  // Skip while hidden (e.g. inactive tab) — fitting a 0×0 element breaks the layout.
  const parent = term.element.parentElement;
  if (!parent || parent.clientWidth === 0 || parent.clientHeight === 0) return;
  try {
    fit.fit();
  } catch {
    // Renderer not ready yet; the ResizeObserver will retry.
  }
}

function createHandle(refs: Refs): TerminalHandle {
  return {
    write(data) {
      if (!data) return;
      if (refs.term.current) refs.term.current.write(data);
      else refs.pending.current.push(data);
    },
    writeln(data) {
      if (refs.term.current) refs.term.current.writeln(data);
      else refs.pending.current.push(`${data}\r\n`);
    },
    clear() {
      if (refs.term.current) refs.term.current.clear();
      else refs.pending.current.length = 0;
    },
    reset() {
      if (refs.term.current) refs.term.current.reset();
      else refs.pending.current.length = 0;
    },
    scrollToBottom() {
      refs.term.current?.scrollToBottom();
    },
    fit() {
      safeFit(refs);
    },
  };
}

/**
 * Read-only xterm.js terminal for streaming agent output (ANSI colours supported). Writes made
 * before xterm has loaded are buffered and flushed on init. Fits itself to its container.
 */
export function TerminalView({
  ref,
  className,
  minHeight = 320,
  fontSize = 12.5,
  convertEol = true,
  onReady,
  scrollback = 5000,
  cursor = false,
}: {
  ref?: React.Ref<TerminalHandle>;
  className?: string;
  minHeight?: number;
  fontSize?: number;
  convertEol?: boolean;
  onReady?: (t: TerminalHandle) => void;
  scrollback?: number;
  cursor?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const pendingRef = useRef<string[]>([]);
  const onReadyRef = useRef(onReady);
  const [refs] = useState<Refs>(() => ({ term: termRef, fit: fitRef, pending: pendingRef }));
  const [handle] = useState(() => createHandle(refs));
  const [initialOptions] = useState(() => ({ fontSize, convertEol, scrollback, cursor }));

  useImperativeHandle(ref, () => handle, [handle]);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  // Mount xterm once (dynamic import: xterm touches `window` at module load).
  useEffect(() => {
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    let frame = 0;

    void (async () => {
      const [{ Terminal: XTerm }, { FitAddon: Fit }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      const container = containerRef.current;
      if (disposed || !container) return;

      const term = new XTerm({
        disableStdin: true,
        convertEol: initialOptions.convertEol,
        scrollback: initialOptions.scrollback,
        fontSize: initialOptions.fontSize,
        fontFamily: resolveFontFamily(),
        lineHeight: 1.25,
        cursorBlink: false,
        cursorStyle: "bar",
        cursorInactiveStyle: initialOptions.cursor ? "bar" : "none",
        cursorWidth: initialOptions.cursor ? 2 : 1,
        allowTransparency: false,
        drawBoldTextInBrightColors: true,
        theme: initialOptions.cursor ? TERMINAL_THEME : { ...TERMINAL_THEME, cursor: TERMINAL_THEME.background },
      });
      const fit = new Fit();
      term.loadAddon(fit);
      term.open(container);
      termRef.current = term;
      fitRef.current = fit;
      safeFit(refs);

      if (pendingRef.current.length) {
        term.write(pendingRef.current.join(""));
        pendingRef.current = [];
      }

      resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => safeFit(refs));
      });
      resizeObserver.observe(container);

      // Web fonts may finish loading after init — re-measure cells once they are ready.
      void document.fonts?.ready.then(() => {
        if (disposed || !termRef.current) return;
        termRef.current.options.fontFamily = resolveFontFamily();
        safeFit(refs);
      });

      onReadyRef.current?.(handle);
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [handle, initialOptions, refs]);

  // Apply option changes after mount.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    term.options.scrollback = scrollback;
    term.options.convertEol = convertEol;
    term.options.cursorInactiveStyle = cursor ? "bar" : "none";
    term.options.theme = cursor ? TERMINAL_THEME : { ...TERMINAL_THEME, cursor: TERMINAL_THEME.background };
    safeFit(refs);
  }, [fontSize, scrollback, convertEol, cursor, refs]);

  return (
    <div
      className={cn(
        "flex w-full max-w-full min-w-0 flex-col overflow-hidden rounded-xl border border-black/10 bg-[#0c0c0d] p-2.5 shadow-soft dark:border-white/10",
        "[&_.xterm]:h-full [&_.xterm-viewport]:bg-transparent!",
        className,
      )}
      style={{ minHeight }}
    >
      <div ref={containerRef} className="min-h-0 w-full min-w-0 flex-1 overflow-hidden" />
    </div>
  );
}
