"use client";

import { useState } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { brandRegex } from "../../lib/brand-match";

type HastNode = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] };

/** Rehype plugin: wraps brand occurrences in <mark> (skips code blocks). */
function rehypeHighlight(brand: string | null) {
  return () => (tree: HastNode) => {
    const re = brand ? brandRegex(brand, "gi") : null;
    if (!re) return;
    const walk = (node: HastNode) => {
      if (!node.children) return;
      if (node.type === "element" && (node.tagName === "code" || node.tagName === "pre")) return;
      const next: HastNode[] = [];
      for (const child of node.children) {
        if (child.type === "text" && child.value) {
          let last = 0;
          const value = child.value;
          re.lastIndex = 0;
          for (const m of value.matchAll(re)) {
            const idx = m.index ?? 0;
            if (idx > last) next.push({ type: "text", value: value.slice(last, idx) });
            next.push({ type: "element", tagName: "mark", properties: { className: ["brand-hit"] }, children: [{ type: "text", value: m[0] }] });
            last = idx + m[0].length;
          }
          if (last === 0) next.push(child);
          else if (last < value.length) next.push({ type: "text", value: value.slice(last) });
        } else {
          walk(child);
          next.push(child);
        }
      }
      node.children = next;
    };
    walk(tree);
  };
}

const components: Components = {
  a: ({ href, children }) => {
    const safe = typeof href === "string" && /^https?:\/\//i.test(href) ? href : undefined;
    return safe ? (
      <a href={safe} target="_blank" rel="noopener noreferrer nofollow" className="font-medium underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    );
  },
  img: () => null,
  mark: ({ children }) => <mark className="rounded-[3px] bg-warning/30 px-0.5 text-foreground">{children}</mark>,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border">
      <table className="w-full text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b bg-muted/60 px-2 py-1.5 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border-b px-2 py-1.5 align-top">{children}</td>,
};

/** Markdown answer (GFM, http(s)-only links, no raw HTML) collapsed to ~12 lines with "Read more". */
export function MarkdownAnswer({ text, brand, collapsible = true }: { text: string; brand: string | null; collapsible?: boolean }) {
  const [open, setOpen] = useState(!collapsible);
  const long = text.length > 900 || text.split("\n").length > 14;
  return (
    <div className="relative">
      <div
        className={cn(
          "prose-answer space-y-2 text-sm leading-relaxed break-words [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:ml-4 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ul]:list-disc [&_ul]:space-y-1 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-xs [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
          long && !open && "max-h-72 overflow-hidden",
        )}
      >
        <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight(brand)]} components={components} skipHtml>
          {text}
        </Markdown>
      </div>
      {long && collapsible && (
        <>
          {!open && <div className="pointer-events-none absolute inset-x-0 bottom-7 h-16 bg-gradient-to-t from-card to-transparent" />}
          <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
            <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
            {open ? "Show less" : "Read more"}
          </button>
        </>
      )}
    </div>
  );
}
