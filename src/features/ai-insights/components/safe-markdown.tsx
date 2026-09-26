import { Fragment } from "react";
import { cn } from "@/lib/utils";

/**
 * Minimal markdown renderer for AI answers. Produces React elements only (never raw HTML), so
 * untrusted answer text is always escaped. Supports headings, lists, bold/italic, inline code,
 * links (http/https only) and highlights brand names.
 */
export function SafeMarkdown({ text, highlights = [], className }: { text: string; highlights?: { term: string; own?: boolean }[]; className?: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push(
        <p key={`p${blocks.length}`} className="leading-relaxed">
          {inline(para.join(" "), highlights)}
        </p>,
      );
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const Tag = list.ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={`l${blocks.length}`} className={cn("space-y-1 pl-5", list.ordered ? "list-decimal" : "list-disc")}>
          {list.items.map((it, i) => (
            <li key={i} className="leading-relaxed">
              {inline(it, highlights)}
            </li>
          ))}
        </Tag>,
      );
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (heading) {
      flushPara();
      flushList();
      blocks.push(
        <p key={`h${blocks.length}`} className="pt-1 font-semibold">
          {inline(heading[2]!, highlights)}
        </p>,
      );
    } else if (ul || ol) {
      flushPara();
      const ordered = !!ol;
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((ul ?? ol)![1]!);
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return <div className={cn("space-y-3 text-sm", className)}>{blocks}</div>;
}

const TOKEN = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string, highlights: { term: string; own?: boolean }[]): React.ReactNode {
  const parts = text.split(TOKEN).filter((p) => p !== "");
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{highlight(p.slice(2, -2), highlights)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i} className="rounded bg-muted px-1 text-xs">{p.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(p);
    if (link) {
      const href = link[2]!;
      if (/^https?:\/\//i.test(href))
        return (
          <a key={i} href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-info underline-offset-2 hover:underline">
            {link[1]}
          </a>
        );
      return <Fragment key={i}>{link[1]}</Fragment>;
    }
    if (p.length > 2 && p.startsWith("*") && p.endsWith("*")) return <em key={i}>{highlight(p.slice(1, -1), highlights)}</em>;
    return <Fragment key={i}>{highlight(p, highlights)}</Fragment>;
  });
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlight(text: string, highlights: { term: string; own?: boolean }[]): React.ReactNode {
  const terms = highlights.filter((h) => h.term.trim().length > 1);
  if (!terms.length) return text;
  const re = new RegExp(`(${terms.map((t) => escapeRe(t.term)).join("|")})`, "gi");
  const parts = text.split(re);
  return parts.map((p, i) => {
    const hit = terms.find((t) => t.term.toLowerCase() === p.toLowerCase());
    if (!hit) return <Fragment key={i}>{p}</Fragment>;
    return (
      <mark key={i} className={cn("rounded px-0.5", hit.own ? "bg-brand-soft text-foreground" : "bg-chart-1/15 text-foreground")}>
        {p}
      </mark>
    );
  });
}
