"use client";

import { AlertTriangle, ExternalLink, Globe2, Megaphone, ShieldCheck, Wallet } from "lucide-react";
import { Panel } from "@/components/app/page";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { Settings } from "@/server/settings/registry";
import { NumberInput, Rows, SaveBar, SecretInput, SettingRow, ToggleRow, useSettingsForm } from "./settings-kit";

type FreeToolsValues = Settings<"freeTools">;

export function FreeToolsForm({
  initial,
  appUrl,
}: {
  initial: { values: FreeToolsValues; secrets: Record<string, boolean> };
  appUrl: string;
}) {
  const f = useSettingsForm<FreeToolsValues>("freeTools", initial);
  const v = f.values;
  const secretSet = f.secretEdits.turnstileSecretKey !== undefined ? Boolean(f.secretEdits.turnstileSecretKey) : Boolean(f.secrets.turnstileSecretKey);
  const turnstileReady = Boolean(v.turnstileSiteKey) && secretSet;
  const turnstilePartial = Boolean(v.turnstileSiteKey) !== secretSet;

  return (
    <div className="space-y-4">
      <Panel title="Availability" icon={<Globe2 className="size-4" />}>
        <Rows>
          <ToggleRow
            label="Publish the tools publicly"
            description={
              <>
                Signed-in users always get the tools hub. When on, the tools are also available without login at{" "}
                <span className="font-mono text-foreground">{appUrl}/free-tools</span> — useful as a lead magnet.
              </>
            }
            checked={v.publicEnabled}
            onCheckedChange={(x) => f.set("publicEnabled", x)}
          />
        </Rows>
        {v.publicEnabled && !turnstileReady && (
          <Alert variant="destructive" className="mt-4">
            <AlertTriangle className="size-4" />
            <AlertDescription>
              Public tools spend your DataForSEO balance on anonymous visitors. Add Cloudflare Turnstile keys below so bots can&apos;t
              drain the daily budget.
            </AlertDescription>
          </Alert>
        )}
      </Panel>

      <Panel
        title="Budget & rate limits"
        icon={<Wallet className="size-4" />}
        description="Hard caps for the public tools. When a limit is hit, visitors see a friendly “try again tomorrow / sign up” message. Limits reset at 00:00 UTC."
      >
        <Rows>
          <SettingRow label="Daily budget" description="Estimated DataForSEO spend of the public tools per day. 0 disables paid tools." htmlFor="ft-budget">
            <NumberInput id="ft-budget" value={v.dailyBudgetUsd} min={0} step={1} suffix="USD / day" onChange={(x) => f.set("dailyBudgetUsd", x)} />
          </SettingRow>
          <SettingRow label="Max paid calls per day" description="Across all visitors and tools." htmlFor="ft-calls">
            <NumberInput id="ft-calls" value={v.maxCallsPerDay} min={0} step={100} suffix="calls" onChange={(x) => f.set("maxCallsPerDay", x)} />
          </SettingRow>
          <SettingRow label="Per visitor per day" description="Paid calls one visitor (hashed IP) may trigger per day." htmlFor="ft-visitor">
            <NumberInput id="ft-visitor" value={v.perVisitorCallsPerDay} min={1} suffix="calls" onChange={(x) => f.set("perVisitorCallsPerDay", x)} />
          </SettingRow>
          <SettingRow label="Per IP per minute" description="Burst protection across all tools (open-seo default: 5)." htmlFor="ft-ip">
            <NumberInput id="ft-ip" value={v.perIpPerMinute} min={1} suffix="requests" onChange={(x) => f.set("perIpPerMinute", x)} />
          </SettingRow>
        </Rows>
      </Panel>

      <Panel
        title="Bot protection (Cloudflare Turnstile)"
        icon={<ShieldCheck className="size-4" />}
        description="Invisible human verification for the public tools. Create a widget for your domain and paste both keys."
        actions={
          <a
            href="https://dash.cloudflare.com/?to=/:account/turnstile"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Turnstile dashboard <ExternalLink className="size-3" />
          </a>
        }
      >
        <Rows>
          <SettingRow label="Site key" htmlFor="ft-site" description="Public — embedded in the tool pages.">
            <Input
              id="ft-site"
              value={v.turnstileSiteKey}
              onChange={(e) => f.set("turnstileSiteKey", e.target.value.trim())}
              placeholder="0x4AAAAAAA…"
              className="font-mono text-[13px]"
              autoComplete="off"
            />
          </SettingRow>
          <SettingRow label="Secret key" htmlFor="ft-secret" description="Stored encrypted, used server-side to verify visitors.">
            <SecretInput
              id="ft-secret"
              isSet={f.secrets.turnstileSecretKey ?? false}
              value={f.secretEdits.turnstileSecretKey}
              onChange={(x) => f.setSecret("turnstileSecretKey", x)}
              placeholder="0x4AAAAAAA…"
            />
          </SettingRow>
        </Rows>
        {turnstilePartial && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-warning">
            <AlertTriangle className="size-3.5" /> Both the site key and the secret key are needed.
          </p>
        )}
      </Panel>

      <Panel title="Call to action" icon={<Megaphone className="size-4" />} description="Shown under public tool results.">
        <Rows>
          <SettingRow label="Button label" htmlFor="ft-cta-label" description="Leave empty for “Get started”.">
            <Input id="ft-cta-label" value={v.ctaLabel} onChange={(e) => f.set("ctaLabel", e.target.value)} placeholder="Book a free consultation" maxLength={80} />
          </SettingRow>
          <SettingRow label="Link" htmlFor="ft-cta-url" description="A full https:// URL or an app path like /login. Leave empty for the sign-in page.">
            <Input id="ft-cta-url" value={v.ctaUrl} onChange={(e) => f.set("ctaUrl", e.target.value)} placeholder="https://calendly.com/…" />
          </SettingRow>
        </Rows>
      </Panel>

      <SaveBar dirty={f.dirty} saving={f.saving} onSave={() => void f.save()} onReset={f.reset} count={f.changedCount} />
    </div>
  );
}
