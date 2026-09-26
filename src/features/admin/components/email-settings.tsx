"use client";

import { useState } from "react";
import { AtSign, Cloud, Info, Send, Server, ShieldCheck } from "lucide-react";
import { Panel } from "@/components/app/page";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import type { Settings } from "@/server/settings/registry";
import { NumberInput, Rows, SaveBar, SecretInput, SettingRow, TestButton, ToggleRow, useSettingsForm } from "./settings-kit";
import { sendTestEmailAction, verifySmtpAction } from "../actions/tests";

export const SES_REGIONS = [
  { value: "us-east-1", label: "US East (N. Virginia)" },
  { value: "us-east-2", label: "US East (Ohio)" },
  { value: "us-west-1", label: "US West (N. California)" },
  { value: "us-west-2", label: "US West (Oregon)" },
  { value: "ca-central-1", label: "Canada (Central)" },
  { value: "eu-central-1", label: "Europe (Frankfurt)" },
  { value: "eu-central-2", label: "Europe (Zurich)" },
  { value: "eu-west-1", label: "Europe (Ireland)" },
  { value: "eu-west-2", label: "Europe (London)" },
  { value: "eu-west-3", label: "Europe (Paris)" },
  { value: "eu-north-1", label: "Europe (Stockholm)" },
  { value: "eu-south-1", label: "Europe (Milan)" },
  { value: "ap-south-1", label: "Asia Pacific (Mumbai)" },
  { value: "ap-northeast-1", label: "Asia Pacific (Tokyo)" },
  { value: "ap-northeast-2", label: "Asia Pacific (Seoul)" },
  { value: "ap-northeast-3", label: "Asia Pacific (Osaka)" },
  { value: "ap-southeast-1", label: "Asia Pacific (Singapore)" },
  { value: "ap-southeast-2", label: "Asia Pacific (Sydney)" },
  { value: "ap-southeast-3", label: "Asia Pacific (Jakarta)" },
  { value: "sa-east-1", label: "South America (São Paulo)" },
  { value: "me-south-1", label: "Middle East (Bahrain)" },
  { value: "af-south-1", label: "Africa (Cape Town)" },
  { value: "il-central-1", label: "Israel (Tel Aviv)" },
];

function PresetCard({
  active,
  onClick,
  icon: Icon,
  title,
  text,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  text: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-start gap-3 rounded-xl border p-3 text-left transition-all",
        active ? "border-foreground bg-card shadow-soft ring-1 ring-foreground" : "bg-background/50 hover:bg-muted/40",
      )}
    >
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", active ? "bg-foreground text-background" : "bg-muted")}>
        <Icon className="size-4" />
      </span>
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{text}</span>
      </span>
    </button>
  );
}

export function EmailSettings({
  smtp,
  adminEmail,
  previewHtml,
}: {
  smtp: { values: Settings<"smtp">; secrets: Record<string, boolean> };
  adminEmail: string;
  previewHtml: string;
}) {
  const f = useSettingsForm("smtp", smtp);
  const v = f.values;
  const [to, setTo] = useState(adminEmail);
  const host = v.preset === "ses" ? `email-smtp.${v.sesRegion}.amazonaws.com` : v.host;
  const incomplete = v.enabled && (!host || !v.fromEmail);

  return (
    <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="min-w-0 space-y-4">
        <Panel>
          <Rows>
            <ToggleRow
              label="Send emails via SMTP"
              description="When off, sign-in links and invitations are written to the server log (fine for testing, not for real use)."
              checked={v.enabled}
              onCheckedChange={(x) => f.set("enabled", x)}
            />
          </Rows>
        </Panel>

        <Panel title="Mail server" icon={<Server className="size-4" />}>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row">
            <PresetCard
              active={v.preset === "ses"}
              onClick={() => {
                f.set("preset", "ses");
                if (v.port !== 587 && v.port !== 465) f.set("port", 587);
              }}
              icon={Cloud}
              title="Amazon SES"
              text="SMTP interface of Amazon Simple Email Service"
            />
            <PresetCard active={v.preset === "custom"} onClick={() => f.set("preset", "custom")} icon={Server} title="Custom SMTP" text="Any SMTP server (Postmark, Mailgun, Google…)" />
          </div>
          <Rows>
            {v.preset === "ses" ? (
              <SettingRow label="SES region" description="The region where your sending identity (domain) is verified.">
                <Select value={v.sesRegion} onValueChange={(x) => f.set("sesRegion", x)}>
                  <SelectTrigger className="w-full max-w-80">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SES_REGIONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label} · <span className="font-mono text-xs">{r.value}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">{host}</p>
              </SettingRow>
            ) : (
              <SettingRow label="Host" htmlFor="smtp-host">
                <Input id="smtp-host" value={v.host} onChange={(e) => f.set("host", e.target.value)} placeholder="smtp.example.com" className="font-mono text-[13px]" />
              </SettingRow>
            )}
            <SettingRow label="Port & encryption" description="587 with STARTTLS (recommended) or 465 with implicit TLS.">
              <div className="flex flex-wrap items-center gap-3">
                <NumberInput value={v.port} onChange={(x) => f.set("port", x)} min={1} max={65535} className="w-28" />
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={v.secure || v.port === 465} onCheckedChange={(x) => f.set("secure", x)} disabled={v.port === 465} />
                  Implicit TLS
                </label>
              </div>
            </SettingRow>
            <SettingRow
              label="Username"
              htmlFor="smtp-user"
              description={v.preset === "ses" ? "SES SMTP credentials (created in the SES console) — not your IAM access key." : undefined}
            >
              <Input id="smtp-user" value={v.user} onChange={(e) => f.set("user", e.target.value)} autoComplete="off" className="font-mono text-[13px]" />
            </SettingRow>
            <SettingRow label="Password" htmlFor="smtp-password" description="Stored encrypted. Never shown again after saving.">
              <SecretInput
                id="smtp-password"
                isSet={f.secrets.password ?? false}
                value={f.secretEdits.password}
                onChange={(x) => f.setSecret("password", x)}
                placeholder="SMTP password"
              />
            </SettingRow>
          </Rows>
        </Panel>

        <Panel title="Sender" icon={<AtSign className="size-4" />}>
          <Rows>
            <SettingRow label="From name" htmlFor="from-name">
              <Input id="from-name" value={v.fromName} onChange={(e) => f.set("fromName", e.target.value)} placeholder="AutoSEO" />
            </SettingRow>
            <SettingRow
              label="From address"
              htmlFor="from-email"
              description={v.preset === "ses" ? "Must belong to a verified SES identity (domain or address)." : "Must be allowed to send via this server."}
            >
              <Input id="from-email" type="email" value={v.fromEmail} onChange={(e) => f.set("fromEmail", e.target.value)} placeholder="seo@company.com" />
            </SettingRow>
            <SettingRow label="Reply-to" htmlFor="reply-to" description="Optional — where replies to invitations go.">
              <Input id="reply-to" type="email" value={v.replyTo} onChange={(e) => f.set("replyTo", e.target.value)} placeholder="support@company.com" />
            </SettingRow>
          </Rows>
        </Panel>

        {incomplete && (
          <Alert>
            <Info className="size-4" />
            <AlertDescription>Host and from address are required before emails can be sent.</AlertDescription>
          </Alert>
        )}

        <Panel title="Test delivery" icon={<ShieldCheck className="size-4" />} description={f.dirty ? "Save your changes first — tests use the saved configuration." : "Tests use the saved configuration."}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <p className="text-sm font-medium">Verify connection</p>
              <p className="text-xs text-muted-foreground">Connects and authenticates without sending anything.</p>
              <TestButton run={verifySmtpAction} label="Verify SMTP" disabled={f.dirty || !v.enabled} disabledReason="Save and enable SMTP first" />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Send a test email</p>
              <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@company.com" className="h-8" />
              <TestButton
                run={() => sendTestEmailAction(to)}
                label={
                  <>
                    <Send className="size-3.5" /> Send test email
                  </>
                }
                disabled={f.dirty || !v.enabled || !to}
                disabledReason="Save and enable SMTP first"
              />
            </div>
          </div>
        </Panel>
        <SaveBar dirty={f.dirty} saving={f.saving} onSave={f.save} onReset={f.reset} count={f.changedCount} />
      </div>

      <Panel title="Sign-in email preview" description="What people receive — uses your branding." className="h-fit 2xl:sticky 2xl:top-20" contentClassName="p-0 sm:p-0">
        <iframe title="Email preview" srcDoc={previewHtml} sandbox="" className="h-[560px] w-full rounded-b-2xl bg-[#f5f4f0]" />
      </Panel>
    </div>
  );
}
