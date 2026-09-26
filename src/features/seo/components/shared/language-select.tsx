"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { languageLabel, SERP_LANGUAGE_OPTIONS } from "@/server/seo/lib/locations";
import { cn } from "@/lib/utils";

/** Searchable language picker over the full SERP language list (or a restricted list). */
export function LanguageSelect({
  value,
  onChange,
  options = SERP_LANGUAGE_OPTIONS as readonly { code: string; label: string }[],
  className,
}: {
  value: string;
  onChange: (code: string) => void;
  options?: readonly { code: string; label: string }[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className={cn("h-9 justify-between font-normal", className)} aria-label="Language">
          <span className="truncate">{languageLabel(value)}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command filter={(v, s) => (v.toLowerCase().includes(s.toLowerCase()) ? 1 : 0)}>
          <CommandInput placeholder="Search languages…" className="h-9" />
          <CommandList className="max-h-72">
            <CommandEmpty>No language found.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.code}
                  value={`${o.label} ${o.code}`}
                  onSelect={() => {
                    onChange(o.code);
                    setOpen(false);
                  }}
                >
                  <span className="flex-1">{o.label}</span>
                  <span className="text-xs text-muted-foreground">{o.code}</span>
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
