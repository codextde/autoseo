"use client";

import { Cloud, ExternalLink, Gauge, Globe, Search, Wallet } from "lucide-react";
import { Panel } from "@/components/app/page";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MultiSelect } from "@/components/app/filters";
import { CopyButton } from "@/components/app/misc";
import { COUNTRIES, flagEmoji, getCountryByLocationCode, LANGUAGES } from "@/lib/countries";
import type { Settings } from "@/server/settings/registry";
import { Rows, SaveBar, SecretInput, SettingRow, TestButton, ToggleRow, useSettingsForm } from "./settings-kit";
import { testDataForSeoAction, testIntegrationAction } from "../actions/tests";

type S<K extends "dataforseo" | "google" | "integrations"> = { values: Settings<K>; secrets: Record<string, boolean> };

function Connected({ on }: { on: boolean }) {
  return on ? (
    <Badge variant="secondary" className="h-5 bg-success/12 text-[10px] text-success">
      Connected
    </Badge>
  ) : (
    <Badge variant="outline" className="h-5 text-[10px] text-muted-foreground">
      Not connected
    </Badge>
  );
}

function CopyField({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2">
      <Input readOnly value={value} className="h-8 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
      <CopyButton value={value} size="icon" className="size-8 shrink-0 border" />
    </div>
  );
}

export function DataSettings({
  dataforseo,
  google,
  integrations,
  appUrl,
}: {
  dataforseo: S<"dataforseo">;
  google: S<"google">;
  integrations: S<"integrations">;
  appUrl: string;
}) {
  const d = useSettingsForm("dataforseo", dataforseo);
  const g = useSettingsForm("google", google);
  const i = useSettingsForm("integrations", integrations);
  const forms = [d, g, i];
  const dirty = forms.some((f) => f.dirty);
  const market = getCountryByLocationCode(d.values.defaultLocationCode);
  const dfsConnected = Boolean(d.values.login) && Boolean(d.secrets.password);
  const redirectUri = `${appUrl}/api/oauth/google/callback`;

  return (
    <div className="space-y-4">
      <Panel
        title={
          <span className="flex items-center gap-2">
            DataForSEO <Connected on={dfsConnected} />
          </span>
        }
        description="Keyword, SERP, backlink, on-page and AI-engine data. Pay-as-you-go; costs are tracked under Usage."
        icon={<Globe className="size-4" />}
        actions={
          <a
            href="https://app.dataforseo.com/api-access"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            API credentials <ExternalLink className="size-3" />
          </a>
        }
      >
        <Rows>
          <SettingRow label="API login" htmlFor="dfs-login" description="The API login (email) from DataForSEO → API Access.">
            <Input id="dfs-login" value={d.values.login} onChange={(e) => d.set("login", e.target.value)} autoComplete="off" placeholder="you@company.com" />
          </SettingRow>
          <SettingRow label="API password" htmlFor="dfs-password" description="Not your account password — the generated API password.">
            <SecretInput id="dfs-password" isSet={d.secrets.password ?? false} value={d.secretEdits.password} onChange={(x) => d.setSecret("password", x)} placeholder="API password" />
          </SettingRow>
          <ToggleRow
            label="Sandbox mode"
            description="Uses sandbox.dataforseo.com — free, but returns sample data. Turn off for real results."
            checked={d.values.sandbox}
            onCheckedChange={(x) => d.set("sandbox", x)}
          />
          <SettingRow label="Default market" description="Pre-selected location and language for research tools.">
            <div className="flex flex-wrap gap-2">
              <MultiSelect
                single
                options={COUNTRIES.map((c) => ({ value: String(c.locationCode), label: `${flagEmoji(c.iso)} ${c.name}` }))}
                value={[String(d.values.defaultLocationCode)]}
                onChange={(vals) => {
                  const code = Number(vals[0]);
                  if (!code) return;
                  d.set("defaultLocationCode", code);
                  const c = getCountryByLocationCode(code);
                  if (c && !c.languages.includes(d.values.defaultLanguageCode)) d.set("defaultLanguageCode", c.language);
                }}
                label="Market"
                className="h-9 min-w-48"
              />
              <MultiSelect
                single
                options={(market?.languages ?? LANGUAGES.map((l) => l.code)).map((code) => ({
                  value: code,
                  label: LANGUAGES.find((l) => l.code === code)?.name ?? code,
                }))}
                value={[d.values.defaultLanguageCode]}
                onChange={(vals) => vals[0] && d.set("defaultLanguageCode", vals[0])}
                label="Language"
                className="h-9 min-w-36"
              />
            </div>
          </SettingRow>
          <SettingRow label="Connection" description={d.dirty ? "Save first — the test uses the saved credentials." : "Checks the credentials and shows your balance."}>
            <TestButton
              run={async () => {
                const res = await testDataForSeoAction();
                if (!res.ok) return res;
                const r = res.data;
                return {
                  ok: true as const,
                  data: {
                    ok: r.ok,
                    message: r.ok && r.balance != null ? `${r.message} · balance $${r.balance.toFixed(2)}` : r.message,
                    detail: r.detail,
                    latencyMs: r.latencyMs,
                  },
                };
              }}
              label={
                <>
                  <Wallet className="size-3.5" /> Test connection
                </>
              }
              disabled={d.dirty || !dfsConnected}
              disabledReason="Save login and password first"
            />
          </SettingRow>
        </Rows>
      </Panel>

      <Panel
        title={
          <span className="flex items-center gap-2">
            Google <Connected on={Boolean(g.values.oauthClientId) && Boolean(g.secrets.oauthClientSecret)} />
          </span>
        }
        description="OAuth app for Search Console and Google Analytics 4 connections, plus PageSpeed Insights."
        icon={<Search className="size-4" />}
        actions={
          <a
            href="https://console.cloud.google.com/apis/credentials"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Google Cloud console <ExternalLink className="size-3" />
          </a>
        }
      >
        <Rows>
          <SettingRow
            label="Authorized redirect URI"
            description="Create an OAuth client (type “Web application”) and register exactly this redirect URI. Enable the Search Console API and Google Analytics Data/Admin APIs."
          >
            <CopyField value={redirectUri} />
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Authorized JavaScript origin: <span className="font-mono">{appUrl}</span>
            </p>
          </SettingRow>
          <SettingRow label="OAuth client ID" htmlFor="g-client">
            <Input
              id="g-client"
              value={g.values.oauthClientId}
              onChange={(e) => g.set("oauthClientId", e.target.value.trim())}
              placeholder="1234567890-abc.apps.googleusercontent.com"
              className="font-mono text-[13px]"
            />
          </SettingRow>
          <SettingRow label="OAuth client secret" htmlFor="g-secret">
            <SecretInput
              id="g-secret"
              isSet={g.secrets.oauthClientSecret ?? false}
              value={g.secretEdits.oauthClientSecret}
              onChange={(x) => g.setSecret("oauthClientSecret", x)}
              placeholder="GOCSPX-…"
            />
          </SettingRow>
          <SettingRow
            label={
              <span className="flex items-center gap-1.5">
                <Gauge className="size-3.5" /> PageSpeed Insights API key
              </span>
            }
            htmlFor="g-psi"
            description="Optional — raises the Lighthouse/Core Web Vitals quota for site audits."
          >
            <div className="space-y-2">
              <SecretInput id="g-psi" isSet={g.secrets.pagespeedApiKey ?? false} value={g.secretEdits.pagespeedApiKey} onChange={(x) => g.setSecret("pagespeedApiKey", x)} />
              <TestButton run={() => testIntegrationAction("pagespeed")} disabled={g.dirty || !g.secrets.pagespeedApiKey} disabledReason="Save a key first" />
            </div>
          </SettingRow>
        </Rows>
      </Panel>

      <Panel title="Other integrations" description="Instance-wide credentials used by analytics and bot-traffic features." icon={<Cloud className="size-4" />}>
        <Rows>
          <SettingRow
            label="Bing Webmaster Tools API key"
            description={
              <>
                Bing search performance data.{" "}
                <a href="https://www.bing.com/webmasters/" target="_blank" rel="noreferrer" className="underline underline-offset-4">
                  Get key
                </a>
              </>
            }
          >
            <div className="space-y-2">
              <SecretInput
                isSet={i.secrets.bingWebmasterApiKey ?? false}
                value={i.secretEdits.bingWebmasterApiKey}
                onChange={(x) => i.setSecret("bingWebmasterApiKey", x)}
              />
              <TestButton run={() => testIntegrationAction("bing")} disabled={i.dirty || !i.secrets.bingWebmasterApiKey} disabledReason="Save a key first" />
            </div>
          </SettingRow>
          <SettingRow
            label="Cloudflare API token"
            description={
              <>
                Read-only token (Zone Analytics + Logs) for AI bot traffic.{" "}
                <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer" className="underline underline-offset-4">
                  Create token
                </a>
              </>
            }
          >
            <div className="space-y-2">
              <SecretInput
                isSet={i.secrets.cloudflareApiToken ?? false}
                value={i.secretEdits.cloudflareApiToken}
                onChange={(x) => i.setSecret("cloudflareApiToken", x)}
              />
              <TestButton
                run={() => testIntegrationAction("cloudflare")}
                disabled={i.dirty || !i.secrets.cloudflareApiToken}
                disabledReason="Save a token first"
              />
            </div>
          </SettingRow>
        </Rows>
      </Panel>

      <SaveBar
        dirty={dirty}
        saving={forms.some((f) => f.saving)}
        count={forms.reduce((n, f) => n + f.changedCount, 0)}
        onReset={() => forms.forEach((f) => f.reset())}
        onSave={async () => {
          for (const f of forms) {
            if (f.dirty && !(await f.save())) return;
          }
        }}
      />
    </div>
  );
}
