"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge, TimeAgo } from "@/components/app/misc";
import { getCatalogEntry } from "@/lib/integrations-catalog";
import { cn } from "@/lib/utils";
import type { PublicGoogleAccount } from "@/server/integrations/google/accounts";
import type { GoogleAccountImpact } from "@/server/integrations/service";
import { googleAccountImpactAction, removeGoogleAccountAction } from "../actions";
import { GoogleAccountAvatar, googleStartHref } from "./google-connection";

const SCOPE_LABEL: { key: keyof PublicGoogleAccount["can"]; label: string }[] = [
  { key: "gsc", label: "Search Console" },
  { key: "ga4", label: "Analytics" },
  { key: "sheets", label: "Sheets export" },
];

function RemoveAccountDialog({
  projectId,
  account,
  open,
  onOpenChange,
}: {
  projectId: string;
  account: PublicGoogleAccount;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove Google account?</DialogTitle>
          <DialogDescription>
            {account.email ?? "This account"} is unlinked from the workspace and its access tokens are deleted. You can link it again at any time.
          </DialogDescription>
        </DialogHeader>
        {open && <RemoveAccountBody projectId={projectId} account={account} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function RemoveAccountBody({ projectId, account, onDone }: { projectId: string; account: PublicGoogleAccount; onDone: () => void }) {
  const router = useRouter();
  const [impact, setImpact] = useState<GoogleAccountImpact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let cancelled = false;
    googleAccountImpactAction(projectId, account.id).then((res) => {
      if (cancelled) return;
      if (res.ok) setImpact(res.data);
      else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, account.id]);

  const remove = () =>
    start(async () => {
      const res = await removeGoogleAccountAction(projectId, account.id);
      if (res.ok) {
        toast.success(res.data.removed ? `Account removed — ${res.data.removed} connection(s) disconnected.` : "Account removed.");
        onDone();
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <>
      {!impact && !error && (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Checking which connections use this account…
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {impact &&
        (impact.integrations.length ? (
          <div className="space-y-2">
            <p className="flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              <span>
                This also disconnects <b>{impact.integrations.length}</b> project connection{impact.integrations.length === 1 ? "" : "s"} and deletes
                their imported data:
              </span>
            </p>
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border bg-muted/40 p-2 text-xs">
              {impact.integrations.map((i) => (
                <li key={`${i.projectId}:${i.provider}`} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">
                    <b>{i.projectName}</b> · {getCatalogEntry(i.provider)?.name ?? i.provider}
                  </span>
                  <span className="shrink-0 truncate text-muted-foreground">{i.property ?? "no property"}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No project connection uses this account — nothing else is affected.</p>
        ))}
      <DialogFooter className="gap-2">
        <Button variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={remove} disabled={!impact || pending}>
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          Remove account
        </Button>
      </DialogFooter>
    </>
  );
}

/** Workspace-level list of linked Google accounts (open-seo "Google accounts management"). */
export function GoogleAccountsPanel({
  projectId,
  accounts,
  canManage,
  currentUserId,
  oauthConfigured,
  className,
}: {
  projectId: string;
  accounts: PublicGoogleAccount[];
  canManage: boolean;
  currentUserId: string;
  oauthConfigured: boolean;
  className?: string;
}) {
  const params = useSearchParams();
  const [removing, setRemoving] = useState<PublicGoogleAccount | null>(null);
  const returnTo = `/p/${projectId}/integrations`;

  useEffect(() => {
    const connected = params.get("google_connected");
    if (connected === "account") toast.success("Google account linked.");
    if (connected === "sheets") toast.success("Google Sheets export enabled.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className={cn("rounded-2xl border bg-card p-4 shadow-soft", className)}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">
            Google accounts <span className="font-normal text-muted-foreground">({accounts.length} linked)</span>
          </h2>
          <p className="text-xs text-muted-foreground">Linked once for the workspace — pick an account and property when connecting Search Console or Analytics.</p>
        </div>
        {canManage && oauthConfigured && (
          <Button asChild size="sm" variant="outline">
            <a href={googleStartHref(projectId, "account", returnTo)}>
              <Plus className="size-3.5" /> Add Google account
            </a>
          </Button>
        )}
      </div>
      {accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {oauthConfigured
            ? "No Google account linked yet. Connecting Search Console or Google Analytics links your account automatically."
            : "Google OAuth isn't configured on this instance yet (Admin → Data Providers)."}
        </p>
      ) : (
        <ul className="divide-y">
          {accounts.map((a) => {
            const mine = a.connectedBy?.id === currentUserId;
            const canRemove = canManage || (mine && a.usage.length === 0);
            return (
              <li key={a.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <GoogleAccountAvatar account={a} className="size-9" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{a.name ?? a.email ?? "Google account"}</span>
                      {a.status === "error" && <StatusBadge status="error" label="Reconnect needed" />}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {a.name && a.email ? `${a.email} · ` : ""}
                      linked {a.connectedBy ? `by ${a.connectedBy.name ?? a.connectedBy.email} ` : ""}
                      <TimeAgo date={a.connectedAt} />
                      {a.usage.length > 0 && ` · used by ${a.usage.length} connection${a.usage.length === 1 ? "" : "s"}`}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {SCOPE_LABEL.map((s) => (
                        <span
                          key={s.key}
                          className={cn(
                            "rounded-full px-1.5 py-px text-[10px] font-medium",
                            a.can[s.key] ? "bg-success/12 text-success" : "bg-muted text-muted-foreground line-through",
                          )}
                        >
                          {s.label}
                        </span>
                      ))}
                    </div>
                    {a.lastError && <p className="mt-1 text-xs text-destructive">{a.lastError}</p>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5 pl-12 sm:pl-0">
                  {(canManage || mine) && oauthConfigured && (
                    <Button asChild size="sm" variant="outline" title="Re-consent to refresh the grant and scopes">
                      <a href={googleStartHref(projectId, canManage ? "account" : "sheets", returnTo, a.email)}>
                        <RefreshCw className="size-3.5" /> Reconnect
                      </a>
                    </Button>
                  )}
                  {canRemove && (
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setRemoving(a)}>
                      <Trash2 className="size-3.5" /> Remove
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {removing && (
        <RemoveAccountDialog projectId={projectId} account={removing} open={!!removing} onOpenChange={(v) => !v && setRemoving(null)} />
      )}
    </section>
  );
}
