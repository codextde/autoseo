"use client";

import { motion } from "motion/react";
import { AlertTriangle, Clock3, KeyRound, Laptop, Mail, MailCheck, ShieldCheck, Smartphone, UserPlus } from "lucide-react";
import { Panel } from "@/components/app/page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import type { Settings } from "@/server/settings/registry";
import { ChipsInput, NumberInput, Rows, SaveBar, SettingRow, ToggleRow, useSettingsForm } from "./settings-kit";

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function normalizeDomain(s: string) {
  return s.trim().toLowerCase().replace(/^@/, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

function FlowStep({ icon: Icon, title, text, i }: { icon: React.ComponentType<{ className?: string }>; title: string; text: React.ReactNode; i: number }) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 * i }}
      className="relative flex gap-3 rounded-xl border bg-background/60 p-3"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">
          <span className="mr-1 text-muted-foreground tabular">{i + 1}.</span>
          {title}
        </span>
        <span className="block text-xs leading-relaxed text-muted-foreground">{text}</span>
      </span>
    </motion.li>
  );
}

export function AuthSettings({
  auth,
  security,
  roles,
  ownDomain,
}: {
  auth: { values: Settings<"auth">; secrets: Record<string, boolean> };
  security: { values: Settings<"security">; secrets: Record<string, boolean> };
  roles: { key: string; name: string }[];
  ownDomain: string;
}) {
  const a = useSettingsForm("auth", auth);
  const s = useSettingsForm("security", security);
  const v = a.values;
  const openSignup = !v.requireInvitation || v.allowDomainSignup;
  const anyoneCanSignUp = openSignup && v.allowedDomains.length === 0;
  const ownMissing = v.allowedDomains.length > 0 && !v.allowedDomains.some((d) => ownDomain === d || ownDomain.endsWith(`.${d}`));

  return (
    <div className="space-y-4">
      <Panel
        title="How sign-in works"
        description="Passwordless and invite-only by default — nothing to leak, nothing to reset."
        icon={<ShieldCheck className="size-4 text-brand" />}
      >
        <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <FlowStep
            i={0}
            icon={UserPlus}
            title="Invite"
            text={
              v.allowedDomains.length
                ? `An admin invites people from ${v.allowedDomains.map((d) => `@${d}`).join(", ")}.`
                : "An admin invites people by email (any domain)."
            }
          />
          <FlowStep i={1} icon={Mail} title="Magic link + code" text={`They get a single-use link and a 6-digit code, valid ${v.magicLinkMinutes} minutes.`} />
          <FlowStep
            i={2}
            icon={Clock3}
            title={`Signed in for ${v.sessionDays} days`}
            text="Each device keeps its own long-lived session — no daily logins."
          />
          <FlowStep
            i={3}
            icon={Laptop}
            title="Many devices"
            text={
              v.maxSessionsPerUser > 0
                ? `Up to ${v.maxSessionsPerUser} devices at once; the oldest is signed out.`
                : "Unlimited devices at once. Users can revoke devices in their account."
            }
          />
        </ol>
      </Panel>

      <Panel title="Who can sign in" icon={<KeyRound className="size-4" />}>
        <Rows>
          <SettingRow
            label="Allowed email domains"
            htmlFor="allowed-domains"
            description={
              <>
                Only addresses from these domains can be invited or sign in (subdomains included). Leave empty to allow any domain.
                Your own domain <span className="font-medium text-foreground">@{ownDomain}</span> must stay on the list.
              </>
            }
          >
            <ChipsInput
              id="allowed-domains"
              value={v.allowedDomains}
              onChange={(list) => a.set("allowedDomains", list)}
              placeholder="solakon.de"
              normalize={normalizeDomain}
              validate={(d) => (DOMAIN_RE.test(d) ? null : `“${d}” is not a valid domain — use e.g. solakon.de`)}
              renderChip={(d) => <span className="font-mono">@{d}</span>}
            />
            {ownMissing && (
              <p className="mt-1.5 flex items-center gap-1 text-xs text-destructive">
                <AlertTriangle className="size-3" /> Add {ownDomain} or you would lock yourself out.
              </p>
            )}
          </SettingRow>
          <ToggleRow
            label="Require an invitation"
            description="Recommended. Only people with a pending invitation (or an existing account) receive a sign-in link."
            checked={v.requireInvitation}
            onCheckedChange={(x) => a.set("requireInvitation", x)}
          />
          <ToggleRow
            label="Allow self sign-up for allowed domains"
            description="Anyone with an email on the allow-list can create an account and joins the default workspace."
            checked={v.allowDomainSignup}
            onCheckedChange={(x) => a.set("allowDomainSignup", x)}
          />
          <SettingRow label="Default role for self sign-ups" description="Used when people join without an invitation.">
            <Select value={v.defaultRoleKey} onValueChange={(x) => a.set("defaultRoleKey", x)} disabled={!openSignup}>
              <SelectTrigger className="w-full max-w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.key} value={r.key}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
        </Rows>
        {anyoneCanSignUp && (
          <Alert variant="destructive" className="mt-4">
            <AlertTriangle className="size-4" />
            <AlertDescription>
              With open sign-up and no domain allow-list, <strong>anyone on the internet</strong> can create an account. Add your
              company domain above or require invitations.
            </AlertDescription>
          </Alert>
        )}
      </Panel>

      <Panel title="Sessions & links" icon={<Smartphone className="size-4" />}>
        <Rows>
          <SettingRow label="Session duration" description="How long a device stays signed in. Default: 365 days.">
            <NumberInput value={v.sessionDays} onChange={(x) => a.set("sessionDays", x)} min={1} max={3650} suffix="days" />
          </SettingRow>
          <SettingRow label="Magic link validity" description="Links and 6-digit codes are single-use.">
            <NumberInput value={v.magicLinkMinutes} onChange={(x) => a.set("magicLinkMinutes", x)} min={5} max={1440} suffix="minutes" />
          </SettingRow>
          <SettingRow label="Invitation validity" description="Expired invitations can be re-sent from Invitations.">
            <NumberInput value={v.inviteDays} onChange={(x) => a.set("inviteDays", x)} min={1} max={90} suffix="days" />
          </SettingRow>
          <SettingRow label="Max devices per user" description="0 = unlimited. When exceeded, the least recently used device is signed out.">
            <NumberInput value={v.maxSessionsPerUser} onChange={(x) => a.set("maxSessionsPerUser", x)} min={0} max={100} suffix="devices" />
          </SettingRow>
        </Rows>
      </Panel>

      <Panel title="Protection" icon={<MailCheck className="size-4" />}>
        <Rows>
          <ToggleRow
            label="Generic sign-in response"
            description="Always show “check your inbox”, so nobody can find out which emails have access."
            checked={v.genericLoginResponse}
            onCheckedChange={(x) => a.set("genericLoginResponse", x)}
          />
          <SettingRow label="Sign-in rate limit" description="Sign-in emails per address and hour (3× per IP address).">
            <NumberInput value={v.loginRateLimitPerHour} onChange={(x) => a.set("loginRateLimitPerHour", x)} min={1} max={1000} suffix="/ hour" />
          </SettingRow>
          <SettingRow label="API rate limit" description="Requests per minute and API key for the REST API and MCP server.">
            <NumberInput
              value={s.values.apiRateLimitPerMinute}
              onChange={(x) => s.set("apiRateLimitPerMinute", x)}
              min={10}
              max={100000}
              suffix="/ minute"
            />
          </SettingRow>
          <SettingRow
            label="Internal hosts allowed for integrations"
            description="Hostnames (e.g. wordpress.intranet.local) that may resolve to private network addresses — for self-hosted CMS or analytics on your LAN. All other private addresses stay blocked."
          >
            <ChipsInput
              value={s.values.privateNetworkAllowlist}
              onChange={(list) => s.set("privateNetworkAllowlist", list)}
              placeholder="host.intranet.local"
              normalize={(x) => x.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/:].*$/, "")}
              validate={(x) => (/^[a-z0-9.-]+$/.test(x) ? null : "Enter a hostname")}
            />
          </SettingRow>
          <ToggleRow
            label="Behind Cloudflare"
            description="Use Cloudflare's CF-Connecting-IP header for client IPs (rate limits, audit log). Only enable when all traffic is proxied by Cloudflare — otherwise clients could spoof it."
            checked={s.values.behindCloudflare}
            onCheckedChange={(x) => s.set("behindCloudflare", x)}
          />
          <ToggleRow
            label="Allow embedding in iframes"
            description="Lets shared reports be embedded on other websites. Keep off unless you need it."
            checked={s.values.allowIframeEmbedding}
            onCheckedChange={(x) => s.set("allowIframeEmbedding", x)}
          />
        </Rows>
      </Panel>

      <SaveBar
        dirty={a.dirty || s.dirty}
        saving={a.saving || s.saving}
        count={a.changedCount + s.changedCount}
        onReset={() => {
          a.reset();
          s.reset();
        }}
        onSave={async () => {
          if (a.dirty && !(await a.save())) return;
          if (s.dirty) await s.save();
        }}
      />
      <p className={cn("text-xs text-muted-foreground")}>
        Changes apply to new sign-ins and sessions. Existing sessions keep their original expiry.
      </p>
    </div>
  );
}
