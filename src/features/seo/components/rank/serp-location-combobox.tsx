"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { SerpLocation } from "@/server/seo/lib/serp-locations";
import { formatLocationLabel } from "@/server/seo/lib/locations";
import { searchSerpLocationsAction } from "../../actions/rank";
import { cn } from "@/lib/utils";

/** City / region picker over DataForSEO's SERP location registry (350 ms debounced, ranked server-side). */
export function SerpLocationCombobox({
  projectId,
  countryCode,
  value,
  onChange,
  invalid,
}: {
  projectId: string;
  countryCode: string;
  value: string | null;
  onChange: (locationName: string | null) => void;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SerpLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const id = ++seq.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      const res = await searchSerpLocationsAction(projectId, q, countryCode);
      if (id !== seq.current) return;
      setLoading(false);
      if (res.ok) {
        setResults(res.data);
        setError(null);
      } else {
        setResults([]);
        setError(res.error);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [query, projectId, countryCode]);

  const hasQuery = query.trim() !== "";
  const shown = hasQuery ? results : [];
  const shownError = hasQuery ? error : null;
  const busy = hasQuery && loading;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-invalid={invalid || undefined}
          className={cn("h-9 w-full justify-between gap-2 font-normal", !value && "text-muted-foreground")}
        >
          <span className="flex min-w-0 items-center gap-2">
            <MapPin className="size-3.5 shrink-0" />
            <span className="truncate">{value ? formatLocationLabel(value) : "Search cities..."}</span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search cities..." value={query} onValueChange={setQuery} className="h-9" />
          <CommandList className="max-h-72">
            {busy && (
              <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Searching locations…
              </div>
            )}
            {!busy && shownError && <div className="px-3 py-3 text-xs text-destructive">{shownError}</div>}
            {!busy && !shownError && (
              <CommandEmpty>{query.trim() ? "No matching city or region." : "Type a city, county or region."}</CommandEmpty>
            )}
            <CommandGroup>
              {shown.map((r) => (
                <CommandItem
                  key={r.locationCode}
                  value={String(r.locationCode)}
                  onSelect={() => {
                    onChange(r.locationName);
                    setOpen(false);
                  }}
                  className="gap-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{r.displayLabel}</span>
                    <span className="block text-[11px] text-muted-foreground">{r.locationType}</span>
                  </span>
                  <Check className={cn("size-3.5", value === r.locationName ? "opacity-100" : "opacity-0")} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
