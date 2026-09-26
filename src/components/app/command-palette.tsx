"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { useTheme } from "next-themes";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { adminNav, isGroup, projectNav, settingsNav } from "@/lib/navigation";
import { NavIcon } from "./nav-icon";
import { Favicon } from "./favicon";
import { useShell } from "./shell-context";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const shell = useShell();
  const { setTheme, resolvedTheme } = useTheme();
  const base = shell.currentProjectId ? `/p/${shell.currentProjectId}` : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="mr-1 hidden h-8 w-52 justify-start gap-2 bg-background/60 text-muted-foreground md:flex"
      >
        <Search className="size-3.5" />
        <span className="flex-1 text-left text-xs">Search or jump to…</span>
        <Kbd className="text-[10px]">⌘K</Kbd>
      </Button>
      <Button variant="ghost" size="icon" className="size-9 md:hidden" onClick={() => setOpen(true)} aria-label="Search">
        <Search className="size-[18px]" />
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Command palette" description="Jump anywhere">
        <CommandInput placeholder="Type a page, project or action…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {base && (
            <CommandGroup heading="Pages">
              {projectNav.flatMap((entry) =>
                (isGroup(entry) ? entry.items.map((i) => ({ ...i, group: entry.title, icon: entry.icon })) : [{ ...entry, group: "" }]).map(
                  (item) => (
                    <CommandItem key={`${item.group}-${item.href}`} value={`${item.group} ${item.title}`} onSelect={() => go(`${base}${item.href}`)}>
                      <NavIcon name={item.icon} className="size-4" />
                      <span>{item.title}</span>
                      {item.group && <CommandShortcut>{item.group}</CommandShortcut>}
                    </CommandItem>
                  ),
                ),
              )}
              <CommandItem value="agent chat assistant" onSelect={() => go(`${base}/agent`)}>
                <NavIcon name="bot" className="size-4" />
                <span>Agent chat</span>
              </CommandItem>
            </CommandGroup>
          )}
          {shell.projects.length > 1 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Switch project">
                {shell.projects.map((p) => (
                  <CommandItem key={p.id} value={`project ${p.name} ${p.domain}`} onSelect={() => go(`/p/${p.id}`)}>
                    <Favicon domain={p.domain} src={p.logoUrl} fallback={p.name} />
                    <span>{p.name}</span>
                    <CommandShortcut>{p.domain}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
          <CommandSeparator />
          <CommandGroup heading="Settings">
            {settingsNav.map((item) => (
              <CommandItem
                key={item.href}
                value={`settings ${item.title}`}
                onSelect={() => go(item.href === "/integrations" && base ? `${base}/integrations` : item.href)}
              >
                <NavIcon name={item.icon} className="size-4" />
                <span>{item.title}</span>
              </CommandItem>
            ))}
            <CommandItem value="toggle theme dark light" onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
              <NavIcon name="wand" className="size-4" />
              <span>Toggle theme</span>
            </CommandItem>
          </CommandGroup>
          {shell.user.isInstanceAdmin && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Admin">
                {adminNav.map((item) => (
                  <CommandItem key={item.href} value={`admin ${item.title}`} onSelect={() => go(item.href)}>
                    <NavIcon name={item.icon} className="size-4" />
                    <span>{item.title}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
