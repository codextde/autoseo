"use client";

import { useActionState } from "react";
import { Cable, Mail, PlugZap, Save, Send, Server, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  connectStripeAction,
  loadCoolifyServersAction,
  saveCoolifyAction,
  saveSmtpAction,
  saveStripeAction,
  selectCoolifyServerAction,
  sendTestEmailAction,
  testCoolifyAction,
  type AdminActionState,
  type CoolifyServersState,
} from "@/server/actions/admin";
import { ActionButton } from "@/components/account/action-button";
import { Field, FormResult, SecretField, StatusRow, SwitchField, useResultToast } from "./form-bits";

function SubmitButton({ pending, children, icon }: { pending: boolean; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Spinner /> : icon}
      {children}
    </Button>
  );
}

function Configured({ ok, label }: { ok: boolean; label?: string }) {
  return ok ? (
    <Badge className="bg-brand-soft text-brand dark:bg-brand/15">{label ?? "Configured"}</Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      Not configured
    </Badge>
  );
}

/* ─────────────────────────────── SMTP ─────────────────────────────── */

export type SmtpView = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  hasPassword: boolean;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  shareWithInstances: boolean;
};

export function SmtpForm({ smtp, adminEmail }: { smtp: SmtpView; adminEmail: string }) {
  const [state, action, pending] = useActionState<AdminActionState, FormData>(saveSmtpAction, {});
  const [testState, testAction, testing] = useActionState<AdminActionState, FormData>(sendTestEmailAction, {});
  useResultToast(state);
  useResultToast(testState);
  const configured = !!(smtp.host && smtp.fromEmail);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <Mail className="size-4" /> Email (SMTP)
            </CardTitle>
            <Configured ok={configured} />
          </div>
          <CardDescription>
            Sign-in links, “instance ready” and payment emails. Until this is set, emails (including sign-in links) are written to
            the server log.
          </CardDescription>
        </CardHeader>
        <form action={action}>
          <CardContent className="grid gap-4 sm:grid-cols-6">
            <Field label="SMTP host" htmlFor="host" className="sm:col-span-4">
              <Input id="host" name="host" defaultValue={smtp.host} placeholder="email-smtp.eu-central-1.amazonaws.com" />
            </Field>
            <Field label="Port" htmlFor="port" className="sm:col-span-2" hint="587 = STARTTLS, 465 = TLS">
              <Input id="port" name="port" type="number" min={1} max={65535} defaultValue={smtp.port} />
            </Field>
            <Field label="Username" htmlFor="user" className="sm:col-span-3">
              <Input id="user" name="user" defaultValue={smtp.user} autoComplete="off" />
            </Field>
            <div className="sm:col-span-3">
              <SecretField label="Password" name="password" saved={smtp.hasPassword} />
            </div>
            <Field label="From name" htmlFor="fromName" className="sm:col-span-2">
              <Input id="fromName" name="fromName" defaultValue={smtp.fromName} />
            </Field>
            <Field label="From email" htmlFor="fromEmail" className="sm:col-span-2">
              <Input id="fromEmail" name="fromEmail" type="email" defaultValue={smtp.fromEmail} placeholder="noreply@autoseo.codext.de" />
            </Field>
            <Field label="Reply-to" htmlFor="replyTo" className="sm:col-span-2">
              <Input id="replyTo" name="replyTo" type="email" defaultValue={smtp.replyTo} placeholder="info@codext.de" />
            </Field>
            <div className="grid gap-3 sm:col-span-6 sm:grid-cols-2">
              <SwitchField name="secure" label="Implicit TLS" description="Use TLS from the start (port 465)." defaultChecked={smtp.secure} />
              <SwitchField
                name="shareWithInstances"
                label="Customer instances use the same SMTP server"
                description="Passed to new and restarted instances as AUTOSEO_SMTP_URL / AUTOSEO_MAIL_FROM."
                defaultChecked={smtp.shareWithInstances}
              />
              {smtp.hasPassword && (
                <SwitchField name="clearPassword" label="Remove the saved password" description="Only when the password field is empty." defaultChecked={false} />
              )}
            </div>
          </CardContent>
          <CardFooter className="mt-4 flex flex-col items-stretch gap-3 border-t py-4 sm:flex-row sm:items-center sm:justify-between">
            <FormResult state={state} />
            <SubmitButton pending={pending} icon={<Save />}>
              Save & verify
            </SubmitButton>
          </CardFooter>
        </form>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Send a test email</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={testAction} className="flex flex-col gap-2 sm:flex-row">
            <Input name="to" type="email" defaultValue={adminEmail} className="sm:max-w-xs" aria-label="Recipient" />
            <SubmitButton pending={testing} icon={<Send />}>
              Send test email
            </SubmitButton>
          </form>
          <div className="mt-2">
            <FormResult state={testState} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────────────────────── Stripe ─────────────────────────────── */

export type StripeView = {
  hasKey: boolean;
  mode: "live" | "test" | null;
  accountName: string;
  productId: string;
  priceId: string;
  webhookEndpointId: string;
  hasWebhookSecret: boolean;
  portalConfigurationId: string;
  connectedAt: string | null;
  lastError: string;
  trialDays: number;
  automaticTax: boolean;
  allowPromotionCodes: boolean;
  webhookUrl: string;
};

export function StripeForm({ stripe }: { stripe: StripeView }) {
  const [state, action, pending] = useActionState<AdminActionState, FormData>(saveStripeAction, {});
  useResultToast(state);
  const connected = !!(stripe.priceId && stripe.hasWebhookSecret);
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <Zap className="size-4" /> Stripe
            </CardTitle>
            {connected ? (
              <Badge className={stripe.mode === "live" ? "bg-brand-soft text-brand dark:bg-brand/15" : "bg-warning/15 text-foreground"}>
                {stripe.mode === "live" ? "Live mode" : "Test mode"}
              </Badge>
            ) : (
              <Configured ok={false} />
            )}
          </div>
          <CardDescription>
            Saving runs the automatic setup: the “AutoSEO Cloud” product with a $50/month price, the webhook endpoint (its signing
            secret is stored encrypted) and a customer portal configuration. It is safe to run again.
          </CardDescription>
        </CardHeader>
        <form action={action}>
          <CardContent className="grid gap-4">
            <SecretField
              label="Secret key"
              name="secretKey"
              saved={stripe.hasKey}
              placeholder="sk_live_… or rk_live_…"
              hint="A restricted key needs write access to products, prices, customers, checkout, subscriptions, webhooks and the customer portal."
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Trial days" htmlFor="trialDays" hint="0 = no trial">
                <Input id="trialDays" name="trialDays" type="number" min={0} max={730} defaultValue={stripe.trialDays} />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <SwitchField
                name="automaticTax"
                label="Automatic tax"
                description="Stripe Tax calculates VAT / sales tax (requires Stripe Tax to be set up)."
                defaultChecked={stripe.automaticTax}
              />
              <SwitchField name="allowPromotionCodes" label="Allow promotion codes" description="Show a coupon field at checkout." defaultChecked={stripe.allowPromotionCodes} />
            </div>
          </CardContent>
          <CardFooter className="mt-4 flex flex-col items-stretch gap-3 border-t py-4 sm:flex-row sm:items-center sm:justify-between">
            <FormResult state={state} />
            <SubmitButton pending={pending} icon={<PlugZap />}>
              Save & connect
            </SubmitButton>
          </CardFooter>
        </form>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Status</CardTitle>
          {stripe.accountName && <CardDescription>{stripe.accountName}</CardDescription>}
        </CardHeader>
        <CardContent className="divide-y">
          <StatusRow label="Secret key" value={stripe.hasKey ? "•••• saved" : "missing"} ok={stripe.hasKey} />
          <StatusRow label="Mode" value={stripe.mode ?? "—"} ok={!!stripe.mode} />
          <StatusRow label="Price" value={stripe.priceId || "—"} ok={!!stripe.priceId} />
          <StatusRow label="Webhook" value={stripe.webhookEndpointId || "—"} ok={!!stripe.webhookEndpointId} />
          <StatusRow label="Signing secret" value={stripe.hasWebhookSecret ? "•••• saved" : "missing"} ok={stripe.hasWebhookSecret} />
          <StatusRow label="Portal" value={stripe.portalConfigurationId || "—"} ok={!!stripe.portalConfigurationId} />
          <StatusRow label="Connected" value={stripe.connectedAt ? new Date(stripe.connectedAt).toLocaleString("en-US") : "never"} ok={!!stripe.connectedAt} />
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-2 border-t py-3">
          <p className="text-xs break-all text-muted-foreground">
            Webhook URL: <span className="font-mono">{stripe.webhookUrl}</span>
          </p>
          {stripe.lastError && <p className="text-xs text-destructive">Last error: {stripe.lastError}</p>}
          {stripe.hasKey && (
            <ActionButton variant="outline" size="sm" action={connectStripeAction} icon={<Cable />}>
              Re-run setup
            </ActionButton>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}

/* ─────────────────────────────── Coolify ─────────────────────────────── */

export type CoolifyView = {
  baseUrl: string;
  hasToken: boolean;
  serverUuid: string;
  serverName: string;
  projectName: string;
  projectUuid: string;
  baseDomain: string;
  image: string;
  memoryLimit: string;
};

export function CoolifyForm({ coolify }: { coolify: CoolifyView }) {
  const [state, action, pending] = useActionState<AdminActionState, FormData>(saveCoolifyAction, {});
  const [servers, loadServers, loading] = useActionState<CoolifyServersState>(loadCoolifyServersAction, {});
  const [selectState, selectAction, selecting] = useActionState<AdminActionState, FormData>(selectCoolifyServerAction, {});
  useResultToast(state);
  useResultToast(servers);
  useResultToast(selectState);
  const ready = !!(coolify.hasToken && coolify.serverUuid);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <Server className="size-4" /> Coolify
            </CardTitle>
            <Configured ok={ready} label="Ready" />
          </div>
          <CardDescription>
            Every customer instance is a Coolify service (Docker Compose) in the project below. Create an API token in Coolify →
            Keys & Tokens with read, write and deploy permissions.
          </CardDescription>
        </CardHeader>
        <form action={action}>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Coolify URL" htmlFor="baseUrl">
              <Input id="baseUrl" name="baseUrl" type="url" required defaultValue={coolify.baseUrl} />
            </Field>
            <SecretField label="API token" name="apiToken" saved={coolify.hasToken} placeholder="1|abc…" />
            <Field label="Project" htmlFor="projectName" hint="Created automatically if it doesn't exist.">
              <Input id="projectName" name="projectName" required defaultValue={coolify.projectName} />
            </Field>
            <Field label="Instance base domain" htmlFor="baseDomain" hint="Instances get <slug>.<this domain>. Needs a wildcard DNS record (DNS only).">
              <Input id="baseDomain" name="baseDomain" required defaultValue={coolify.baseDomain} />
            </Field>
            <Field label="Docker image" htmlFor="image">
              <Input id="image" name="image" required defaultValue={coolify.image} className="font-mono" />
            </Field>
            <Field label="Memory limit (app container)" htmlFor="memoryLimit" hint="e.g. 1536m or 2g. PostgreSQL gets 512m.">
              <Input id="memoryLimit" name="memoryLimit" required defaultValue={coolify.memoryLimit} className="font-mono" />
            </Field>
          </CardContent>
          <CardFooter className="mt-4 flex flex-col items-stretch gap-3 border-t py-4 sm:flex-row sm:items-center sm:justify-between">
            <FormResult state={state} />
            <SubmitButton pending={pending} icon={<Save />}>
              Save
            </SubmitButton>
          </CardFooter>
        </form>
      </Card>

      <div className="space-y-6">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">Server</CardTitle>
            <CardDescription>{coolify.serverUuid ? `${coolify.serverName || "Selected"} · ${coolify.serverUuid}` : "No server selected yet."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <form action={loadServers}>
              <Button type="submit" variant="outline" size="sm" disabled={loading || !coolify.hasToken} className="w-full">
                {loading ? <Spinner /> : <Server />} Load servers
              </Button>
            </form>
            {servers.servers && servers.servers.length > 0 && (
              <form action={selectAction} className="space-y-2">
                <select
                  name="serverUuid"
                  defaultValue={coolify.serverUuid || servers.servers[0]!.uuid}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30"
                  aria-label="Server"
                >
                  {servers.servers.map((s) => (
                    <option key={s.uuid} value={s.uuid}>
                      {s.name}
                      {s.ip ? ` (${s.ip})` : ""}
                    </option>
                  ))}
                </select>
                <Button type="submit" size="sm" disabled={selecting} className="w-full">
                  {selecting ? <Spinner /> : null} Use this server
                </Button>
              </form>
            )}
            <FormResult state={servers.error ? servers : selectState} />
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">Connection</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            <StatusRow label="API token" value={coolify.hasToken ? "•••• saved" : "missing"} ok={coolify.hasToken} />
            <StatusRow label="Project" value={coolify.projectUuid || "not created yet"} ok={!!coolify.projectUuid} />
          </CardContent>
          <CardFooter className="border-t py-3">
            <ActionButton variant="outline" size="sm" className="w-full" action={testCoolifyAction} disabled={!coolify.hasToken} icon={<Cable />}>
              Test connection
            </ActionButton>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
