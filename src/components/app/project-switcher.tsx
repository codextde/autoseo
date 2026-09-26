"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronsUpDown, FolderCog, Plus, Settings2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Favicon } from "./favicon";
import { useCan, useShell } from "./shell-context";

export function ProjectSwitcher() {
  const shell = useShell();
  const can = useCan();
  const router = useRouter();
  const pathname = usePathname();
  const current = shell.projects.find((p) => p.id === shell.currentProjectId) ?? null;

  function switchTo(id: string) {
    // Keep the same sub-page when switching projects.
    const match = pathname.match(/^\/p\/[^/]+(\/.*)?$/);
    const rest = match?.[1] ?? "";
    const safeRest = rest.split("/").length > 3 ? rest.split("/").slice(0, 3).join("/") : rest;
    router.push(`/p/${id}${safeRest}`);
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="border border-sidebar-border bg-background/60 shadow-xs data-[state=open]:bg-sidebar-accent"
            >
              <span className="flex size-8 items-center justify-center rounded-md border bg-background">
                <Favicon domain={current?.domain} src={current?.logoUrl} fallback={current?.name} />
              </span>
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium">{current?.name ?? "No project"}</span>
                <span className="truncate text-xs text-muted-foreground">{current?.domain ?? "Create your first project"}</span>
              </span>
              <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-64" align="start" sideOffset={6}>
            <DropdownMenuLabel className="text-xs text-muted-foreground">Projects</DropdownMenuLabel>
            <div className="max-h-80 overflow-y-auto">
              {shell.projects.map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => switchTo(p.id)} className="gap-2">
                  <Favicon domain={p.domain} src={p.logoUrl} fallback={p.name} />
                  <span className="flex-1 truncate">{p.name}</span>
                  {p.isPitch && (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                      Pitch
                    </Badge>
                  )}
                  {p.id === shell.currentProjectId && <Check className="size-4 text-brand" />}
                </DropdownMenuItem>
              ))}
              {shell.projects.length === 0 && (
                <div className="px-2 py-3 text-sm text-muted-foreground">No projects yet.</div>
              )}
            </div>
            <DropdownMenuSeparator />
            {can("projects.manage") && (
              <DropdownMenuItem asChild>
                <Link href="/onboarding" className="gap-2">
                  <Plus className="size-4" /> New project
                </Link>
              </DropdownMenuItem>
            )}
            {current && (
              <DropdownMenuItem asChild>
                <Link href={`/p/${current.id}/settings`} className="gap-2">
                  <Settings2 className="size-4" /> Project settings
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <Link href="/settings/projects" className="gap-2">
                <FolderCog className="size-4" /> Manage projects
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
