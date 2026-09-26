"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { ArrowUpRight, Check, Clock, LayoutGrid, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/app/empty-state";
import { useUrlPatch, useUrlState } from "@/hooks/use-url-state";
import {
  INTEGRATIONS,
  INTEGRATION_CATEGORIES,
  isInlineTokenProvider,
  PROVIDERS,
  resolveIntegrationHref,
  type CatalogEntry,
  type IntegrationCategory,
} from "@/lib/integrations-catalog";
import { cn } from "@/lib/utils";
import type { GoogleConnectionState } from "@/server/integrations/service";
import type { PublicIntegration } from "@/server/integrations/store";
import { GoogleConnectionCard } from "./google-connection";
import { GoogleAccountsPanel } from "./google-accounts-panel";
import type { PublicGoogleAccount } from "@/server/integrations/google/accounts";
import { IntegrationLogo } from "./integration-logo";
import { TokenConnectDialog, TokenIntegrationCard } from "./token-connect";

type ConnState = "connected" | "attention" | "pending" | "none";

const CATEGORY_LABEL = Object.fromEntries(INTEGRATION_CATEGORIES.map((c) => [c.key, c.label])) as Record<IntegrationCategory, string>;

function stateOf(entry: CatalogEntry, row: PublicIntegration | undefined, google: Record<string, GoogleConnectionState>): ConnState {
  if (entry.key === PROVIDERS.gsc || entry.key === PROVIDERS.ga4) {
    const g = google[entry.key];
    if (!g || g.status === "not_connected") return "none";
    return g.status === "connected" ? "connected" : g.status === "pending" ? "pending" : "attention";
  }
  if (!row || row.status === "disconnected") return "none";
  if ([PROVIDERS.cloudflare, PROVIDERS.akamai, PROVIDERS.serverLogs].includes(entry.key as never) && !row.tokenPrefix) return "none";
  if (row.status === "error") return "attention";
  if (row.status === "pending") return "pending";
  return "connected";
}

export function IntegrationsView({
  projectId,
  rows,
  google,
  googleAccounts,
  currentUserId,
  canManage,
}: {
  projectId: string;
  rows: PublicIntegration[];
  google: { google_search_console: GoogleConnectionState; google_analytics: GoogleConnectionState };
  googleAccounts: PublicGoogleAccount[];
  currentUserId: string;
  canManage: boolean;
}) {
  const [category, setCategory] = useUrlState("category", "all");
  const [q, setQ] = useUrlState("q", "");
  const [connect] = useUrlState("connect", "");
  const [patch] = useUrlPatch();
  const [search, setSearch] = useState(q);
  const [tokenDialog, setTokenDialog] = useState<string | null>(null);

  const [syncedQ, setSyncedQ] = useState(q);
  if (q !== syncedQ) {
    // URL changed from outside (back/forward, category links): mirror it in the input.
    setSyncedQ(q);
    setSearch(q);
  }
  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== q) setQ(search || null);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const byKey = useMemo(() => new Map(rows.map((r) => [r.provider, r])), [rows]);
  const googleMap = google as unknown as Record<string, GoogleConnectionState>;
  const states = useMemo(
    () => new Map(INTEGRATIONS.map((e) => [e.key, stateOf(e, byKey.get(e.key), googleMap)])),
    [byKey, googleMap],
  );
  const installed = INTEGRATIONS.filter((e) => states.get(e.key) !== "none");

  const term = q.trim().toLowerCase();
  const visible = INTEGRATIONS.filter(
    (e) =>
      (category === "all" || e.category === category) &&
      (!term || `${e.name} ${e.description} ${CATEGORY_LABEL[e.category]}`.toLowerCase().includes(term)),
  );
  const counts = useMemo(() => {
    const m = new Map<string, number>([["all", INTEGRATIONS.length]]);
    for (const e of INTEGRATIONS) m.set(e.category, (m.get(e.category) ?? 0) + 1);
    return m;
  }, []);

  const managed = connect ? INTEGRATIONS.find((e) => e.key === connect) : undefined;
  const openManage = (key: string) => patch({ connect: key });
  const closeManage = () => patch({ connect: null, picker: null, google_connected: null });

  const grouped = category === "all" && !term;

  return (
    <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
      {/* Category navigation */}
      <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
        <nav className="scrollbar-none -mx-3 flex gap-1 overflow-x-auto px-3 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
          {[{ key: "all", label: "All" }, ...INTEGRATION_CATEGORIES].map((c) => {
            const active = category === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setCategory(c.key === "all" ? null : c.key)}
                className={cn(
                  "flex shrink-0 items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition-colors lg:py-2",
                  active ? "bg-foreground text-background lg:bg-muted lg:font-medium lg:text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <span className="flex items-center gap-2">
                  {c.key === "all" && <LayoutGrid className="hidden size-3.5 lg:block" />}
                  {c.label}
                </span>
                <span className={cn("text-xs tabular", active ? "opacity-80" : "text-muted-foreground")}>{counts.get(c.key) ?? 0}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="min-w-0 space-y-5">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search integrations…"
            className="h-10 rounded-xl bg-card pl-9 shadow-soft"
            aria-label="Search integrations"
          />
        </div>

        <GoogleAccountsPanel
          projectId={projectId}
          accounts={googleAccounts}
          canManage={canManage}
          currentUserId={currentUserId}
          oauthConfigured={google.google_search_console.oauthConfigured}
        />

        {/* Installed */}
        <section className="rounded-2xl border bg-card p-4 shadow-soft">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold tracking-tight">
              Installed <span className="font-normal text-muted-foreground">({installed.length} connected)</span>
            </h2>
          </div>
          {installed.length ? (
            <div className="flex flex-wrap gap-2">
              {installed.map((e) => {
                const s = states.get(e.key)!;
                const href = e.setupHref && !isGoogle(e.key) && !isInlineTokenProvider(e) ? resolveIntegrationHref(e.setupHref, projectId) : null;
                const chip = (
                  <>
                    <IntegrationLogo provider={e.key} size="sm" className="size-6 rounded-md" />
                    <span className="font-medium">{e.name}</span>
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        s === "connected" ? "bg-success" : s === "pending" ? "bg-warning" : "bg-destructive",
                      )}
                    />
                  </>
                );
                const cls = "inline-flex items-center gap-2 rounded-full border bg-background py-1 pr-3 pl-1 text-sm transition-colors hover:bg-muted";
                return href ? (
                  <Link key={e.key} href={href} className={cls}>
                    {chip}
                  </Link>
                ) : (
                  <button key={e.key} type="button" className={cls} onClick={() => openManage(e.key)}>
                    {chip}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing connected yet. Start with <b>Google Search Console</b> and <b>Google Analytics</b> — they power the Analytics pages.
            </p>
          )}
        </section>

        {/* Catalog */}
        {visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed">
            <EmptyState icon={Search} title="No integration found" description={`Nothing matches “${q}”. Try another name or category.`} compact />
          </div>
        ) : grouped ? (
          INTEGRATION_CATEGORIES.map((c) => {
            const items = visible.filter((e) => e.category === c.key);
            if (!items.length) return null;
            return (
              <section key={c.key} className="space-y-3">
                <div>
                  <h2 className="text-[15px] font-semibold tracking-tight">{c.label}</h2>
                  <p className="text-xs text-muted-foreground">{c.description}</p>
                </div>
                <CardGrid
                  items={items}
                  states={states}
                  projectId={projectId}
                  canManage={canManage}
                  onManage={openManage}
                  onToken={setTokenDialog}
                />
              </section>
            );
          })
        ) : (
          <CardGrid items={visible} states={states} projectId={projectId} canManage={canManage} onManage={openManage} onToken={setTokenDialog} />
        )}
      </div>

      {/* Manage dialog (Google OAuth / token providers) */}
      <Dialog open={!!managed && (isGoogle(managed.key) || isInlineTokenProvider(managed))} onOpenChange={(v) => !v && closeManage()}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          {managed && (
            <>
              <DialogHeader className="sr-only">
                <DialogTitle>{managed.name}</DialogTitle>
                <DialogDescription>{managed.description}</DialogDescription>
              </DialogHeader>
              {isGoogle(managed.key) ? (
                <GoogleConnectionCard
                  bare
                  projectId={projectId}
                  state={googleMap[managed.key]!}
                  canManage={canManage}
                  returnTo={`/p/${projectId}/integrations?connect=${managed.key}`}
                />
              ) : (
                <TokenIntegrationCard
                  className="border-0 p-0 shadow-none sm:p-0"
                  projectId={projectId}
                  provider={managed.key}
                  integration={byKey.get(managed.key) ?? null}
                  canManage={canManage}
                />
              )}
              {managed.manageHref && states.get(managed.key) === "connected" && (
                <Button asChild variant="link" className="h-auto justify-start p-0 text-xs">
                  <Link href={resolveIntegrationHref(managed.manageHref, projectId)!}>
                    Open {managed.category === "search_console" ? "Search Console" : "Human Traffic"} <ArrowUpRight className="size-3" />
                  </Link>
                </Button>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {tokenDialog && (
        <TokenConnectDialog projectId={projectId} provider={tokenDialog} open onOpenChange={(v) => !v && setTokenDialog(null)} />
      )}
    </div>
  );
}

function isGoogle(key: string) {
  return key === PROVIDERS.gsc || key === PROVIDERS.ga4;
}

function CardGrid({
  items,
  states,
  projectId,
  canManage,
  onManage,
  onToken,
}: {
  items: CatalogEntry[];
  states: Map<string, ConnState>;
  projectId: string;
  canManage: boolean;
  onManage: (key: string) => void;
  onToken: (key: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
      {items.map((e, i) => (
        <motion.div
          key={e.key}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: Math.min(i, 12) * 0.02 }}
        >
          <IntegrationCard entry={e} state={states.get(e.key) ?? "none"} projectId={projectId} canManage={canManage} onManage={onManage} onToken={onToken} />
        </motion.div>
      ))}
    </div>
  );
}

function IntegrationCard({
  entry,
  state,
  projectId,
  canManage,
  onManage,
  onToken,
}: {
  entry: CatalogEntry;
  state: ConnState;
  projectId: string;
  canManage: boolean;
  onManage: (key: string) => void;
  onToken: (key: string) => void;
}) {
  const soon = entry.status === "coming_soon";
  const external = entry.setupHref && !isGoogle(entry.key) && !isInlineTokenProvider(entry);
  const href = external ? resolveIntegrationHref(entry.setupHref, projectId)! : null;
  const connected = state !== "none";

  let action: React.ReactNode;
  if (soon) {
    action = (
      <Button size="sm" variant="outline" disabled className="gap-1.5">
        <Clock className="size-3.5" /> Coming soon
      </Button>
    );
  } else if (href) {
    const label = connected ? "Manage" : entry.connect === "link" ? "View setup" : entry.connect === "webhook" || entry.connect === "snippet" ? "View setup" : "Connect";
    action = (
      <Button asChild size="sm" variant={connected || entry.connect === "link" ? "outline" : "default"}>
        <Link href={href}>
          {label}
          {entry.connect === "link" && <ArrowUpRight className="size-3.5" />}
        </Link>
      </Button>
    );
  } else if (!canManage && !connected) {
    action = (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button size="sm" disabled>
              Connect
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Only workspace admins can connect integrations.</TooltipContent>
      </Tooltip>
    );
  } else if (connected) {
    action = (
      <Button size="sm" variant="outline" onClick={() => onManage(entry.key)}>
        Manage
      </Button>
    );
  } else if (isGoogle(entry.key)) {
    action = (
      <Button size="sm" onClick={() => onManage(entry.key)}>
        Connect
      </Button>
    );
  } else {
    action = (
      <Button size="sm" onClick={() => onToken(entry.key)}>
        Connect
      </Button>
    );
  }

  return (
    <article
      className={cn(
        "group flex h-full flex-col rounded-2xl border bg-card p-4 shadow-soft transition-shadow hover:shadow-md",
        soon && "opacity-75",
      )}
    >
      <div className="flex items-start gap-3">
        <IntegrationLogo provider={entry.key} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold">{entry.name}</h3>
            {entry.status === "beta" && <span className="rounded-full bg-info/12 px-1.5 py-px text-[10px] font-medium text-info">Beta</span>}
            {entry.status === "new" && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-brand/12 px-1.5 py-px text-[10px] font-medium text-brand">
                <Sparkles className="size-2.5" /> New
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">{CATEGORY_LABEL[entry.category]}</p>
        </div>
        {connected && (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
              state === "connected"
                ? "bg-success/12 text-success"
                : state === "pending"
                  ? "bg-warning/15 text-warning"
                  : "bg-destructive/10 text-destructive",
            )}
          >
            {state === "connected" && <Check className="size-3" />}
            {state === "connected" ? "Connected" : state === "pending" ? "Setup" : "Error"}
          </span>
        )}
      </div>
      <p className="mt-3 line-clamp-3 flex-1 text-sm text-muted-foreground">{entry.description}</p>
      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          {entry.connect === "oauth" ? "OAuth" : entry.connect === "token" ? "API key" : entry.connect === "webhook" ? "Webhook / push" : entry.connect === "snippet" ? "Snippet" : "API"}
        </span>
        {action}
      </div>
    </article>
  );
}
