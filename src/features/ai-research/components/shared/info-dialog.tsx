"use client";

import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export type InfoStep = { title: string; body: React.ReactNode };

/** "How we get this data" dialog (finseo). */
export function HowWeGetDataDialog({
  title,
  intro,
  steps,
  footer,
  label = "How we get this data",
  size = "sm",
}: {
  title: string;
  intro?: React.ReactNode;
  steps: InfoStep[];
  footer?: React.ReactNode;
  label?: string;
  size?: "sm" | "default";
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size={size} className="gap-1.5 text-muted-foreground">
          <Info className="size-3.5" />
          <span className="hidden sm:inline">{label}</span>
          <span className="sm:hidden">Info</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {intro && <DialogDescription>{intro}</DialogDescription>}
        </DialogHeader>
        <ol className="space-y-3">
          {steps.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular">{i + 1}</span>
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium">{s.title}</p>
                <div className="text-sm text-muted-foreground">{s.body}</div>
              </div>
            </li>
          ))}
        </ol>
        {footer && <div className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">{footer}</div>}
      </DialogContent>
    </Dialog>
  );
}
