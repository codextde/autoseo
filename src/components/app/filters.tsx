"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, Check, ChevronDown, Search, SlidersHorizontal, Tag, X } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/* ─────────────── Period selector (7d / 30d / 90d / custom) ─────────────── */

export type Period = { preset: string; from?: string; to?: string };

export const PERIOD_PRESETS = [
  { key: "7d", label: "7d", days: 7 },
  { key: "30d", label: "30d", days: 30 },
  { key: "90d", label: "90d", days: 90 },
];

/** Resolves a period (preset or custom "from..to") into concrete dates (UTC midnight bounds). */
export function resolvePeriod(preset: string | null | undefined, from?: string | null, to?: string | null) {
  const end = to ? new Date(`${to}T23:59:59.999Z`) : new Date();
  if (preset === "custom" && from) return { from: new Date(`${from}T00:00:00.000Z`), to: end, days: Math.max(1, Math.round((end.getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000)) };
  const days = PERIOD_PRESETS.find((p) => p.key === preset)?.days ?? 30;
  const start = new Date(end.getTime() - days * 86400000);
  return { from: start, to: end, days };
}

export function PeriodSelect({
  value,
  onChange,
  from,
  to,
  onCustom,
  presets = PERIOD_PRESETS,
  className,
}: {
  value: string;
  onChange: (preset: string) => void;
  from?: string;
  to?: string;
  onCustom?: (range: { from: string; to: string }) => void;
  presets?: { key: string; label: string }[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<DateRange | undefined>(
    from ? { from: new Date(from), to: to ? new Date(to) : undefined } : undefined,
  );
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <div className="flex rounded-lg bg-muted p-0.5">
        {presets.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => onChange(p.key)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              value === p.key ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {onCustom && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant={value === "custom" ? "secondary" : "outline"} size="sm" className="h-8 gap-1.5 px-2 text-xs">
              <CalendarIcon className="size-3.5" />
              {value === "custom" && from ? `${format(new Date(from), "MMM d")} – ${to ? format(new Date(to), "MMM d") : "now"}` : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="range" numberOfMonths={2} selected={range} onSelect={setRange} disabled={{ after: new Date() }} />
            <div className="flex justify-end gap-2 border-t p-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!range?.from}
                onClick={() => {
                  if (!range?.from) return;
                  onCustom({ from: format(range.from, "yyyy-MM-dd"), to: format(range.to ?? range.from, "yyyy-MM-dd") });
                  setOpen(false);
                }}
              >
                Apply
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

/* ─────────────────────────── Multi select ─────────────────────────── */

export type Option = { value: string; label: string; icon?: React.ReactNode; count?: number; description?: string };

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "All",
  label,
  icon,
  className,
  searchable = true,
  single,
}: {
  options: Option[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  label?: string;
  icon?: React.ReactNode;
  className?: string;
  searchable?: boolean;
  single?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabels = options.filter((o) => value.includes(o.value));
  const text =
    value.length === 0
      ? placeholder
      : value.length === 1
        ? (selectedLabels[0]?.label ?? value[0])
        : `${label ?? "Selected"} (${value.length})`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("h-8 justify-between gap-1.5 bg-background px-2.5 text-xs font-normal", className)}>
          <span className="flex min-w-0 items-center gap-1.5">
            {icon}
            <span className="truncate">{text}</span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          {searchable && options.length > 6 && <CommandInput placeholder="Search…" className="h-9" />}
          <CommandList>
            <CommandEmpty>Nothing found.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const checked = value.includes(o.value);
                return (
                  <CommandItem
                    key={o.value}
                    value={`${o.label} ${o.value}`}
                    onSelect={() => {
                      if (single) {
                        onChange(checked ? [] : [o.value]);
                        setOpen(false);
                      } else onChange(checked ? value.filter((v) => v !== o.value) : [...value, o.value]);
                    }}
                    className="gap-2"
                  >
                    <span
                      className={cn(
                        "flex size-4 items-center justify-center rounded-[4px] border",
                        checked ? "border-foreground bg-foreground text-background" : "border-input",
                      )}
                    >
                      {checked && <Check className="size-3" />}
                    </span>
                    {o.icon}
                    <span className="flex-1 truncate">{o.label}</span>
                    {o.count != null && <span className="text-xs text-muted-foreground tabular">{o.count}</span>}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {value.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onSelect={() => onChange([])} className="justify-center text-xs text-muted-foreground">
                    Clear selection
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function TagFilter(props: Omit<React.ComponentProps<typeof MultiSelect>, "icon" | "label" | "placeholder">) {
  return <MultiSelect {...props} icon={<Tag className="size-3.5 text-muted-foreground" />} label="Tags" placeholder="All Tags" />;
}

/* ─────────────────────────── Search input ─────────────────────────── */

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  className,
  debounce = 250,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  debounce?: number;
}) {
  const [local, setLocal] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    // Adopt external changes (e.g. "clear filters") during render instead of in an effect.
    setPrevValue(value);
    setLocal(value);
  }
  useEffect(() => {
    if (local === value) return;
    const t = setTimeout(() => onChange(local), debounce);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);
  return (
    <div className={cn("relative min-w-0", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder}
        className="h-8 bg-background pr-7 pl-8 text-xs"
      />
      {local && (
        <button
          type="button"
          onClick={() => {
            setLocal("");
            onChange("");
          }}
          className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/* ─────────────────── Responsive filter bar (drawer on mobile) ─────────────────── */

export function FilterBar({
  children,
  search,
  right,
  className,
  activeCount = 0,
}: {
  children?: React.ReactNode;
  search?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
  activeCount?: number;
}) {
  const isMobile = useIsMobile();
  const filters = useMemo(() => children, [children]);
  if (isMobile) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        {search && <div className="min-w-0 flex-1">{search}</div>}
        {children && (
          <Drawer>
            <DrawerTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5">
                <SlidersHorizontal className="size-3.5" /> Filters
                {activeCount > 0 && <span className="rounded-full bg-foreground px-1.5 text-[10px] text-background">{activeCount}</span>}
              </Button>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>Filters</DrawerTitle>
              </DrawerHeader>
              <div className="flex flex-col gap-3 px-4 pb-8 [&_button]:w-full">{filters}</div>
            </DrawerContent>
          </Drawer>
        )}
        {right}
      </div>
    );
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {search && <div className="min-w-48 flex-1">{search}</div>}
      {filters}
      {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
    </div>
  );
}
