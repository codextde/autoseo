"use client";

import { CircleCheck, CircleX, ExternalLink, Quote } from "lucide-react";
import { EngineIcon } from "@/components/app/engine-icon";
import { Favicon } from "@/components/app/favicon";
import type { TaskEvidence } from "@/server/db/schema/optimize";
import { cn } from "@/lib/utils";
import { safeHttpUrl } from "@/features/optimize/shared/safe-url";

function hostOf(href: string | null | undefined) {
  if (!href) return null;
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function MiniBars({ data }: { data: NonNullable<TaskEvidence["chart"]> }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.compare ?? 0)));
  return (
    <div className="space-y-1.5">
      {data.map((d) => (
        <div key={d.label} className="grid grid-cols-[minmax(0,7rem)_1fr_2.5rem] items-center gap-2 text-xs">
          <span className="truncate text-muted-foreground">{d.label}</span>
          <div className="relative h-2 overflow-hidden rounded-full bg-muted">
            <div className="absolute inset-y-0 left-0 rounded-full bg-brand transition-all" style={{ width: `${(d.value / max) * 100}%` }} />
            {d.compare != null && <div className="absolute inset-y-0 w-0.5 bg-foreground/60" style={{ left: `${(d.compare / max) * 100}%` }} />}
          </div>
          <span className="text-right font-medium tabular">{d.value}</span>
        </div>
      ))}
    </div>
  );
}

function ItemRow({ kind, item }: { kind: TaskEvidence["kind"]; item: NonNullable<TaskEvidence["items"]>[number] }) {
  const host = kind === "sources" || kind === "pages" ? hostOf(item.href) ?? (kind === "sources" ? item.label : null) : null;
  const content = (
    <>
      {item.engine ? (
        <EngineIcon id={item.engine} size="xs" />
      ) : host ? (
        <Favicon domain={host} />
      ) : item.good === true ? (
        <CircleCheck className="size-3.5 shrink-0 text-success" />
      ) : item.good === false ? (
        <CircleX className="size-3.5 shrink-0 text-destructive" />
      ) : null}
      <span className={cn("min-w-0 flex-1", kind === "prompts" || kind === "queries" ? "line-clamp-2" : "truncate")}>
        {item.label}
        {item.detail && <span className="ml-2 text-xs text-muted-foreground">{item.detail}</span>}
      </span>
      {item.value != null && item.value !== "" && <span className="shrink-0 text-xs font-medium text-muted-foreground tabular">{item.value}</span>}
      {item.href && <ExternalLink className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />}
    </>
  );
  const cls = "group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm";
  const href = item.href && (item.href.startsWith("/") && !item.href.startsWith("//") ? item.href : safeHttpUrl(item.href));
  if (href) {
    const internal = href.startsWith("/");
    return (
      <a href={href} target={internal ? undefined : "_blank"} rel="noopener noreferrer nofollow" className={cn(cls, "hover:bg-muted")}>
        {content}
      </a>
    );
  }
  return <div className={cls}>{content}</div>;
}

export function EvidenceView({ evidence }: { evidence: TaskEvidence[] }) {
  if (!evidence.length) return <p className="text-sm text-muted-foreground">No evidence recorded.</p>;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {evidence.map((e, i) => {
        const wide = e.kind === "quotes" || e.kind === "prompts" || (e.items?.length ?? 0) > 6;
        return (
          <div key={`${e.label}-${i}`} className={cn("min-w-0 rounded-xl border bg-background/60 p-3", wide && "md:col-span-2")}>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{e.label}</h4>
              {e.value && <span className="text-sm font-semibold tabular">{e.value}</span>}
            </div>
            {e.description && <p className="mb-2 text-xs text-muted-foreground">{e.description}</p>}
            {e.chart && e.chart.length > 0 && (
              <div className="mb-2">
                <MiniBars data={e.chart} />
              </div>
            )}
            {e.kind === "quotes" ? (
              <ul className="space-y-2">
                {(e.items ?? []).map((q, j) => (
                  <li key={j} className="flex gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm">
                    <Quote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span className="text-foreground/90">{q.label.replace(/^“|”$/g, "")}</span>
                  </li>
                ))}
              </ul>
            ) : (
              (e.items?.length ?? 0) > 0 && (
                <div className="-mx-2 space-y-0.5">
                  {(e.items ?? []).map((item, j) => (
                    <ItemRow key={j} kind={e.kind} item={item} />
                  ))}
                </div>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}
