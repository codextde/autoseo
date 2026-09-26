"use client";

import { useState } from "react";
import { BarChart3, Bug, FileText, MapPin, Presentation, Search, Sparkles, Swords, ArrowRight } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ExampleCategory } from "../lib/examples";

const ICONS: Record<ExampleCategory["icon"], React.ComponentType<{ className?: string }>> = {
  sparkles: Sparkles,
  swords: Swords,
  search: Search,
  bug: Bug,
  "file-text": FileText,
  presentation: Presentation,
  "bar-chart": BarChart3,
  "map-pin": MapPin,
};

/** Gallery of categorized example prompts tailored to the project; picking one fills the composer. */
export function ExamplesDialog({
  open,
  onOpenChange,
  categories,
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  categories: ExampleCategory[];
  onPick: (prompt: string) => void;
}) {
  const [active, setActive] = useState(categories[0]?.id ?? "");
  const cat = categories.find((c) => c.id === active) ?? categories[0];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(88dvh,720px)] w-[calc(100vw-1.5rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-5 pt-5 pb-4 text-left">
          <DialogTitle>Example prompts</DialogTitle>
          <DialogDescription>Pick a starting point — it’s filled into the composer so you can adjust it before sending.</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 scrollbar-none sm:w-52 sm:flex-col sm:overflow-y-auto sm:border-r sm:border-b-0" aria-label="Categories">
            {categories.map((c) => {
              const Icon = ICONS[c.icon];
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActive(c.id)}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                    c.id === cat?.id ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="whitespace-nowrap">{c.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
            {cat && (
              <>
                <p className="mb-3 px-1 text-xs text-muted-foreground">{cat.description}</p>
                <div className="grid gap-2">
                  {cat.prompts.map((p) => (
                    <button
                      key={p.title}
                      type="button"
                      onClick={() => {
                        onPick(p.prompt);
                        onOpenChange(false);
                      }}
                      className="group flex items-start gap-3 rounded-xl border bg-card p-3 text-left shadow-soft transition-colors hover:border-foreground/20 hover:bg-muted/30"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{p.title}</span>
                        <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{p.prompt}</span>
                      </span>
                      <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
