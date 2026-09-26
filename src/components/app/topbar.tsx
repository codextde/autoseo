"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useMemo } from "react";
import { BookOpen, CalendarClock, ChevronRight } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { adminNav, isGroup, projectNav, settingsNav } from "@/lib/navigation";
import { useShell } from "./shell-context";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { BookmarksSheet } from "./bookmarks-sheet";
import { FeedbackDialog } from "./feedback-dialog";
import { CommandPalette } from "./command-palette";
import { NotificationsPopover } from "./notifications-popover";
import { humanizeSegment, usePageCrumbLabel } from "./page-crumb";

type Crumb = { title: string; href?: string };

function useCrumbs(): Crumb[] {
  const pathname = usePathname();
  const shell = useShell();
  const pageLabel = usePageCrumbLabel(pathname);
  const crumbs = useMemo(() => {
    const crumbs: Crumb[] = [];
    const base = shell.currentProjectId ? `/p/${shell.currentProjectId}` : null;
    if (base && pathname.startsWith(base)) {
      crumbs.push({ title: "Home", href: base });
      const rest = pathname.slice(base.length);
      if (!rest) return [{ title: "Home" }];
      if (rest.startsWith("/agent")) return [{ title: "Home", href: base }, { title: "Agent" }];
      for (const entry of projectNav) {
        const items = isGroup(entry) ? entry.items : [entry];
        for (const item of items) {
          if (item.href && (rest === item.href || rest.startsWith(`${item.href}/`))) {
            if (isGroup(entry)) crumbs.push({ title: entry.title });
            crumbs.push({ title: item.title, href: rest === item.href ? undefined : `${base}${item.href}` });
            const tail = rest.slice(item.href.length).split("/").filter(Boolean);
            if (tail.length) crumbs.push({ title: humanizeSegment(tail[tail.length - 1]!) });
            return crumbs;
          }
        }
      }
      const last = rest.split("/").filter(Boolean).pop();
      if (last) crumbs.push({ title: humanizeSegment(last) });
      return crumbs;
    }
    const all = [...settingsNav, ...adminNav];
    const match = all
      .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
      .sort((a, b) => b.href.length - a.href.length)[0];
    if (pathname.startsWith("/admin")) crumbs.push({ title: "Admin", href: "/admin" });
    if (match && match.href !== "/admin") {
      crumbs.push({ title: match.title, href: pathname === match.href ? undefined : match.href });
      const tail = pathname.slice(match.href.length).split("/").filter(Boolean);
      if (tail.length) crumbs.push({ title: humanizeSegment(tail[tail.length - 1]!) });
    } else if (!match) crumbs.push({ title: humanizeSegment(pathname.split("/").filter(Boolean).pop() ?? "home") });
    return crumbs;
  }, [pathname, shell.currentProjectId]);
  // A detail page can name its own crumb (e.g. the competitor's name instead of its id).
  if (pageLabel && crumbs.length) return [...crumbs.slice(0, -1), { ...crumbs[crumbs.length - 1]!, title: pageLabel }];
  return crumbs;
}

export function Topbar() {
  const crumbs = useCrumbs();
  const shell = useShell();
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70 sm:px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
      <nav className="flex min-w-0 flex-1 items-center gap-1.5 text-sm" aria-label="Breadcrumb">
        {crumbs.map((c, i) => (
          <Fragment key={`${c.title}-${i}`}>
            {i > 0 && <ChevronRight className="hidden size-3.5 shrink-0 text-muted-foreground/60 sm:block" />}
            {c.href && i < crumbs.length - 1 ? (
              <Link href={c.href} className="hidden truncate text-muted-foreground hover:text-foreground sm:inline">
                {c.title}
              </Link>
            ) : (
              <span
                className={
                  i === crumbs.length - 1
                    ? "truncate font-medium"
                    : "hidden truncate text-muted-foreground sm:inline"
                }
              >
                {c.title}
              </span>
            )}
          </Fragment>
        ))}
      </nav>
      <div className="flex items-center gap-0.5 sm:gap-1">
        <CommandPalette />
        <BookmarksSheet />
        <FeedbackDialog />
        <NotificationsPopover />
        <ThemeToggle />
        {shell.branding.demoBookingUrl && (
          <Button asChild variant="secondary" size="sm" className="ml-1 hidden gap-1.5 lg:inline-flex">
            <a href={shell.branding.demoBookingUrl} target="_blank" rel="noreferrer">
              <CalendarClock className="size-4" /> Get Demo
            </a>
          </Button>
        )}
        {shell.branding.docsUrl && (
          <Button asChild variant="outline" size="sm" className="ml-1 hidden gap-1.5 md:inline-flex">
            <a href={shell.branding.docsUrl} target="_blank" rel="noreferrer">
              <BookOpen className="size-4 text-brand" /> Docs
            </a>
          </Button>
        )}
        <UserMenu />
      </div>
    </header>
  );
}
