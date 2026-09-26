import type { ReactNode } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { Brand } from "./brand";

const perks = [
  "Your own private AutoSEO instance",
  "Every feature, unlimited users & projects",
  "Automatic updates, SSL and email delivery included",
  "Cancel anytime — export your data",
];

/** Split layout for sign-in screens: form on the left, product promise on the right (desktop). */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,34rem)]">
      <div className="flex flex-col px-4 py-6 sm:px-8">
        <Brand />
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">{children}</main>
        <p className="text-center text-xs text-muted-foreground">
          By continuing you agree to our{" "}
          <Link href="/terms" className="underline underline-offset-3 hover:text-foreground">
            terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline underline-offset-3 hover:text-foreground">
            privacy policy
          </Link>
          .
        </p>
      </div>
      <aside className="relative hidden overflow-hidden border-l bg-[#141413] p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-24 size-96 rounded-full bg-[#22c55e]/25 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:36px_36px]"
        />
        <div className="relative">
          <p className="text-xs font-medium tracking-[0.18em] text-white/50 uppercase">Managed AutoSEO</p>
          <h2 className="mt-4 max-w-sm text-3xl leading-tight font-semibold tracking-tight text-balance">
            See how AI search talks about your brand — without running servers.
          </h2>
        </div>
        <ul className="relative space-y-3">
          {perks.map((p) => (
            <li key={p} className="flex items-start gap-3 text-sm text-white/80">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#22c55e]/15 text-[#22c55e]">
                <Check className="size-3.5" />
              </span>
              {p}
            </li>
          ))}
        </ul>
        <p className="relative text-sm text-white/60">
          <span className="text-2xl font-semibold text-white">$50</span> / month per instance · open source (MIT)
        </p>
      </aside>
    </div>
  );
}
