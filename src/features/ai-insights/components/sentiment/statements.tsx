"use client";

import { useMemo } from "react";
import { Quote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Panel } from "@/components/app/page";
import { DataTable, type Column } from "@/components/app/data-table";
import { MultiSelect, SearchInput } from "@/components/app/filters";
import { EngineStack } from "@/components/app/engine-icon";
import { EmptyState } from "@/components/app/empty-state";
import { cn } from "@/lib/utils";
import type { StatementRow } from "@/server/ai/insights/sentiment";
import { useClientListParam, useClientParam } from "../../lib/client-url";
import type { BrandDTO } from "../../types";
import { BrandLabel } from "../brand";
import { openAnswer } from "../answer-sheet";

export function StatementsView({ rows, polarity, own, brands }: { rows: StatementRow[]; polarity: "praise" | "criticism"; own: BrandDTO; brands: BrandDTO[] }) {
  const [brand, setBrand] = useClientParam("brand", "own");
  const [aspects, setAspects] = useClientListParam("aspects");
  const [q, setQ] = useClientParam("q", "");
  const byKey = useMemo(() => new Map(brands.map((b) => [b.key, b])), [brands]);

  const brandOptions = useMemo(() => {
    const counts = new Map<string, { name: string; n: number }>();
    for (const r of rows) {
      const e = counts.get(r.brand) ?? { name: byKey.get(r.brand)?.name ?? r.brandName, n: 0 };
      e.n += r.count;
      counts.set(r.brand, e);
    }
    return [...counts.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [rows, byKey]);

  const aspectOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.attribute) m.set(r.attribute, (m.get(r.attribute) ?? 0) + r.count);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, label: value, count }));
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (brand === "own" && r.brand !== own.key) return false;
      if (brand !== "own" && brand !== "all" && r.brand !== brand) return false;
      if (aspects.length && !(r.attribute && aspects.includes(r.attribute))) return false;
      if (needle && !`${r.quote} ${r.brandName} ${r.attribute ?? ""} ${r.promptText}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, brand, aspects, q, own.key]);

  const tone = polarity === "praise" ? "var(--success)" : "var(--destructive)";

  const columns: Column<StatementRow>[] = [
    {
      id: "brand",
      header: "Brand",
      sortValue: (r) => r.brandName.toLowerCase(),
      cell: (r) => {
        const b = byKey.get(r.brand);
        return <BrandLabel name={b?.name ?? r.brandName} domain={b?.domain} isOwn={b?.isOwn} className="min-w-28" />;
      },
    },
    {
      id: "quote",
      header: "What AI says",
      cell: (r) => (
        <div className="flex min-w-64 max-w-xl gap-2">
          <Quote className="mt-0.5 size-3.5 shrink-0" style={{ color: tone }} />
          <span className="text-sm">
            {r.quote}
            {r.count > 1 && <span className="ml-1.5 text-xs text-muted-foreground">×{r.count}</span>}
          </span>
        </div>
      ),
    },
    {
      id: "aspect",
      header: "Aspect",
      sortValue: (r) => r.attribute ?? "",
      hideBelow: "md",
      cell: (r) => (
        <span className="text-sm">
          {r.attribute ?? "—"}
          {r.theme && <span className="block text-xs text-muted-foreground">{r.theme}</span>}
        </span>
      ),
    },
    { id: "models", header: "Models", hideBelow: "lg", cell: (r) => <EngineStack ids={r.engines} max={4} /> },
    {
      id: "severity",
      header: "Severity",
      align: "right",
      sortValue: (r) => r.severity,
      cell: (r) => (
        <span className="inline-flex items-center gap-2">
          <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full" style={{ width: `${r.severity}%`, background: tone }} />
          </span>
          <span className="w-6 text-xs tabular">{Math.round(r.severity)}</span>
        </span>
      ),
    },
    {
      id: "action",
      header: <span className="sr-only">Action</span>,
      align: "right",
      cell: (r) => (
        <Button variant="outline" size="sm" className="h-7" onClick={() => openAnswer(r.answerId)}>
          View Prompt
        </Button>
      ),
    },
  ];

  const ownCount = rows.filter((r) => r.brand === own.key).length;

  return (
    <Panel
      title={polarity === "praise" ? "Praise" : "Criticism"}
      description={polarity === "praise" ? "Positive statements AI makes about brands, by aspect" : "Critical statements AI makes about brands, by aspect"}
    >
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Select value={brand} onValueChange={(v) => setBrand(v)}>
          <SelectTrigger size="sm" className="h-8 w-full text-xs sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="own">Only {own.name} ({ownCount})</SelectItem>
            <SelectItem value="all">All brands</SelectItem>
            {brandOptions
              .filter(([k]) => k !== own.key)
              .map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v.name} ({v.n})
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <MultiSelect options={aspectOptions} value={aspects} onChange={setAspects} placeholder="All Aspects" label="Aspects" className="w-full sm:w-auto" />
        <SearchInput value={q} onChange={(v) => setQ(v || null)} placeholder="Search statements…" className="sm:max-w-72 sm:flex-1" />
      </div>
      <DataTable
        columns={columns}
        data={filtered}
        getRowId={(r) => r.id}
        pageSize={25}
        initialSort={{ id: "severity", dir: "desc" }}
        empty={
          <EmptyState
            compact
            icon={Quote}
            title="Nothing to show yet"
            description={rows.length ? "No statements match these filters." : "Aspect sentiment is extracted on new results going forward."}
          />
        }
        mobileCard={(r) => (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{byKey.get(r.brand)?.name ?? r.brandName}</span>
              <span className={cn("text-xs tabular")} style={{ color: tone }}>
                {Math.round(r.severity)}
              </span>
            </div>
            <p className="text-sm">“{r.quote}”</p>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{r.attribute ?? "—"}</span>
              <button type="button" className="font-medium text-foreground underline-offset-2 hover:underline" onClick={() => openAnswer(r.answerId)}>
                View Prompt
              </button>
            </div>
          </div>
        )}
      />
    </Panel>
  );
}
