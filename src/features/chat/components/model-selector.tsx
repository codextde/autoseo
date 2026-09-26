"use client";

import Link from "next/link";
import { Check, ChevronDown, Cloud, Cpu, Settings2, Sparkles } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ModelOption, ModelOptionsView } from "../types";

const GROUPS: { id: ModelOption["group"]; label: string }[] = [
  { id: "auto", label: "Smart routing" },
  { id: "local", label: "Local agents" },
  { id: "api", label: "API providers" },
];

function OptionIcon({ group, className }: { group: ModelOption["group"]; className?: string }) {
  if (group === "auto") return <Sparkles className={className} />;
  if (group === "local") return <Cpu className={className} />;
  return <Cloud className={className} />;
}

/** Composer model picker: Auto, local CLI agents and configured API providers with live availability. */
export function ModelSelector({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  options: ModelOptionsView;
  disabled?: boolean;
}) {
  const current = options.options.find((o) => o.id === value) ?? options.options[0]!;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="h-8 max-w-[11rem] gap-1.5 rounded-full px-2.5 text-muted-foreground hover:text-foreground"
          aria-label={`Model: ${current.label}`}
        >
          <OptionIcon group={current.group} className={cn("size-3.5", current.available ? "text-brand" : "text-muted-foreground")} />
          <span className="truncate text-[13px] font-medium">{current.label}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-[min(22rem,calc(100vw-2rem))] p-1.5">
        {GROUPS.map((g, gi) => {
          const items = options.options.filter((o) => o.group === g.id);
          if (!items.length) return null;
          return (
            <DropdownMenuGroup key={g.id}>
              {gi > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{g.label}</DropdownMenuLabel>
              {items.map((o) => (
                <DropdownMenuItem
                  key={o.id}
                  disabled={!o.available}
                  onSelect={() => onChange(o.id)}
                  className="items-start gap-2.5 rounded-lg px-2 py-2"
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border bg-background",
                      o.available ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <OptionIcon group={o.group} className="size-3.5" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {o.label}
                      <span className={cn("size-1.5 rounded-full", o.available ? "bg-success" : "bg-muted-foreground/40")} aria-hidden />
                    </span>
                    <span className="text-xs text-muted-foreground">{o.description}</span>
                    <span className={cn("text-[11px]", o.available ? "text-muted-foreground" : "text-muted-foreground/80")}>
                      {o.status}
                      {o.price ? ` · ${o.price}` : ""}
                    </span>
                  </span>
                  {o.id === value && <Check className="mt-1 size-4 shrink-0 text-brand" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          );
        })}
        {options.manage.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <div className="flex items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground">
              <Settings2 className="size-3.5" /> Manage:
              {options.manage.map((m, i) => (
                <span key={m.href}>
                  {i > 0 && <span className="mx-1">·</span>}
                  <Link href={m.href} className="font-medium text-foreground hover:underline">
                    {m.label}
                  </Link>
                </span>
              ))}
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
