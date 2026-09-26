import {
  BookOpen,
  Check,
  CircleAlert,
  CreditCard,
  ExternalLink,
  LifeBuoy,
  Play,
  RefreshCw,
  RotateCcw,
  Rocket,
  X,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionButton } from "@/components/account/action-button";
import { AccountCard } from "@/components/account/dashboard/account-card";
import { NewInstanceForm } from "@/components/account/dashboard/new-instance-form";
import { ProvisioningProgress } from "@/components/account/dashboard/provisioning-progress";
import { GitHubIcon } from "@/components/account/icons";
import { requireUser } from "@/server/auth/guards";
import { countActiveSessions } from "@/server/auth/session";
import { getUserInstance } from "@/server/instances";
import { toInstanceView, type InstanceView } from "@/server/instance-view";
import { getSetting, isStripeConnected } from "@/server/settings";
import { isSubscriptionLive, subscriptionAction } from "@/server/billing-rules";
import { processCheckoutRedirect } from "@/server/stripe";
import {
  cancelPendingAction,
  manageBillingAction,
  openInstanceAction,
  restartMyInstanceAction,
  resumeCheckoutAction,
  retryMyInstanceAction,
} from "@/server/actions/instance";

export const metadata = { title: "Dashboard" };

const GITHUB = "https://github.com/codextde/autoseo";
const DOCS = "https://github.com/codextde/autoseo#readme";
const SUPPORT = "info@codext.de";

const INCLUDED = [
  "Your own private instance with its own database",
  "Every feature — AI visibility, rankings, audits, content",
  "Unlimited users, workspaces and projects",
  "Automatic updates, SSL and email delivery set up",
  "Bring your own AI keys, or connect a local Claude Code / Codex agent",
  "DataForSEO optional for keyword & SERP data",
  "Export your data anytime · cancel anytime",
];

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(iso));
}

function subscriptionLabel(view: InstanceView): { label: string; tone: "ok" | "warn" | "bad" | "muted" } {
  switch (view.subscriptionStatus) {
    case "active":
      return view.cancelAtPeriodEnd ? { label: "Cancels at period end", tone: "warn" } : { label: "Active", tone: "ok" };
    case "trialing":
      return { label: "Trial", tone: "ok" };
    case "past_due":
      return { label: "Payment overdue", tone: "warn" };
    case "unpaid":
      return { label: "Unpaid", tone: "bad" };
    case "canceled":
      return { label: "Canceled", tone: "muted" };
    case null:
      return { label: "—", tone: "muted" };
    default:
      return { label: view.subscriptionStatus.replace(/_/g, " "), tone: "muted" };
  }
}

const toneClass = {
  ok: "bg-brand-soft text-brand dark:bg-brand/15",
  warn: "bg-warning/15 text-[oklch(0.5_0.12_70)] dark:text-warning",
  bad: "bg-destructive/10 text-destructive",
  muted: "bg-muted text-muted-foreground",
};

function StatusDot({ tone }: { tone: keyof typeof toneClass }) {
  const color = { ok: "bg-brand", warn: "bg-warning", bad: "bg-destructive", muted: "bg-muted-foreground" }[tone];
  return (
    <span className="relative flex size-2.5">
      {tone === "ok" && <span className={`absolute inline-flex size-full animate-ping rounded-full ${color} opacity-50`} />}
      <span className={`relative inline-flex size-2.5 rounded-full ${color}`} />
    </span>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border bg-background/60 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-sm font-medium">{children}</dd>
    </div>
  );
}

function HelpLinks() {
  const link = "inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground";
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2">
      <a href={DOCS} target="_blank" rel="noopener" className={link}>
        <BookOpen className="size-4" /> Documentation
      </a>
      <a href={GITHUB} target="_blank" rel="noopener" className={link}>
        <GitHubIcon className="size-4" /> GitHub
      </a>
      <a href={`mailto:${SUPPORT}`} className={link}>
        <LifeBuoy className="size-4" /> {SUPPORT}
      </a>
    </div>
  );
}

function IncludedCard() {
  return (
    <Card className="bg-[#141413] text-white ring-white/10 dark:bg-card dark:text-card-foreground">
      <CardHeader>
        <CardTitle className="text-base">Everything included</CardTitle>
        <CardDescription className="text-white/60 dark:text-muted-foreground">
          <span className="text-2xl font-semibold text-white dark:text-foreground">$50</span> / month
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2.5">
          {INCLUDED.map((item) => (
            <li key={item} className="flex items-start gap-2.5 text-sm text-white/80 dark:text-muted-foreground">
              <Check className="mt-0.5 size-4 shrink-0 text-[#22c55e]" />
              {item}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function RunningView({ view }: { view: InstanceView }) {
  const sub = subscriptionLabel(view);
  const healthy = view.healthy !== false;
  return (
    <div className="space-y-6">
      <Card className="overflow-hidden pt-0">
        <div className="relative border-b bg-gradient-to-br from-brand-soft/70 via-card to-card p-6 sm:p-8 dark:from-brand/10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium">
                <StatusDot tone={healthy ? "ok" : "warn"} />
                {healthy ? "Running" : "Not responding"}
              </div>
              <h2 className="mt-2 truncate text-2xl font-semibold tracking-tight sm:text-3xl">{view.workspaceName}</h2>
              <a
                href={view.url}
                target="_blank"
                rel="noopener"
                className="mt-1 inline-flex max-w-full items-center gap-1.5 truncate text-sm text-muted-foreground hover:text-foreground"
              >
                {view.host} <ExternalLink className="size-3.5 shrink-0" />
              </a>
            </div>
            <ActionButton action={openInstanceAction} size="lg" className="h-12 px-6 text-base" icon={<Rocket />}>
              Open AutoSEO
            </ActionButton>
          </div>
        </div>
        <CardContent className="pt-2">
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Detail label="Subscription">
              <span className={`rounded-full px-2 py-0.5 text-xs ${toneClass[sub.tone]}`}>{sub.label}</span>
            </Detail>
            <Detail label={view.cancelAtPeriodEnd ? "Access until" : "Renews on"}>{formatDate(view.currentPeriodEnd)}</Detail>
            <Detail label="Last health check">
              {view.lastHealthAt
                ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(view.lastHealthAt))
                : "—"}
            </Detail>
            <Detail label="Created">{formatDate(view.createdAt)}</Detail>
          </dl>
        </CardContent>
        <CardFooter className="flex flex-col items-stretch gap-3 border-t py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <ActionButton variant="outline" action={manageBillingAction} icon={<CreditCard />}>
              Manage billing
            </ActionButton>
            <ActionButton
              variant="outline"
              action={restartMyInstanceAction}
              icon={<RotateCcw />}
              confirm="Restart your instance? It will be unavailable for about a minute."
            >
              Restart instance
            </ActionButton>
          </div>
          <HelpLinks />
        </CardFooter>
      </Card>
      {view.subscriptionStatus === "past_due" && (
        <Alert>
          <CircleAlert />
          <AlertTitle>Your last payment failed</AlertTitle>
          <AlertDescription>Update your payment method under “Manage billing” to keep your instance running.</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Getting started</CardTitle>
          <CardDescription>Your instance is yours — sign in with one click and set it up in a few minutes.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-3 text-sm sm:grid-cols-3">
            {[
              ["Open AutoSEO", "You're signed in automatically as the owner of your workspace."],
              ["Connect AI", "Add your OpenAI / Anthropic / Gemini keys, or connect a local Claude Code or Codex agent."],
              ["Invite your team", "Add colleagues and clients — unlimited users and projects."],
            ].map(([title, body], i) => (
              <li key={title} className="rounded-xl border p-4">
                <span className="text-xs font-semibold text-brand">Step {i + 1}</span>
                <p className="mt-1 font-medium">{title}</p>
                <p className="mt-1 text-muted-foreground">{body}</p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function StoppedView({ view }: { view: InstanceView }) {
  const paymentIssue = ["unpaid", "past_due", "paused"].includes(view.subscriptionStatus ?? "");
  const ended = !isSubscriptionLive(view.subscriptionStatus);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <StatusDot tone="muted" /> Stopped
        </div>
        <CardTitle className="text-2xl">{view.host}</CardTitle>
        <CardDescription className="max-w-2xl text-sm">
          {paymentIssue
            ? "Your instance was paused because the subscription is unpaid. Update your payment method and it starts again automatically — your data is kept."
            : ended
              ? "Your subscription has ended, so the instance was stopped. Your data is kept — resubscribe and it starts again with everything in place."
              : "Your instance is currently stopped. Contact us if you didn't expect this."}
        </CardDescription>
      </CardHeader>
      <CardFooter className="flex flex-col items-stretch gap-3 border-t py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {paymentIssue ? (
            <ActionButton action={manageBillingAction} icon={<CreditCard />}>
              Update payment method
            </ActionButton>
          ) : ended ? (
            <ActionButton action={resumeCheckoutAction} icon={<Play />}>
              Resubscribe — $50/month
            </ActionButton>
          ) : null}
          <ActionButton variant="outline" action={manageBillingAction} icon={<CreditCard />}>
            Billing & invoices
          </ActionButton>
        </div>
        <HelpLinks />
      </CardFooter>
    </Card>
  );
}

function FailedView({ view }: { view: InstanceView }) {
  const canRetry = subscriptionAction(view.subscriptionStatus) === "run";
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 text-sm font-medium text-destructive">
          <StatusDot tone="bad" /> Setup failed
        </div>
        <CardTitle className="text-2xl">{view.host}</CardTitle>
        <CardDescription className="max-w-2xl text-sm">
          Something went wrong while setting up your instance. We&apos;ve been notified and are looking into it. You can try
          again, or write to {SUPPORT} and we&apos;ll sort it out.
        </CardDescription>
      </CardHeader>
      <CardFooter className="flex flex-col items-stretch gap-3 border-t py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {canRetry && (
            <ActionButton action={retryMyInstanceAction} icon={<RefreshCw />}>
              Try again
            </ActionButton>
          )}
          <ActionButton variant="outline" action={manageBillingAction} icon={<CreditCard />}>
            Manage billing
          </ActionButton>
        </div>
        <HelpLinks />
      </CardFooter>
    </Card>
  );
}

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const { user } = await requireUser("/dashboard");
  const sp = await searchParams;
  const checkout = typeof sp.checkout === "string" ? sp.checkout : null;
  const sessionId = typeof sp.session_id === "string" ? sp.session_id : null;
  // The webhook may be slower than the redirect: process the finished checkout here too (idempotent).
  if (checkout === "success" && sessionId) await processCheckoutRedirect(sessionId, user.id);

  const [instance, coolify, stripe, sessions] = await Promise.all([
    getUserInstance(user.id),
    getSetting("coolify"),
    getSetting("stripe"),
    countActiveSessions(user.id),
  ]);
  const view = instance ? toInstanceView(instance) : null;
  const canDelete = !instance || !isSubscriptionLive(instance.subscriptionStatus);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          {view?.status === "running" ? "Your AutoSEO instance" : view ? "Your instance" : "Get your own AutoSEO"}
        </h1>
        <p className="mt-1 text-muted-foreground">
          {view ? `${view.host}` : "A private, fully managed AutoSEO instance — ready in a few minutes."}
        </p>
      </div>

      {sp.error === "forbidden" && (
        <Alert variant="destructive">
          <X />
          <AlertDescription>That page is only available to administrators.</AlertDescription>
        </Alert>
      )}
      {sp.error === "billing" && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>We couldn&apos;t open the billing portal. Please try again or contact {SUPPORT}.</AlertDescription>
        </Alert>
      )}
      {checkout === "canceled" && view?.status === "pending_payment" && (
        <Alert>
          <CircleAlert />
          <AlertDescription>Checkout was canceled. Your address stays reserved for 24 hours — resume whenever you&apos;re ready.</AlertDescription>
        </Alert>
      )}

      {!view && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Create your instance</CardTitle>
              <CardDescription>Pick a name and address. You can invite your team once it&apos;s running.</CardDescription>
            </CardHeader>
            <CardContent>
              <NewInstanceForm baseDomain={coolify.baseDomain} billingReady={isStripeConnected(stripe)} />
            </CardContent>
          </Card>
          <IncludedCard />
        </div>
      )}

      {view?.status === "pending_payment" &&
        (checkout === "success" ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Confirming your payment…</CardTitle>
              <CardDescription>This usually takes a few seconds.</CardDescription>
            </CardHeader>
            <CardContent>
              <ProvisioningProgress initial={view} waitWhile={["pending_payment"]} />
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <Card>
              <CardHeader>
                <Badge variant="outline" className="mb-1">
                  Awaiting payment
                </Badge>
                <CardTitle className="text-xl">Finish your order</CardTitle>
                <CardDescription>
                  <span className="font-medium text-foreground">{view.host}</span> is reserved for you. Complete the checkout to
                  start your instance.
                </CardDescription>
              </CardHeader>
              <CardFooter className="flex flex-wrap gap-2 border-t py-4">
                <ActionButton action={resumeCheckoutAction} icon={<CreditCard />}>
                  Resume checkout
                </ActionButton>
                <ActionButton variant="ghost" action={cancelPendingAction} icon={<X />} confirm="Cancel this order and release the address?">
                  Cancel order
                </ActionButton>
              </CardFooter>
            </Card>
            <IncludedCard />
          </div>
        ))}

      {view?.status === "provisioning" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Setting up {view.host}</CardTitle>
            <CardDescription>Thanks for subscribing! Your private instance is being created.</CardDescription>
          </CardHeader>
          <CardContent>
            <ProvisioningProgress initial={view} />
          </CardContent>
        </Card>
      )}

      {view?.status === "running" && <RunningView view={view} />}
      {view?.status === "stopped" && <StoppedView view={view} />}
      {view?.status === "failed" && <FailedView view={view} />}

      <AccountCard email={user.email} sessions={sessions} canDelete={canDelete} />
    </div>
  );
}
