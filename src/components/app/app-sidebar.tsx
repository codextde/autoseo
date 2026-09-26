"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { ChevronRight, ListTodo, Play, ShieldAlert } from "lucide-react";
import { motion } from "motion/react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { isGroup, projectNav, settingsNav, type NavGroup, type NavItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { NavIcon } from "./nav-icon";
import { Logo } from "./logo";
import { ProjectSwitcher } from "./project-switcher";
import { useCan, useShell } from "./shell-context";
import { AgentSidebarSection } from "@/features/chat/components/agent-sidebar";

const GROUP_STATE_KEY = "autoseo.sidebar.groups";

const groupListeners = new Set<() => void>();
function readGroups(): string {
  try {
    return localStorage.getItem(GROUP_STATE_KEY) ?? "{}";
  } catch {
    return "{}";
  }
}

/** Collapsible group state persisted in localStorage (SSR-safe via useSyncExternalStore). */
function useGroupState() {
  const raw = useSyncExternalStore(
    (cb) => {
      groupListeners.add(cb);
      return () => groupListeners.delete(cb);
    },
    readGroups,
    () => "{}",
  );
  const open = useMemo<Record<string, boolean>>(() => {
    try {
      return JSON.parse(raw) as Record<string, boolean>;
    } catch {
      return {};
    }
  }, [raw]);
  const toggle = (key: string, value: boolean) => {
    try {
      localStorage.setItem(GROUP_STATE_KEY, JSON.stringify({ ...open, [key]: value }));
    } catch {
      /* ignore */
    }
    groupListeners.forEach((l) => l());
  };
  return { open, toggle };
}

function ModeToggle({ base }: { base: string }) {
  const pathname = usePathname();
  const agentMode = pathname.startsWith(`${base}/agent`);
  return (
    <div className="relative grid grid-cols-2 rounded-lg bg-sidebar-accent p-1 text-sm group-data-[collapsible=icon]:hidden">
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 40 }}
        className={cn(
          "absolute inset-y-1 w-[calc(50%-4px)] rounded-md bg-background shadow-xs",
          agentMode ? "left-[calc(50%+2px)]" : "left-1",
        )}
      />
      <Link href={base} className={cn("relative z-10 py-1.5 text-center font-medium", agentMode && "text-muted-foreground")}>
        App
      </Link>
      <Link
        href={`${base}/agent`}
        className={cn("relative z-10 py-1.5 text-center font-medium", !agentMode && "text-muted-foreground")}
      >
        Agent
      </Link>
    </div>
  );
}

export function AppSidebar() {
  const shell = useShell();
  const can = useCan();
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const { open, toggle } = useGroupState();
  const base = shell.currentProjectId ? `/p/${shell.currentProjectId}` : "";
  const agentMode = !!base && pathname.startsWith(`${base}/agent`);

  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

  const isActive = (item: NavItem, scoped = true) => {
    const href = scoped ? `${base}${item.href}` : item.href;
    if (scoped && item.href === "") return pathname === base;
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const renderGroup = (group: NavGroup) => {
    const groupActive = group.items.some((i) => isActive(i));
    const isOpen = open[group.title] ?? groupActive;
    return (
      <Collapsible key={group.title} open={isOpen} onOpenChange={(v) => toggle(group.title, v)} asChild>
        <SidebarMenuItem className="group/collapsible">
          <CollapsibleTrigger asChild>
            <SidebarMenuButton tooltip={group.title} isActive={groupActive && !isOpen}>
              <NavIcon name={group.icon} />
              <span>{group.title}</span>
              <ChevronRight className="ml-auto size-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SidebarMenuSub>
              {group.items.map((item) => (
                <SidebarMenuSubItem key={item.href}>
                  <SidebarMenuSubButton asChild isActive={isActive(item)}>
                    <Link href={`${base}${item.href}`}>
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        </SidebarMenuItem>
      </Collapsible>
    );
  };

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader className="gap-3">
        <div className="flex items-center justify-between px-1 pt-1 group-data-[collapsible=icon]:justify-center">
          <Link href={base || "/"}>
            <Logo name={shell.branding.appName} src={shell.branding.logoUrl || undefined} className="text-[15px] group-data-[collapsible=icon]:[&>span:last-child]:hidden" />
          </Link>
        </div>
        <ProjectSwitcher />
        {base && <ModeToggle base={base} />}
      </SidebarHeader>

      <SidebarContent>
        {agentMode ? (
          <AgentSidebarSection projectId={shell.currentProjectId!} />
        ) : (
          <>
            {base && (
              <SidebarGroup>
                <SidebarGroupLabel>Menu</SidebarGroupLabel>
                <SidebarMenu>
                  {projectNav.map((entry) =>
                    isGroup(entry) ? (
                      renderGroup(entry)
                    ) : (
                      <SidebarMenuItem key={entry.href}>
                        <SidebarMenuButton asChild tooltip={entry.title} isActive={isActive(entry)}>
                          <Link href={`${base}${entry.href}`}>
                            <NavIcon name={entry.icon} />
                            <span>{entry.title}</span>
                          </Link>
                        </SidebarMenuButton>
                        {entry.badge && (
                          <SidebarMenuBadge className="rounded-full bg-brand-soft px-1.5 text-[10px] font-medium text-brand">
                            {entry.badge}
                          </SidebarMenuBadge>
                        )}
                      </SidebarMenuItem>
                    ),
                  )}
                </SidebarMenu>
              </SidebarGroup>
            )}
            <SidebarGroup>
              <SidebarGroupLabel>Settings</SidebarGroupLabel>
              <SidebarMenu>
                {settingsNav
                  .filter((i) => !i.permission || can(i.permission))
                  .map((item) => {
                    const href = item.href === "/integrations" ? `${base}/integrations` : item.href;
                    if (item.href === "/integrations" && !base) return null;
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton asChild tooltip={item.title} isActive={pathname === href || pathname.startsWith(`${href}/`)}>
                          <Link href={href}>
                            <NavIcon name={item.icon} />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                {shell.user.isInstanceAdmin && (
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild tooltip="Admin" isActive={pathname.startsWith("/admin")}>
                      <Link href="/admin">
                        <ShieldAlert />
                        <span>Admin</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      <SidebarFooter className="gap-2 group-data-[collapsible=icon]:hidden">
        {base && (
          <Button asChild className="w-full justify-center gap-2">
            <Link href={`${base}/tasks`}>
              <ListTodo className="size-4" /> Open Tasks
              {shell.openTaskCount > 0 && (
                <span className="ml-1 rounded-full bg-brand px-1.5 text-[11px] font-semibold text-brand-foreground">
                  {shell.openTaskCount}
                </span>
              )}
            </Link>
          </Button>
        )}
        {shell.branding.showProductTour && (
          <Button asChild variant="outline" className="w-full justify-center gap-2 bg-background">
            <Link href={base ? `${base}/tour` : "/"}>
              <Play className="size-3.5 fill-current" /> Product Tour
            </Link>
          </Button>
        )}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
