"use client";

import { Check } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { API_SCOPES, SCOPE_INFO, type ApiScope } from "../scopes";

export type PickerProject = { id: string; name: string; domain: string };

/** Scope checkboxes (read is always on). */
export function ScopePicker({
  value,
  onChange,
  disabledScopes = [],
}: {
  value: ApiScope[];
  onChange: (v: ApiScope[]) => void;
  disabledScopes?: ApiScope[];
}) {
  return (
    <div className="grid gap-2">
      {API_SCOPES.map((s) => {
        const locked = s === "read";
        const disabled = locked || disabledScopes.includes(s);
        const checked = locked || value.includes(s);
        return (
          <label
            key={s}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors",
              checked ? "border-foreground/20 bg-muted/50" : "hover:bg-muted/30",
              disabled && !locked && "cursor-not-allowed opacity-60",
            )}
          >
            <Checkbox
              className="mt-0.5"
              checked={checked}
              disabled={disabled}
              onCheckedChange={(c) => {
                const next = new Set(value);
                if (c) next.add(s);
                else next.delete(s);
                next.add("read");
                onChange(API_SCOPES.filter((x) => next.has(x)));
              }}
            />
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-medium">
                {SCOPE_INFO[s].label}
                {locked && <span className="text-[11px] font-normal text-muted-foreground">always included</span>}
              </span>
              <span className="block text-xs text-muted-foreground">{SCOPE_INFO[s].description}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** "All projects" vs. selected projects. `value === null` means all projects. */
export function ProjectScopePicker({
  projects,
  value,
  onChange,
  allLabel = "All projects",
  allDescription = "Includes projects created later.",
}: {
  projects: PickerProject[];
  value: string[] | null;
  onChange: (v: string[] | null) => void;
  allLabel?: string;
  allDescription?: string;
}) {
  const all = value === null;
  const selected = new Set(value ?? []);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/70 p-1">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={cn("rounded-lg px-3 py-1.5 text-sm transition-colors", all ? "bg-background font-medium shadow-xs ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}
        >
          {allLabel}
        </button>
        <button
          type="button"
          onClick={() => onChange(value ?? [])}
          className={cn("rounded-lg px-3 py-1.5 text-sm transition-colors", !all ? "bg-background font-medium shadow-xs ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}
        >
          Selected projects
        </button>
      </div>
      {all ? (
        <p className="px-1 text-xs text-muted-foreground">{allDescription}</p>
      ) : projects.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">No projects available.</p>
      ) : (
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border p-1.5">
          {projects.map((p) => {
            const checked = selected.has(p.id);
            return (
              <Label
                key={p.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 font-normal transition-colors",
                  checked ? "bg-muted" : "hover:bg-muted/50",
                )}
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(c) => {
                    const next = new Set(selected);
                    if (c) next.add(p.id);
                    else next.delete(p.id);
                    onChange(projects.filter((x) => next.has(x.id)).map((x) => x.id));
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{p.domain}</span>
                </span>
                {checked && <Check className="size-3.5 text-brand" />}
              </Label>
            );
          })}
        </div>
      )}
    </div>
  );
}
