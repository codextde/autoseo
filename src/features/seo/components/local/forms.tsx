"use client";

import { useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { LocalRunTool, LocalToolInput } from "@/server/seo/local";
import { LanguageSelect } from "../shared/language-select";
import {
  AreaInput,
  areaInput,
  CategoryPicker,
  EMPTY_IDENTIFIER,
  EMPTY_LOCATION,
  Field,
  IdentifierInput,
  identifierInput,
  LocationPicker,
  locationFromLatLng,
  readLocation,
  RunBar,
  type AreaValue,
  type IdentifierValue,
  type LocationValue,
} from "./inputs";
import { clampInt, estimateToolCost, type PickedBusiness } from "./shared";

export type FormSeed = { key: number; business?: PickedBusiness; keyword?: string };

export type FormCommon = {
  projectId: string;
  /** Why running is impossible (not configured / no permission), or null. */
  blockedReason: string | null;
  busy: boolean;
  languageCode: string;
  marketLocationCode: number;
};

type RunFn<T extends LocalRunTool> = (input: LocalToolInput<T>) => void;

function seedLocation(b: PickedBusiness | undefined, radius = ""): LocationValue {
  return b?.latitude != null && b.longitude != null ? locationFromLatLng({ latitude: b.latitude, longitude: b.longitude }, b.title ?? "Picked business", radius) : { ...EMPTY_LOCATION, radius };
}

function seedIdentifier(b: PickedBusiness | undefined): IdentifierValue {
  if (b?.cid) return { kind: "cid", value: b.cid };
  if (b?.placeId) return { kind: "placeId", value: b.placeId };
  if (b?.title) return { kind: "businessName", value: b.title };
  return EMPTY_IDENTIFIER;
}

function seedArea(b: PickedBusiness | undefined, marketLocationCode: number): AreaValue {
  const near = seedLocation(b, "2");
  return { mode: b?.latitude != null ? "near" : "market", locationCode: marketLocationCode, near };
}

function SmallSelect<V extends string>({ value, onChange, options, disabled }: { value: V; onChange: (v: V) => void; options: { value: V; label: string }[]; disabled?: boolean }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as V)} disabled={disabled}>
      <SelectTrigger className="h-9 w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DeviceToggle({ value, onChange, disabled }: { value: "desktop" | "mobile"; onChange: (v: "desktop" | "mobile") => void; disabled?: boolean }) {
  return (
    <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={value} disabled={disabled} onValueChange={(v) => v && onChange(v as "desktop" | "mobile")} className="w-full">
      <ToggleGroupItem value="mobile" className="flex-1 text-xs">
        Mobile
      </ToggleGroupItem>
      <ToggleGroupItem value="desktop" className="flex-1 text-xs">
        Desktop
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

/* ───────────────────────────── Business search ───────────────────────────── */

export function BusinessSearchForm({ common, onRun, seed }: { common: FormCommon; onRun: RunFn<"business_search">; seed?: FormSeed }) {
  const [query, setQuery] = useState(seed?.keyword ?? "");
  const [loc, setLoc] = useState<LocationValue>(seedLocation(seed?.business, "10"));
  const [categories, setCategories] = useState<string[]>([]);
  const [minRating, setMinRating] = useState<"any" | "3" | "3.5" | "4" | "4.5">("any");
  const [minReviews, setMinReviews] = useState("");
  const [claimed, setClaimed] = useState<"any" | "claimed" | "unclaimed">("any");
  const [sortBy, setSortBy] = useState<"relevance" | "rating" | "reviews">("relevance");
  const [limit, setLimit] = useState("20");
  const center = readLocation(loc);
  const reason = common.blockedReason ?? (!center ? "Pick a location to search around." : null);
  const run = () => {
    if (!center) return;
    const r = Number(loc.radius);
    onRun({
      query: query.trim() || undefined,
      near: { ...center, radiusKm: loc.radius.trim() !== "" && Number.isFinite(r) ? Math.max(1, r) : 10 },
      categories: categories.length ? categories : undefined,
      minRating: minRating === "any" ? undefined : Number(minRating),
      minReviews: minReviews.trim() !== "" ? clampInt(minReviews, 0, 1_000_000, 0) : undefined,
      isClaimed: claimed === "any" ? undefined : claimed === "claimed",
      sortBy,
      limit: clampInt(limit, 1, 50, 20),
    });
  };
  return (
    <div className="space-y-4">
      <Field label="Business name or text (optional)">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={200} placeholder="e.g. solar installer" className="h-9" />
      </Field>
      <Field label="Location & radius" hint="Radius in whole kilometres (min 1).">
        <LocationPicker projectId={common.projectId} value={loc} onChange={setLoc} radius={{ min: 1, max: 1000, placeholder: "10" }} />
      </Field>
      <Field label="Categories (optional, up to 10)" hint="Google Business categories — the list is free and ranked by how many businesses use them.">
        <CategoryPicker projectId={common.projectId} value={categories} onChange={setCategories} disabled={Boolean(common.blockedReason)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Min rating">
          <SmallSelect
            value={minRating}
            onChange={setMinRating}
            options={[
              { value: "any", label: "Any" },
              { value: "3", label: "3.0 ★+" },
              { value: "3.5", label: "3.5 ★+" },
              { value: "4", label: "4.0 ★+" },
              { value: "4.5", label: "4.5 ★+" },
            ]}
          />
        </Field>
        <Field label="Min reviews">
          <Input value={minReviews} onChange={(e) => setMinReviews(e.target.value)} type="number" min={0} inputMode="numeric" placeholder="Any" className="h-9 tabular" />
        </Field>
        <Field label="Claimed">
          <SmallSelect
            value={claimed}
            onChange={setClaimed}
            options={[
              { value: "any", label: "Any" },
              { value: "claimed", label: "Claimed only" },
              { value: "unclaimed", label: "Unclaimed only" },
            ]}
          />
        </Field>
        <Field label="Sort by">
          <SmallSelect
            value={sortBy}
            onChange={setSortBy}
            options={[
              { value: "relevance", label: "Relevance" },
              { value: "rating", label: "Rating" },
              { value: "reviews", label: "Reviews" },
            ]}
          />
        </Field>
        <Field label="Results (1–50)">
          <Input value={limit} onChange={(e) => setLimit(e.target.value)} type="number" min={1} max={50} inputMode="numeric" className="h-9 tabular" />
        </Field>
      </div>
      <RunBar label="Search businesses" costUsd={estimateToolCost("business_search", {})} busy={common.busy} reason={reason} onRun={run} />
    </div>
  );
}

/* ───────────────────────────── Local SERP ───────────────────────────── */

export function LocalSerpForm({ common, onRun, seed }: { common: FormCommon; onRun: RunFn<"local_serp">; seed?: FormSeed }) {
  const [keyword, setKeyword] = useState(seed?.keyword ?? "");
  const [loc, setLoc] = useState<LocationValue>(seedLocation(seed?.business));
  const [zoom, setZoom] = useState("");
  const [searchType, setSearchType] = useState<"maps" | "local_finder">("maps");
  const [device, setDevice] = useState<"desktop" | "mobile">("mobile");
  const [depth, setDepth] = useState("20");
  const [language, setLanguage] = useState(common.languageCode);
  const center = readLocation(loc);
  const depthN = clampInt(depth, 1, 100, 20);
  const reason = common.blockedReason ?? (!keyword.trim() ? "Enter a keyword." : !center ? "Pick the searcher's location." : null);
  const run = () => {
    if (!center) return;
    onRun({
      keyword: keyword.trim(),
      near: { ...center, zoom: zoom.trim() !== "" ? clampInt(zoom, 4, 18, 14) : undefined },
      searchType,
      device,
      depth: depthN,
      languageCode: language,
    });
  };
  return (
    <div className="space-y-4">
      <Field label="Keyword">
        <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} maxLength={200} placeholder="e.g. pizza near me" className="h-9" />
      </Field>
      <Field label="Searcher location" hint="The exact coordinate the search is run from. Optional zoom 4–18 controls the map viewport.">
        <LocationPicker projectId={common.projectId} value={loc} onChange={setLoc} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Result type">
          <SmallSelect
            value={searchType}
            onChange={setSearchType}
            options={[
              { value: "maps", label: "Google Maps" },
              { value: "local_finder", label: "Local Finder" },
            ]}
          />
        </Field>
        <Field label="Device">
          <DeviceToggle value={device} onChange={setDevice} />
        </Field>
        <Field label="Depth (1–100)">
          <Input value={depth} onChange={(e) => setDepth(e.target.value)} type="number" min={1} max={100} inputMode="numeric" className="h-9 tabular" />
        </Field>
        <Field label="Zoom (optional)">
          <Input value={zoom} onChange={(e) => setZoom(e.target.value)} type="number" min={4} max={18} inputMode="numeric" placeholder="Auto" className="h-9 tabular" />
        </Field>
      </div>
      <Field label="Language">
        <LanguageSelect value={language} onChange={setLanguage} className="w-full" />
      </Field>
      <RunBar label="Check local SERP" costUsd={estimateToolCost("local_serp", { depth: depthN })} busy={common.busy} reason={reason} onRun={run} />
    </div>
  );
}

/* ───────────────────────────── Rank grid ───────────────────────────── */

export function RankGridForm({ common, onRun, seed }: { common: FormCommon; onRun: RunFn<"rank_grid">; seed?: FormSeed }) {
  const b = seed?.business;
  const [keyword, setKeyword] = useState(seed?.keyword ?? "");
  const [name, setName] = useState(b?.title ?? "");
  const [cid, setCid] = useState(b?.cid ?? "");
  const [placeId, setPlaceId] = useState(b?.placeId ?? "");
  const [loc, setLoc] = useState<LocationValue>(seedLocation(b));
  const [gridSize, setGridSize] = useState<3 | 5>(3);
  const [spacing, setSpacing] = useState("2");
  const [device, setDevice] = useState<"desktop" | "mobile">("mobile");
  const [zoom, setZoom] = useState("");
  const [language, setLanguage] = useState(common.languageCode);
  const center = readLocation(loc);
  const spacingN = Math.min(10, Math.max(0.25, Number(spacing) || 2));
  const hasTarget = Boolean(name.trim() || cid.trim() || placeId.trim());
  const reason =
    common.blockedReason ??
    (!keyword.trim() ? "Enter the keyword to check." : !hasTarget ? "Identify the business (CID, place ID or name)." : !center ? "Pick the grid center (usually the storefront)." : null);
  const run = () => {
    if (!center) return;
    onRun({
      keyword: keyword.trim(),
      target: { cid: cid.trim() || undefined, placeId: placeId.trim() || undefined, name: name.trim() || undefined },
      center,
      gridSize,
      spacingKm: spacingN,
      device,
      zoom: zoom.trim() !== "" ? clampInt(zoom, 4, 18, 13) : undefined,
      languageCode: language,
    });
  };
  const span = (gridSize - 1) * spacingN;
  return (
    <div className="space-y-4">
      <Field label="Keyword">
        <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} maxLength={120} placeholder="e.g. solar installer" className="h-9" />
      </Field>
      <Field label="Target business" hint="Matched per grid point by CID, then place ID, then name (contains, case-insensitive).">
        <div className="space-y-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder="Business name" className="h-9" aria-label="Business name" />
          <div className="grid grid-cols-2 gap-2">
            <Input value={cid} onChange={(e) => setCid(e.target.value)} maxLength={64} placeholder="CID" className="h-9" aria-label="CID" />
            <Input value={placeId} onChange={(e) => setPlaceId(e.target.value)} maxLength={256} placeholder="Place ID" className="h-9" aria-label="Place ID" />
          </div>
        </div>
      </Field>
      <Field label="Grid center">
        <LocationPicker projectId={common.projectId} value={loc} onChange={setLoc} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Grid size">
          <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={String(gridSize)} onValueChange={(v) => v && setGridSize(v === "5" ? 5 : 3)} className="w-full">
            <ToggleGroupItem value="3" className="flex-1 text-xs">
              3 × 3
            </ToggleGroupItem>
            <ToggleGroupItem value="5" className="flex-1 text-xs">
              5 × 5
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>
        <Field label="Spacing (km)">
          <Input value={spacing} onChange={(e) => setSpacing(e.target.value)} type="number" step={0.25} min={0.25} max={10} inputMode="decimal" className="h-9 tabular" />
        </Field>
        <Field label="Device">
          <DeviceToggle value={device} onChange={setDevice} />
        </Field>
        <Field label="Zoom (optional)">
          <Input value={zoom} onChange={(e) => setZoom(e.target.value)} type="number" min={4} max={18} inputMode="numeric" placeholder="From spacing" className="h-9 tabular" />
        </Field>
      </div>
      <Field label="Language">
        <LanguageSelect value={language} onChange={setLanguage} className="w-full" />
      </Field>
      <p className="flex items-start gap-1.5 rounded-lg bg-muted px-3 py-2 text-[11px] text-muted-foreground">
        <Info className="mt-px size-3.5 shrink-0" />
        {gridSize * gridSize} Maps searches covering ~{span.toFixed(span < 1 ? 2 : 1)} × {span.toFixed(span < 1 ? 2 : 1)} km. North is on top.
      </p>
      {gridSize === 5 && (
        <p className="flex items-start gap-1.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[11px]">
          <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning" />A 5 × 5 grid runs 25 billed searches — start with 3 × 3 unless you need the extra reach.
        </p>
      )}
      <RunBar label="Build rank grid" costUsd={estimateToolCost("rank_grid", { gridSize })} busy={common.busy} reason={reason} onRun={run} />
    </div>
  );
}

/* ───────────────────────────── Business profile / reviews / Q&A / posts ───────────────────────────── */

export function ProfileForm({ common, onRun, seed }: { common: FormCommon; onRun: RunFn<"business_profile">; seed?: FormSeed }) {
  const [id, setId] = useState<IdentifierValue>(seedIdentifier(seed?.business));
  const [area, setArea] = useState<AreaValue>(seedArea(seed?.business, common.marketLocationCode));
  const [language, setLanguage] = useState(common.languageCode);
  const ident = identifierInput(id);
  const loc = areaInput(area);
  const reason = common.blockedReason ?? (!ident ? "Identify the business." : !loc ? "Pick a valid location or switch to Country." : null);
  return (
    <div className="space-y-4">
      <Field label="Business" hint="CID or place ID (from Business search / Local SERP) is the most precise.">
        <IdentifierInput value={id} onChange={setId} />
      </Field>
      <Field label="Search area">
        <AreaInput projectId={common.projectId} value={area} onChange={setArea} />
      </Field>
      <Field label="Language">
        <LanguageSelect value={language} onChange={setLanguage} className="w-full" />
      </Field>
      <RunBar
        label="Load profile"
        costUsd={estimateToolCost("business_profile", {})}
        busy={common.busy}
        reason={reason}
        onRun={() => ident && loc && onRun({ ...ident, ...loc, languageCode: language })}
      />
    </div>
  );
}

export function ReviewsForm({ common, onRun, seed }: { common: FormCommon; onRun: RunFn<"reviews">; seed?: FormSeed }) {
  const [id, setId] = useState<IdentifierValue>(seedIdentifier(seed?.business));
  const [area, setArea] = useState<AreaValue>(seedArea(seed?.business, common.marketLocationCode));
  const [depth, setDepth] = useState("20");
  const [sortBy, setSortBy] = useState<"newest" | "highest_rating" | "lowest_rating" | "relevant">("newest");
  const [other, setOther] = useState(false);
  const [language, setLanguage] = useState(common.languageCode);
  const ident = identifierInput(id);
  const loc = areaInput(area);
  const depthN = clampInt(depth, 10, 200, 20);
  const reason = common.blockedReason ?? (!ident ? "Identify the business." : !loc ? "Pick a valid location or switch to Country." : null);
  return (
    <div className="space-y-4">
      <Field label="Business">
        <IdentifierInput value={id} onChange={setId} />
      </Field>
      <Field label="Search area">
        <AreaInput projectId={common.projectId} value={area} onChange={setArea} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Reviews (10–200)" hint={other ? "Billed per 20 reviews." : "Billed per 10 reviews."}>
          <Input value={depth} onChange={(e) => setDepth(e.target.value)} type="number" min={10} max={200} step={10} inputMode="numeric" className="h-9 tabular" />
        </Field>
        <Field label="Sort">
          <SmallSelect
            value={sortBy}
            onChange={setSortBy}
            disabled={other}
            options={[
              { value: "newest", label: "Newest" },
              { value: "highest_rating", label: "Highest rating" },
              { value: "lowest_rating", label: "Lowest rating" },
              { value: "relevant", label: "Most relevant" },
            ]}
          />
        </Field>
      </div>
      <label className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5">
        <span>
          <span className="block text-sm font-medium">Include other review sites</span>
          <span className="block text-[11px] text-muted-foreground">Reviews Google shows from Yelp, Tripadvisor, Trustpilot… (costs more, can&apos;t be sorted)</span>
        </span>
        <Switch checked={other} onCheckedChange={setOther} />
      </label>
      <Field label="Language">
        <LanguageSelect value={language} onChange={setLanguage} className="w-full" />
      </Field>
      <RunBar
        label="Collect reviews"
        costUsd={estimateToolCost("reviews", { depth: depthN, includeOtherSources: other })}
        busy={common.busy}
        reason={reason}
        note={<p className="text-[11px] text-muted-foreground">Reviews are a queued DataForSEO task (high priority) — results usually arrive within ~20 seconds.</p>}
        onRun={() => ident && loc && onRun({ ...ident, ...loc, languageCode: language, depth: depthN, sortBy, includeOtherSources: other })}
      />
    </div>
  );
}

export function QuestionsForm({ common, onRun, seed }: { common: FormCommon; onRun: RunFn<"questions">; seed?: FormSeed }) {
  const [id, setId] = useState<IdentifierValue>(seedIdentifier(seed?.business));
  const [loc, setLoc] = useState<LocationValue>(seedLocation(seed?.business, "2"));
  const [depth, setDepth] = useState("20");
  const [language, setLanguage] = useState(common.languageCode);
  const ident = identifierInput(id);
  const center = readLocation(loc);
  const reason = common.blockedReason ?? (!ident ? "Identify the business." : !center ? "Pick the location the business is near." : null);
  const run = () => {
    if (!ident || !center) return;
    const r = Number(loc.radius);
    onRun({
      ...ident,
      near: { ...center, radiusKm: loc.radius.trim() !== "" && Number.isFinite(r) ? Math.min(199, Math.max(0.2, r)) : undefined },
      depth: clampInt(depth, 1, 100, 20),
      languageCode: language,
    });
  };
  return (
    <div className="space-y-4">
      <Field label="Business">
        <IdentifierInput value={id} onChange={setId} />
      </Field>
      <Field label="Near (required)" hint="Radius 0.2–199 km, default 10 km.">
        <LocationPicker projectId={common.projectId} value={loc} onChange={setLoc} radius={{ min: 0.2, max: 199, placeholder: "10" }} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Questions (1–100)">
          <Input value={depth} onChange={(e) => setDepth(e.target.value)} type="number" min={1} max={100} inputMode="numeric" className="h-9 tabular" />
        </Field>
        <Field label="Language">
          <LanguageSelect value={language} onChange={setLanguage} className="w-full" />
        </Field>
      </div>
      <RunBar label="Load Q&A" costUsd={estimateToolCost("questions", {})} busy={common.busy} reason={reason} onRun={run} />
    </div>
  );
}

export function PostsForm({ common, onRun, seed }: { common: FormCommon; onRun: RunFn<"posts">; seed?: FormSeed }) {
  const [id, setId] = useState<IdentifierValue>(seedIdentifier(seed?.business));
  const [area, setArea] = useState<AreaValue>(seedArea(seed?.business, common.marketLocationCode));
  const [depth, setDepth] = useState("10");
  const [language, setLanguage] = useState(common.languageCode);
  const ident = identifierInput(id);
  const loc = areaInput(area);
  const depthN = clampInt(depth, 10, 100, 10);
  const reason = common.blockedReason ?? (!ident ? "Identify the business." : !loc ? "Pick a valid location or switch to Country." : null);
  return (
    <div className="space-y-4">
      <Field label="Business">
        <IdentifierInput value={id} onChange={setId} />
      </Field>
      <Field label="Search area">
        <AreaInput projectId={common.projectId} value={area} onChange={setArea} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Posts (10–100)">
          <Input value={depth} onChange={(e) => setDepth(e.target.value)} type="number" min={10} max={100} step={10} inputMode="numeric" className="h-9 tabular" />
        </Field>
        <Field label="Language">
          <LanguageSelect value={language} onChange={setLanguage} className="w-full" />
        </Field>
      </div>
      <RunBar
        label="Load posts"
        costUsd={estimateToolCost("posts", { depth: depthN })}
        busy={common.busy}
        reason={reason}
        note={<p className="text-[11px] text-muted-foreground">Posts are a queued DataForSEO task — results usually arrive within ~20 seconds.</p>}
        onRun={() => ident && loc && onRun({ ...ident, ...loc, languageCode: language, depth: depthN })}
      />
    </div>
  );
}
