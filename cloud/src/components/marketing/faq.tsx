import { Plus } from "lucide-react";
import type { Faq } from "./content";

/**
 * FAQ list built on native <details>: zero client JS, keyboard accessible, and every answer stays in the HTML
 * for search engines and AI crawlers.
 */
export function FaqList({ items }: { items: Faq[] }) {
  return (
    <div className="divide-y rounded-2xl border bg-card">
      {items.map((item) => (
        <details key={item.q} className="mk-faq group px-5 sm:px-6">
          <summary className="flex cursor-pointer items-start justify-between gap-6 rounded-md py-5 text-left font-medium focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none">
            <h3 className="text-[0.975rem] leading-6">{item.q}</h3>
            <Plus
              className="mk-faq-icon mt-0.5 size-5 shrink-0 text-muted-foreground transition-transform duration-200"
              aria-hidden="true"
            />
          </summary>
          <p className="-mt-1 pb-5 text-[0.95rem] leading-7 text-pretty text-muted-foreground">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
