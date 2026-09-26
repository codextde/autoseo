"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  RESEARCH_SCOPE_DESCRIPTIONS,
  RESEARCH_SCOPE_EXAMPLES,
  RESEARCH_SCOPE_LABELS,
  RESEARCH_SCOPES,
  type ResearchScope,
} from "@/server/seo/lib/research-scope";
import { cn } from "@/lib/utils";

/** Research scope dropdown: label, one-line description and wildcard example per option. */
export function ScopeSelect({
  value,
  onChange,
  hasPath,
  className,
}: {
  value: ResearchScope;
  onChange: (scope: ResearchScope) => void;
  /** Subfolder needs a path in the input. */
  hasPath: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className={cn("h-9 justify-between gap-2 font-normal", className)} aria-label="Research scope">
          <span className="truncate">{RESEARCH_SCOPE_LABELS[value]}</span>
          <ChevronDown className="size-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-1" align="start">
        {RESEARCH_SCOPES.map((s) => {
          const disabled = s === "subfolder" && !hasPath;
          return (
            <button
              key={s}
              type="button"
              disabled={disabled}
              onClick={() => {
                onChange(s);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40",
                value === s && "bg-muted",
              )}
            >
              <Check className={cn("mt-0.5 size-3.5 shrink-0", value === s ? "opacity-100" : "opacity-0")} />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{RESEARCH_SCOPE_LABELS[s]}</span>
                <span className="block text-xs text-muted-foreground">{RESEARCH_SCOPE_DESCRIPTIONS[s]}</span>
                <code className="mt-0.5 block text-[11px] text-muted-foreground/80">{RESEARCH_SCOPE_EXAMPLES[s]}</code>
              </span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
