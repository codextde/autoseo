"use client";

import { createContext, useContext } from "react";

export type ShellProject = {
  id: string;
  name: string;
  domain: string;
  logoUrl: string | null;
  workspaceId: string;
  isPitch: boolean;
};

export type ShellData = {
  user: { id: string; name: string | null; email: string; avatarUrl: string | null; isInstanceAdmin: boolean };
  projects: ShellProject[];
  currentProjectId: string | null;
  /** Permissions in the workspace of the current project (or the first workspace). */
  permissions: string[];
  workspace: { id: string; name: string } | null;
  branding: { appName: string; logoUrl: string; docsUrl: string; demoBookingUrl: string; showProductTour: boolean };
  openTaskCount: number;
};

const ShellContext = createContext<ShellData | null>(null);

export function ShellProvider({ value, children }: { value: ShellData; children: React.ReactNode }) {
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellData {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside <ShellProvider>");
  return ctx;
}

/** Like useShell, but returns null outside the app shell (public pages, isolated component tests). */
export function useOptionalShell(): ShellData | null {
  return useContext(ShellContext);
}

export function useCan() {
  const shell = useShell();
  return (permission: string) => shell.user.isInstanceAdmin || shell.permissions.includes(permission);
}

/** Builds a project-scoped href: projectHref("/ai/tracker") → /p/<id>/ai/tracker */
export function useProjectHref() {
  const shell = useShell();
  return (path = "") => (shell.currentProjectId ? `/p/${shell.currentProjectId}${path}` : "/onboarding");
}
