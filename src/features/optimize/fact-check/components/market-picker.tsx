"use client";

import { X } from "lucide-react";
import { MultiSelect } from "@/components/app/filters";
import { Input } from "@/components/ui/input";
import { COUNTRIES, flagEmoji } from "@/lib/countries";
import { defaultRegulator } from "@/features/optimize/constants";
import type { FcMarketView } from "../types";

const OPTIONS = COUNTRIES.map((c) => ({
  value: c.iso,
  label: c.name,
  icon: <span className="text-[14px] leading-none">{flagEmoji(c.iso)}</span>,
}));

/** Market multi-select with an editable regulator per market ("DE · EMA", "US · FDA"). */
export function MarketPicker({ value, onChange }: { value: FcMarketView[]; onChange: (v: FcMarketView[]) => void }) {
  return (
    <div className="space-y-2">
      <MultiSelect
        options={OPTIONS}
        value={value.map((m) => m.country)}
        onChange={(isos) => onChange(isos.map((iso) => value.find((m) => m.country === iso) ?? { country: iso, regulator: defaultRegulator(iso) }))}
        placeholder="Select markets"
        label="Markets"
        className="w-full"
      />
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((m) => (
            <span key={m.country} className="inline-flex h-7 items-center gap-1 rounded-lg border bg-background pr-1 pl-2 text-xs">
              <span className="text-[14px] leading-none">{flagEmoji(m.country)}</span>
              <span className="font-medium">{m.country}</span>
              <span className="text-muted-foreground">·</span>
              <Input
                aria-label={`Regulator for ${m.country}`}
                value={m.regulator}
                onChange={(e) => onChange(value.map((x) => (x.country === m.country ? { ...x, regulator: e.target.value.slice(0, 40) } : x)))}
                className="h-5 w-[92px] border-none bg-transparent px-1 text-xs shadow-none focus-visible:ring-1"
              />
              <button
                type="button"
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={`Remove ${m.country}`}
                onClick={() => onChange(value.filter((x) => x.country !== m.country))}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
