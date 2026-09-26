"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { ResolveCtx } from "../../lib/catalog";
import { resolveColor } from "../../lib/theme";
import type { TextElement, Theme } from "../../lib/types";
import { textBoxStyle } from "../slide/slide-view";
import { htmlToRuns, insertTokenAtCaret, runsToHtml } from "./rich-text";
import { useEditor } from "./store";

/** The text box currently edited in place (toolbar commands talk to it). */
export type ActiveTextEditor = {
  id: string;
  exec: (command: "bold" | "italic" | "underline" | "foreColor" | "removeFormat", value?: string) => void;
  insertToken: (key: string) => void;
  /** Writes the DOM back to the store (keeps editing open). */
  flush: () => void;
  /** Writes back and leaves edit mode. */
  finish: () => void;
};

export const activeTextEditor: { current: ActiveTextEditor | null } = { current: null };

export function TextEditorOverlay({ el, theme, data }: { el: TextElement; theme: Theme; data: ResolveCtx }) {
  const { store } = useEditor();
  const ref = useRef<HTMLDivElement>(null);
  const dataRef = useRef(data);
  useLayoutEffect(() => {
    dataRef.current = data;
  });

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.innerHTML = runsToHtml(el.paragraphs, theme, dataRef.current);
    node.focus({ preventScroll: true });
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(node);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    // only when a new element enters edit mode
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el.id]);

  useEffect(() => {
    // keep the node: during unmount cleanup the ref is already detached
    const node = ref.current;
    const read = () => (node ? htmlToRuns(node, theme, el.style.color) : el.paragraphs);
    const write = (leave: boolean) => {
      const paragraphs = read();
      // the element may no longer be on the current slide (e.g. user switched slides while editing)
      const deck = store.getState().deck;
      const home = deck.slides.find((s) => s.elements.some((e) => e.id === el.id));
      const current = home?.elements.find((e) => e.id === el.id);
      const changed = home && current && current.type === "text" && JSON.stringify(current.paragraphs) !== JSON.stringify(paragraphs);
      if (changed) {
        const next = store.withSlide((s) => ({ ...s, elements: s.elements.map((e) => (e.id === el.id ? { ...(e as TextElement), paragraphs } : e)) }), deck, home.id);
        store.commit(next, leave ? { editingId: null } : {});
      } else if (leave) store.set({ editingId: null });
    };
    const api: ActiveTextEditor = {
      id: el.id,
      exec: (command, value) => {
        node?.focus({ preventScroll: true });
        document.execCommand("styleWithCSS", false, command === "foreColor" ? "true" : "false");
        document.execCommand(command, false, value);
      },
      insertToken: (key) => {
        if (!node) return;
        node.focus({ preventScroll: true });
        insertTokenAtCaret(node, key, dataRef.current);
      },
      flush: () => write(false),
      finish: () => {
        if (activeTextEditor.current === api) activeTextEditor.current = null;
        write(true);
      },
    };
    activeTextEditor.current = api;
    return () => {
      if (activeTextEditor.current === api) {
        // leaving edit mode by any route (slide change, selection change): persist the text
        activeTextEditor.current = null;
        write(false);
      }
    };
  }, [el.id, el.paragraphs, el.style.color, store, theme]);

  const style = textBoxStyle(el, theme);
  return (
    <div
      data-text-editor
      style={{
        position: "absolute",
        left: el.x,
        top: el.y,
        width: el.w,
        minHeight: el.h,
        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
        zIndex: 5,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <style>{`.rt-editor [data-bullet]{padding-left:1.1em;text-indent:-1.1em}.rt-editor [data-bullet]::before{content:"•\\00a0";color:${resolveColor("$accent", theme)}}.rt-editor:focus{outline:none}`}</style>
      <div
        ref={ref}
        className="rt-editor"
        contentEditable
        suppressContentEditableWarning
        spellCheck
        style={{ ...style, height: undefined, minHeight: el.h, caretColor: resolveColor("$accent", theme), cursor: "text", boxShadow: "0 0 0 3px rgba(61,220,132,0.55)" }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            activeTextEditor.current?.finish();
          }
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            activeTextEditor.current?.flush();
          }
        }}
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, text);
        }}
      />
    </div>
  );
}
