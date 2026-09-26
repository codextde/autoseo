"use client";

import { useRef } from "react";
import Link from "next/link";
import { Menu, Star, X } from "lucide-react";
import { site } from "@/lib/site";
import { authLinks, mainNav } from "./content";
import { GitHubIcon } from "./primitives";

const itemClass =
  "flex items-center gap-2 rounded-lg px-3 py-3 text-[0.95rem] font-medium hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none";

/**
 * Mobile menu built on the native Popover API (light dismiss, Escape and top layer for free), so the marketing
 * pages don't ship a dialog library. The only script is closing the panel after a link is followed.
 */
export function MobileNav() {
  const panel = useRef<HTMLDivElement>(null);
  const close = () => panel.current?.hidePopover();

  return (
    <>
      <button
        type="button"
        popoverTarget="mobile-menu"
        aria-label="Open menu"
        className="grid size-9 place-items-center rounded-full text-foreground transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none md:hidden"
      >
        <Menu className="size-5" aria-hidden="true" />
      </button>
      <div
        ref={panel}
        id="mobile-menu"
        popover="auto"
        aria-label="Menu"
        className="mk-sheet fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-[85%] max-w-sm flex-col border-0 border-l bg-popover p-0 text-popover-foreground shadow-xl open:flex md:hidden"
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <p className="text-base font-semibold">Menu</p>
          <button
            type="button"
            popoverTarget="mobile-menu"
            popoverTargetAction="hide"
            aria-label="Close menu"
            className="grid size-9 place-items-center rounded-full hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <nav aria-label="Mobile" className="flex flex-col px-3 py-3">
          {mainNav.map((item) => (
            <Link key={item.href} href={item.href} onClick={close} className={itemClass}>
              {item.label}
            </Link>
          ))}
          <a href={site.github} target="_blank" rel="noopener" onClick={close} className={itemClass}>
            <GitHubIcon />
            GitHub
            <Star className="ml-auto size-4 text-muted-foreground" aria-hidden="true" />
          </a>
        </nav>
        <div className="mt-auto flex flex-col gap-2 border-t p-5">
          <Link
            href={authLinks.signup.href}
            prefetch={false}
            onClick={close}
            className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/85 focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none"
          >
            {authLinks.signup.label}
          </Link>
          <Link
            href={authLinks.login.href}
            prefetch={false}
            onClick={close}
            className="inline-flex h-11 items-center justify-center rounded-full border bg-card px-5 text-sm font-medium hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none"
          >
            {authLinks.login.label}
          </Link>
        </div>
      </div>
    </>
  );
}
