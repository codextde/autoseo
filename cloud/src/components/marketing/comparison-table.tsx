import { Check, Minus } from "lucide-react";
import { comparison } from "./content";
import { LogoMark } from "./primitives";

export function ComparisonTable() {
  return (
    <>
      <ComparisonList />
      <div className="hidden overflow-hidden rounded-2xl border bg-card sm:block">
        <table className="w-full border-collapse text-left text-sm">
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
    </>
  );
}

/** Phone layout: one card per row instead of a table that would need sideways scrolling. */
function ComparisonList() {
  return (
    <ul className="divide-y overflow-hidden rounded-2xl border bg-card sm:hidden">
      {comparison.rows.map((row) => (
        <li key={row.label} className="p-4">
          <p className="font-medium">{row.label}</p>
          <dl className="mt-2.5 space-y-2 text-sm">
            <div className="rounded-lg bg-brand-soft/60 px-3 py-2 dark:bg-brand-soft/30">
              <dt className="sr-only">{comparison.columns[0]}</dt>
              <dd className="flex gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-green-700 dark:text-green-400" strokeWidth={2.5} aria-hidden="true" />
                <span>
                  <span className="font-medium">AutoSEO:</span> {row.ours}
                </span>
              </dd>
            </div>
            <div className="px-3 text-muted-foreground">
              <dt className="sr-only">{comparison.columns[1]}</dt>
              <dd className="flex gap-2.5">
                <Minus className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  <span className="font-medium">Closed SaaS:</span> {row.theirs}
                </span>
              </dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}
