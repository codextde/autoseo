import { Check, Minus } from "lucide-react";
import { comparison } from "./content";
import { LogoMark } from "./primitives";

export function ComparisonTable() {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Comparison table">
        <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
          <caption className="sr-only">{comparison.title}</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="w-[28%] px-5 py-4 font-medium text-muted-foreground">
                <span className="sr-only">Feature</span>
              </th>
              <th scope="col" className="bg-brand-soft/60 px-5 py-4 font-semibold dark:bg-brand-soft/30">
                <span className="inline-flex items-center gap-2">
                  <LogoMark className="size-5 rounded-[0.3rem]" />
                  {comparison.columns[0]}
                </span>
              </th>
              <th scope="col" className="px-5 py-4 font-semibold text-muted-foreground">
                {comparison.columns[1]}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {comparison.rows.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="px-5 py-4 font-medium">
                  {row.label}
                </th>
                <td className="bg-brand-soft/60 px-5 py-4 dark:bg-brand-soft/30">
                  <span className="flex gap-2.5">
                    <Check className="mt-0.5 size-4 shrink-0 text-green-700 dark:text-green-400" strokeWidth={2.5} aria-hidden="true" />
                    {row.ours}
                  </span>
                </td>
                <td className="px-5 py-4 text-muted-foreground">
                  <span className="flex gap-2.5">
                    <Minus className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    {row.theirs}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
