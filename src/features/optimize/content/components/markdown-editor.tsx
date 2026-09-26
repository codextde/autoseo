"use client";

import { useRef } from "react";
import { Bold, Columns2, Eye, Heading2, Heading3, Italic, Link as LinkIcon, List, ListOrdered, PenLine, Quote, Table } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Markdown } from "@/features/optimize/shared/markdown";
import { cn } from "@/lib/utils";

export type EditorMode = "write" | "preview" | "split";

type Action = { key: string; label: string; icon: React.ComponentType<{ className?: string }>; run: (s: string, a: number, b: number) => { text: string; start: number; end: number } };

function wrap(before: string, after = before, placeholder = "text") {
  return (s: string, a: number, b: number) => {
    const sel = s.slice(a, b) || placeholder;
    const text = s.slice(0, a) + before + sel + after + s.slice(b);
    return { text, start: a + before.length, end: a + before.length + sel.length };
  };
}

function linePrefix(prefix: string | ((i: number) => string)) {
  return (s: string, a: number, b: number) => {
    const lineStart = s.lastIndexOf("\n", a - 1) + 1;
    const lineEndIdx = s.indexOf("\n", b);
    const lineEnd = lineEndIdx === -1 ? s.length : lineEndIdx;
    const block = s.slice(lineStart, lineEnd);
    const lines = block.split("\n").map((l, i) => {
      const clean = l.replace(/^(#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s?)/, "");
      return (typeof prefix === "function" ? prefix(i) : prefix) + clean;
    });
    const out = lines.join("\n");
    return { text: s.slice(0, lineStart) + out + s.slice(lineEnd), start: lineStart, end: lineStart + out.length };
  };
}

const ACTIONS: Action[] = [
  { key: "h2", label: "Heading 2", icon: Heading2, run: linePrefix("## ") },
  { key: "h3", label: "Heading 3", icon: Heading3, run: linePrefix("### ") },
  { key: "bold", label: "Bold", icon: Bold, run: wrap("**") },
  { key: "italic", label: "Italic", icon: Italic, run: wrap("*") },
  { key: "ul", label: "Bulleted list", icon: List, run: linePrefix("- ") },
  { key: "ol", label: "Numbered list", icon: ListOrdered, run: linePrefix((i) => `${i + 1}. `) },
  { key: "quote", label: "Quote", icon: Quote, run: linePrefix("> ") },
  {
    key: "link",
    label: "Link",
    icon: LinkIcon,
    run: (s, a, b) => {
      const sel = s.slice(a, b) || "link text";
      const ins = `[${sel}](https://)`;
      return { text: s.slice(0, a) + ins + s.slice(b), start: a + sel.length + 3, end: a + sel.length + 11 };
    },
  },
  {
    key: "table",
    label: "Table",
    icon: Table,
    run: (s, a) => {
      const ins = `\n\n| Option | Key fact | Price |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n\n`;
      return { text: s.slice(0, a) + ins + s.slice(a), start: a + 4, end: a + 10 };
    },
  },
];

export function MarkdownEditor({
  value,
  onChange,
  mode,
  onModeChange,
  readOnly,
  textareaRef,
}: {
  value: string;
  onChange: (v: string) => void;
  mode: EditorMode;
  onModeChange: (m: EditorMode) => void;
  readOnly?: boolean;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const ref = textareaRef ?? localRef;

  const apply = (action: Action) => {
    const el = ref.current;
    if (!el) return;
    const { text, start, end } = action.run(value, el.selectionStart, el.selectionEnd);
    onChange(text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start, end);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    const a = k === "b" ? ACTIONS[2] : k === "i" ? ACTIONS[3] : k === "k" ? ACTIONS[7] : null;
    if (a) {
      e.preventDefault();
      apply(a);
    }
  };

  const showWrite = mode !== "preview";
  const showPreview = mode !== "write";

  return (
    <div className="flex min-h-0 flex-col rounded-2xl border bg-card shadow-soft">
      <div className="flex items-center gap-1 overflow-x-auto border-b px-2 py-1.5">
        {!readOnly &&
          ACTIONS.map((a) => (
            <Tooltip key={a.key}>
              <TooltipTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => apply(a)} disabled={mode === "preview"} aria-label={a.label}>
                  <a.icon className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{a.label}</TooltipContent>
            </Tooltip>
          ))}
        <div className="ml-auto flex shrink-0 rounded-lg bg-muted p-0.5">
          {(
            [
              ["write", "Write", PenLine],
              ["split", "Split", Columns2],
              ["preview", "Preview", Eye],
            ] as const
          ).map(([m, label, Icon]) => (
            <button
              key={m}
              type="button"
              onClick={() => onModeChange(m)}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium",
                m === "split" && "hidden xl:inline-flex",
                mode === m ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className={cn("grid min-h-[60vh]", mode === "split" ? "xl:grid-cols-2" : "grid-cols-1")}>
        {showWrite && (
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            readOnly={readOnly}
            spellCheck
            placeholder={"Start with a 40–80 word answer to the target question…\n\n## First question people ask?\n\nShort, factual paragraphs…"}
            className={cn(
              "min-h-[60vh] w-full resize-none bg-transparent px-4 py-4 font-mono text-[13.5px] leading-relaxed outline-none placeholder:text-muted-foreground/60 sm:px-6",
              mode === "split" && "xl:border-r",
            )}
          />
        )}
        {showPreview && (
          <div className={cn("min-w-0 overflow-y-auto px-4 py-4 sm:px-6", mode === "split" && "hidden xl:block")}>
            {value.trim() ? <Markdown className="text-[15px]">{value}</Markdown> : <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
