"use client";

import { useMemo, useState, useTransition } from "react";
import { motion } from "motion/react";
import { ArrowLeftRight, ExternalLink, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LogoMark } from "@/components/app/logo";
import { approveOAuthAction, denyOAuthAction } from "../oauth-actions";
import type { ApiScope } from "../scopes";
import { ProjectScopePicker, ScopePicker, type PickerProject } from "./access-picker";

export type ConsentWorkspace = { id: string; name: string; projects: PickerProject[]; canWrite: boolean };

export function ConsentForm({
  params,
  client,
  user,
  workspaces,
  requestedScopes,
  appName,
  logoUrl,
}: {
  params: Record<string, string | undefined>;
  client: { name: string; redirectHost: string; clientUri: string | null; registeredAt: string };
  user: { email: string; name: string | null };
  workspaces: ConsentWorkspace[];
  requestedScopes: ApiScope[];
  appName: string;
  logoUrl?: string;
}) {
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [projectIds, setProjectIds] = useState<string[] | null>(null);
  const [scopes, setScopes] = useState<ApiScope[]>(requestedScopes);
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const ws = useMemo(() => workspaces.find((w) => w.id === workspaceId), [workspaces, workspaceId]);

  const go = (url: string) => {
    setDone(true);
    window.location.assign(url);
  };

  const approve = () =>
    start(async () => {
      const res = await approveOAuthAction({ params, workspaceId, projectIds, scopes });
      if (!res.ok) return void toast.error(res.error);
      go(res.data.redirectTo);
    });

  const deny = () =>
    start(async () => {
      const res = await denyOAuthAction({ params });
      if (!res.ok) return void toast.error(res.error);
      go(res.data.redirectTo);
    });

  const initial = client.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="space-y-6">
      <div className="flex items-center justify-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-2xl border bg-card text-lg font-semibold shadow-soft">{initial}</div>
        <ArrowLeftRight className="size-4 text-muted-foreground" />
        <div className="flex size-12 items-center justify-center rounded-2xl border bg-card shadow-soft">
          <LogoMark src={logoUrl || undefined} className="size-8" />
        </div>
      </div>

      <div className="space-y-1.5 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-balance">
          {client.name} wants to access your {appName} account
        </h1>
        <p className="text-sm text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{user.email}</span>
        </p>
        <p>
          <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning ring-1 ring-warning/30 ring-inset">
            <TriangleAlert className="size-3" /> Unverified app · name chosen by the app
          </span>
        </p>
      </div>

      <div className="space-y-1 rounded-xl border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
        <div className="flex items-center justify-between gap-3">
          <span>Redirects to</span>
          <span className="truncate font-mono text-sm font-semibold text-foreground">{client.redirectHost}</span>
        </div>
        {client.clientUri && (
          <div className="flex items-center justify-between gap-3">
            <span>Website</span>
            <a href={client.clientUri} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 truncate text-foreground hover:underline">
              {client.clientUri.replace(/^https?:\/\//, "")}
              <ExternalLink className="size-3" />
            </a>
          </div>
        )}
        <div className="flex items-start gap-2 pt-1 text-[11px]">
          <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning" />
          <span>
            This app registered itself automatically — its name and website are not verified. Only continue if you just started connecting it (e.g. from
            Claude, ChatGPT or your editor) and the redirect host above is the one you expect.
          </span>
        </div>
      </div>

      {workspaces.length === 0 ? (
        <p className="rounded-xl border p-4 text-sm text-muted-foreground">You are not a member of any workspace yet.</p>
      ) : (
        <div className="space-y-5">
          {workspaces.length > 1 && (
            <div className="space-y-1.5">
              <Label>Workspace</Label>
              <Select
                value={workspaceId}
                onValueChange={(v) => {
                  setWorkspaceId(v);
                  setProjectIds(null);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Projects</Label>
            <ProjectScopePicker
              projects={ws?.projects ?? []}
              value={projectIds}
              onChange={setProjectIds}
              allLabel="All my projects"
              allDescription="Every project you can access in this workspace, including future ones."
            />
          </div>
          <div className="space-y-1.5">
            <Label>Permissions</Label>
            <ScopePicker value={scopes} onChange={setScopes} />
            {ws && !ws.canWrite && scopes.includes("write") && (
              <p className="px-1 text-[11px] text-muted-foreground">Your role is read-only in this workspace — write actions will be refused.</p>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="lg" onClick={deny} disabled={pending || done}>
          Deny
        </Button>
        <Button size="lg" onClick={approve} disabled={pending || done || workspaces.length === 0 || (projectIds !== null && projectIds.length === 0)}>
          {pending || done ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
          Allow access
        </Button>
      </div>
      <p className="text-center text-[11px] text-muted-foreground">
        You can disconnect this app any time in Settings → API &amp; MCP. Access tokens expire after 1 hour and are refreshed automatically.
      </p>
    </motion.div>
  );
}
