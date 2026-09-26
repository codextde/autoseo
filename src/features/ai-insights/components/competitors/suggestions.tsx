"use client";

import { useTransition } from "react";
import { Plus, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/app/page";
import { EngineStack } from "@/components/app/engine-icon";
import { Favicon } from "@/components/app/favicon";
import { acceptSuggestionAction, dismissSuggestionAction } from "../../actions";
import type { BrandSuggestion } from "../../types";

export function SuggestedCompetitors({ projectId, suggestions, canManage }: { projectId: string; suggestions: BrandSuggestion[]; canManage: boolean }) {
  const [pending, start] = useTransition();
  if (!suggestions.length) return null;
  return (
    <Panel
      title="Suggested competitors"
      icon={<Sparkles className="size-4 text-brand" />}
      description="Brands AI engines name alongside you that you don't track yet (last 90 days)."
      contentClassName="p-0 sm:p-0"
    >
      <ul className="divide-y">
        {suggestions.map((s) => (
          <li key={s.name} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <Favicon fallback={s.name} className="mt-0.5 size-6 rounded-md" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-xs text-muted-foreground tabular">
                    {s.answers} answers · {s.prompts} prompts{s.avgPosition != null ? ` · Ø pos ${s.avgPosition.toFixed(1)}` : ""}
                  </span>
                  <EngineStack ids={s.engines} max={5} />
                </div>
                {s.sample && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">“{s.sample}”</p>}
              </div>
            </div>
            {canManage && (
              <div className="flex shrink-0 gap-1.5 self-end sm:self-auto">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await dismissSuggestionAction(projectId, s.name);
                      if (!r.ok) toast.error(r.error);
                    })
                  }
                >
                  <X className="size-3.5" /> Dismiss
                </Button>
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await acceptSuggestionAction(projectId, s.name);
                      if (!r.ok) toast.error(r.error);
                      else toast.success(`${s.name} added to your competitors`);
                    })
                  }
                >
                  <Plus className="size-3.5" /> Track
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
