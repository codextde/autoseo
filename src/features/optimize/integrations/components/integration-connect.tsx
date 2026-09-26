"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ExternalLink,
  KeyRound,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ConfirmButton, CopyButton, StatusBadge, TimeAgo } from "@/components/app/misc";
import { useUrlState } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import type { ConnectedIntegration, ProviderMeta } from "@/server/optimize/integrations/types";
import { CMS_PROVIDERS, PM_PROVIDERS, getProviderMeta } from "../providers";
import {
  connectIntegrationAction,
  disconnectIntegrationAction,
  getIntegrationDetailsAction,
  listIntegrationTargetsAction,
  rotateWebhookSecretAction,
  sendWebhookTestAction,
  setIntegrationTargetAction,
  setWebhookEventsAction,
  testIntegrationAction,
} from "../actions";
import { ProviderGlyph, ProviderGlyphStack } from "./provider-glyph";

type Target = { id: string; name: string };
type View =
  | { type: "pick" }
  | { type: "form"; provider: string }
  | { type: "target"; provider: string; targets: Target[]; current: Target | null }
  | { type: "secret"; provider: string; secret: string }
  | { type: "manage"; provider: string };

const STATUS_LABEL: Record<ConnectedIntegration["status"], string> = {
  connected: "Connected",
  pending: "Setup incomplete",
  error: "Error",
  disconnected: "Disconnected",
};
const STATUS_TONE: Record<ConnectedIntegration["status"], string> = {
  connected: "active",
  pending: "pending",
  error: "error",
  disconnected: "disabled",
};

/** Opens the connect dialog of a kind from anywhere on the page (sets `?connect=`). */
export function useOpenConnect() {
  const [, setParam] = useUrlState("connect", "");
  return setParam;
}

export function IntegrationConnect({
  projectId,
  kind,
  connected,
  canManage,
  className,
}: {
  projectId: string;
  kind: "pm" | "cms";
  connected: ConnectedIntegration[];
  canManage: boolean;
  className?: string;
}) {
  const router = useRouter();
  const providers = kind === "pm" ? PM_PROVIDERS : CMS_PROVIDERS;
  const [items, setItems] = useState(connected.filter((c) => c.kind === kind));
  // Re-sync local state when the server sends a fresh list (after router.refresh()).
  const [syncedFrom, setSyncedFrom] = useState(connected);
  if (syncedFrom !== connected) {
    setSyncedFrom(connected);
    setItems(connected.filter((c) => c.kind === kind));
  }
  const [param, setParam] = useUrlState("connect", "");
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>({ type: "pick" });
  const [dirty, setDirty] = useState(false);

  const byProvider = useMemo(() => new Map(items.map((i) => [i.provider, i])), [items]);

  const viewFor = useCallback(
    (provider?: string): View => {
      if (!provider) return { type: "pick" };
      if (byProvider.has(provider)) return { type: "manage", provider };
      return canManage ? { type: "form", provider } : { type: "pick" };
    },
    [byProvider, canManage],
  );
  const openFor = (provider?: string) => {
    setView(viewFor(provider));
    setOpen(true);
  };

  // Deep links from the Integrations catalog: ?connect=<provider> (or ?connect=pm / cms).
  const [handledParam, setHandledParam] = useState("");
  if (param !== handledParam) {
    setHandledParam(param);
    const meta = param && param !== kind ? getProviderMeta(param) : undefined;
    if (param === kind || meta?.kind === kind) {
      setView(viewFor(meta?.key));
      setOpen(true);
    }
  }

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      if (param && (param === kind || getProviderMeta(param)?.kind === kind)) setParam(null);
      if (dirty) {
        router.refresh();
        setDirty(false);
      }
    }
  };

  const upsert = (i: ConnectedIntegration) => {
    setDirty(true);
    setItems((prev) => [...prev.filter((p) => p.provider !== i.provider), i]);
  };
  const remove = (provider: string) => {
    setDirty(true);
    setItems((prev) => prev.filter((p) => p.provider !== provider));
  };

  const label = kind === "pm" ? "Connect PM Tool" : "Connect CMS";
  const stack = kind === "pm" ? ["asana", "jira", "linear", "clickup"] : ["wordpress", "webflow", "shopify_cms", "framer"];

  return (
    <>
      <div className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}>
        {items.length === 0 ? (
          <Button variant="outline" size="sm" className="gap-2" onClick={() => openFor()}>
            <ProviderGlyphStack providers={stack} />
            {label}
          </Button>
        ) : (
          <>
            {items.slice(0, 2).map((i) => (
              <Button
                key={i.provider}
                variant="outline"
                size="sm"
                className="max-w-full min-w-0 gap-1.5"
                onClick={() => openFor(i.provider)}
                title={`${i.name}${i.target ? ` · ${i.target.name}` : ""}`}
              >
                <ProviderGlyph provider={i.provider} size="xs" />
                <span className="truncate">{i.name.replace(/ \(.*\)$/, "")}</span>
                {i.target && <span className="hidden max-w-32 truncate text-muted-foreground sm:inline">· {i.target.name}</span>}
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    i.status === "connected" ? "bg-success" : i.status === "error" ? "bg-destructive" : "bg-warning",
                  )}
                />
              </Button>
            ))}
            {items.length > 2 && (
              <Button variant="ghost" size="sm" className="px-2 text-xs text-muted-foreground" onClick={() => openFor()}>
                +{items.length - 2}
              </Button>
            )}
            {canManage && (
              <Button variant="ghost" size="icon-sm" aria-label={label} title={label} onClick={() => openFor()}>
                <Plus />
              </Button>
            )}
          </>
        )}
      </div>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92dvh] max-w-[calc(100%-1rem)] gap-0 overflow-y-auto p-0 sm:max-w-xl">
          {view.type === "pick" && (
            <PickView
              kind={kind}
              providers={providers}
              byProvider={byProvider}
              canManage={canManage}
              onPick={(p) => (byProvider.has(p) ? setView({ type: "manage", provider: p }) : setView({ type: "form", provider: p }))}
            />
          )}
          {view.type === "form" && (
            <FormView
              projectId={projectId}
              meta={getProviderMeta(view.provider)!}
              existing={byProvider.get(view.provider) ?? null}
              onBack={() => setView(byProvider.has(view.provider) ? { type: "manage", provider: view.provider } : { type: "pick" })}
              onConnected={(res) => {
                upsert(res.integration);
                if (res.integration.status === "pending" && res.targets?.length) {
                  setView({ type: "target", provider: view.provider, targets: res.targets, current: null });
                } else if (res.signingSecret) {
                  setView({ type: "secret", provider: view.provider, secret: res.signingSecret });
                } else {
                  toast.success(`${res.integration.name} connected`);
                  setView({ type: "manage", provider: view.provider });
                }
              }}
            />
          )}
          {view.type === "target" && (
            <TargetView
              projectId={projectId}
              meta={getProviderMeta(view.provider)!}
              targets={view.targets}
              current={view.current}
              onBack={() => setView({ type: "manage", provider: view.provider })}
              onSaved={(i) => {
                upsert(i);
                toast.success(`${i.name}: ${getProviderMeta(i.provider)?.targetLabel ?? "target"} set to ${i.target?.name ?? ""}`);
                setView({ type: "manage", provider: view.provider });
              }}
            />
          )}
          {view.type === "secret" && (
            <SecretView
              projectId={projectId}
              secret={view.secret}
              onDone={() => setView({ type: "manage", provider: view.provider })}
            />
          )}
          {view.type === "manage" && byProvider.get(view.provider) && (
            <ManageView
              projectId={projectId}
              meta={getProviderMeta(view.provider)!}
              item={byProvider.get(view.provider)!}
              canManage={canManage}
              onBack={() => setView({ type: "pick" })}
              onEdit={() => setView({ type: "form", provider: view.provider })}
              onChooseTarget={(targets, current) => setView({ type: "target", provider: view.provider, targets, current })}
              onSecret={(secret) => setView({ type: "secret", provider: view.provider, secret })}
              onUpdated={upsert}
              onRemoved={() => {
                remove(view.provider);
                setView({ type: "pick" });
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ─────────────────────────── Views ─────────────────────────── */

function Header({
  title,
  description,
  provider,
  onBack,
}: {
  title: string;
  description?: React.ReactNode;
  provider?: string;
  onBack?: () => void;
}) {
  return (
    <DialogHeader className="border-b px-4 py-4 pr-12 sm:px-5">
      <div className="flex items-start gap-3">
        {onBack && (
          <Button variant="ghost" size="icon-sm" className="-ml-1 shrink-0" onClick={onBack} aria-label="Back">
            <ArrowLeft />
          </Button>
        )}
        {provider && <ProviderGlyph provider={provider} size="md" />}
        <div className="min-w-0 space-y-1">
          <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
          {description && <DialogDescription className="text-xs">{description}</DialogDescription>}
        </div>
      </div>
    </DialogHeader>
  );
}

function PickView({
  kind,
  providers,
  byProvider,
  canManage,
  onPick,
}: {
  kind: "pm" | "cms";
  providers: ProviderMeta[];
  byProvider: Map<string, ConnectedIntegration>;
  canManage: boolean;
  onPick: (provider: string) => void;
}) {
  return (
    <>
      <Header
        title={kind === "pm" ? "Connect a project management tool" : "Connect your CMS"}
        description={
          kind === "pm"
            ? "Push prioritized tasks as issues or cards and keep their status in sync — or send signed webhooks to Zapier, n8n and Make."
            : "Publish optimized content with formatting, metadata and schema markup in one click."
        }
      />
      <div className="space-y-3 p-4 sm:p-5">
        {!canManage && (
          <Alert>
            <ShieldCheck />
            <AlertDescription>Ask a workspace admin (Integrations permission) to connect.</AlertDescription>
          </Alert>
        )}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {providers.map((p) => {
            const c = byProvider.get(p.key);
            const disabled = !canManage && !c;
            return (
              <button
                key={p.key}
                type="button"
                disabled={disabled}
                onClick={() => onPick(p.key)}
                className={cn(
                  "group flex min-w-0 items-start gap-3 rounded-xl border bg-card p-3 text-left transition-colors",
                  disabled ? "cursor-not-allowed opacity-60" : "hover:border-foreground/20 hover:bg-muted/40",
                )}
              >
                <ProviderGlyph provider={p.key} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{p.name}</span>
                    {c && <StatusBadge status={STATUS_TONE[c.status]} label={STATUS_LABEL[c.status]} className="px-1.5 py-0 text-[10px]" />}
                    {p.exportOnly && !c && <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">Export</span>}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{p.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

function FormView({
  projectId,
  meta,
  existing,
  onBack,
  onConnected,
}: {
  projectId: string;
  meta: ProviderMeta;
  existing: ConnectedIntegration | null;
  onBack: () => void;
  onConnected: (res: { integration: ConnectedIntegration; targets: Target[] | null; signingSecret?: string }) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!existing) return;
    let cancelled = false;
    getIntegrationDetailsAction(projectId, meta.key).then((res) => {
      if (!cancelled && res.ok && res.data) setValues((v) => ({ ...res.data!.values, ...v }));
    });
    return () => {
      cancelled = true;
    };
  }, [existing, projectId, meta.key]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await connectIntegrationAction({ projectId, provider: meta.key, values });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onConnected(res.data);
    });
  };

  return (
    <form onSubmit={submit}>
      <Header title={existing ? `Update ${meta.name}` : `Connect ${meta.name}`} description={meta.description} provider={meta.key} onBack={onBack} />
      <div className="space-y-4 p-4 sm:p-5">
        <ol className="space-y-1.5 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
          {meta.setupSteps.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-background text-[10px] font-semibold text-foreground tabular ring-1 ring-border">
                {i + 1}
              </span>
              <span className="min-w-0 break-words">{s}</span>
            </li>
          ))}
          {meta.docsUrl && (
            <li className="pt-1 pl-6">
              <a href={meta.docsUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline">
                Documentation <ExternalLink className="size-3" />
              </a>
            </li>
          )}
        </ol>
        {meta.fields.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <Label htmlFor={`f-${f.key}`} className="text-xs">
              {f.label}
              {f.required && <span className="text-destructive">*</span>}
            </Label>
            <Input
              id={`f-${f.key}`}
              type={f.type === "password" ? "password" : f.type === "email" ? "email" : "text"}
              inputMode={f.type === "url" ? "url" : undefined}
              autoComplete="off"
              spellCheck={false}
              required={f.required && !(existing && f.secret)}
              placeholder={existing && f.secret ? "•••••••• (unchanged — leave empty to keep)" : f.placeholder}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              className="h-9"
            />
            {f.help && <p className="text-[11px] text-muted-foreground">{f.help}</p>}
          </div>
        ))}
        {meta.fields.some((f) => f.secret) && (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <KeyRound className="size-3" /> Credentials are encrypted at rest and never sent back to the browser.
            {existing && meta.fields.some((f) => f.type === "url" || /url|domain|host|site|shop/i.test(f.key)) && " Changing the address requires re-entering them."}
          </p>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription className="break-words">{error}</AlertDescription>
          </Alert>
        )}
      </div>
      <div className="flex flex-col-reverse gap-2 border-t bg-muted/40 px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
        <Button type="button" variant="outline" onClick={onBack} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Plug />}
          {pending ? "Verifying…" : existing ? "Save & verify" : meta.exportOnly ? "Add" : "Connect"}
        </Button>
      </div>
    </form>
  );
}

function TargetView({
  projectId,
  meta,
  targets,
  current,
  onBack,
  onSaved,
}: {
  projectId: string;
  meta: ProviderMeta;
  targets: Target[];
  current: Target | null;
  onBack: () => void;
  onSaved: (i: ConnectedIntegration) => void;
}) {
  const [selected, setSelected] = useState<string | null>(current?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const label = meta.targetLabel ?? "Target";
  const save = () => {
    if (!selected) return;
    setError(null);
    start(async () => {
      const res = await setIntegrationTargetAction({ projectId, provider: meta.key, targetId: selected });
      if (!res.ok) setError(res.error);
      else onSaved(res.data);
    });
  };
  return (
    <>
      <Header
        title={`Choose a ${label.toLowerCase()}`}
        description={meta.kind === "pm" ? `New tasks are created in this ${label.toLowerCase()}.` : `Content is published to this ${label.toLowerCase()}.`}
        provider={meta.key}
        onBack={onBack}
      />
      <div className="space-y-3 p-4 sm:p-5">
        <Command className="rounded-xl border">
          {targets.length > 6 && <CommandInput placeholder={`Search ${label.toLowerCase()}s…`} className="h-9" />}
          <CommandList className="max-h-72">
            <CommandEmpty>Nothing found.</CommandEmpty>
            <CommandGroup>
              {targets.map((t) => (
                <CommandItem key={t.id} value={`${t.name} ${t.id}`} onSelect={() => setSelected(t.id)} className="gap-2">
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-full border",
                      selected === t.id ? "border-foreground bg-foreground text-background" : "border-input",
                    )}
                  >
                    {selected === t.id && <Check className="size-3" />}
                  </span>
                  <span className="truncate">{t.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription className="break-words">{error}</AlertDescription>
          </Alert>
        )}
      </div>
      <div className="flex flex-col-reverse gap-2 border-t bg-muted/40 px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
        <Button variant="outline" onClick={onBack} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={save} disabled={!selected || pending}>
          {pending && <Loader2 className="animate-spin" />}
          Save {label.toLowerCase()}
        </Button>
      </div>
    </>
  );
}

function SecretView({ projectId, secret, onDone }: { projectId: string; secret: string; onDone: () => void }) {
  const [pending, start] = useTransition();
  const snippet = `const expected = "sha256=" + crypto
  .createHmac("sha256", SIGNING_SECRET)
  .update(\`\${req.headers["x-autoseo-timestamp"]}.\${rawBody}\`)
  .digest("hex");
const valid = expected === req.headers["x-autoseo-signature"];`;
  return (
    <>
      <Header title="Webhook connected" description="Copy the signing secret now — it won't be shown again." provider="webhook" />
      <div className="space-y-4 p-4 sm:p-5">
        <div className="space-y-1.5">
          <Label className="text-xs">Signing secret</Label>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border bg-muted/50 px-3 py-2 font-mono text-xs">{secret}</code>
            <CopyButton value={secret} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Verify requests (Node.js)</Label>
          <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3 font-mono text-[11px] leading-relaxed">{snippet}</pre>
          <p className="text-[11px] text-muted-foreground">
            Events: <code>task.created</code>, <code>task.updated</code>, <code>task.resolved</code>, <code>task.pushed</code>, <code>ping</code>. Headers:{" "}
            <code>X-AutoSEO-Event</code>, <code>X-AutoSEO-Timestamp</code>, <code>X-AutoSEO-Signature</code>.
          </p>
        </div>
      </div>
      <div className="flex flex-col-reverse gap-2 border-t bg-muted/40 px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await sendWebhookTestAction(projectId);
              if (res.ok) toast.success("Test event delivered");
              else toast.error(res.error);
            })
          }
        >
          {pending ? <Loader2 className="animate-spin" /> : <Send />}
          Send test event
        </Button>
        <Button onClick={onDone}>Done</Button>
      </div>
    </>
  );
}

function ManageView({
  projectId,
  meta,
  item,
  canManage,
  onBack,
  onEdit,
  onChooseTarget,
  onSecret,
  onUpdated,
  onRemoved,
}: {
  projectId: string;
  meta: ProviderMeta;
  item: ConnectedIntegration;
  canManage: boolean;
  onBack: () => void;
  onEdit: () => void;
  onChooseTarget: (targets: Target[], current: Target | null) => void;
  onSecret: (secret: string) => void;
  onUpdated: (i: ConnectedIntegration) => void;
  onRemoved: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [webhookEvents, setWebhookEvents] = useState<boolean | null>(null);

  useEffect(() => {
    if (meta.key !== "webhook" || !canManage) return;
    getIntegrationDetailsAction(projectId, "webhook").then((res) => {
      if (res.ok && res.data) setWebhookEvents(res.data.webhookEvents ?? true);
    });
  }, [meta.key, projectId, canManage]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const loadTargets = () =>
    run("targets", async () => {
      const res = await listIntegrationTargetsAction(projectId, meta.key);
      if (!res.ok) toast.error(res.error);
      else onChooseTarget(res.data.targets, res.data.current);
    });

  const rows: { label: string; value: React.ReactNode }[] = [
    { label: "Account", value: item.account ?? "—" },
    ...(meta.targetLabel
      ? [
          {
            label: meta.targetLabel,
            value: item.target ? (
              item.target.name
            ) : (
              <span className="text-warning">Not selected — required before {meta.kind === "pm" ? "pushing tasks" : "publishing"}</span>
            ),
          },
        ]
      : []),
    { label: "Last activity", value: item.lastSyncAt ? <TimeAgo date={item.lastSyncAt} /> : "—" },
  ];

  return (
    <>
      <Header
        title={item.name}
        description={<StatusBadge status={STATUS_TONE[item.status]} label={STATUS_LABEL[item.status]} />}
        provider={meta.key}
        onBack={onBack}
      />
      <div className="space-y-4 p-4 sm:p-5">
        <dl className="divide-y rounded-xl border">
          {rows.map((r) => (
            <div key={r.label} className="flex flex-col gap-0.5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <dt className="text-xs text-muted-foreground">{r.label}</dt>
              <dd className="flex min-w-0 items-center gap-2 text-sm sm:justify-end">
                <span className="min-w-0 truncate">{r.value}</span>
                {r.label === meta.targetLabel && canManage && (
                  <Button variant="outline" size="xs" onClick={loadTargets} disabled={busy !== null}>
                    {busy === "targets" && <Loader2 className="animate-spin" />}
                    {item.target ? "Change" : "Choose"}
                  </Button>
                )}
              </dd>
            </div>
          ))}
        </dl>

        {item.lastError && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription className="break-words">{item.lastError}</AlertDescription>
          </Alert>
        )}

        {meta.exportOnly && (
          <p className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
            {meta.name} has no publishing API. Open a piece of content → Publish → {meta.name} to download a Markdown, HTML or CMS-ready CSV export.
          </p>
        )}

        {meta.key === "webhook" && canManage && (
          <div className="space-y-3 rounded-xl border p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Send task events automatically</div>
                <p className="text-xs text-muted-foreground">task.created, task.updated and task.resolved after each analysis and status change.</p>
              </div>
              <Switch
                checked={webhookEvents ?? true}
                disabled={webhookEvents === null || busy !== null}
                onCheckedChange={(v) =>
                  run("events", async () => {
                    const res = await setWebhookEventsAction(projectId, v);
                    if (res.ok) setWebhookEvents(res.data);
                    else toast.error(res.error);
                  })
                }
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() =>
                  run("ping", async () => {
                    const res = await sendWebhookTestAction(projectId);
                    if (res.ok) toast.success("Test event delivered");
                    else toast.error(res.error);
                  })
                }
              >
                {busy === "ping" ? <Loader2 className="animate-spin" /> : <Send />}
                Send test event
              </Button>
              <ConfirmButton
                title="Rotate signing secret?"
                description="Receivers verifying the old secret will reject new events until you update them."
                confirmLabel="Rotate"
                onConfirm={async () => {
                  const res = await rotateWebhookSecretAction(projectId);
                  if (res.ok) onSecret(res.data);
                  else toast.error(res.error);
                }}
              >
                <Button variant="outline" size="sm" disabled={busy !== null}>
                  <KeyRound /> Rotate secret
                </Button>
              </ConfirmButton>
            </div>
          </div>
        )}

        {!canManage && <p className="text-xs text-muted-foreground">Ask a workspace admin (Integrations permission) to change this connection.</p>}
      </div>
      {canManage && (
        <div className="flex flex-col-reverse gap-2 border-t bg-muted/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <ConfirmButton
            title={`Disconnect ${item.name}?`}
            description="Stored credentials are deleted. Links to already created issues or posts are kept."
            confirmLabel="Disconnect"
            destructive
            onConfirm={async () => {
              const res = await disconnectIntegrationAction(projectId, meta.key);
              if (res.ok) {
                toast.success(`${item.name} disconnected`);
                onRemoved();
              } else toast.error(res.error);
            }}
          >
            <Button variant="ghost" className="text-destructive hover:text-destructive">
              <Unplug /> Disconnect
            </Button>
          </ConfirmButton>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {meta.fields.length > 0 && (
              <Button variant="outline" onClick={onEdit} disabled={busy !== null}>
                Update credentials
              </Button>
            )}
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                run("test", async () => {
                  const res = await testIntegrationAction(projectId, meta.key);
                  if (!res.ok) toast.error(res.error);
                  else {
                    onUpdated(res.data.integration);
                    if (res.data.ok) toast.success("Connection works");
                    else toast.error(res.data.error);
                  }
                })
              }
            >
              {busy === "test" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Test connection
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
