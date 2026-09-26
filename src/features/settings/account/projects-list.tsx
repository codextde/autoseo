"use client";

import Link from "next/link";
import { ArrowUpRight, FolderKanban, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/app/page";
import { Favicon } from "@/components/app/favicon";
import { CountryFlag } from "@/components/app/misc";
import { EmptyState } from "@/components/app/empty-state";

export type AccountProject = {
  id: string;
  name: string;
  domain: string;
  logoUrl: string | null;
  country: string;
  workspaceName: string;
  isPitch: boolean;
  isDefault: boolean;
};

export function AccountProjectsList({ projects, canCreate }: { projects: AccountProject[]; canCreate: boolean }) {
  return (
    <Panel
      title="Your projects"
      icon={<FolderKanban className="size-4 text-muted-foreground" />}
      description={`${projects.length} ${projects.length === 1 ? "project" : "projects"} · Manage your websites`}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href="/settings/projects">Manage projects</Link>
        </Button>
      }
      contentClassName="p-0 sm:p-0"
    >
      {projects.length === 0 ? (
        <EmptyState
          compact
          icon={FolderKanban}
          title="No projects yet"
          description={canCreate ? "Create your first project to start tracking." : "Ask a workspace admin to give you access to a project."}
          action={canCreate ? { label: "New project", href: "/onboarding" } : undefined}
        />
      ) : (
        <ul className="divide-y">
          {projects.map((p) => (
            <li key={p.id} className="group flex items-center gap-3 px-4 py-3 sm:px-5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border bg-background">
                <Favicon domain={p.domain} src={p.logoUrl} fallback={p.name} className="size-5" />
              </span>
              <Link href={`/p/${p.id}`} className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium group-hover:underline">{p.name}</span>
                  {p.isDefault && (
                    <Badge variant="secondary" className="h-5 text-[10px]">
                      Default
                    </Badge>
                  )}
                  {p.isPitch && (
                    <Badge variant="outline" className="h-5 text-[10px]">
                      Pitch
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CountryFlag iso={p.country} />
                  <span className="truncate">{p.domain}</span>
                  <span aria-hidden className="hidden sm:inline">·</span>
                  <span className="hidden truncate sm:inline">{p.workspaceName}</span>
                </div>
              </Link>
              <Button asChild variant="ghost" size="sm" className="shrink-0 gap-1.5 text-muted-foreground">
                <Link href={`/p/${p.id}/settings`}>
                  <Settings2 className="size-3.5" />
                  <span className="hidden sm:inline">Settings</span>
                </Link>
              </Button>
              <Link href={`/p/${p.id}`} className="hidden text-muted-foreground hover:text-foreground sm:block" aria-label="Open project">
                <ArrowUpRight className="size-4" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
