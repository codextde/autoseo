"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  CalendarClock,
  Check,
  CheckCircle2,
  Circle,
  CreditCard,
  Globe,
  Loader2,
  Radio,
  ShoppingBag,
  Sparkles,
  Target,
  UserPlus,
  Webhook,
} from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TimeAgo } from "@/components/app/misc";
import { useUrlState } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import { FORMS_MODE_LABELS, PLATFORMS, recommendInstallPath } from "@/server/attribution/recommend";
import { getProvider } from "@/server/attribution/providers";
import { FORMS_MODES, PLATFORM_IDS, type ConversionSource, type FormsMode, type PlatformId, type SurveyConfig, type TrackMode } from "@/server/attribution/types";
import { getLiveStatusAction, saveSetupAction } from "../actions";
import { CodeBlock } from "./code-block";
import { ProviderSetup, type IntegrationsContext } from "./integrations";
import { WebhookEndpointCard } from "./mapping";
import { SurveyEditor } from "./survey-editor";

const STEPS = [
  { n: 1, title: "What to track" },
  { n: 2, title: "Platform" },
  { n: 3, title: "Your forms" },
  { n: 4, title: "Survey" },
  { n: 5, title: "Install snippet" },
  { n: 6, title: "Conversions" },
  { n: 7, title: "Verify live" },
];

const CONVERSION_OPTIONS: Array<{ key: ConversionSource; title: string; description: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: "snippet", title: "Website snippet", description: "Passively captures GA / Google Ads and Meta Pixel purchase & lead events, or call trackConversion().", icon: Globe },
  { key: "stripe", title: "Stripe", description: "Signed webhook — purchases, $0 trials and renewals.", icon: CreditCard },
  { key: "shopify", title: "Shopify", description: "Custom Pixel reports every checkout.", icon: ShoppingBag },
  { key: "woocommerce", title: "WooCommerce", description: "Native order webhook with shared secret.", icon: ShoppingBag },
  { key: "shopware", title: "Shopware", description: "Flow Builder “Call webhook” on order placed.", icon: Boxes },
  { key: "webhook", title: "CRM / webhook", description: "HubSpot, Salesforce, Pipedrive, Zapier … send deals with value.", icon: Webhook },
  { key: "none", title: "No conversions", description: "Only collect answers (you can add a source later).", icon: Circle },
];

function OptionCard({
  selected,
  onClick,
  title,
  description,
  icon: Icon,
  badge,
  disabled,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  badge?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative flex min-w-0 items-start gap-3 rounded-xl border bg-card p-3.5 text-left transition-all hover:border-foreground/40 disabled:cursor-not-allowed disabled:opacity-60",
        selected && "border-foreground ring-1 ring-foreground",
      )}
    >
      {Icon && (
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background", selected && "border-foreground bg-foreground text-background")}>
          <Icon className="size-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {title}
          {badge}
        </span>
        {description && <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>}
      </span>
      {selected && <Check className="absolute top-3 right-3 size-4" />}
    </button>
  );
}

type LiveStatus = {
  snippetFirstSeenAt: string | null;
  snippetLastSeenAt: string | null;
  snippetLastOrigin: string | null;
  responses: number;
  lastResponseAt: string | null;
  conversions: number;
  lastConversionAt: string | null;
};

function VerifyStep({ projectId, ns, initial }: { projectId: string; ns: string; initial: LiveStatus }) {
  const [status, setStatus] = useState<LiveStatus>(initial);
  const [polling, setPolling] = useState(true);
  const [startedAt] = useState(() => new Date().toISOString());
  useEffect(() => {
    if (!polling) return;
    let stop = false;
    const tick = async () => {
      const r = await getLiveStatusAction(projectId);
      if (!stop && r.ok) setStatus(r.data);
    };
    const t = setInterval(tick, 3000);
    const timeout = setTimeout(() => setPolling(false), 10 * 60_000);
    return () => {
      stop = true;
      clearInterval(t);
      clearTimeout(timeout);
    };
  }, [projectId, polling]);
  const snippetLive = !!status.snippetLastSeenAt;
  const newSinceOpen = status.lastResponseAt && status.lastResponseAt > startedAt;
  const items = [
    {
      done: snippetLive,
      title: "Snippet detected on your website",
      detail: snippetLive ? (
        <>
          Last seen <TimeAgo date={status.snippetLastSeenAt} />
          {status.snippetLastOrigin ? ` on ${status.snippetLastOrigin}` : ""}
        </>
      ) : (
        "Open your website in a new tab (fresh session) — the snippet reports itself once per session."
      ),
    },
    {
      done: status.responses > 0,
      title: "First response received",
      detail:
        status.responses > 0 ? (
          <>
            {status.responses} response{status.responses === 1 ? "" : "s"} · latest <TimeAgo date={status.lastResponseAt} />
            {newSinceOpen ? " (new!)" : ""}
          </>
        ) : (
          <>
            Test the popup: run <code className="rounded bg-muted px-1 font-mono">{`window.${ns}.show({ force: true })`}</code> in your browser console, or submit a form.
          </>
        ),
    },
    {
      done: status.conversions > 0,
      title: "First conversion received",
      detail:
        status.conversions > 0 ? (
          <>
            {status.conversions} conversion{status.conversions === 1 ? "" : "s"} · latest <TimeAgo date={status.lastConversionAt} />
          </>
        ) : (
          "Place a test order / send a test webhook, or call trackConversion() — optional for lead-only setups."
        ),
    },
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {polling ? (
          <>
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
              <span className="relative inline-flex size-2.5 rounded-full bg-brand" />
            </span>
            Listening for events…
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setPolling(true)} className="gap-1.5">
            <Radio className="size-3.5" /> Listen again
          </Button>
        )}
      </div>
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.title} className={cn("flex items-start gap-3 rounded-xl border p-3", it.done && "border-success/40 bg-success/5")}>
            <AnimatePresence mode="wait" initial={false}>
              {it.done ? (
                <motion.span key="done" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                  <CheckCircle2 className="size-5 text-success" />
                </motion.span>
              ) : (
                <motion.span key="wait" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <Loader2 className={cn("size-5 text-muted-foreground", polling && "animate-spin")} />
                </motion.span>
              )}
            </AnimatePresence>
            <div className="min-w-0">
              <div className="text-sm font-medium">{it.title}</div>
              <div className="text-xs break-words text-muted-foreground">{it.detail}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type SetupWizardProps = {
  projectId: string;
  canManage: boolean;
  trackMode: TrackMode;
  platform: PlatformId | null;
  formsMode: FormsMode | null;
  conversionSource: ConversionSource | null;
  wizardStep: number;
  setupComplete: boolean;
  survey: SurveyConfig;
  installTag: string;
  ns: string;
  bookingUrl: string;
  integrations: IntegrationsContext;
  webhook: { endpoint: string; tokenPrefix: string | null; tokenCreatedAt: string | null };
  live: LiveStatus;
};

export function SetupWizard(props: SetupWizardProps) {
  const { projectId, canManage } = props;
  const [stepRaw, setStepRaw] = useUrlState("step", String(Math.min(7, Math.max(1, props.wizardStep))));
  const step = Math.min(7, Math.max(1, Number(stepRaw) || 1));
  const [trackMode, setTrackMode] = useState<TrackMode>(props.trackMode);
  const [platform, setPlatform] = useState<PlatformId | null>(props.platform);
  const [formsMode, setFormsMode] = useState<FormsMode | null>(props.formsMode);
  const [conversionSource, setConversionSource] = useState<ConversionSource | null>(props.conversionSource);
  const [saving, start] = useTransition();
  const rec = recommendInstallPath({ trackMode, platform, formsMode });

  const persist = (patch: Parameters<typeof saveSetupAction>[1], next?: number) =>
    start(async () => {
      if (canManage) {
        const r = await saveSetupAction(projectId, { ...patch, ...(next ? { wizardStep: next } : {}) });
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
      }
      if (next) setStepRaw(String(next));
    });

  const go = (n: number) => {
    const patch: Parameters<typeof saveSetupAction>[1] = {};
    if (step === 1) patch.trackMode = trackMode;
    if (step === 2) patch.platform = platform;
    if (step === 3) patch.formsMode = formsMode;
    if (step === 6) patch.conversionSource = conversionSource ?? rec.conversionSource;
    persist(patch, n);
  };

  const canContinue = step === 2 ? !!platform : step === 3 ? !!formsMode : true;
  const convSource = conversionSource ?? rec.conversionSource;
  const convProvider = convSource && ["stripe", "shopify", "woocommerce", "shopware"].includes(convSource) ? getProvider(convSource) : null;

  const bookCall = props.bookingUrl ? (
    <a href={props.bookingUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <CalendarClock className="size-4" /> Rather have us set it up? <span className="font-medium text-foreground underline underline-offset-2">Book setup call</span>
    </a>
  ) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      {/* Stepper */}
      <aside className="min-w-0">
        <div className="mb-3 lg:hidden">
          <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Step {step} of 7 · {STEPS[step - 1]!.title}
            </span>
            {props.setupComplete && <Badge variant="outline" className="h-5 text-[10px] text-success">Completed</Badge>}
          </div>
          <div className="flex gap-1">
            {STEPS.map((s) => (
              <button key={s.n} type="button" aria-label={s.title} onClick={() => setStepRaw(String(s.n))} className={cn("h-1.5 flex-1 rounded-full", s.n <= step ? "bg-foreground" : "bg-muted")} />
            ))}
          </div>
        </div>
        <ol className="hidden space-y-1 lg:block">
          {STEPS.map((s) => (
            <li key={s.n}>
              <button
                type="button"
                onClick={() => setStepRaw(String(s.n))}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                  s.n === step ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular",
                    s.n < step && "border-foreground bg-foreground text-background",
                    s.n === step && "border-foreground",
                  )}
                >
                  {s.n < step ? <Check className="size-3.5" /> : s.n}
                </span>
                {s.title}
              </button>
            </li>
          ))}
        </ol>
        {props.setupComplete && (
          <p className="mt-3 hidden items-center gap-1.5 text-xs text-success lg:flex">
            <CheckCircle2 className="size-3.5" /> Setup completed
          </p>
        )}
      </aside>

      <div className="min-w-0 space-y-4">
        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.18 }}>
            {step === 1 && (
              <Panel title="What do you want to track?" description="We tailor the setup to your business model.">
                <div className="grid gap-3 sm:grid-cols-3">
                  <OptionCard selected={trackMode === "purchases"} onClick={() => setTrackMode("purchases")} icon={ShoppingBag} title="Purchases" description="E-commerce orders with revenue" disabled={!canManage} />
                  <OptionCard selected={trackMode === "leads"} onClick={() => setTrackMode("leads")} icon={UserPlus} title="Leads" description="Form submissions, signups, demos" disabled={!canManage} />
                  <OptionCard selected={trackMode === "both"} onClick={() => setTrackMode("both")} icon={Target} title="Both" description="Leads and purchases" disabled={!canManage} />
                </div>
                {bookCall && <div className="mt-5 border-t pt-4">{bookCall}</div>}
              </Panel>
            )}

            {step === 2 && (
              <Panel title="Which platform runs your website?" description="We show the right install instructions and integrations.">
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {PLATFORM_IDS.map((id) => (
                    <OptionCard key={id} selected={platform === id} onClick={() => setPlatform(id)} title={PLATFORMS[id].label} disabled={!canManage} />
                  ))}
                </div>
              </Panel>
            )}

            {step === 3 && (
              <Panel title="How do your forms work?" description="Existing questions are captured without a popup.">
                <div className="grid gap-2">
                  {FORMS_MODES.map((id) => (
                    <OptionCard key={id} selected={formsMode === id} onClick={() => setFormsMode(id)} title={FORMS_MODE_LABELS[id].label} description={FORMS_MODE_LABELS[id].description} disabled={!canManage} />
                  ))}
                </div>
              </Panel>
            )}

            {step === 4 && (
              <div className="space-y-3">
                <div>
                  <h2 className="text-[15px] font-semibold tracking-tight">Survey question & channels</h2>
                  <p className="text-sm text-muted-foreground">Customize the question (EN/DE), answer channels, colors and position. Changes apply to the live snippet.</p>
                </div>
                <SurveyEditor projectId={projectId} initial={props.survey} canManage={canManage} compact />
              </div>
            )}

            {step === 5 && (
              <div className="space-y-4">
                <Panel
                  title="Recommended install path"
                  description="Based on your answers."
                  actions={<Badge className="bg-brand text-brand-foreground">Recommended</Badge>}
                >
                  <div className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
                      <Sparkles className="size-4" />
                    </span>
                    <div>
                      <div className="font-medium">{rec.title}</div>
                      <p className="text-sm text-muted-foreground">{rec.description}</p>
                      {rec.providers.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {rec.providers.map((k) => (
                            <Link key={k} href={`/p/${projectId}/attribution?tab=integrations&setup=${k}`} className="rounded-full border px-2 py-0.5 text-xs hover:bg-muted">
                              {getProvider(k)?.name ?? k}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </Panel>
                {rec.useSnippet || formsMode !== "form_tool" ? (
                  <Panel title="Install the snippet" description="Paste this into the <head> of every page. It loads async, uses no cookies and asks each visitor at most once.">
                    <div className="space-y-3">
                      <CodeBlock code={props.installTag} label="HTML — contains your project key" maxHeight={180} />
                      <p className="rounded-xl bg-muted/50 p-3 text-sm">
                        <span className="font-medium">{platform ? PLATFORMS[platform].label : "Where"}:</span> {PLATFORMS[platform ?? "custom"].snippetHint}
                      </p>
                      <CodeBlock
                        label="Optional JavaScript API"
                        maxHeight={200}
                        code={`// Report a conversion yourself (deduplicated by transactionId)
window.${props.ns}.trackConversion({ transactionId: "SO-1001", value: 499, currency: "EUR", email: "customer@example.com" });

// Link later answers to a known email (hashed in the browser)
window.${props.ns}.identify("customer@example.com");

// Show the survey manually (respects ask-once unless force: true)
window.${props.ns}.show({ force: true });`}
                      />
                    </div>
                  </Panel>
                ) : (
                  <Panel title="No snippet needed" description="Your form tool sends answers via webhook — set it up in the next step or under Integrations." />
                )}
              </div>
            )}

            {step === 6 && (
              <div className="space-y-4">
                <Panel title="Where do conversions come from?" description="Purchases and leads with transaction id + value. They merge with answers by order id, then hashed email.">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {CONVERSION_OPTIONS.map((o) => (
                      <OptionCard
                        key={o.key}
                        selected={convSource === o.key}
                        onClick={() => setConversionSource(o.key)}
                        title={o.title}
                        description={o.description}
                        icon={o.icon}
                        disabled={!canManage}
                        badge={rec.conversionSource === o.key ? <Badge className="h-5 bg-brand text-[10px] text-brand-foreground">Recommended</Badge> : undefined}
                      />
                    ))}
                  </div>
                </Panel>
                {convProvider && (
                  <Panel title={`Connect ${convProvider.name}`}>
                    <ProviderSetup provider={convProvider} ctx={props.integrations} />
                  </Panel>
                )}
                {convSource === "webhook" && (
                  <WebhookEndpointCard projectId={projectId} canManage={canManage} endpoint={props.webhook.endpoint} tokenPrefix={props.webhook.tokenPrefix} tokenCreatedAt={props.webhook.tokenCreatedAt} />
                )}
                {convSource === "snippet" && (
                  <Panel title="Passive capture is on" description="No extra setup when GA4 / Google Ads or Meta Pixel already track purchases and leads on your site.">
                    <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                      <li>
                        GA / Google Ads: <code className="font-mono text-xs">purchase</code>, <code className="font-mono text-xs">generate_lead</code> (gtag or dataLayer) — transaction id, value, currency, items
                      </li>
                      <li>
                        Meta Pixel: <code className="font-mono text-xs">Purchase</code>, <code className="font-mono text-xs">Lead</code>
                      </li>
                      <li>Everything else: call trackConversion() on your thank-you page.</li>
                    </ul>
                  </Panel>
                )}
              </div>
            )}

            {step === 7 && (
              <Panel title="Verify it's live" description="We listen for the first events from your website and integrations.">
                <VerifyStep projectId={projectId} ns={props.ns} initial={props.live} />
                {bookCall && <div className="mt-5 border-t pt-4">{bookCall}</div>}
              </Panel>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" className="gap-1.5" disabled={step === 1 || saving} onClick={() => setStepRaw(String(step - 1))}>
            <ArrowLeft className="size-3.5" /> Back
          </Button>
          {step < 7 ? (
            <Button size="sm" className="gap-1.5" disabled={!canContinue || saving} onClick={() => go(step + 1)}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Continue <ArrowRight className="size-3.5" />
            </Button>
          ) : (
            canManage && (
              <Button
                size="sm"
                className="gap-1.5"
                disabled={saving}
                onClick={() =>
                  start(async () => {
                    const r = await saveSetupAction(projectId, { complete: true, wizardStep: 7 });
                    if (!r.ok) toast.error(r.error);
                    else toast.success("Attribution is set up");
                  })
                }
              >
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                {props.setupComplete ? "Done" : "Finish setup"}
              </Button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
