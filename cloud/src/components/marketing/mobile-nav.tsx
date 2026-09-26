"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, Star } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { authLinks, mainNav } from "./content";
import { GitHubIcon } from "./primitives";
import { site } from "@/lib/site";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label="Open menu"
        className="grid size-9 place-items-center rounded-full text-foreground transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none md:hidden"
      >
        <Menu className="size-5" aria-hidden="true" />
      </SheetTrigger>
      <SheetContent side="right" className="w-[85%] max-w-sm gap-0 p-0">
        <div className="border-b px-5 py-4">
          <SheetTitle className="text-base font-semibold">Menu</SheetTitle>
          <SheetDescription className="sr-only">Site navigation</SheetDescription>
        </div>
        <nav aria-label="Mobile" className="flex flex-col px-3 py-3">
          {mainNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={close}
              className="rounded-lg px-3 py-3 text-[0.95rem] font-medium hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none"
            >
              {item.label}
            </Link>
          ))}
          <a
            href={site.github}
            target="_blank"
            rel="noopener"
            onClick={close}
            className="flex items-center gap-2 rounded-lg px-3 py-3 text-[0.95rem] font-medium hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none"
          >
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
      </SheetContent>
    </Sheet>
  );
}
