"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Copy, ExternalLink, Globe, KeyRound, Link2Off, Lock, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/app/misc";
import { cn } from "@/lib/utils";
import { getShareStateAction, revokeShareAction, setPublishedAction, updateShareAction, type ShareState } from "../actions";

export function ShareDialog(props: {
  projectId: string;
  reportId: string;
  kind: "deck" | "html";
  open: boolean;
  onOpenChange: (v: boolean) => void;
  canManage: boolean;
  onChanged?: (s: ShareState) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share report</DialogTitle>
          <DialogDescription>Publish the report and share a read-only link with your client — no sign-in needed.</DialogDescription>
        </DialogHeader>
        {props.open && <ShareBody {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function ShareBody({
  projectId,
  reportId,
  kind,
  canManage,
  onChanged,
}: {
  projectId: string;
  reportId: string;
  kind: "deck" | "html";
  canManage: boolean;
  onChanged?: (s: ShareState) => void;
}) {
  const [state, setState] = useState<ShareState | null>(null);
  const [pending, start] = useTransition();
  const [password, setPassword] = useState("");
  const [copied, setCopied] = useState(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  useEffect(() => {
    let alive = true;
    void getShareStateAction(projectId, reportId).then((res) => {
      if (!alive) return;
      if (res.ok) setState(res.data);
      else toast.error(res.error);
    });
    return () => {
      alive = false;
    };
  }, [projectId, reportId]);

  const apply = (fn: () => Promise<{ ok: true; data: ShareState } | { ok: false; error: string }>, success?: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setState(res.data);
      onChanged?.(res.data);
      if (success) toast.success(success);
    });

  const url = state?.sharePath ? `${origin}${state.sharePath}` : "";
  const expiryValue = state?.shareExpiresAt ? state.shareExpiresAt.slice(0, 10) : "";

  return (
    <>
        {!state ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium">
                  Status <StatusBadge status={state.status} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {state.status === "published" ? "Marked as final for the client." : "Work in progress. A public link (if enabled) still works for drafts."}
                </p>
              </div>
              <Button
                size="sm"
                variant={state.status === "published" ? "outline" : "default"}
                disabled={!canManage || pending}
                onClick={() => apply(() => setPublishedAction(projectId, reportId, state.status !== "published"), state.status === "published" ? "Moved back to draft" : "Published")}
              >
                {state.status === "published" ? "Unpublish" : "Publish"}
              </Button>
            </div>

            <div className="rounded-xl border">
              <div className="flex items-start justify-between gap-3 p-3">
                <div className="flex min-w-0 gap-3">
                  <div className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", state.shareEnabled ? "bg-brand-soft text-brand" : "bg-muted text-muted-foreground")}>
                    <Globe className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">Public link</div>
                    <p className="text-xs text-muted-foreground">
                      {state.shareEnabled ? "Anyone with the link can view. Search engines are told not to index it." : "Only members of your workspace can open this report."}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={state.shareEnabled}
                  disabled={!canManage || pending}
                  onCheckedChange={(v) => apply(() => updateShareAction(projectId, reportId, { enabled: v }), v ? "Link enabled" : "Link disabled")}
                  aria-label="Public link"
                />
              </div>
              {state.shareEnabled && url && (
                <div className="space-y-4 border-t p-3">
                  <div className="flex gap-2">
                    <Input readOnly value={url} className="h-9 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                    <Button
                      size="icon"
                      variant="outline"
                      className="size-9 shrink-0"
                      aria-label="Copy link"
                      onClick={async () => {
                        await navigator.clipboard.writeText(url);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      }}
                    >
                      {copied ? <Check className="size-4 text-brand" /> : <Copy className="size-4" />}
                    </Button>
                    <Button size="icon" variant="outline" className="size-9 shrink-0" asChild aria-label="Open link">
                      <a href={url} target="_blank" rel="noreferrer">
                        <ExternalLink className="size-4" />
                      </a>
                    </Button>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5 text-xs">
                      <Lock className="size-3.5" /> Password {state.hasPassword && <span className="font-normal text-brand">· set</span>}
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        placeholder={state.hasPassword ? "New password (min. 8 characters)" : "Optional password (min. 8 characters)"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="h-9"
                        disabled={!canManage}
                        autoComplete="new-password"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9"
                        disabled={!canManage || pending || password.length < 8}
                        onClick={() =>
                          apply(async () => {
                            const r = await updateShareAction(projectId, reportId, { enabled: true, password });
                            if (r.ok) setPassword("");
                            return r;
                          }, "Password saved")
                        }
                      >
                        <KeyRound className="size-3.5" /> Save
                      </Button>
                      {state.hasPassword && (
                        <Button size="sm" variant="ghost" className="h-9" disabled={!canManage || pending} onClick={() => apply(() => updateShareAction(projectId, reportId, { enabled: true, password: null }), "Password removed")}>
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Expires</Label>
                      <div className="flex gap-2">
                        <Input
                          type="date"
                          className="h-9"
                          value={expiryValue}
                          min={new Date().toISOString().slice(0, 10)}
                          disabled={!canManage || pending}
                          onChange={(e) => apply(() => updateShareAction(projectId, reportId, { enabled: true, expiresAt: e.target.value || null }), "Expiry updated")}
                        />
                        {expiryValue && (
                          <Button size="sm" variant="ghost" className="h-9" disabled={!canManage || pending} onClick={() => apply(() => updateShareAction(projectId, reportId, { enabled: true, expiresAt: null }))}>
                            Never
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Views</Label>
                      <div className="flex h-9 items-center text-sm tabular">{state.shareViews}</div>
                    </div>
                  </div>

                  {kind === "deck" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Data</Label>
                      <div className="grid grid-cols-2 gap-2">
                        {(["live", "snapshot"] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            disabled={!canManage || pending}
                            onClick={() => state.shareMode !== m && apply(() => updateShareAction(projectId, reportId, { enabled: true, mode: m }), m === "live" ? "Live data" : "Snapshot captured")}
                            className={cn(
                              "rounded-lg border p-2.5 text-left transition-colors",
                              state.shareMode === m ? "border-foreground bg-muted/60" : "hover:bg-muted/40",
                            )}
                          >
                            <div className="text-sm font-medium">{m === "live" ? "Live" : "Snapshot"}</div>
                            <div className="text-xs text-muted-foreground">{m === "live" ? "Numbers refresh on every view" : "Frozen at publish time"}</div>
                          </button>
                        ))}
                      </div>
                      {state.shareMode === "snapshot" && (
                        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span>Captured {state.snapshotAt ? new Date(state.snapshotAt).toLocaleString() : "—"}</span>
                          <Button size="xs" variant="ghost" disabled={!canManage || pending} onClick={() => apply(() => updateShareAction(projectId, reportId, { enabled: true, refreshSnapshot: true }), "Snapshot refreshed")}>
                            <RefreshCw className="size-3" /> Refresh snapshot
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex justify-end border-t pt-3">
                    <Button size="sm" variant="destructive" disabled={!canManage || pending} onClick={() => apply(() => revokeShareAction(projectId, reportId), "Link revoked — the old URL no longer works")}>
                      <Link2Off className="size-3.5" /> Revoke link
                    </Button>
                  </div>
                </div>
              )}
            </div>
            {!canManage && <p className="text-xs text-muted-foreground">You need the “Create, edit and share reports” permission to change sharing.</p>}
          </div>
        )}
    </>
  );
}
