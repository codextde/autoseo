"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Check, ExternalLink, Loader2, Plus, RefreshCw, Search, Settings2, Star, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConfirmButton, CopyButton, StatusBadge, TimeAgo } from "@/components/app/misc";
import { useShell } from "@/components/app/shell-context";
import { cn } from "@/lib/utils";
import type { GoogleConnectionState, GooglePropertyOption } from "@/server/integrations/service";
import type { PublicGoogleAccount } from "@/server/integrations/google/accounts";
import {
  disconnectIntegrationAction,
  listGooglePropertiesAction,
  selectGooglePropertyAction,
  syncIntegrationAction,
} from "../actions";
import { IntegrationLogo } from "./integration-logo";

const LABEL = { gsc: "Google Search Console", ga4: "Google Analytics" } as const;

const ERROR_COPY: Record<string, string> = {
  access_denied: "The Google connection was cancelled.",
  state_mismatch: "The connection didn't finish. Complete the Google sign-in within 10 minutes and make sure cookies are allowed, then try again.",
  not_configured: "Google OAuth is not configured on this instance yet.",
  forbidden: "You need the “Integrations, API keys, model settings” permission to connect Google.",
  invalid_grant: "Google rejected the authorization code. Please try again.",
  missing_scope: "The required permission was not granted on the Google consent screen.",
  oauth_error: "Google returned an error. Please try again.",
};

/** Shows `?google_error=` / `?google_connected=` feedback once after the OAuth redirect. */
function useOAuthFeedback(product: "gsc" | "ga4") {
  const params = useSearchParams();
  const router = useRouter();
  const error = params.get("google_error");
  const errorProduct = params.get("google_product");
  const connected = params.get("google_connected");
  const message = params.get("google_message");
  useEffect(() => {
    if (connected === product) toast.success(`Google account connected — now choose the ${LABEL[product]} property.`);
    if (error && (!errorProduct || errorProduct === product)) {
      toast.error(message || ERROR_COPY[error] || ERROR_COPY.oauth_error);
    }
    if ((connected === product || (error && (!errorProduct || errorProduct === product))) && typeof window !== "undefined") {
      const url = new URL(window.location.href);
      ["google_error", "google_product", "google_connected", "google_message", "google_account"].forEach((k) => url.searchParams.delete(k));
      router.replace(url.pathname + (url.search || ""), { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function GoogleSetupHelp({ redirectUri, product, compact }: { redirectUri: string; product: "gsc" | "ga4"; compact?: boolean }) {
  const shell = useShell();
  return (
    <Alert className={cn("border-warning/40 bg-warning/5", compact && "text-xs")}>
      <Settings2 />
      <AlertTitle>Google OAuth isn’t configured yet</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>An instance admin needs to add a Google OAuth client once. Then everyone can connect their Google account.</p>
        <ol className="list-decimal space-y-1 pl-4 text-xs">
          <li>
            In Google Cloud Console create an OAuth client (type <b>Web application</b>) and enable the{" "}
            {product === "gsc" ? <b>Google Search Console API</b> : <b>Google Analytics Data API</b>}
            {product === "ga4" && (
              <>
                {" "}
                and <b>Google Analytics Admin API</b>
              </>
            )}
            .
          </li>
          <li>
            Add this authorized redirect URI:
            <span className="mt-1 flex items-center gap-1">
              <code className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5 text-[11px]">{redirectUri}</code>
              <CopyButton value={redirectUri} size="icon" />
            </span>
          </li>
          <li>
            Paste client ID and secret in <b>Admin → Data Providers → Google</b>.
          </li>
        </ol>
        {shell.user.isInstanceAdmin && (
          <Button asChild size="sm" variant="outline" className="mt-1">
            <Link href="/admin/data">Open Admin → Data Providers</Link>
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** Round avatar of a linked Google account (Google profile photo, initial as fallback). */
export function GoogleAccountAvatar({
  account,
  className,
}: {
  account: { email: string | null; name?: string | null; picture: string | null };
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const letter = (account.name ?? account.email ?? "?").charAt(0).toUpperCase();
  if (!account.picture || failed) {
    return (
      <span className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground", className)}>
        {letter}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={account.picture}
      alt=""
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("size-7 shrink-0 rounded-full object-cover", className)}
    />
  );
}

export function googleStartHref(projectId: string, product: "gsc" | "ga4" | "sheets" | "account", returnTo: string, loginHint?: string | null) {
  const qs = new URLSearchParams({ projectId, product, returnTo });
  if (loginHint) qs.set("loginHint", loginHint);
  return `/api/oauth/google/start?${qs.toString()}`;
}

export function GooglePropertyPicker({
  projectId,
  product,
  open,
  onOpenChange,
  currentId,
  accounts,
  defaultAccountId,
  returnTo,
  onSaved,
}: {
  projectId: string;
  product: "gsc" | "ga4";
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentId: string | null;
  /** Workspace accounts that granted this product's scope. */
  accounts: PublicGoogleAccount[];
  defaultAccountId: string | null;
  returnTo: string;
  onSaved?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{product === "gsc" ? "Choose a Search Console property" : "Choose a Google Analytics property"}</DialogTitle>
          <DialogDescription>
            {product === "gsc"
              ? "Pick the Google account and the verified property that matches this project. Domain properties include all subdomains and protocols."
              : "Pick the Google account and the GA4 property that tracks this project's website."}
          </DialogDescription>
        </DialogHeader>
        {/* Mounted per opening so the lists are always fresh. */}
        {open && (
          <PropertyPickerBody
            projectId={projectId}
            product={product}
            currentId={currentId}
            accounts={accounts}
            defaultAccountId={defaultAccountId}
            returnTo={returnTo}
            onOpenChange={onOpenChange}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PropertyPickerBody({
  projectId,
  product,
  currentId,
  accounts,
  defaultAccountId,
  returnTo,
  onOpenChange,
  onSaved,
}: {
  projectId: string;
  product: "gsc" | "ga4";
  currentId: string | null;
  accounts: PublicGoogleAccount[];
  defaultAccountId: string | null;
  returnTo: string;
  onOpenChange: (v: boolean) => void;
  onSaved?: () => void;
}) {
  const initialAccount = accounts.find((a) => a.id === defaultAccountId)?.id ?? accounts[0]?.id ?? null;
  const [accountId, setAccountId] = useState<string | null>(initialAccount);
  const [selection, setSelection] = useState<{ accountId: string | null; propertyId: string | null }>({
    accountId: initialAccount,
    propertyId: initialAccount && initialAccount === defaultAccountId ? currentId : null,
  });
  const [saving, startSaving] = useTransition();
  const router = useRouter();
  const selected = selection.accountId === accountId ? selection.propertyId : null;
  const addAccountHref = googleStartHref(projectId, product, returnTo);

  const save = () => {
    if (!selected || !accountId) return;
    startSaving(async () => {
      const res = await selectGooglePropertyAction(projectId, product, accountId, selected);
      if (res.ok) {
        toast.success("Property saved — importing data in the background.");
        onOpenChange(false);
        onSaved?.();
        router.refresh();
      } else toast.error(res.error);
    });
  };

  if (!accounts.length) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">No Google account with {product === "gsc" ? "Search Console" : "Analytics"} access is linked to this workspace yet.</p>
        <Button asChild>
          <a href={addAccountHref}>
            <GoogleG /> Connect a Google account
          </a>
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Google account</p>
        <div className="flex flex-wrap gap-1.5">
          {accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setAccountId(a.id)}
              className={cn(
                "flex max-w-full items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-xs transition-colors",
                accountId === a.id ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
              )}
            >
              <GoogleAccountAvatar account={a} className="size-5 text-[9px]" />
              <span className="truncate">{a.email ?? a.name ?? "Google account"}</span>
              {a.status === "error" && <AlertTriangle className="size-3 text-warning" />}
            </button>
          ))}
          <a href={addAccountHref} className="flex items-center gap-1 rounded-full border border-dashed px-3 py-1 text-xs text-muted-foreground hover:bg-muted">
            <Plus className="size-3" /> Add account
          </a>
        </div>
      </div>
      {accountId && (
        <PropertyList
          key={accountId}
          projectId={projectId}
          product={product}
          accountId={accountId}
          selected={selected}
          onSelect={(propertyId) => setSelection({ accountId, propertyId })}
        />
      )}
      <DialogFooter className="gap-2">
        <Button onClick={save} disabled={!selected || saving}>
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          Save property
        </Button>
      </DialogFooter>
    </>
  );
}

function PropertyList({
  projectId,
  product,
  accountId,
  selected,
  onSelect,
}: {
  projectId: string;
  product: "gsc" | "ga4";
  accountId: string;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const [options, setOptions] = useState<GooglePropertyOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listGooglePropertiesAction(projectId, product, accountId).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setOptions(res.data);
        setError(null);
        if (!selected) {
          const match = res.data.find((o) => o.recommended && o.selectable);
          if (match) onSelect(match.id);
        }
      } else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, product, accountId, attempt]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (options ?? []).filter((o) => !q || `${o.label} ${o.detail} ${o.id}`.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search properties…" className="h-9 pl-8" />
      </div>
      <ScrollArea className="h-64 rounded-lg border">
        {!options && !error && (
          <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading properties…
          </div>
        )}
        {error && (
          <div className="flex h-64 flex-col items-center justify-center gap-3 px-6 text-center text-sm">
            <AlertTriangle className="size-5 text-destructive" />
            <p className="text-muted-foreground">{error}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setError(null);
                setOptions(null);
                setAttempt((a) => a + 1);
              }}
            >
              Try again
            </Button>
          </div>
        )}
        {options && !filtered.length && (
          <div className="flex h-64 items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {options.length ? "No property matches your search." : "No properties available for this Google account."}
          </div>
        )}
        <ul className="divide-y">
          {filtered.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                disabled={!o.selectable}
                onClick={() => onSelect(o.id)}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  selected === o.id ? "bg-brand-soft/60" : "hover:bg-muted/60",
                )}
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-full border",
                    selected === o.id ? "border-foreground bg-foreground text-background" : "border-input",
                  )}
                >
                  {selected === o.id && <Check className="size-3" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 font-medium">
                    <span className="truncate">{o.label}</span>
                    {o.recommended && (
                      <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-brand/12 px-1.5 text-[10px] font-medium text-brand">
                        <Star className="size-2.5" /> Match
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{o.detail}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </>
  );
}

/**
 * Connection card for Google Search Console / Google Analytics — used on the Integrations page
 * and in the Settings tabs of the analytics pages.
 */
export function GoogleConnectionCard({
  projectId,
  state,
  canManage,
  returnTo,
  className,
  bare,
}: {
  projectId: string;
  state: GoogleConnectionState;
  canManage: boolean;
  /** Path to come back to after the OAuth redirect. */
  returnTo: string;
  className?: string;
  bare?: boolean;
}) {
  useOAuthFeedback(state.product);
  const params = useSearchParams();
  const router = useRouter();
  // Re-open the picker right after the OAuth redirect (?picker=gsc|ga4).
  const [pickerOpen, setPickerOpen] = useState(
    () => canManage && state.status === "pending" && (params.get("picker") === state.product || params.get("google_connected") === state.product),
  );
  const [busy, startBusy] = useTransition();

  const startHref = googleStartHref(projectId, state.product, returnTo);
  const reconnectHref = googleStartHref(projectId, state.product, returnTo, state.account?.email ?? state.email);

  const refresh = () =>
    startBusy(async () => {
      const res = await syncIntegrationAction(projectId, state.provider);
      if (res.ok) toast.success(res.data.alreadyQueued ? "A sync is already running." : "Sync started — new data appears in a minute.");
      else toast.error(res.error);
    });

  const disconnect = async () => {
    const res = await disconnectIntegrationAction(projectId, state.provider);
    if (res.ok) {
      toast.success(`${LABEL[state.product]} disconnected.`);
      router.refresh();
    } else toast.error(res.error);
  };

  const badge =
    state.status === "connected" ? (
      <StatusBadge status="active" label="Connected" />
    ) : state.status === "pending" ? (
      <StatusBadge status="pending" label="Choose property" />
    ) : state.status === "error" ? (
      <StatusBadge status="error" label="Needs attention" />
    ) : !state.oauthConfigured ? (
      <StatusBadge status="disabled" label="Setup required" />
    ) : (
      <StatusBadge status="disabled" label="Not connected" dot={false} />
    );

  const body = (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <IntegrationLogo provider={state.provider} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold tracking-tight">{LABEL[state.product]}</h3>
            {badge}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {state.product === "gsc"
              ? "Queries, pages and countries from Google Search. Synced daily, 16 months of history."
              : "Sessions, conversions and revenue from AI platforms. Synced daily."}
          </p>
        </div>
      </div>

      {!state.oauthConfigured && state.status === "not_connected" && <GoogleSetupHelp redirectUri={state.redirectUri} product={state.product} />}

      {state.status !== "not_connected" && (
        <dl className="grid gap-x-6 gap-y-3 rounded-xl bg-muted/50 p-3 text-sm sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{state.product === "gsc" ? "Property" : "Property"}</dt>
            <dd className="truncate font-medium">
              {state.propertyName ?? <span className="text-muted-foreground">Not selected yet</span>}
              {state.product === "ga4" && state.propertyId && (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">ID {state.propertyId.replace(/^properties\//, "")}</span>
              )}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Google account</dt>
            <dd className="flex min-w-0 items-center gap-1.5 font-medium">
              {state.account && <GoogleAccountAvatar account={state.account} className="size-5 text-[9px]" />}
              <span className="truncate">{state.account?.email ?? state.email ?? "—"}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Last synced</dt>
            <dd className="font-medium">{state.lastSyncAt ? <TimeAgo date={state.lastSyncAt} /> : state.status === "connected" ? "Importing…" : "—"}</dd>
          </div>
          {state.product === "ga4" && state.timeZone && (
            <div>
              <dt className="text-xs text-muted-foreground">Time zone · currency</dt>
              <dd className="font-medium">
                {state.timeZone} · {state.currency}
              </dd>
            </div>
          )}
        </dl>
      )}

      {state.lastError && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Last sync failed</AlertTitle>
          <AlertDescription>{state.lastError}</AlertDescription>
        </Alert>
      )}

      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          {state.status === "not_connected" &&
            state.oauthConfigured &&
            (state.accounts.length ? (
              <>
                <Button onClick={() => setPickerOpen(true)}>
                  <GoogleG /> Connect
                </Button>
                <Button asChild variant="outline">
                  <a href={startHref}>
                    <Plus className="size-3.5" /> Add Google account
                  </a>
                </Button>
              </>
            ) : (
              <Button asChild>
                <a href={startHref}>
                  <GoogleG /> Connect with Google
                </a>
              </Button>
            ))}
          {state.status === "pending" && (
            <Button onClick={() => setPickerOpen(true)}>
              <Settings2 className="size-3.5" /> Choose property
            </Button>
          )}
          {(state.status === "connected" || state.status === "error") && (
            <>
              <Button variant="outline" onClick={refresh} disabled={busy}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                Refresh data
              </Button>
              <Button variant="outline" onClick={() => setPickerOpen(true)}>
                Change property
              </Button>
            </>
          )}
          {state.status === "error" && (
            <Button asChild variant="outline">
              <a href={reconnectHref}>Reconnect</a>
            </Button>
          )}
          {state.status !== "not_connected" && (
            <ConfirmButton
              title={`Disconnect ${LABEL[state.product]}?`}
              description="The connection and all imported data for this project are removed. You can reconnect at any time."
              confirmLabel="Disconnect"
              destructive
              onConfirm={disconnect}
            >
              <Button variant="ghost" className="text-destructive hover:text-destructive">
                <Unplug className="size-3.5" /> Disconnect
              </Button>
            </ConfirmButton>
          )}
        </div>
      ) : (
        state.status === "not_connected" && (
          <p className="text-sm text-muted-foreground">Ask a workspace admin to connect {LABEL[state.product]}.</p>
        )
      )}

      {state.product === "gsc" && state.status === "connected" && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <ExternalLink className="mt-0.5 size-3 shrink-0" />
          Data freshness: Search Console data trails by 2–3 days. The most recent days are re-imported on every sync.
        </p>
      )}

      {canManage && (
        <GooglePropertyPicker
          projectId={projectId}
          product={state.product}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          currentId={state.propertyId}
          accounts={state.accounts}
          defaultAccountId={params.get("google_account") ?? state.account?.id ?? null}
          returnTo={returnTo}
        />
      )}
    </div>
  );

  if (bare) return <div className={className}>{body}</div>;
  return <section className={cn("rounded-2xl border bg-card p-4 shadow-soft sm:p-5", className)}>{body}</section>;
}

function GoogleG() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" aria-hidden>
      <path fill="#fff" d="M21.35 11.1H12v2.9h5.35c-.23 1.5-1.7 4.4-5.35 4.4-3.22 0-5.85-2.67-5.85-5.95S8.78 6.5 12 6.5c1.83 0 3.06.78 3.76 1.45l2.57-2.47C16.7 3.95 14.55 3 12 3 6.98 3 3 7.03 3 12s3.98 9 9 9c5.2 0 8.64-3.65 8.64-8.8 0-.6-.07-1.05-.29-1.1z" />
    </svg>
  );
}
