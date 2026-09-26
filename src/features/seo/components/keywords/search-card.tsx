"use client";

import { useState, useSyncExternalStore } from "react";
import { Info, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Panel } from "@/components/app/page";
import { MAX_KEYWORDS_PER_SUBMIT, parseKeywordInput, RESULT_LIMITS, type KeywordMode, type ResultLimit } from "@/server/seo/lib/keywords";
import { getKeywordDataProvider, isSupportedLocationCode } from "@/server/seo/lib/locations";
import { estimateKeywordResearch } from "@/server/seo/lib/costs";
import { LocationSelect } from "../shared/location-select";
import { CostPill, HelpTip } from "../shared/badges";
import { MODES, type KeywordSearchInput } from "./params";

const CLICKSTREAM_HELP =
  "Google reports one combined search volume for similar keywords (e.g. 'seo tool' and 'seo tools'). Turn this on to estimate each keyword's own volume. Costs 2x the credits.";

export function preferredLocationKey(projectId: string) {
  return `keyword-preferred-location:${projectId}`;
}

const noopSubscribe = () => () => {};

function readPreferredLocation(projectId: string): number | null {
  try {
    const stored = Number(window.localStorage.getItem(preferredLocationKey(projectId)));
    return stored && isSupportedLocationCode(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** Search card: keyword textarea (≤5, one per line), location, result limit, mode, clickstream toggle. */
export function KeywordSearchCard({
  projectId,
  initial,
  disabled,
  onSubmit,
}: {
  projectId: string;
  initial: KeywordSearchInput;
  disabled?: boolean;
  onSubmit: (inputs: KeywordSearchInput[]) => void;
}) {
  // The parent keys this card by the active search, so it re-initialises from `initial` on tab switches.
  const [text, setText] = useState(initial.keyword);
  const [chosenLoc, setLoc] = useState<number | null>(initial.keyword ? initial.loc : null);
  const [kLimit, setKLimit] = useState<ResultLimit>(initial.kLimit);
  const [mode, setMode] = useState<KeywordMode>(initial.mode);
  const [cs, setCs] = useState(initial.cs);
  const [error, setError] = useState<string | null>(null);
  // Location preference: URL loc > per-project localStorage > project default.
  const preferred = useSyncExternalStore(noopSubscribe, () => readPreferredLocation(projectId), () => null);
  const loc = chosenLoc ?? preferred ?? initial.loc;

  const provider = getKeywordDataProvider(loc);
  const estimate = estimateKeywordResearch({ resultLimit: kLimit, clickstream: provider === "labs" && cs, provider, mode });
  const lines = Math.min(5, Math.max(1, text.split("\n").length));

  const submit = () => {
    const keywords = parseKeywordInput(text);
    if (keywords.length === 0) return setError("Please enter at least one keyword.");
    if (keywords.length > MAX_KEYWORDS_PER_SUBMIT) return setError(`Please enter no more than ${MAX_KEYWORDS_PER_SUBMIT} keywords (one per line).`);
    setError(null);
    try {
      if (isSupportedLocationCode(loc)) window.localStorage.setItem(preferredLocationKey(projectId), String(loc));
    } catch {
      // storage unavailable
    }
    onSubmit(
      keywords.map((k) => ({
        keyword: k.toLowerCase(),
        loc,
        kLimit,
        mode: provider === "google_ads" ? "auto" : mode,
        cs: provider === "labs" && cs,
      })),
    );
  };

  return (
    <Panel contentClassName="p-3 sm:p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-3"
      >
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Textarea
              value={text}
              rows={lines}
              onChange={(e) => {
                setText(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="Enter a keyword"
              aria-label="Keywords (one per line)"
              aria-invalid={error ? true : undefined}
              className="max-h-32 min-h-9 resize-none bg-background py-2 pl-9 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:flex-nowrap">
            <LocationSelect value={loc} onChange={setLoc} className="col-span-2 sm:w-52" />
            <Select value={String(kLimit)} onValueChange={(v) => setKLimit(Number(v) as ResultLimit)}>
              <SelectTrigger className="h-9 w-full sm:w-32" aria-label="Result limit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESULT_LIMITS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} results
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={provider === "google_ads" ? "auto" : mode} onValueChange={(v) => setMode(v as KeywordMode)} disabled={provider === "google_ads"}>
              <SelectTrigger className="h-9 w-full sm:w-40" aria-label="Keyword source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" className="col-span-2 h-9 px-4" disabled={disabled}>
              <Search /> Search
            </Button>
          </div>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {provider === "labs" ? (
            <div className="flex items-center gap-2">
              <Switch id="kw-clickstream" checked={cs} onCheckedChange={setCs} />
              <Label htmlFor="kw-clickstream" className="text-xs font-normal text-muted-foreground">
                Clickstream-refined volumes
              </Label>
              <HelpTip text={CLICKSTREAM_HELP} />
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-lg bg-info/10 px-3 py-2 text-xs text-info">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>Keyword data for this country comes from Google Ads — search volume, CPC, and trends are available, but difficulty and intent are not.</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="hidden sm:inline">Enter to search · Shift+Enter for a new line · up to 5 keywords</span>
            <CostPill usd={estimate.minUsd} max={estimate.maxUsd} label="per keyword" />
          </div>
        </div>
      </form>
    </Panel>
  );
}
