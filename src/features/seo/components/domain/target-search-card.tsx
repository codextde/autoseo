"use client";

import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/app/page";
import { defaultScopeForInput, parseResearchTarget, type ResearchScope, type ResearchTarget } from "@/server/seo/lib/research-scope";
import { ScopeSelect } from "../shared/scope-select";

/**
 * Domain / URL search card with research-scope picker (open-seo DomainSearchCard / backlinks search card).
 * The scope follows the input's implied default while typing until the user picks one explicitly.
 */
export function TargetSearchCard({
  value,
  scope,
  scopeExplicit,
  onSubmit,
  loading,
  disabled,
  children,
  aside,
  emptyMessage = "Enter a domain or URL",
}: {
  /** Applied target from the URL. */
  value: string;
  /** Applied scope from the URL. */
  scope: ResearchScope;
  /** Whether the URL carried an explicit scope. */
  scopeExplicit: boolean;
  onSubmit: (input: { raw: string; target: ResearchTarget; scope: ResearchScope }) => void;
  loading?: boolean;
  disabled?: boolean;
  /** Extra controls (location, sort …) rendered between scope and the Search button. */
  children?: React.ReactNode;
  /** Right side note (cost pill). */
  aside?: React.ReactNode;
  emptyMessage?: string;
}) {
  const [input, setInput] = useState(value);
  const [picked, setPicked] = useState<ResearchScope | null>(scopeExplicit ? scope : null);
  const [error, setError] = useState<string | null>(null);

  // Sync from the URL (history selection, back/forward) — derived on change during render.
  const urlKey = `${value}\u0000${scope}\u0000${scopeExplicit}`;
  const [prevUrlKey, setPrevUrlKey] = useState(urlKey);
  if (prevUrlKey !== urlKey) {
    setPrevUrlKey(urlKey);
    setInput(value);
    setPicked(scopeExplicit ? scope : null);
    setError(null);
  }

  const effectiveScope = picked ?? defaultScopeForInput(input);
  const parsedForPath = parseResearchTarget(input);
  const hasPath = parsedForPath.ok && parsedForPath.target.path !== "";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) {
      setError(emptyMessage);
      return;
    }
    const scopeToUse = picked === "subfolder" && !hasPath ? undefined : (picked ?? undefined);
    const parsed = parseResearchTarget(input, scopeToUse);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setError(null);
    onSubmit({ raw: input.trim(), target: parsed.target, scope: parsed.target.scope });
  };

  return (
    <Panel contentClassName="p-3 sm:p-4">
      <form onSubmit={submit} className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Enter a domain or URL"
            aria-label="Domain or URL"
            aria-invalid={error ? true : undefined}
            className="h-9 bg-background pl-9"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ScopeSelect value={effectiveScope} hasPath={hasPath} onChange={(s) => setPicked(s)} className="w-full sm:w-36" />
          {children}
          <Button type="submit" className="h-9 w-full sm:w-auto" disabled={disabled || loading}>
            {loading ? <Loader2 className="animate-spin" /> : <Search />}
            {loading ? "Loading..." : "Search"}
          </Button>
          {aside}
        </div>
      </form>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </Panel>
  );
}
