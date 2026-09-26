"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { CopyButton } from "@/components/app/misc";
import { cn } from "@/lib/utils";

/** Pretty JSON block with copy button and collapse for long payloads. */
export function JsonView({
  value,
  label,
  className,
  maxHeight = 320,
  emptyText = "—",
}: {
  value: unknown;
  label?: React.ReactNode;
  className?: string;
  maxHeight?: number;
  emptyText?: string;
}) {
  const text = useMemo(() => {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, [value]);
  const [expanded, setExpanded] = useState(false);
  const long = text.split("\n").length > 16;
  const empty = !text || text === "{}" || text === "[]";
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      {(label || !empty) && (
        <div className="flex items-center justify-between gap-2">
          {label && <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</div>}
          {!empty && <CopyButton value={text} size="icon" />}
        </div>
      )}
      {empty ? (
        <div className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">{emptyText}</div>
      ) : (
        <div className="relative">
          <pre
            className="overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-[11.5px] leading-relaxed break-words whitespace-pre-wrap"
            style={{ maxHeight: expanded ? undefined : maxHeight }}
          >
            <JsonHighlight text={text} />
          </pre>
          {long && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />
              {expanded ? "Collapse" : "Expand"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Minimal token colouring (keys, strings, numbers, literals) without dangerouslySetInnerHTML. */
function JsonHighlight({ text }: { text: string }) {
  const parts = useMemo(() => {
    const re = /("(?:\\.|[^"\\])*"(\s*:)?)|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
    const out: { t: string; c?: string }[] = [];
    let last = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m.index > last) out.push({ t: text.slice(last, m.index) });
      if (m[1]) out.push({ t: m[0], c: m[2] ? "text-info" : "text-success" });
      else if (m[3]) out.push({ t: m[0], c: "text-chart-4" });
      else out.push({ t: m[0], c: "text-chart-1" });
      last = m.index + m[0].length;
      if (out.length > 20_000) break;
    }
    if (last < text.length) out.push({ t: text.slice(last) });
    return out;
  }, [text]);
  return (
    <>
      {parts.map((p, i) =>
        p.c ? (
          <span key={i} className={p.c}>
            {p.t}
          </span>
        ) : (
          p.t
        ),
      )}
    </>
  );
}
