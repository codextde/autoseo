"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Archive, ChevronRight, Plus, RotateCcw, Search, TrendingUp } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Panel } from "@/components/app/page";
import { EmptyState } from "@/components/app/empty-state";
import { SearchInput } from "@/components/app/filters";
import { ConfirmButton, StatusBadge } from "@/components/app/misc";
import type { RankConfigSummary } from "@/server/seo/rank-tracking";
import { devicesLabel, FILTER_BAR_MIN_DOMAINS, scheduleLabel } from "@/server/seo/lib/rank-tracking";
import { locationLabel } from "@/server/seo/lib/locations";
import { archiveRankConfigAction } from "../../actions/rank";
import { toastError, unwrap } from "../../lib/client";
import { useQueryParams } from "../../hooks/use-query-params";
import type { ClientPageInfo } from "../../server/page-context";
import { RankConfigModal } from "./rank-config-modal";
import { configFlag, configLocationLabel, formatShortDate, skipReasonMessage } from "./rank-utils";

/** Tracked domains ("trackers") with filter bar (≥6 domains), archive and the Add Domain modal. */
export function RankDomainList({ info, configs }: { info: ClientPageInfo; configs: RankConfigSummary[] }) {
  const router = useRouter();
  const { params, set } = useQueryParams();
  const [addOpen, setAddOpen] = useState(false);
  const q = params.get("q") ?? "";
  const device = params.get("device") ?? "";
  const loc = params.get("loc") ?? "";
  const activeFilters = [q, device, loc].filter(Boolean).length;
  const showFilters = configs.length >= FILTER_BAR_MIN_DOMAINS || activeFilters > 0;

  const deviceOptions = useMemo(() => [...new Set(configs.map((c) => c.devices))], [configs]);
  const locationOptions = useMemo(
    () =>
      [...new Set(configs.map((c) => c.locationCode))]
        .map((code) => ({ code, label: locationLabel(code) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [configs],
  );

  const filtered = configs.filter(
    (c) =>
      (!q || c.domain.toLowerCase().includes(q.toLowerCase())) &&
      (!device || c.devices === device) &&
      (!loc || String(c.locationCode) === loc),
  );
  const canEdit = info.canRun;

  const archive = async (c: RankConfigSummary) => {
    try {
      unwrap(await archiveRankConfigAction(info.projectId, c.id));
      toast.success(`${c.domain} archived`);
      router.refresh();
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <>
      <Panel
        title="Tracked Domains"
        icon={<TrendingUp className="size-4 text-brand" />}
        description={configs.length ? `${configs.length} domain${configs.length === 1 ? "" : "s"}` : undefined}
        actions={
          <Button size="sm" onClick={() => setAddOpen(true)} disabled={!canEdit}>
            <Plus /> Add Domain
          </Button>
        }
        contentClassName="p-0"
      >
        {showFilters && (
          <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:px-5">
            <SearchInput value={q} onChange={(v) => set({ q: v })} placeholder="Filter domains…" className="sm:w-64" />
            <div className="flex gap-2">
              <Select value={device || "all"} onValueChange={(v) => set({ device: v === "all" ? null : v })}>
                <SelectTrigger size="sm" className="h-8 min-w-36 flex-1 text-xs sm:flex-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All devices</SelectItem>
                  {deviceOptions.map((d) => (
                    <SelectItem key={d} value={d}>
                      {devicesLabel(d)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={loc || "all"} onValueChange={(v) => set({ loc: v === "all" ? null : v })}>
                <SelectTrigger size="sm" className="h-8 min-w-36 flex-1 text-xs sm:flex-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All locations</SelectItem>
                  {locationOptions.map((o) => (
                    <SelectItem key={o.code} value={String(o.code)}>
                      {configFlag(o.code)} {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {activeFilters > 0 && (
              <Button variant="ghost" size="sm" className="self-start sm:ml-auto" onClick={() => set({ q: null, device: null, loc: null })}>
                <RotateCcw /> Reset ({activeFilters})
              </Button>
            )}
          </div>
        )}

        {configs.length === 0 ? (
          <EmptyState
            icon={TrendingUp}
            title="No tracked domains yet"
            description="Add a domain, pick a country or city, and track its Google positions on desktop and mobile — manually or on a schedule."
            action={canEdit ? { label: "Add Domain", onClick: () => setAddOpen(true) } : undefined}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            compact
            icon={Search}
            title="No matching tracked domains"
            action={{ label: "Clear filters", onClick: () => set({ q: null, device: null, loc: null }) }}
          />
        ) : (
          <ul className="divide-y">
            {filtered.map((c, i) => {
              const warning = skipReasonMessage(c.lastSkipReason, "list");
              const last = c.lastCheckedAt ?? c.lastRunCompletedAt;
              return (
                <motion.li
                  key={c.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.02, 0.2) }}
                  className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 sm:px-5"
                >
                  <Link href={`/p/${info.projectId}/seo/rank-tracking/${c.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="hidden size-9 shrink-0 items-center justify-center rounded-xl border bg-background text-lg sm:flex">{configFlag(c.locationCode)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-semibold">{c.domain}</span>
                        {(c.lastRunStatus === "running" || c.lastRunStatus === "pending") && <StatusBadge status="running" label="Checking" />}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                        <span className="truncate">{configLocationLabel(c)}</span>
                        <span>·</span>
                        <span>{devicesLabel(c.devices)}</span>
                        <span>·</span>
                        <span>{scheduleLabel(c.scheduleInterval)}</span>
                        <span>·</span>
                        <span>Last: {formatShortDate(last)}</span>
                      </span>
                      {warning && (
                        <span className="mt-1 flex items-center gap-1 text-xs text-warning">
                          <AlertTriangle className="size-3.5 shrink-0" /> {warning}
                        </span>
                      )}
                    </span>
                    {c.keywordCount > 0 && (
                      <span className="hidden shrink-0 flex-col items-end sm:flex">
                        <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Keywords</span>
                        <span className="text-sm font-semibold tabular">{c.keywordCount.toLocaleString()}</span>
                      </span>
                    )}
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                  {canEdit && (
                    <ConfirmButton
                      title={`Archive ${c.domain}?`}
                      description="Scheduled checks will stop and this domain will be hidden from the list. Ranking history is preserved."
                      confirmLabel="Archive"
                      destructive
                      onConfirm={() => archive(c)}
                    >
                      <Button variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground" aria-label={`Archive ${c.domain}`}>
                        <Archive />
                      </Button>
                    </ConfirmButton>
                  )}
                </motion.li>
              );
            })}
          </ul>
        )}
      </Panel>

      <RankConfigModal projectId={info.projectId} open={addOpen} onOpenChange={setAddOpen} market={info.market} defaultDomain={configs.length === 0 ? info.projectDomain : ""} onSaved={() => router.refresh()} />
    </>
  );
}
