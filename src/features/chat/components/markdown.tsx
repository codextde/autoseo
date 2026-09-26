"use client";

import Link from "next/link";
import { memo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

function CodeBlock({ children, className }: { children: React.ReactNode; className?: string }) {
  const [copied, setCopied] = useState(false);
  const lang = /language-(\w+)/.exec(className ?? "")?.[1];
  const text = String(Array.isArray(children) ? children.join("") : (children ?? "")).replace(/\n$/, "");
  return (
    <div className="group/code relative my-3 min-w-0 overflow-hidden rounded-xl border bg-muted/50">
      <div className="flex items-center justify-between border-b bg-muted/60 px-3 py-1 text-[11px] text-muted-foreground">
        <span className="font-mono">{lang ?? "text"}</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-foreground"
          onClick={() => {
            void navigator.clipboard?.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[12.5px] leading-relaxed">
        <code>{text}</code>
      </pre>
    </div>
  );
}

function safeHref(href: string | undefined): string | null {
  if (!href) return null;
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  if (href.startsWith("#")) return href;
  try {
    const u = new URL(href);
    if (u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:") return u.toString();
  } catch {
    /* invalid */
  }
  return null;
}

const components: Components = {
  a: ({ href, children }) => {
    const safe = safeHref(href);
    if (!safe) return <span className="text-foreground">{children}</span>;
    if (safe.startsWith("/")) {
      return (
        <Link href={safe} className="font-medium text-brand underline decoration-brand/30 underline-offset-2 hover:decoration-brand">
          {children}
        </Link>
      );
    }
    return (
      <a href={safe} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-brand underline decoration-brand/30 underline-offset-2 break-words hover:decoration-brand">
        {children}
      </a>
    );
  },
  p: ({ children }) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h3 className="mt-5 mb-2 text-lg font-semibold tracking-tight first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-5 mb-2 text-base font-semibold tracking-tight first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-4 mb-1.5 text-[15px] font-semibold first:mt-0">{children}</h4>,
  h4: ({ children }) => <h5 className="mt-3 mb-1 text-sm font-semibold first:mt-0">{children}</h5>,
  ul: ({ children }) => <ul className="my-2 ml-5 list-disc space-y-1 marker:text-muted-foreground">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 ml-5 list-decimal space-y-1 marker:text-muted-foreground">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5 leading-relaxed">{children}</li>,
  blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-brand/40 pl-3 text-muted-foreground">{children}</blockquote>,
  hr: () => <hr className="my-4 border-border" />,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  table: ({ children }) => (
    <div className="my-3 max-w-full overflow-x-auto rounded-xl border">
      <table className="w-full border-collapse text-[13px] tabular">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60 text-left">{children}</thead>,
  th: ({ children }) => <th className="border-b px-3 py-2 font-medium whitespace-nowrap text-muted-foreground">{children}</th>,
  td: ({ children }) => <td className="border-b px-3 py-1.5 align-top [tr:last-child_&]:border-b-0">{children}</td>,
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const isBlock = /language-/.test(className ?? "") || String(children ?? "").includes("\n");
    if (isBlock) return <CodeBlock className={className}>{children}</CodeBlock>;
    return <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em]">{children}</code>;
  },
  img: ({ alt }) => <span className="text-muted-foreground">[{alt || "image"}]</span>,
};

/** Markdown for chat answers and tool outputs (GFM tables, safe links, no raw HTML). */
export const Markdown = memo(function Markdown({ text, className, compact }: { text: string; className?: string; compact?: boolean }) {
  return (
    <div className={cn("min-w-0 text-[14.5px] break-words text-foreground/90", compact && "text-[13px]", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
});
