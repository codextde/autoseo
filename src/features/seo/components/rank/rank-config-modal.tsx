"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Info, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type Column } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { formatNumber } from "@/components/app/metrics";
import type { DomainKeywordSuggestion } from "@/server/seo/domain";
import { getIsoCountryCode, getLanguageCode, isLabsLocationCode } from "@/server/seo/lib/locations";
import { isValidDomainHost } from "@/server/seo/lib/research-scope";
import {
  checksPerMonth,
  estimateRankCheckCost,
  normalizeTrackerDomain,
  type RankDevices,
  type ScheduleInterval,
} from "@/server/seo/lib/rank-tracking";
import { formatUsd } from "@/server/seo/lib/costs";
import {
  addTrackingKeywordsAction,
  createRankConfigAction,
  getTrackerKeywordSuggestionsAction,
  prewarmSerpLocationsAction,
  updateRankConfigAction,
} from "../../actions/rank";
import { toastError, unwrap } from "../../lib/client";
import { LocationSelect } from "../shared/location-select";
import { LanguageSelect } from "../shared/language-select";
import { SerpLocationCombobox } from "./serp-location-combobox";
import type { ConfigLike } from "./rank-utils";

const PRE_SELECT_COUNT = 20;
const DEPTH_PAGES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

type FormState = {
  domain: string;
  locationCode: number;
  languageCode: string;
  targeting: "national" | "local";
  locationName: string | null;
  devices: RankDevices;
  scheduleInterval: ScheduleInterval;
  serpDepth: number;
};

function initialForm(config: ConfigLike | null, market: { locationCode: number; languageCode: string }, defaultDomain: string): FormState {
  if (config) {
    return {
      domain: config.domain,
      locationCode: config.locationCode,
      languageCode: config.languageCode,
      targeting: config.locationName ? "local" : "national",
      locationName: config.locationName,
      devices: config.devices,
      scheduleInterval: config.scheduleInterval,
      serpDepth: config.serpDepth,
    };
  }
  return {
    domain: defaultDomain,
    locationCode: market.locationCode,
    languageCode: market.languageCode,
    targeting: "national",
    locationName: null,
    devices: "mobile",
    scheduleInterval: "weekly",
    serpDepth: 40,
  };
}

function domainError(value: string): string | null {
  const d = normalizeTrackerDomain(value);
  if (!d) return "Enter a domain";
  if (!d.includes(".") || !/^[a-z\d.-]+$/.test(d) || !isValidDomainHost(d)) return "Enter a valid domain like example.com";
  return null;
}

/** Add / edit a tracked domain (step 1), then pick ranked-keyword suggestions (step 2, create only). */
export function RankConfigModal({
  projectId,
  open,
  onOpenChange,
  config,
  market,
  defaultDomain = "",
  onSaved,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Edit mode when set. */
  config?: ConfigLike | null;
  market: { locationCode: number; languageCode: string };
  defaultDomain?: string;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const editing = Boolean(config);
  const [form, setForm] = useState<FormState>(() => initialForm(config ?? null, market, defaultDomain));
  const [step, setStep] = useState<"config" | "keywords">("config");
  const [created, setCreated] = useState<{ id: string; domain: string; locationCode: number } | null>(null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  // Reset the form whenever the dialog (re)opens — derived during render, not in an effect.
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setForm(initialForm(config ?? null, market, defaultDomain));
      setStep("config");
      setCreated(null);
      setTouched(false);
    }
  }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const dErr = domainError(form.domain);
  const localErr = form.targeting === "local" && !form.locationName ? "Please select a city or region for local targeting" : null;
  const cost = useMemo(
    () => estimateRankCheckCost(1, form.devices, form.serpDepth, form.scheduleInterval === "manual" ? "live" : "queued").costUsd,
    [form.devices, form.serpDepth, form.scheduleInterval],
  );
  const monthly = form.scheduleInterval !== "manual" ? cost * 50 * checksPerMonth(form.scheduleInterval) : null;

  const submit = async () => {
    setTouched(true);
    if (dErr || localErr) return;
    setBusy(true);
    try {
      const domain = normalizeTrackerDomain(form.domain);
      if (editing && config) {
        unwrap(
          await updateRankConfigAction(projectId, {
            configId: config.id,
            domain,
            locationCode: form.locationCode,
            languageCode: form.languageCode,
            locationName: form.targeting === "local" ? form.locationName : null,
            devices: form.devices,
            serpDepth: form.serpDepth,
            scheduleInterval: form.scheduleInterval,
          }),
        );
        toast.success("Configuration updated");
        onOpenChange(false);
        onSaved?.();
        router.refresh();
      } else {
        const row = unwrap(
          await createRankConfigAction(projectId, {
            domain,
            locationCode: form.locationCode,
            languageCode: form.languageCode,
            locationName: form.targeting === "local" ? form.locationName : null,
            devices: form.devices,
            serpDepth: form.serpDepth,
            scheduleInterval: form.scheduleInterval,
          }),
        );
        toast.success("Domain added for rank tracking");
        setCreated({ id: row.id, domain: row.domain, locationCode: row.locationCode });
        setStep("keywords");
        onSaved?.();
      }
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const finish = (configId: string) => {
    onOpenChange(false);
    router.push(`/p/${projectId}/seo/rank-tracking/${configId}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={step === "keywords" ? "max-h-[92dvh] overflow-y-auto sm:max-w-3xl" : "max-h-[92dvh] overflow-y-auto sm:max-w-lg"}>
        {step === "config" ? (
          <>
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Domain Config" : "Add Domain"}</DialogTitle>
              <DialogDescription>Choose where and how often Google positions are checked for this domain.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="rt-domain">Target Domain</Label>
                <Input
                  id="rt-domain"
                  value={form.domain}
                  placeholder="example.com"
                  aria-invalid={touched && Boolean(dErr)}
                  onChange={(e) => set("domain", e.target.value)}
                  onBlur={() => {
                    setTouched(true);
                    set("domain", normalizeTrackerDomain(form.domain));
                  }}
                  className="h-9"
                />
                {touched && dErr && <p className="text-xs text-destructive">{dErr}</p>}
              </div>

              <div className="space-y-1.5">
                <Label>Country</Label>
                <LocationSelect
                  value={form.locationCode}
                  onChange={(code) =>
                    setForm((f) => ({ ...f, locationCode: code, languageCode: getLanguageCode(code), locationName: null }))
                  }
                  className="w-full"
                />
              </div>

              <div className="space-y-2">
                <Label>Search Targeting</Label>
                <RadioGroup
                  value={form.targeting}
                  onValueChange={(v) => {
                    const t = v as "national" | "local";
                    set("targeting", t);
                    if (t === "local") void prewarmSerpLocationsAction(projectId, getIsoCountryCode(form.locationCode));
                  }}
                  className="grid gap-2 sm:grid-cols-2"
                >
                  <label className="flex cursor-pointer gap-2.5 rounded-xl border p-3 has-[[data-state=checked]]:border-foreground/40 has-[[data-state=checked]]:bg-muted/40">
                    <RadioGroupItem value="national" className="mt-0.5" />
                    <span>
                      <span className="block text-sm font-medium">National</span>
                      <span className="block text-xs text-muted-foreground">Local targeting can understate rankings for non-geo-modified terms.</span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer gap-2.5 rounded-xl border p-3 has-[[data-state=checked]]:border-foreground/40 has-[[data-state=checked]]:bg-muted/40">
                    <RadioGroupItem value="local" className="mt-0.5" />
                    <span>
                      <span className="block text-sm font-medium">Local</span>
                      <span className="block text-xs text-muted-foreground">Best for: &quot;near me&quot; queries, city/county keywords, service-area pages.</span>
                    </span>
                  </label>
                </RadioGroup>
                {form.targeting === "local" && (
                  <div className="space-y-1">
                    <SerpLocationCombobox
                      projectId={projectId}
                      countryCode={getIsoCountryCode(form.locationCode)}
                      value={form.locationName}
                      onChange={(n) => set("locationName", n)}
                      invalid={touched && Boolean(localErr)}
                    />
                    {touched && localErr && <p className="text-xs text-destructive">{localErr}</p>}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Language</Label>
                <LanguageSelect value={form.languageCode} onChange={(c) => set("languageCode", c)} className="w-full" />
                <p className="text-xs text-muted-foreground">Defaults to the country&apos;s language. Any language can be tracked in any country</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Devices</Label>
                  <Select value={form.devices} onValueChange={(v) => set("devices", v as RankDevices)}>
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="both">Desktop + Mobile</SelectItem>
                      <SelectItem value="desktop">Desktop only</SelectItem>
                      <SelectItem value="mobile">Mobile only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Schedule</Label>
                  <Select value={form.scheduleInterval} onValueChange={(v) => set("scheduleInterval", v as ScheduleInterval)}>
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly (end of month)</SelectItem>
                      <SelectItem value="manual">Manual only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {form.devices === "both" && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Info className="size-3.5" /> Tracking both devices uses 2x credits per keyword check
                </p>
              )}
              {form.scheduleInterval === "daily" && (
                <p className="flex items-center gap-1.5 text-xs text-warning">
                  <AlertTriangle className="size-3.5" /> Daily checks use 7x more credits than weekly
                </p>
              )}

              <div className="space-y-1.5">
                <Label>Search Depth</Label>
                <Select value={String(form.serpDepth / 10)} onValueChange={(v) => set("serpDepth", Number(v) * 10)}>
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEPTH_PAGES.map((p) => (
                      <SelectItem key={p} value={String(p)}>
                        {p} page{p === 1 ? "" : "s"} (top {p * 10} results)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">10 pages is ~8x more expensive than 1 page</p>
              </div>

              <div className="rounded-xl border bg-muted/40 px-3 py-2.5 text-sm">
                <div className="font-medium tabular">~{formatUsd(cost, 4)} per keyword per check</div>
                {monthly != null && (
                  <div className="text-xs text-muted-foreground tabular">50 keywords would cost ~{formatUsd(monthly, 2)}/month</div>
                )}
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {form.scheduleInterval === "manual" ? "Manual checks use the live SERP endpoint." : "Scheduled checks use the cheaper DataForSEO task queue."} Charged to your DataForSEO balance.
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                {editing ? "Save changes" : "Add Domain"}
              </Button>
            </DialogFooter>
          </>
        ) : created ? (
          <KeywordSuggestionStep projectId={projectId} config={created} onDone={() => finish(created.id)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Step 2: top ranked keywords (Labs ranked_keywords, top 100 by traffic); pre-selects the top 20. */
function KeywordSuggestionStep({
  projectId,
  config,
  onDone,
}: {
  projectId: string;
  config: { id: string; domain: string; locationCode: number };
  onDone: () => void;
}) {
  const labs = isLabsLocationCode(config.locationCode);
  const [state, setState] = useState<{ status: "loading" | "error" | "ready"; error?: string; rows: DomainKeywordSuggestion[] }>({
    status: labs ? "loading" : "ready",
    rows: [],
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!labs) return;
    let cancelled = false;
    void getTrackerKeywordSuggestionsAction(projectId, config.id).then((res) => {
      if (cancelled) return;
      if (!res.ok) return setState({ status: "error", error: res.error, rows: [] });
      const rows = res.data.keywords;
      setState({ status: "ready", rows });
      const top = [...rows].sort((a, b) => (b.traffic ?? 0) - (a.traffic ?? 0)).slice(0, PRE_SELECT_COUNT);
      setSelected(new Set(top.map((r) => r.keyword)));
    });
    return () => {
      cancelled = true;
    };
  }, [labs, projectId, config.id]);

  const save = async () => {
    setSaving(true);
    try {
      const res = unwrap(await addTrackingKeywordsAction(projectId, { configId: config.id, keywords: [...selected] }));
      toast.success(`Added ${res.added} keyword${res.added === 1 ? "" : "s"} for tracking`);
      onDone();
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<DomainKeywordSuggestion>[] = [
    { id: "keyword", header: "Keyword", sortValue: (r) => r.keyword, cell: (r) => <span className="font-medium">{r.keyword}</span> },
    { id: "position", header: "Position", align: "right", sortValue: (r) => r.position, cell: (r) => r.position ?? "-" },
    { id: "volume", header: "Volume", align: "right", sortValue: (r) => r.searchVolume, cell: (r) => formatNumber(r.searchVolume, { maximumFractionDigits: 0 }) },
    { id: "traffic", header: "Traffic", align: "right", sortValue: (r) => r.traffic, cell: (r) => formatNumber(r.traffic != null ? Math.round(r.traffic) : null) },
  ];

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-brand" /> Pick keywords to track
        </DialogTitle>
        <DialogDescription>Keywords {config.domain} already ranks for, sorted by estimated traffic.</DialogDescription>
      </DialogHeader>
      {!labs ? (
        <EmptyState
          compact
          title="Add keywords manually"
          description="Ranked-keyword suggestions aren't available for this country. Add the keywords you want to track on the next screen."
        />
      ) : state.status === "loading" ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <span className="font-medium text-foreground">Finding your top keywords...</span>
          This usually takes a few seconds
        </div>
      ) : state.status === "error" ? (
        <EmptyState compact icon={AlertTriangle} title="Couldn't fetch keywords" description={state.error} />
      ) : state.rows.length === 0 ? (
        <EmptyState compact title="No rankings found" description="We couldn't find ranked keywords for this domain. You can add keywords manually." />
      ) : (
        <div className="max-h-[50dvh] overflow-y-auto">
          <DataTable
            columns={columns}
            data={state.rows}
            getRowId={(r) => r.keyword}
            initialSort={{ id: "traffic", dir: "desc" }}
            selectable
            selected={selected}
            onSelectedChange={setSelected}
            paginate={false}
            dense
            stickyHeader
            mobileCard={(r) => (
              <label className="flex items-start gap-3">
                <Checkbox
                  checked={selected.has(r.keyword)}
                  onCheckedChange={(v) => {
                    const next = new Set(selected);
                    if (v) next.add(r.keyword);
                    else next.delete(r.keyword);
                    setSelected(next);
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{r.keyword}</span>
                  <span className="text-xs text-muted-foreground tabular">
                    Pos {r.position ?? "-"} · Vol {formatNumber(r.searchVolume, { maximumFractionDigits: 0 })} · Traffic {formatNumber(r.traffic != null ? Math.round(r.traffic) : null)}
                  </span>
                </span>
              </label>
            )}
          />
        </div>
      )}
      <DialogFooter className="items-center gap-2 sm:justify-between">
        <span className="text-xs text-muted-foreground tabular">
          {labs && state.status === "ready" && state.rows.length > 0 ? `${selected.size} of ${state.rows.length} selected` : ""}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onDone}>
            {labs && state.status === "ready" && state.rows.length > 0 ? "Skip" : !labs ? "Continue" : "Skip"}
          </Button>
          {labs && state.status === "ready" && state.rows.length > 0 && (
            <Button onClick={save} disabled={saving || selected.size === 0}>
              {saving && <Loader2 className="animate-spin" />}
              Save Keywords
            </Button>
          )}
        </div>
      </DialogFooter>
    </>
  );
}
