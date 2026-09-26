import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { plans, pricingNotes } from "./content";
import { CtaLink } from "./primitives";

export function PricingPlans({ headingLevel = "h3" }: { headingLevel?: "h2" | "h3" }) {
  const Heading = headingLevel;
  return (
    <div>
      <div className="mx-auto grid max-w-4xl gap-5 md:grid-cols-2">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={cn(
              "relative flex flex-col rounded-3xl border bg-card p-7 sm:p-8",
              plan.highlight &&
                "border-transparent shadow-[0_24px_64px_-28px_oklch(0.4_0.12_152/0.45)] ring-2 ring-green-600/70 dark:ring-green-400/60",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <Heading className="text-lg font-semibold">{plan.name}</Heading>
              {plan.badge && (
                <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-green-800 dark:text-green-200">
                  {plan.badge}
                </span>
              )}
            </div>
            <p className="mt-2 text-sm text-muted-foreground md:min-h-10">{plan.description}</p>
            <p className="mt-6 flex items-baseline gap-2">
              <span className="text-5xl font-semibold tracking-tight">{plan.price}</span>
              <span className="text-sm text-muted-foreground">{plan.period}</span>
            </p>
            <p className="mt-1 h-5 text-xs text-muted-foreground">{plan.note ?? ""}</p>
            <CtaLink
              href={plan.cta.href}
              variant={plan.highlight ? "primary" : "secondary"}
              size="lg"
              arrow
              className="mt-6 w-full"
            >
              {plan.cta.label}
            </CtaLink>
            <ul className="mt-8 space-y-3 border-t pt-6">
              {plan.features.map((feature) => (
                <li key={feature} className="flex gap-3 text-sm leading-6">
                  <Check className="mt-1 size-4 shrink-0 text-green-700 dark:text-green-400" strokeWidth={2.5} aria-hidden="true" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-8 max-w-2xl space-y-2 text-center text-sm text-muted-foreground">
        {pricingNotes.map((note) => (
          <p key={note}>{note}</p>
        ))}
      </div>
    </div>
  );
}
