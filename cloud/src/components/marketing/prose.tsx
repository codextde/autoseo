import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Readable long-form typography for guides and legal pages (no typography plugin needed). */
export const proseClass = cn(
  "max-w-none text-[1rem] leading-7 text-foreground/90",
  "[&_h2]:mt-14 [&_h2]:scroll-mt-24 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground [&_h2:first-child]:mt-0",
  "[&_h3]:mt-8 [&_h3]:scroll-mt-24 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-foreground",
  "[&_p]:mt-4 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5",
  "[&_li]:pl-1 [&_li::marker]:text-muted-foreground",
  "[&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4 [&_a:hover]:decoration-2",
  "[&_strong]:font-semibold [&_strong]:text-foreground",
  "[&_:not(pre)>code]:rounded-md [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.85em] [&_:not(pre)>code]:text-foreground",
  "[&_.not-prose]:mt-5",
  "[&_table]:mt-5 [&_table]:w-full [&_table]:text-sm [&_th]:border-b [&_th]:py-2 [&_th]:pr-4 [&_th]:text-left [&_th]:font-semibold [&_td]:border-b [&_td]:py-2 [&_td]:pr-4 [&_td]:align-top",
);

export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn(proseClass, className)}>{children}</div>;
}
