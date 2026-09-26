"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpRight, Globe, Plug, Sparkles } from "lucide-react";
import { ToolCallCard, stringifyValue } from "@/components/agent-ui";
import { cn } from "@/lib/utils";
import type { ChatPart } from "../types";
import { Markdown } from "./markdown";

type ToolPart = Extract<ChatPart, { type: "tool_call" }>;
type Row = Record<string, unknown>;

function isPlainObject(v: unknown): v is Row {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Finds the most table-like array in a tool payload (array of objects). */
function findRows(data: unknown, depth = 0): { key: string; rows: Row[] } | null {
  if (!isPlainObject(data) || depth > 2) return null;
  let best: { key: string; rows: Row[] } | null = null;
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v) && v.length && v.every(isPlainObject)) {
      if (!best || v.length > best.rows.length) best = { key: k, rows: v as Row[] };
    } else if (isPlainObject(v)) {
      const inner = findRows(v, depth + 1);
      if (inner && (!best || inner.rows.length > best.rows.length)) best = inner;
    }
  }
  return best;
}

function humanize(key: string) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

function cellText(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(1);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.map(cellText).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function DataTable({ rows }: { rows: Row[] }) {
  const cols = useMemo(() => {
    const keys: string[] = [];
    for (const r of rows.slice(0, 20)) for (const k of Object.keys(r)) if (!keys.includes(k) && !isPlainObject(r[k])) keys.push(k);
    return keys.filter((k) => !/^(id|projectId|.*Id)$/.test(k) || keys.length <= 3).slice(0, 7);
  }, [rows]);
  return (
    <div className="max-h-80 overflow-auto rounded-lg border">
      <table className="w-full border-collapse text-xs tabular">
        <thead className="sticky top-0 bg-muted/90 backdrop-blur">
          <tr>
            {cols.map((c) => (
              <th key={c} className="border-b px-2.5 py-1.5 text-left font-medium whitespace-nowrap text-muted-foreground">
                {humanize(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 100).map((r, i) => (
            <tr key={i} className="border-b last:border-b-0">
              {cols.map((c) => {
                const v = r[c];
                const text = cellText(v);
                const isUrl = typeof v === "string" && /^https?:\/\//.test(v);
                return (
                  <td key={c} className={cn("max-w-[260px] truncate px-2.5 py-1.5 align-top", typeof v === "number" && "text-right")} title={text}>
                    {isUrl ? (
                      <a href={v as string} target="_blank" rel="noopener noreferrer nofollow" className="text-brand hover:underline">
                        {text.replace(/^https?:\/\/(www\.)?/, "")}
                      </a>
                    ) : (
                      text
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 100 && <div className="border-t px-2.5 py-1.5 text-[11px] text-muted-foreground">Showing 100 of {rows.length} rows</div>}
    </div>
  );
}

/** Picks the object holding headline numbers (e.g. `current` of a metrics payload). */
function kpiSource(data: unknown): Row | null {
  if (!isPlainObject(data)) return null;
  const numericCount = (o: Row) => Object.values(o).filter((v) => typeof v === "number" || v === null).length;
  for (const key of ["current", "metrics", "summary", "totals", "kpis", "overview"]) {
    const v = data[key];
    if (isPlainObject(v) && numericCount(v) >= 2) return v;
  }
  if (Object.values(data).some((v) => typeof v === "number")) return data;
  for (const v of Object.values(data)) if (isPlainObject(v) && numericCount(v) >= 2) return v;
  return null;
}

function KpiList({ data }: { data: Row }) {
  const items = Object.entries(data).filter(
    ([k, v]) => (typeof v === "number" || v === null || (typeof v === "string" && v.length < 60)) && !/id$/i.test(k) && k !== "url",
  );
  if (!items.length) return <div className="text-xs text-muted-foreground">No headline numbers — see JSON.</div>;
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.slice(0, 12).map(([k, v]) => (
        <div key={k} className="min-w-0 rounded-lg border bg-background px-2.5 py-1.5">
          <dt className="truncate text-[11px] text-muted-foreground">{humanize(k)}</dt>
          <dd className="truncate text-sm font-medium tabular">{cellText(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function appLink(data: unknown): string | null {
  if (!isPlainObject(data)) return null;
  const url = typeof data.url === "string" ? data.url : null;
  if (!url) return null;
  try {
    const u = new URL(url, window.location.origin);
    if (u.origin === window.location.origin && u.pathname.startsWith("/p/")) return u.pathname + u.search;
  } catch {
    /* ignore */
  }
  return null;
}

function ToolResultView({ part }: { part: ToolPart }) {
  const summary = (part.output ?? "").replace(/\n\n---\nJSON:\n[\s\S]*$/, "").trim();
  const rows = useMemo(() => findRows(part.data), [part.data]);
  const kpis = rows ? null : kpiSource(part.data);
  const link = typeof window !== "undefined" ? appLink(part.data) : null;
  const hasData = part.data != null && !(isPlainObject(part.data) && Object.keys(part.data).length === 0);
  const [view, setView] = useState<"summary" | "data" | "raw">(summary || !hasData ? "summary" : "data");
  const tabs: { id: typeof view; label: string }[] = [
    ...(summary || !hasData ? [{ id: "summary" as const, label: "Summary" }] : []),
    ...(hasData ? [{ id: "data" as const, label: rows ? `Data (${rows.rows.length})` : "Data" }, { id: "raw" as const, label: "JSON" }] : []),
  ];

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Result</div>
        {tabs.length > 1 && (
          <div className="flex rounded-md bg-muted p-0.5 text-[11px]">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setView(t.id)}
                className={cn("rounded px-2 py-0.5 font-medium transition-colors", view === t.id ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {view === "summary" &&
        (summary ? (
          <div className="max-h-96 overflow-auto rounded-lg border bg-background px-3 py-2">
            <Markdown text={summary.slice(0, 12_000)} compact />
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">No text output.</div>
        ))}
      {view === "data" &&
        (rows ? <DataTable rows={rows.rows} /> : kpis ? <KpiList data={kpis} /> : <div className="text-xs text-muted-foreground">No table data — see JSON.</div>)}
      {view === "raw" && (
        <pre className="max-h-80 overflow-auto rounded-lg border bg-muted/50 px-3 py-2 font-mono text-[11.5px] leading-relaxed break-words whitespace-pre-wrap">
          {stringifyValue(part.data)}
        </pre>
      )}
      {link && (
        <Link href={link} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
          Open in AutoSEO <ArrowUpRight className="size-3" />
        </Link>
      )}
    </div>
  );
}

/** One tool call inside an assistant message (AutoSEO tool, external MCP / CLI tool or web search). */
export function ChatToolCall({ part }: { part: ToolPart }) {
  const icon = part.source === "server" ? <Globe /> : part.source === "external" ? <Plug /> : <Sparkles />;
  const title = part.title ?? (part.source === "server" && part.name === "web_search" ? "Web search" : undefined);
  const badge =
    part.source === "external" ? (
      <span className="hidden shrink-0 rounded-full border px-1.5 py-px text-[10px] text-muted-foreground sm:inline">local tool</span>
    ) : null;
  const finished = part.state !== "running";
  return (
    <ToolCallCard
      name={part.name}
      title={title}
      args={part.input}
      status={part.state === "running" ? "running" : part.state === "error" ? "error" : "success"}
      error={part.state === "error" ? (part.error ?? "The tool failed.") : null}
      durationMs={part.durationMs}
      icon={icon}
      badge={badge}
      resultContent={finished && part.state !== "error" ? <ToolResultView part={part} /> : undefined}
    />
  );
}
