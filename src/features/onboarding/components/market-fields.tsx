"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { COUNTRIES, flagEmoji, getCountry, LANGUAGES } from "@/lib/countries";
import { cn } from "@/lib/utils";

/** Searchable country (market) picker with flags. */
export function CountryPicker({
  value,
  onChange,
  id,
  placeholder = "Select a market",
  searchPlaceholder = "Search country…",
  emptyText = "No country found.",
  className,
  disabled,
}: {
  value: string;
  onChange: (iso: string) => void;
  id?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = getCountry(value);
  const sorted = useMemo(() => [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name)), []);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("h-10 w-full justify-between bg-background px-3 text-sm font-normal", className)}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="text-base leading-none">{flagEmoji(current?.iso)}</span>
            <span className={cn("truncate", !current && "text-muted-foreground")}>{current?.name ?? placeholder}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="h-10" />
          <CommandList className="max-h-72">
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {sorted.map((c) => (
                <CommandItem
                  key={c.iso}
                  value={`${c.name} ${c.iso}`}
                  onSelect={() => {
                    onChange(c.iso);
                    setOpen(false);
                  }}
                  className="gap-2"
                >
                  <span className="text-base leading-none">{flagEmoji(c.iso)}</span>
                  <span className="flex-1 truncate">{c.name}</span>
                  {c.iso === current?.iso && <Check className="size-4 text-brand" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Language select; the market's languages are listed first. */
export function LanguageSelect({
  value,
  onChange,
  country,
  id,
  recommendedLabel = "Recommended",
  allLabel = "All languages",
  className,
  disabled,
}: {
  value: string;
  onChange: (code: string) => void;
  country?: string;
  id?: string;
  recommendedLabel?: string;
  allLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const c = getCountry(country);
  const recommended = LANGUAGES.filter((l) => c?.languages.includes(l.code));
  const rest = LANGUAGES.filter((l) => !c?.languages.includes(l.code));
  const known = LANGUAGES.some((l) => l.code === value);
  return (
    <Select value={known ? value : undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className={cn("h-10! w-full bg-background", className)}>
        <SelectValue placeholder="Select a language" />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {recommended.length > 0 && (
          <>
            <SelectGroup>
              <SelectLabel>{recommendedLabel}</SelectLabel>
              {recommended.map((l) => (
                <SelectItem key={l.code} value={l.code}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectSeparator />
          </>
        )}
        <SelectGroup>
          <SelectLabel>{allLabel}</SelectLabel>
          {rest.map((l) => (
            <SelectItem key={l.code} value={l.code}>
              {l.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
