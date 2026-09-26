"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Plain streaming text (no markdown): preserves whitespace, fades in the most recently appended
 * chunk and shows a blinking block caret while `streaming` is true.
 */
export function StreamingText({
  text,
  streaming,
  className,
  as = "div",
}: {
  text: string;
  streaming?: boolean;
  className?: string;
  as?: "div" | "p" | "span";
}) {
  const reduceMotion = useReducedMotion();
  // Split point between "already shown" text and the freshly appended chunk.
  const [prev, setPrev] = useState(text);
  const [boundary, setBoundary] = useState(text.length);
  if (text !== prev) {
    setPrev(text);
    setBoundary(text.startsWith(prev) ? prev.length : text.length);
  }

  const animate = streaming && !reduceMotion;
  const split = animate ? Math.min(boundary, text.length) : text.length;
  const stable = text.slice(0, split);
  const fresh = text.slice(split);
  const Comp = as;

  return (
    <Comp className={cn("break-words whitespace-pre-wrap", className)} aria-busy={streaming || undefined}>
      {stable}
      {fresh && (
        <motion.span key={split} initial={{ opacity: 0.25 }} animate={{ opacity: 1 }} transition={{ duration: 0.35, ease: "easeOut" }}>
          {fresh}
        </motion.span>
      )}
      {streaming && (
        <motion.span
          aria-hidden
          className="ml-0.5 inline-block h-[1.05em] w-[0.5em] translate-y-[0.18em] rounded-[1px] bg-foreground/70"
          animate={reduceMotion ? undefined : { opacity: [1, 1, 0, 0] }}
          transition={{ duration: 1.05, repeat: Infinity, times: [0, 0.5, 0.5, 1], ease: "linear" }}
        />
      )}
    </Comp>
  );
}
