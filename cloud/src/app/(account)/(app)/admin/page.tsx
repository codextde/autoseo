import { Activity, CircleAlert, CreditCard, Mail, Server, Users } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CoolifyForm, SmtpForm, StripeForm } from "@/components/account/admin/settings-forms";
import { CustomersTable, type CustomerRow } from "@/components/account/admin/customers-table";
import { EventsList } from "@/components/account/admin/events-list";
import { requireAdmin } from "@/server/auth/guards";
import { getSetting, isCoolifyConfigured, isSmtpConfigured, isStripeConnected } from "@/server/settings";
import { listInstancesWithUsers, listUsersWithoutInstances } from "@/server/instances";
import { instanceCounts } from "@/server/provisioning";
import { latestEvents } from "@/server/events";
import { webhookUrl } from "@/server/stripe";

export const metadata = { title: "Admin" };

const TABS = ["customers", "email", "stripe", "coolify", "events"] as const;

export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  const { user } = await requireAdmin();
  const sp = await searchParams;
  const tab = TABS.includes(sp.tab as (typeof TABS)[number]) ? (sp.tab as string) : "customers";

  const [smtp, stripe, coolify, withInstances, withoutInstances, counts, events] = await Promise.all([
    getSetting("smtp"),
    getSetting("stripe"),
    getSetting("coolify"),
    listInstancesWithUsers(),
    listUsersWithoutInstances(),
    instanceCounts(),
    latestEvents(200),
  ]);

  // Only non-secret fields leave the server; secrets are reported as "saved" flags.
  const rows: CustomerRow[] = [
    ...withInstances.map(({ instance, user: owner }) => ({
      instanceId: instance.id,
      email: owner?.email ?? null,
      slug: instance.slug,
      host: instance.host,
      status: instance.status,
      subscriptionStatus: instance.subscriptionStatus,
      currentPeriodEnd: instance.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: instance.cancelAtPeriodEnd,
      hasService: !!instance.coolifyServiceUuid,
      error: instance.error,
      createdAt: instance.createdAt.toISOString(),
    })),
    ...withoutInstances.map((u) => ({
      instanceId: null,
      email: u.email,
      slug: null,
      host: null,
      status: null,
      subscriptionStatus: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      hasService: false,
      error: null,
      createdAt: u.createdAt.toISOString(),
    })),
  ];

  const setup = [
    { ok: isSmtpConfigured(smtp), label: "Email (SMTP)", impact: "sign-in links are only written to the server log" },
    { ok: isStripeConnected(stripe), label: "Stripe", impact: "customers can't subscribe" },
    { ok: isCoolifyConfigured(coolify), label: "Coolify", impact: "instances can't be created" },
  ];
  const missing = setup.filter((s) => !s.ok);
  const stats = [
    { label: "Running", value: counts.running ?? 0 },
    { label: "Provisioning", value: counts.provisioning ?? 0 },
    { label: "Awaiting payment", value: counts.pending_payment ?? 0 },
    { label: "Stopped / failed", value: (counts.stopped ?? 0) + (counts.failed ?? 0) },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Admin</h1>
        <p className="mt-1 text-muted-foreground">Integrations, customers and the audit log.</p>
      </div>

      {missing.length > 0 && (
        <Alert>
          <CircleAlert />
          <AlertTitle>Setup incomplete</AlertTitle>
          <AlertDescription>
            <ul className="list-inside list-disc">
              {missing.map((m) => (
                <li key={m.label}>
                  <span className="font-medium text-foreground">{m.label}</span> is not configured — {m.impact}.
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} size="sm">
            <CardContent>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue={tab} className="gap-6">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList>
            <TabsTrigger value="customers">
              <Users /> Customers
            </TabsTrigger>
            <TabsTrigger value="email">
              <Mail /> Email
            </TabsTrigger>
            <TabsTrigger value="stripe">
              <CreditCard /> Stripe
            </TabsTrigger>
            <TabsTrigger value="coolify">
              <Server /> Coolify
            </TabsTrigger>
            <TabsTrigger value="events">
              <Activity /> Events
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="customers">
          <CustomersTable rows={rows} />
        </TabsContent>
        <TabsContent value="email">
          <SmtpForm
            adminEmail={user.email}
            smtp={{
              host: smtp.host,
              port: smtp.port,
              secure: smtp.secure,
              user: smtp.user,
              hasPassword: !!smtp.password,
              fromName: smtp.fromName,
              fromEmail: smtp.fromEmail,
              replyTo: smtp.replyTo,
              shareWithInstances: smtp.shareWithInstances,
            }}
          />
        </TabsContent>
        <TabsContent value="stripe">
          <StripeForm
            stripe={{
              hasKey: !!stripe.secretKey,
              mode: stripe.mode,
              accountName: stripe.accountName,
              productId: stripe.productId,
              priceId: stripe.priceId,
              webhookEndpointId: stripe.webhookEndpointId,
              hasWebhookSecret: !!stripe.webhookSecret,
              portalConfigurationId: stripe.portalConfigurationId,
              connectedAt: stripe.connectedAt,
              lastError: stripe.lastError,
              trialDays: stripe.trialDays,
              automaticTax: stripe.automaticTax,
              allowPromotionCodes: stripe.allowPromotionCodes,
              webhookUrl: webhookUrl(),
            }}
          />
        </TabsContent>
        <TabsContent value="coolify">
          <CoolifyForm
            coolify={{
              baseUrl: coolify.baseUrl,
              hasToken: !!coolify.apiToken,
              serverUuid: coolify.serverUuid,
              serverName: coolify.serverName,
              projectName: coolify.projectName,
              projectUuid: coolify.projectUuid,
              baseDomain: coolify.baseDomain,
              image: coolify.image,
              memoryLimit: coolify.memoryLimit,
            }}
          />
        </TabsContent>
        <TabsContent value="events">
          <EventsList
            events={events.map((e) => ({
              id: e.id,
              type: e.type,
              userId: e.userId,
              instanceId: e.instanceId,
              data: e.data,
              createdAt: e.createdAt.toISOString(),
            }))}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
