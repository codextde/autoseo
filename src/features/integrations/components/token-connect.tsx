"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ExternalLink, KeyRound, Loader2, RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmButton, StatusBadge, TimeAgo } from "@/components/app/misc";
import { destinationChanged, getCatalogEntry } from "@/lib/integrations-catalog";
import { cn } from "@/lib/utils";
import type { PublicIntegration } from "@/server/integrations/store";
import {
  disconnectIntegrationAction,
  getTokenFormStateAction,
  saveTokenIntegrationAction,
  syncIntegrationAction,
  testTokenIntegrationAction,
} from "../actions";
import { IntegrationLogo } from "./integration-logo";

/** Generic credentials dialog for token-based providers (fields come from the catalog). */
export function TokenConnectDialog({
  projectId,
  provider,
  open,
  onOpenChange,
  onSaved,
}: {
  projectId: string;
  provider: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved?: () => void;
}) {
  const entry = getCatalogEntry(provider);
  if (!entry) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <IntegrationLogo provider={provider} size="sm" />
            <div className="min-w-0">
              <DialogTitle>Connect {entry.name}</DialogTitle>
              <DialogDescription className="mt-0.5">{entry.description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        {/* Mounted per opening so values are always reloaded. */}
        {open && <TokenForm projectId={projectId} provider={provider} onOpenChange={onOpenChange} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  );
}

function TokenForm({
  projectId,
  provider,
  onOpenChange,
  onSaved,
}: {
  projectId: string;
  provider: string;
  onOpenChange: (v: boolean) => void;
  onSaved?: () => void;
}) {
  const entry = getCatalogEntry(provider)!;
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [secretsSet, setSecretsSet] = useState<Record<string, boolean>>({});
  const [initialValues, setInitialValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, startTest] = useTransition();
  const [saving, startSave] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getTokenFormStateAction(projectId, provider).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.ok) {
        setValues(res.data.values);
        setSecretsSet(res.data.secretsSet);
        setInitialValues(res.data.values);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, provider]);

  const fields = entry.fields ?? [];
  // Stored secrets are discarded (server-side too) once a destination field such as the base URL changes.
  const secretsReusable = !destinationChanged(entry, initialValues, values);
  const secretSaved = (key: string) => secretsReusable && !!secretsSet[key];
  const validate = () => {
    const errs: Record<string, string> = {};
    for (const f of fields) {
      const v = (values[f.key] ?? "").trim();
      if (f.required && !v && !(f.secret && secretSaved(f.key)))
        errs[f.key] = f.secret && secretsSet[f.key] ? `${f.label} must be entered again because the URL changed` : `${f.label} is required`;
      else if (v && f.type === "url" && !/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(v)) errs[f.key] = "Enter a valid http(s) URL";
      else if (v && f.pattern && !new RegExp(f.pattern).test(v)) errs[f.key] = f.patternMessage ?? "Invalid value";
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const test = () => {
    if (!validate()) return;
    startTest(async () => {
      const res = await testTokenIntegrationAction(projectId, provider, values);
      setResult(res.ok ? { ok: true, message: res.data } : { ok: false, message: res.error });
    });
  };

  const save = (withTest: boolean) => {
    if (!validate()) return;
    startSave(async () => {
      const res = await saveTokenIntegrationAction(projectId, provider, values, { test: withTest && !!entry.testable });
      if (res.ok) {
        toast.success(res.data.message ?? `${entry.name} saved.`);
        onOpenChange(false);
        onSaved?.();
        router.refresh();
      } else setResult({ ok: false, message: res.error });
    });
  };

  return (
    <form
      className="space-y-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        save(true);
      }}
    >
      {fields.map((f) => (
        <div key={f.key} className="space-y-1.5">
          <Label htmlFor={`f-${f.key}`} className="text-xs">
            {f.label}
            {f.required && !(f.secret && secretSaved(f.key)) && <span className="text-destructive">*</span>}
          </Label>
          <Input
            id={`f-${f.key}`}
            type={f.type === "password" ? "password" : f.type === "number" ? "number" : "text"}
            inputMode={f.type === "url" ? "url" : undefined}
            autoComplete="off"
            disabled={loading}
            placeholder={
                  f.secret && secretSaved(f.key)
                    ? "•••••••• (saved — leave empty to keep)"
                    : f.secret && secretsSet[f.key]
                      ? "Re-enter — the URL changed"
                      : f.placeholder
                }
            value={values[f.key] ?? ""}
            aria-invalid={!!fieldErrors[f.key]}
            onChange={(e) => {
              setValues((v) => ({ ...v, [f.key]: e.target.value }));
              setFieldErrors((er) => ({ ...er, [f.key]: "" }));
              setResult(null);
            }}
          />
          {fieldErrors[f.key] ? (
            <p className="text-xs text-destructive">{fieldErrors[f.key]}</p>
          ) : (
            f.help && <p className="text-xs text-muted-foreground">{f.help}</p>
          )}
        </div>
      ))}
      {entry.docsUrl && (
        <a href={entry.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ExternalLink className="size-3" /> Where do I find these credentials?
        </a>
      )}
      {result && (
        <Alert variant={result.ok ? "default" : "destructive"} className={cn(result.ok && "border-success/30 bg-success/5")}>
          {result.ok ? <CheckCircle2 className="text-success" /> : <AlertTriangle />}
          <AlertTitle>{result.ok ? "Connection works" : "Connection failed"}</AlertTitle>
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      )}
      <DialogFooter className="gap-2 pt-1">
        {result && !result.ok && (
          <Button type="button" variant="ghost" size="sm" className="mr-auto" disabled={saving} onClick={() => save(false)}>
            Save without testing
          </Button>
        )}
        {entry.testable && (
          <Button type="button" variant="outline" disabled={testing || saving || loading} onClick={test}>
            {testing && <Loader2 className="size-3.5 animate-spin" />}
            Test connection
          </Button>
        )}
        <Button type="submit" disabled={saving || loading}>
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          {entry.testable ? "Save & connect" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Settings card for a token-based provider (Bing, Matomo, Piwik PRO) on the analytics settings tabs. */
export function TokenIntegrationCard({
  projectId,
  provider,
  integration,
  canManage,
  className,
  note,
}: {
  projectId: string;
  provider: string;
  integration: PublicIntegration | null;
  canManage: boolean;
  className?: string;
  note?: React.ReactNode;
}) {
  const entry = getCatalogEntry(provider);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  if (!entry) return null;
  const connected = !!integration && integration.status !== "disconnected";
  const summary = (entry.fields ?? [])
    .filter((f) => !f.secret && integration?.config[f.key])
    .map((f) => ({ label: f.label, value: String(integration!.config[f.key]) }));

  return (
    <section className={cn("space-y-4 rounded-2xl border bg-card p-4 shadow-soft sm:p-5", className)}>
      <div className="flex items-start gap-3">
        <IntegrationLogo provider={provider} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold tracking-tight">{entry.name}</h3>
            {connected ? (
              integration!.status === "error" ? (
                <StatusBadge status="error" label="Needs attention" />
              ) : (
                <StatusBadge status="active" label="Connected" />
              )
            ) : (
              <StatusBadge status="disabled" label="Not connected" dot={false} />
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{entry.description}</p>
        </div>
      </div>
      {connected && (
        <dl className="grid gap-x-6 gap-y-3 rounded-xl bg-muted/50 p-3 text-sm sm:grid-cols-2">
          {summary.map((s) => (
            <div key={s.label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{s.label}</dt>
              <dd className="truncate font-medium">{s.value}</dd>
            </div>
          ))}
          <div>
            <dt className="text-xs text-muted-foreground">Credentials</dt>
            <dd className="flex items-center gap-1 font-medium">
              <KeyRound className="size-3 text-muted-foreground" /> {integration!.hasSecret ? "Stored encrypted" : "Instance default"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Last synced</dt>
            <dd className="font-medium">{integration!.lastSyncAt ? <TimeAgo date={integration!.lastSyncAt} /> : "Importing…"}</dd>
          </div>
        </dl>
      )}
      {integration?.lastError && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Last sync failed</AlertTitle>
          <AlertDescription>{integration.lastError}</AlertDescription>
        </Alert>
      )}
      {note}
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={connected ? "outline" : "default"} onClick={() => setOpen(true)}>
            {connected ? "Edit credentials" : `Connect ${entry.name}`}
          </Button>
          {connected && (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  start(async () => {
                    const res = await syncIntegrationAction(projectId, provider);
                    if (res.ok) toast.success(res.data.alreadyQueued ? "A sync is already running." : "Sync started.");
                    else toast.error(res.error);
                  })
                }
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                Refresh data
              </Button>
              <ConfirmButton
                title={`Disconnect ${entry.name}?`}
                description="Credentials and imported data for this project are removed."
                confirmLabel="Disconnect"
                destructive
                onConfirm={async () => {
                  const res = await disconnectIntegrationAction(projectId, provider);
                  if (res.ok) {
                    toast.success(`${entry.name} disconnected.`);
                    router.refresh();
                  } else toast.error(res.error);
                }}
              >
                <Button variant="ghost" className="text-destructive hover:text-destructive">
                  <Unplug className="size-3.5" /> Disconnect
                </Button>
              </ConfirmButton>
            </>
          )}
        </div>
      )}
      {canManage && <TokenConnectDialog projectId={projectId} provider={provider} open={open} onOpenChange={setOpen} />}
    </section>
  );
}
