"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { flagEmoji } from "@/lib/countries";
import { LABS_LOCATION_OPTIONS, LOCATION_OPTIONS, getLocationOption } from "@/server/seo/lib/locations";
import { cn } from "@/lib/utils";

/** Searchable country picker (143 markets, or the 94 Labs markets with `labsOnly`). */
export function LocationSelect({
  value,
  onChange,
  labsOnly,
  className,
  disabled,
  size = "default",
}: {
  value: number;
  onChange: (code: number) => void;
  labsOnly?: boolean;
  className?: string;
  disabled?: boolean;
  size?: "sm" | "default";
}) {
  const [open, setOpen] = useState(false);
  const options = labsOnly ? LABS_LOCATION_OPTIONS : LOCATION_OPTIONS;
  const current = getLocationOption(value);
  const sorted = useMemo(() => [...options].sort((a, b) => a.label.localeCompare(b.label)), [options]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size={size}
          disabled={disabled}
          className={cn("min-w-0 justify-between gap-2 font-normal", size === "default" && "h-9", className)}
          aria-label="Location"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="text-base leading-none">{flagEmoji(current?.shortLabel)}</span>
            <span className="truncate">{current?.label ?? "Select country"}</span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command filter={(v, search) => (v.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}>
          <CommandInput placeholder="Search countries…" className="h-9" />
          <CommandList className="max-h-72">
            <CommandEmpty>No country found.</CommandEmpty>
            <CommandGroup>
              {sorted.map((o) => (
                <CommandItem
                  key={o.code}
                  value={`${o.label} ${o.shortLabel}`}
                  onSelect={() => {
                    onChange(o.code);
                    setOpen(false);
                  }}
                  className="gap-2"
                >
                  <span className="text-base leading-none">{flagEmoji(o.shortLabel)}</span>
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.googleAdsOnly && !labsOnly && <span className="text-[10px] text-muted-foreground">Ads data</span>}
                  <Check className={cn("size-3.5", o.code === value ? "opacity-100" : "opacity-0")} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
