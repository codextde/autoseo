"use client";

import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

export type Highlight = { name: string; terms: string[]; kind: "own" | "competitor" | "other" };

type HNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HNode[];
};

const SKIP_TAGS = new Set(["code", "pre", "a"]);

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Rehype plugin: wraps brand terms in <mark data-kind=…> (text nodes only, never inside code/links). */
function rehypeBrandMarks(highlights: Highlight[]) {
  const termKind = new Map<string, Highlight["kind"]>();
  const terms: string[] = [];
  for (const h of highlights) {
    for (const t of h.terms) {
      const term = t.trim();
      if (term.length < 2 || termKind.has(term.toLowerCase())) continue;
      termKind.set(term.toLowerCase(), h.kind);
      terms.push(term);
    }
  }
  terms.sort((a, b) => b.length - a.length);
  const re = terms.length ? new RegExp(`(?<![\\p{L}\\p{N}_])(${terms.map(escapeRe).join("|")})(?![\\p{L}\\p{N}_])`, "giu") : null;

  const split = (value: string): HNode[] => {
    if (!re) return [{ type: "text", value }];
    const out: HNode[] = [];
    let last = 0;
    for (const m of value.matchAll(re)) {
      const idx = m.index ?? 0;
      if (idx > last) out.push({ type: "text", value: value.slice(last, idx) });
      const kind = termKind.get(m[0].toLowerCase()) ?? "other";
      out.push({ type: "element", tagName: "mark", properties: { dataKind: kind }, children: [{ type: "text", value: m[0] }] });
      last = idx + m[0].length;
    }
    if (last < value.length) out.push({ type: "text", value: value.slice(last) });
    return out;
  };

  const walk = (node: HNode) => {
    if (!node.children) return;
    const next: HNode[] = [];
    for (const child of node.children) {
      if (child.type === "text" && child.value) next.push(...split(child.value));
      else {
        if (child.type === "element" && !SKIP_TAGS.has(child.tagName ?? "")) walk(child);
        next.push(child);
      }
    }
    node.children = next;
  };

  return () => (tree: HNode) => {
    walk(tree);
  };
}

const components: Components = {
  a: ({ href, children }) => {
    const safe = href && /^https?:\/\//i.test(href) ? href : undefined;
    return safe ? (
      <a href={safe} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    );
  },
  // Remote images in AI answers would leak viewers' IPs — show the alt text instead.
  img: ({ alt }) => (alt ? <span className="text-muted-foreground italic">[{alt}]</span> : null),
  mark: ({ children, ...props }) => {
    const kind = (props as { "data-kind"?: string })["data-kind"];
    return (
      <mark
        className={cn(
          "rounded-[4px] px-0.5 text-inherit",
          kind === "own" && "bg-brand/20 font-semibold ring-1 ring-brand/30",
          kind === "competitor" && "bg-amber-400/25 ring-1 ring-amber-500/25",
          kind === "other" && "bg-muted ring-1 ring-border",
        )}
      >
        {children}
      </mark>
    );
  },
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b bg-muted/60 px-2.5 py-1.5 font-medium">{children}</th>,
  td: ({ children }) => <td className="border-b px-2.5 py-1.5 align-top last:border-0">{children}</td>,
};

/** Renders an AI answer (markdown, no raw HTML) with own brand / competitors highlighted. */
export function MarkdownAnswer({ text, highlights, className }: { text: string; highlights: Highlight[]; className?: string }) {
  const plugins = useMemo(() => [rehypeBrandMarks(highlights)], [highlights]);
  return (
    <div
      className={cn(
        "max-w-none text-sm leading-relaxed text-foreground/90 [overflow-wrap:anywhere]",
        "[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-[12px]",
        "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:font-semibold [&_h4]:mt-3 [&_h4]:font-medium",
        "[&_hr]:my-4 [&_li]:my-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_strong]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={plugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
