"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";

/** Rotating "typewriter" placeholder: types a line, pauses, deletes it, moves to the next one. */
export function useTypewriter(lines: string[], enabled: boolean): string {
  const reduce = useReducedMotion();
  const [state, setState] = useState({ line: 0, chars: 0, deleting: false });

  useEffect(() => {
    if (!enabled || reduce || !lines.length) return;
    const current = lines[state.line % lines.length]!;
    let delay = state.deleting ? 18 : 42;
    if (!state.deleting && state.chars === current.length) delay = 2200;
    if (state.deleting && state.chars === 0) delay = 350;
    const t = setTimeout(() => {
      setState((s) => {
        const line = lines[s.line % lines.length]!;
        if (!s.deleting && s.chars < line.length) return { ...s, chars: s.chars + 1 };
        if (!s.deleting) return { ...s, deleting: true };
        if (s.chars > 0) return { ...s, chars: s.chars - 1 };
        return { line: (s.line + 1) % lines.length, chars: 0, deleting: false };
      });
    }, delay);
    return () => clearTimeout(t);
  }, [state, enabled, reduce, lines]);

  if (!lines.length) return "";
  if (reduce || !enabled) return lines[0]!;
  return lines[state.line % lines.length]!.slice(0, state.chars);
}
