"use client";

import { resolveToken, type ResolveCtx } from "../../lib/catalog";
import { normalizeRuns } from "../../lib/text";
import { resolveColor } from "../../lib/theme";
import { THEME_COLOR_KEYS, type Paragraph, type Run, type Theme } from "../../lib/types";
import { TOKEN_CHIP_STYLE } from "../slide/slide-view";

/*
 * contentEditable <-> runs conversion. Rendering produces one <div> per paragraph with inline
 * <b>/<i>/<u>/<span style=color> and non-editable token chips; parsing walks the DOM the browser
 * produced (incl. execCommand output) and rebuilds a clean run model.
 */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function chipCss(): string {
  const s = TOKEN_CHIP_STYLE;
  return `color:${s.color};background:${s.background};box-shadow:${s.boxShadow};border-radius:${s.borderRadius};padding:${s.padding}`;
}

export function tokenChipHtml(key: string, ctx: ResolveCtx): string {
  return `<span data-token="${esc(key)}" contenteditable="false" style="${chipCss()}">${esc(resolveToken(key, ctx).text)}</span>`;
}

export function runsToHtml(paragraphs: Paragraph[], theme: Theme, ctx: ResolveCtx): string {
  const paras = paragraphs.length ? paragraphs : [{ runs: [] }];
  return paras
    .map((p) => {
      const inner = p.runs
        .map((r) => {
          let html = r.token ? tokenChipHtml(r.token, ctx) : esc(r.text);
          if (!html) return "";
          if (r.color) html = `<span style="color:${esc(resolveColor(r.color, theme))}">${html}</span>`;
          if (r.u) html = `<u>${html}</u>`;
          if (r.i) html = `<i>${html}</i>`;
          if (r.b) html = `<b>${html}</b>`;
          return html;
        })
        .join("");
      return `<div${p.bullet ? ' data-bullet="1"' : ""}>${inner || "<br>"}</div>`;
    })
    .join("");
}

function rgbToHex(value: string): string | null {
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v.slice(1).split("").map((c) => c + c).join("")}`.toUpperCase();
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(v);
  if (!m) return null;
  return `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

type Marks = { b?: boolean; i?: boolean; u?: boolean; color?: string };

export function htmlToRuns(root: HTMLElement, theme: Theme, baseColor: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let current: Paragraph = { runs: [] };
  const themeHex = new Map<string, string>();
  for (const k of THEME_COLOR_KEYS) themeHex.set(theme.colors[k].toUpperCase(), `$${k}`);
  const baseHex = rgbToHex(resolveColor(baseColor, theme)) ?? "";

  const push = (run: Run) => current.runs.push(run);
  const breakPara = () => {
    paragraphs.push(current);
    current = { runs: [] };
  };

  const colorOf = (el: HTMLElement, inherited?: string): string | undefined => {
    const raw = el.tagName === "FONT" ? el.getAttribute("color") : el.style?.color;
    if (!raw) return inherited;
    const hex = rgbToHex(raw);
    if (!hex) return inherited;
    if (hex === baseHex) return undefined;
    return themeHex.get(hex) ?? hex;
  };

  const walk = (node: Node, marks: Marks) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").replace(/​/g, "");
      if (text) push({ text, ...clean(marks) });
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.dataset.token) {
      push({ text: "", token: node.dataset.token, ...clean(marks) });
      return;
    }
    const tag = node.tagName;
    if (tag === "BR") {
      breakPara();
      return;
    }
    const next: Marks = { ...marks };
    const fw = node.style?.fontWeight;
    if (tag === "B" || tag === "STRONG" || fw === "bold" || (fw && Number(fw) >= 600)) next.b = true;
    if (fw === "normal" || (fw && Number(fw) < 600 && Number(fw) > 0)) next.b = false;
    if (tag === "I" || tag === "EM" || node.style?.fontStyle === "italic") next.i = true;
    if (tag === "U" || node.style?.textDecoration?.includes("underline") || node.style?.textDecorationLine?.includes("underline")) next.u = true;
    next.color = colorOf(node, marks.color);
    const block = tag === "DIV" || tag === "P" || tag === "LI";
    if (block && current.runs.length) breakPara();
    if (block && node.dataset.bullet) current.bullet = true;
    node.childNodes.forEach((c) => walk(c, next));
    if (block) {
      // a block that only contained <br> already produced its break; blocks made of nested
      // blocks were closed by their children
      const onlyBr = node.childNodes.length === 1 && node.firstChild instanceof HTMLElement && node.firstChild.tagName === "BR";
      const hasBlockChild = [...node.children].some((c) => c.tagName === "DIV" || c.tagName === "P" || c.tagName === "LI");
      if (!onlyBr && (current.runs.length || !hasBlockChild)) breakPara();
    }
  };

  root.childNodes.forEach((c) => walk(c, {}));
  if (current.runs.length || !paragraphs.length) paragraphs.push(current);
  // drop trailing empty paragraph created by the final block break
  while (paragraphs.length > 1 && paragraphs.at(-1)!.runs.length === 0 && !paragraphs.at(-1)!.bullet) paragraphs.pop();
  return paragraphs.map((p) => ({ ...p, runs: normalizeRuns(p.runs) }));
}

function clean(m: Marks): Partial<Run> {
  const out: Partial<Run> = {};
  if (m.b) out.b = true;
  if (m.i) out.i = true;
  if (m.u) out.u = true;
  if (m.color) out.color = m.color;
  return out;
}

/** Inserts a token chip at the caret inside a contentEditable root. */
export function insertTokenAtCaret(root: HTMLElement, key: string, ctx: ResolveCtx) {
  const sel = window.getSelection();
  const tmp = document.createElement("span");
  tmp.innerHTML = tokenChipHtml(key, ctx);
  const chip = tmp.firstChild as HTMLElement;
  const space = document.createTextNode(" ");
  if (!sel || !sel.rangeCount || !root.contains(sel.anchorNode)) {
    const last = (root.lastElementChild as HTMLElement | null) ?? root;
    last.querySelector("br:last-child")?.remove();
    last.appendChild(chip);
    last.appendChild(space);
  } else {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(space);
    range.insertNode(chip);
    range.setStartAfter(space);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}
