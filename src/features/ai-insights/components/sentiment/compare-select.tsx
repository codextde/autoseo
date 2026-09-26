"use client";

import { ArrowLeftRight } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUrlPatch } from "@/hooks/use-url-state";
import type { BrandDTO } from "../../types";

/** "You vs <brand>" compare selector (URL `?compare=`). */
export function CompareSelect({ own, brands, compare }: { own: BrandDTO; brands: BrandDTO[]; compare: BrandDTO | null }) {
  const [patch] = useUrlPatch();
  const competitors = brands.filter((b) => !b.isOwn);
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-background px-2.5 font-medium">
        <span className="size-2 rounded-full" style={{ background: own.color }} />
        {own.name}
      </span>
      <ArrowLeftRight className="size-3.5 text-muted-foreground" />
      <Select value={compare?.competitorId ?? "none"} onValueChange={(v) => patch({ compare: v })}>
        <SelectTrigger size="sm" className="h-8 min-w-36 text-xs">
          <SelectValue placeholder="Compare with…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No comparison</SelectItem>
          {competitors.map((b) => (
            <SelectItem key={b.key} value={b.competitorId!}>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: b.color }} />
                {b.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
