"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, FileUp, KeyRound, Loader2, Plug, RefreshCw, Search, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ConfirmButton, StatusBadge, TimeAgo } from "@/components/app/misc";
import { EmptyState } from "@/components/app/empty-state";
import { useUrlPatch, useUrlState } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import { CATEGORY_LABELS, PROVIDERS, type ProviderCategory, type ProviderInfo } from "@/server/attribution/providers";
import type { SourceDTO } from "@/server/attribution/sources";
import { connectSourceAction, disconnectSourceAction, importCsvAction, syncSourceAction } from "../actions";
import { CodeBlock, SecretReveal } from "./code-block";
import { SourceIcon } from "./shared";

export type IntegrationsContext = {
  projectId: string;
  canManage: boolean;
  appName: string;
  sources: SourceDTO[];
  shopifyPixel: string;
  installTag: string;
  webhookBase: string;
  recommended: string[];
};

const KIND_LABEL: Record<ProviderInfo["kind"], string> = {
  webhook: "Webhook",
  signed_webhook: "Signed webhook",
  pixel: "Custom Pixel",
  api_import: "API import + CSV",
};

function fillStep(step: string, vars: { webhookUrl: string; appName: string }) {
  return step.replaceAll("{{webhookUrl}}", vars.webhookUrl).replaceAll("{{appName}}", vars.appName);
}

/** Setup guide + connection form for one provider (used in the Integrations tab and the setup wizard). */
export function ProviderSetup({ provider, ctx }: { provider: ProviderInfo; ctx: IntegrationsContext }) {
  const source = ctx.sources.find((s) => s.provider === provider.key && s.status !== "disconnected") ?? null;
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [config, setConfig] = useState<Record<string, string>>(source?.config ?? {});
  const [reveal, setReveal] = useState<{ url: string | null; generated: Record<string, string> } | null>(null);
  const [busy, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvResult, setCsvResult] = useState<string | null>(null);

  const webhookUrl = reveal?.url ?? `${ctx.webhookBase}?token=${source?.tokenPrefix ? `${source.tokenPrefix}…` : "YOUR_TOKEN"}&source=${provider.key}`;
  const needsWebhook = provider.kind === "webhook" || provider.kind === "signed_webhook";

  const connect = (regenerateToken = false) =>
    start(async () => {
      const r = await connectSourceAction(ctx.projectId, { provider: provider.key, secrets, config, regenerateToken });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setSecrets({});
      if (r.data.url || Object.keys(r.data.generatedSecrets).length) setReveal({ url: r.data.url, generated: r.data.generatedSecrets });
      toast.success(source ? "Integration updated" : `${provider.name} connected`);
    });

  const disconnect = async () => {
    const r = await disconnectSourceAction(ctx.projectId, provider.key);
    if (!r.ok) toast.error(r.error);
    else {
      setReveal(null);
      toast.success(`${provider.name} disconnected`);
    }
  };

  const sync = () =>
    start(async () => {
      const r = await syncSourceAction(ctx.projectId, provider.key);
      if (!r.ok) toast.error(r.error);
      else toast.success("Sync queued — new responses appear in a minute");
    });

  const onCsv = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast.error("CSV files are limited to 5 MB");
      return;
    }
    const text = await file.text();
    start(async () => {
      const r = await importCsvAction(ctx.projectId, provider.key, text);
      if (!r.ok) toast.error(r.error);
      else {
        const d = r.data;
        const msg = `${d.imported} imported · ${d.updated} updated · ${d.merged} merged with orders · ${d.skipped} skipped${d.failed ? ` · ${d.failed} failed` : ""}`;
        setCsvResult(msg);
        toast.success("CSV imported");
      }
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <SourceIcon provider={provider.key} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{provider.name}</span>
            <Badge variant="outline" className="h-5 text-[10px] font-normal">
              {KIND_LABEL[provider.kind]}
            </Badge>
            {source && <StatusBadge status={source.status === "error" ? "error" : "active"} label={source.status === "error" ? "Error" : "Connected"} />}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{provider.description}</p>
        </div>
      </div>

      {source && (
        <div className="grid grid-cols-3 gap-2 rounded-xl border bg-muted/20 p-3 text-center text-xs">
          <div>
            <div className="text-muted-foreground">Events</div>
            <div className="mt-0.5 font-semibold tabular">{source.eventCount.toLocaleString("en-US")}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Last event</div>
            <div className="mt-0.5 font-medium">
              <TimeAgo date={source.lastEventAt} />
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">{provider.kind === "api_import" ? "Last sync" : "Connected"}</div>
            <div className="mt-0.5 font-medium">
              <TimeAgo date={provider.kind === "api_import" ? source.lastSyncAt : source.createdAt} />
            </div>
          </div>
          {source.lastError && <p className="col-span-3 rounded-lg bg-destructive/10 p-2 text-left text-destructive">{source.lastError}</p>}
        </div>
      )}

      <section className="space-y-2">
        <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Setup guide</h4>
        <ol className="space-y-2">
          {provider.steps.map((step, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background">{i + 1}</span>
              <span className="min-w-0 break-words whitespace-pre-wrap">{fillStep(step, { webhookUrl: needsWebhook ? webhookUrl : "", appName: ctx.appName })}</span>
            </li>
          ))}
        </ol>
        {provider.docsUrl && (
          <a href={provider.docsUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            {provider.name} documentation <ExternalLink className="size-3" />
          </a>
        )}
      </section>

      {provider.kind === "pixel" && (
        <section className="space-y-3">
          <CodeBlock code={ctx.shopifyPixel} label="Shopify Custom Pixel" />
          <CodeBlock code={ctx.installTag} label="Theme snippet (theme.liquid, before </head>)" maxHeight={140} />
          {ctx.canManage && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
              <p className="text-xs text-muted-foreground">
                {source ? "Checkouts reported by the pixel are counted on this integration." : "Installed the pixel? Mark it as installed to track its events here and on the Integrations page."}
              </p>
              {source ? (
                <ConfirmButton title={`Disconnect ${provider.name}?`} description="Pixel events are still stored as conversions; they are no longer counted on this integration." destructive confirmLabel="Disconnect" onConfirm={disconnect}>
                  <Button size="sm" variant="ghost" className="gap-1.5 text-destructive">
                    <Unplug className="size-3.5" /> Disconnect
                  </Button>
                </ConfirmButton>
              ) : (
                <Button size="sm" className="gap-1.5" disabled={busy} onClick={() => connect(false)}>
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />} Mark as installed
                </Button>
              )}
            </div>
          )}
        </section>
      )}

      {reveal && (
        <SecretReveal
          title="Copy these now — they are shown only once (we only store a hash / encrypted copy)."
          items={[
            ...(reveal.url ? [{ label: "Webhook URL", value: reveal.url }] : []),
            ...Object.entries(reveal.generated).map(([k, v]) => ({ label: provider.secretFields?.find((f) => f.key === k)?.label ?? k, value: v })),
          ]}
        />
      )}

      {ctx.canManage && provider.kind !== "pixel" && (
        <section className="space-y-3 rounded-xl border p-3">
          {(provider.secretFields ?? []).map((f) => (
            <div key={f.key} className="space-y-1">
              <Label className="flex items-center gap-1.5 text-xs">
                <KeyRound className="size-3" /> {f.label}
                {source?.secretKeys.includes(f.key) && <span className="font-normal text-success">· stored</span>}
              </Label>
              <Input
                type="password"
                autoComplete="off"
                placeholder={source?.secretKeys.includes(f.key) ? "•••••••• (leave empty to keep)" : (f.placeholder ?? (f.generate ? "Leave empty to generate" : ""))}
                value={secrets[f.key] ?? ""}
                onChange={(e) => setSecrets((p) => ({ ...p, [f.key]: e.target.value }))}
                className="h-8 text-xs"
              />
              {f.help && <p className="text-[11px] text-muted-foreground">{f.help}</p>}
            </div>
          ))}
          {(provider.configFields ?? []).map((f) => (
            <div key={f.key} className="space-y-1">
              <Label className="text-xs">{f.label}</Label>
              <Input value={config[f.key] ?? ""} placeholder={f.placeholder} onChange={(e) => setConfig((p) => ({ ...p, [f.key]: e.target.value }))} className="h-8 text-xs" />
              {f.help && <p className="text-[11px] text-muted-foreground">{f.help}</p>}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" className="gap-1.5" disabled={busy} onClick={() => connect(false)}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plug className="size-3.5" />}
              {source ? "Save" : "Connect"}
            </Button>
            {source && needsWebhook && (
              <ConfirmButton
                title="Regenerate webhook URL?"
                description="The current URL stops working immediately. Update it in the sending system afterwards."
                confirmLabel="Regenerate"
                onConfirm={() => connect(true)}
              >
                <Button size="sm" variant="outline" className="gap-1.5" disabled={busy}>
                  <RefreshCw className="size-3.5" /> Regenerate URL
                </Button>
              </ConfirmButton>
            )}
            {source && provider.kind === "api_import" && (
              <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={sync}>
                <RefreshCw className="size-3.5" /> Sync now
              </Button>
            )}
            {source && (
              <ConfirmButton title={`Disconnect ${provider.name}?`} description="Incoming data from this integration is rejected afterwards. Existing responses stay." destructive confirmLabel="Disconnect" onConfirm={disconnect}>
                <Button size="sm" variant="ghost" className="gap-1.5 text-destructive">
                  <Unplug className="size-3.5" /> Disconnect
                </Button>
              </ConfirmButton>
            )}
          </div>
        </section>
      )}

      {ctx.canManage && provider.supportsCsv && (
        <section className="space-y-2 rounded-xl border border-dashed p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">Import CSV</p>
              <p className="text-xs text-muted-foreground">Export responses from {provider.name} and upload the file (≤ 5 MB). Columns are detected automatically.</p>
            </div>
            <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => fileRef.current?.click()}>
              <FileUp className="size-3.5" /> Upload
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onCsv(f);
                e.target.value = "";
              }}
            />
          </div>
          {csvResult && <p className="text-xs text-success">{csvResult}</p>}
        </section>
      )}
    </div>
  );
}

export function IntegrationsTab({ ctx }: { ctx: IntegrationsContext }) {
  const [category] = useUrlState("cat", "all");
  const [open] = useUrlState("setup", "");
  const [patch] = useUrlPatch();
  // Keep `tab=integrations` explicit: deep links from the global Integrations page only carry `?setup=<key>`.
  const setOpen = (v: string | null) => patch({ setup: v, tab: "integrations" });
  const [q, setQ] = useState("");
  const connected = ctx.sources.filter((s) => s.status !== "disconnected");
  const categories = useMemo(() => {
    const counts = new Map<ProviderCategory, number>();
    for (const p of PROVIDERS) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    return [...counts.entries()];
  }, []);
  const list = PROVIDERS.filter(
    (p) => (category === "all" || p.category === category) && (!q || `${p.name} ${p.description}`.toLowerCase().includes(q.toLowerCase())),
  );
  const openProvider = PROVIDERS.find((p) => p.key === open) ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
      <nav className="scrollbar-none -mx-1 flex gap-1 overflow-x-auto px-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
        {[["all", PROVIDERS.length] as const, ...categories].map(([key, n]) => (
          <button
            key={key}
            type="button"
            onClick={() => patch({ cat: key === "all" ? null : key, tab: "integrations" })}
            className={cn(
              "flex shrink-0 items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-left text-sm whitespace-nowrap transition-colors",
              category === key ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {key === "all" ? "All" : CATEGORY_LABELS[key as ProviderCategory]}
            <span className="text-xs tabular opacity-70">{n}</span>
          </button>
        ))}
      </nav>
      <div className="min-w-0 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search integrations…" className="h-8 pl-8 text-xs" />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>Installed ({connected.length} connected)</span>
            {connected.map((s) => (
              <button key={s.id} type="button" onClick={() => setOpen(s.provider)} className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-foreground hover:bg-muted">
                <SourceIcon provider={s.provider} className="size-4 rounded text-[9px]" />
                {PROVIDERS.find((p) => p.key === s.provider)?.name ?? s.provider}
              </button>
            ))}
          </div>
        </div>
        {list.length === 0 ? (
          <EmptyState compact icon={Search} title="No integration found" description="Try another search or use the Custom Webhook." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((p) => {
              const s = connected.find((x) => x.provider === p.key);
              const rec = ctx.recommended.includes(p.key);
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setOpen(p.key)}
                  className={cn(
                    "group flex min-w-0 flex-col rounded-2xl border bg-card p-4 text-left shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-md",
                    rec && "ring-2 ring-brand/40",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <SourceIcon provider={p.key} size="md" />
                    <div className="flex flex-wrap justify-end gap-1">
                      {rec && <Badge className="h-5 bg-brand text-[10px] text-brand-foreground">Recommended</Badge>}
                      {s && (
                        <Badge variant="outline" className="h-5 gap-1 text-[10px] text-success">
                          <CheckCircle2 className="size-3" /> Connected
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 font-medium">{p.name}</div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{CATEGORY_LABELS[p.category]}</span>
                    <span className="font-medium group-hover:underline">{s ? "Manage" : p.kind === "pixel" ? "View setup" : "Connect"}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Missing a tool? Anything that can send JSON works with the{" "}
          <button type="button" className="underline" onClick={() => setOpen("custom_webhook")}>
            Custom Webhook
          </button>{" "}
          and{" "}
          <Link href={`/p/${ctx.projectId}/attribution?tab=mapping`} className="underline">
            Field Mapping
          </Link>
          .
        </p>
      </div>

      <Sheet open={!!openProvider} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{openProvider?.name}</SheetTitle>
            <SheetDescription>{openProvider ? CATEGORY_LABELS[openProvider.category] : ""}</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-8">{openProvider && <ProviderSetup key={openProvider.key} provider={openProvider} ctx={ctx} />}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
