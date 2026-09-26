"use client";

import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Favicon } from "@/components/app/favicon";
import { cn } from "@/lib/utils";

export type PickerProject = { id: string; name: string; domain: string; logoUrl: string | null };

/** Searchable checkbox list of projects (used for member project access & invitations). */
export function ProjectPicker({
  projects,
  value,
  onChange,
  className,
}: {
  projects: PickerProject[];
  value: string[];
  onChange: (ids: string[]) => void;
  className?: string;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? projects.filter((p) => p.name.toLowerCase().includes(s) || p.domain.includes(s)) : projects;
  }, [projects, q]);
  const all = projects.length > 0 && value.length === projects.length;
  return (
    <div className={cn("overflow-hidden rounded-xl border", className)}>
      <div className="flex items-center gap-2 border-b bg-muted/40 px-2 py-1.5">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search projects…"
          className="h-7 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <button
          type="button"
          className="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={() => onChange(all ? [] : projects.map((p) => p.id))}
        >
          {all ? "Clear" : "Select all"}
        </button>
      </div>
      <ul className="max-h-56 overflow-y-auto p-1">
        {filtered.length === 0 && <li className="px-3 py-6 text-center text-xs text-muted-foreground">No projects found.</li>}
        {filtered.map((p) => {
          const checked = value.includes(p.id);
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onChange(checked ? value.filter((v) => v !== p.id) : [...value, p.id])}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                    checked ? "border-foreground bg-foreground text-background" : "border-input",
                  )}
                >
                  {checked && <Check className="size-3" />}
                </span>
                <Favicon domain={p.domain} src={p.logoUrl} fallback={p.name} />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="hidden truncate text-xs text-muted-foreground sm:inline">{p.domain}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
