"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, LocateFixed, MapPin, Play, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { flagEmoji } from "@/lib/countries";
import { getLocationOption } from "@/server/seo/lib/locations";
import { geocodePlaceAction, listBusinessCategoriesAction } from "../../actions/local";
import { LocationSelect } from "../shared/location-select";
import { CostPill } from "../shared/badges";
import { parseCoordinates, type LatLng } from "./shared";
import { cn } from "@/lib/utils";

/* ───────────────────────────── Field wrapper ───────────────────────────── */

export function Field({ label, hint, children, className }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {children}
      {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

/* ───────────────────────────── Location picker ───────────────────────────── */

export type LocationValue = { lat: string; lng: string; radius: string; label?: string };

export const EMPTY_LOCATION: LocationValue = { lat: "", lng: "", radius: "" };

export function locationFromLatLng(c: LatLng, label?: string, radius = ""): LocationValue {
  return { lat: String(Number(c.latitude.toFixed(7))), lng: String(Number(c.longitude.toFixed(7))), radius, label };
}

export function readLocation(v: LocationValue): LatLng | null {
  if (v.lat.trim() === "" || v.lng.trim() === "") return null;
  const latitude = Number(v.lat);
  const longitude = Number(v.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

type GeoResult = { label: string; latitude: number; longitude: number; type: string };

/**
 * Place search (OpenStreetMap), manual lat/lng, or paste "lat,lng" / a Google Maps URL.
 * Optional radius (km) for tools that search an area.
 */
export function LocationPicker({
  projectId,
  value,
  onChange,
  radius,
  disabled,
}: {
  projectId: string;
  value: LocationValue;
  onChange: (v: LocationValue) => void;
  radius?: { min: number; max: number; placeholder: string; label?: string };
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3 || parseCoordinates(q)) return;
    const id = ++seq.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      const res = await geocodePlaceAction(projectId, q);
      if (id !== seq.current) return;
      setLoading(false);
      if (res.ok) {
        setResults(res.data);
        setError(null);
        setOpen(true);
      } else setError(res.error);
    }, 550);
    return () => clearTimeout(timer);
  }, [query, projectId]);

  const onQuery = (text: string) => {
    const coords = parseCoordinates(text);
    if (coords) {
      onChange(locationFromLatLng(coords, "Pasted coordinates", value.radius));
      setQuery("");
      setResults([]);
      setOpen(false);
      return;
    }
    setQuery(text);
    if (text.trim().length < 3) {
      setResults([]);
      setOpen(false);
    }
  };

  const picked = readLocation(value);
  return (
    <div className="space-y-2">
      <Popover open={open && (results.length > 0 || !!error)} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              disabled={disabled}
              onChange={(e) => onQuery(e.target.value)}
              onFocus={() => results.length && setOpen(true)}
              placeholder="Search a place, or paste lat,lng / a Google Maps link"
              className="h-9 pr-8 pl-8"
              aria-label="Search a place"
            />
            {loading && <Loader2 className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />}
          </div>
        </PopoverAnchor>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-72 p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
          <Command shouldFilter={false}>
            <CommandList className="max-h-64">
              <CommandEmpty>{error ?? "No places found."}</CommandEmpty>
              <CommandGroup>
                {results.map((r) => (
                  <CommandItem
                    key={`${r.latitude},${r.longitude},${r.label}`}
                    value={`${r.label}|${r.latitude}|${r.longitude}`}
                    onSelect={() => {
                      onChange(locationFromLatLng(r, r.label, value.radius));
                      setQuery("");
                      setOpen(false);
                    }}
                    className="items-start gap-2"
                  >
                    <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="line-clamp-2 text-sm">{r.label}</span>
                      <span className="text-[11px] text-muted-foreground tabular">
                        {r.latitude.toFixed(4)}, {r.longitude.toFixed(4)}
                        {r.type ? ` · ${r.type}` : ""}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <div className={cn("grid gap-2", radius ? "grid-cols-3" : "grid-cols-2")}>
        <Input
          value={value.lat}
          disabled={disabled}
          inputMode="decimal"
          placeholder="Latitude"
          aria-label="Latitude"
          onChange={(e) => onChange({ ...value, lat: e.target.value, label: undefined })}
          className="h-9 tabular"
        />
        <Input
          value={value.lng}
          disabled={disabled}
          inputMode="decimal"
          placeholder="Longitude"
          aria-label="Longitude"
          onChange={(e) => onChange({ ...value, lng: e.target.value, label: undefined })}
          className="h-9 tabular"
        />
        {radius && (
          <div className="relative">
            <Input
              value={value.radius}
              disabled={disabled}
              type="number"
              inputMode="decimal"
              min={radius.min}
              max={radius.max}
              step="any"
              placeholder={radius.placeholder}
              aria-label={radius.label ?? "Radius (km)"}
              onChange={(e) => onChange({ ...value, radius: e.target.value })}
              className="h-9 pr-9 tabular"
            />
            <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">km</span>
          </div>
        )}
      </div>
      {picked ? (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <LocateFixed className="size-3 text-brand" />
          <span className="truncate">{value.label ?? "Custom coordinates"}</span>
          <button type="button" className="ml-auto rounded p-0.5 hover:bg-muted hover:text-foreground" onClick={() => onChange(EMPTY_LOCATION)} aria-label="Clear location">
            <X className="size-3" />
          </button>
        </div>
      ) : (
        (value.lat || value.lng) && <p className="text-[11px] text-destructive">Enter a valid latitude (−90…90) and longitude (−180…180).</p>
      )}
    </div>
  );
}

/* ───────────────────────────── Business identifier ───────────────────────────── */

export type IdentifierKind = "businessName" | "cid" | "placeId";
export type IdentifierValue = { kind: IdentifierKind; value: string };
export const EMPTY_IDENTIFIER: IdentifierValue = { kind: "businessName", value: "" };

export function identifierInput(v: IdentifierValue): { businessName?: string; cid?: string; placeId?: string } | null {
  const value = v.value.trim();
  if (!value) return null;
  return { [v.kind]: value };
}

const KIND_LABEL: Record<IdentifierKind, string> = { businessName: "Name", cid: "CID", placeId: "Place ID" };
const KIND_PLACEHOLDER: Record<IdentifierKind, string> = {
  businessName: "Business name as on Google, e.g. Joe's Pizza",
  cid: "Google CID, e.g. 1234567890123456789",
  placeId: "Google Maps place ID, e.g. ChIJ…",
};

/** Exactly one of business name / CID / place ID (CID is the most precise). */
export function IdentifierInput({ value, onChange, disabled }: { value: IdentifierValue; onChange: (v: IdentifierValue) => void; disabled?: boolean }) {
  return (
    <div className="space-y-2">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={value.kind}
        disabled={disabled}
        onValueChange={(k) => k && onChange({ kind: k as IdentifierKind, value: "" })}
        className="w-full"
      >
        {(Object.keys(KIND_LABEL) as IdentifierKind[]).map((k) => (
          <ToggleGroupItem key={k} value={k} className="flex-1 text-xs">
            {KIND_LABEL[k]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Input
        value={value.value}
        disabled={disabled}
        maxLength={value.kind === "cid" ? 64 : value.kind === "placeId" ? 256 : 200}
        placeholder={KIND_PLACEHOLDER[value.kind]}
        onChange={(e) => onChange({ ...value, value: e.target.value })}
        className="h-9"
        aria-label={KIND_LABEL[value.kind]}
      />
    </div>
  );
}

/* ───────────────────────────── Search area (market or near) ───────────────────────────── */

export type AreaValue = { mode: "market" | "near"; locationCode: number; near: LocationValue };

/** Where the business is looked up: a country market (default: project market) or near a coordinate. */
export function AreaInput({ projectId, value, onChange, disabled }: { projectId: string; value: AreaValue; onChange: (v: AreaValue) => void; disabled?: boolean }) {
  const market = getLocationOption(value.locationCode);
  return (
    <div className="space-y-2">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={value.mode}
        disabled={disabled}
        onValueChange={(m) => m && onChange({ ...value, mode: m as AreaValue["mode"] })}
        className="w-full"
      >
        <ToggleGroupItem value="market" className="flex-1 text-xs">
          {flagEmoji(market?.shortLabel)} Country
        </ToggleGroupItem>
        <ToggleGroupItem value="near" className="flex-1 text-xs">
          <MapPin className="size-3" /> Near a location
        </ToggleGroupItem>
      </ToggleGroup>
      {value.mode === "market" ? (
        <LocationSelect value={value.locationCode} onChange={(code) => onChange({ ...value, locationCode: code })} disabled={disabled} className="w-full" />
      ) : (
        <LocationPicker
          projectId={projectId}
          value={value.near}
          onChange={(near) => onChange({ ...value, near })}
          radius={{ min: 0.2, max: 199, placeholder: "10" }}
          disabled={disabled}
        />
      )}
    </div>
  );
}

/** Serializes an AreaValue into the business_data location inputs (`near` wins over locationCode). */
export function areaInput(v: AreaValue): { near?: { latitude: number; longitude: number; radiusKm?: number }; locationCode?: number } | null {
  if (v.mode === "market") return { locationCode: v.locationCode };
  const c = readLocation(v.near);
  if (!c) return null;
  const r = Number(v.near.radius);
  return { near: { ...c, radiusKm: v.near.radius.trim() !== "" && Number.isFinite(r) ? Math.min(199, Math.max(0.2, r)) : undefined } };
}

/* ───────────────────────────── Categories (free) ───────────────────────────── */

type Category = { category: string; businessCount: number | null };

export function CategoryPicker({
  projectId,
  value,
  onChange,
  disabled,
}: {
  projectId: string;
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!open || disabled) return;
    const id = ++seq.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      const res = await listBusinessCategoriesAction(projectId, query);
      if (id !== seq.current) return;
      setLoading(false);
      if (res.ok) {
        setItems(res.data.categories);
        setError(null);
      } else setError(res.error);
    }, 250);
    return () => clearTimeout(timer);
  }, [open, query, projectId, disabled]);

  const toggle = (c: string) => onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c].slice(0, 10));
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((c) => (
            <span key={c} className="inline-flex h-6 items-center gap-1 rounded-full bg-brand-soft px-2 text-[11px] font-medium text-foreground">
              {c.replace(/_/g, " ")}
              <button type="button" onClick={() => toggle(c)} className="opacity-60 hover:opacity-100" aria-label={`Remove ${c}`}>
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              disabled={disabled || value.length >= 10}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              placeholder={value.length >= 10 ? "Maximum 10 categories" : "Search categories, e.g. pizza"}
              className="h-9 pl-8"
              aria-label="Business categories"
            />
            {loading && <Loader2 className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />}
          </div>
        </PopoverAnchor>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-72 p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
          <Command shouldFilter={false}>
            <CommandList className="max-h-64">
              <CommandEmpty>{error ?? (loading ? "Loading…" : "No categories found.")}</CommandEmpty>
              <CommandGroup>
                {items.map((c) => (
                  <CommandItem key={c.category} value={c.category} onSelect={() => toggle(c.category)} className="gap-2">
                    <Check className={cn("size-3.5", value.includes(c.category) ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1 truncate">{c.category.replace(/_/g, " ")}</span>
                    {c.businessCount != null && <span className="text-[11px] text-muted-foreground tabular">{c.businessCount.toLocaleString()}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* ───────────────────────────── Run bar ───────────────────────────── */

export function RunBar({
  label,
  costUsd,
  disabled,
  busy,
  reason,
  onRun,
  note,
}: {
  label: string;
  costUsd: number;
  disabled?: boolean;
  busy?: boolean;
  reason?: string | null;
  onRun: () => void;
  note?: React.ReactNode;
}) {
  return (
    <div className="space-y-2 border-t pt-3">
      {note}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={onRun} disabled={disabled || busy || Boolean(reason)} className="h-9 gap-1.5 px-4">
          {busy ? <Loader2 className="animate-spin" /> : <Play className="size-3.5" />}
          {label}
        </Button>
        <CostPill usd={costUsd} />
      </div>
      {reason && <p className="text-[11px] text-muted-foreground">{reason}</p>}
    </div>
  );
}
