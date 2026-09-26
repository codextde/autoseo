"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { ShieldAlert } from "lucide-react";
import { motion } from "motion/react";
import { adminNav } from "@/lib/navigation";
import { NavIcon } from "@/components/app/nav-icon";
import { cn } from "@/lib/utils";

const GROUPS: { title: string; hrefs: string[] }[] = [
  { title: "Instance", hrefs: ["/admin", "/admin/system", "/admin/jobs", "/admin/audit-log"] },
  { title: "People & access", hrefs: ["/admin/users", "/admin/invitations", "/admin/roles", "/admin/workspaces", "/admin/auth"] },
  { title: "Configuration", hrefs: ["/admin/email", "/admin/ai", "/admin/data", "/admin/agents", "/admin/onboarding", "/admin/branding", "/admin/limits"] },
];

function isActive(pathname: string, href: string) {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Admin sub-navigation: grouped sidebar on desktop, horizontally scrollable pills on mobile. */
export function AdminNav() {
  const pathname = usePathname();
  const pillsRef = useRef<HTMLDivElement>(null);
  const byHref = new Map(adminNav.map((i) => [i.href, i]));

  useEffect(() => {
    const el = pillsRef.current?.querySelector<HTMLElement>("[data-active=true]");
    el?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [pathname]);

  return (
    <>
      {/* Mobile / tablet: pill bar */}
      <div className="-mx-3 lg:hidden">
        <div ref={pillsRef} className="scrollbar-none flex gap-1.5 overflow-x-auto px-3 pb-1">
          {adminNav.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                data-active={active}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                <NavIcon name={item.icon} className="size-3.5" />
                {item.title}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Desktop: grouped sidebar */}
      <aside className="hidden w-56 shrink-0 lg:block">
        <nav className="sticky top-20 space-y-5">
          <div className="flex items-center gap-2 px-2 text-sm font-semibold">
            <span className="flex size-7 items-center justify-center rounded-lg bg-foreground text-background">
              <ShieldAlert className="size-4" />
            </span>
            Admin panel
          </div>
          {GROUPS.map((group) => (
            <div key={group.title} className="space-y-0.5">
              <div className="px-2 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                {group.title}
              </div>
              {group.hrefs.map((href) => {
                const item = byHref.get(href);
                if (!item) return null;
                const active = isActive(pathname, href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      "relative flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors",
                      active ? "font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="admin-nav-active"
                        className="absolute inset-0 rounded-lg bg-card shadow-xs ring-1 ring-border"
                        transition={{ type: "spring", stiffness: 500, damping: 40 }}
                      />
                    )}
                    <NavIcon name={item.icon} className="relative size-4" />
                    <span className="relative truncate">{item.title}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
