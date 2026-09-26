"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Clock, KeyRound, Loader2, RefreshCw, RotateCw, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmButton, CopyButton, StatusBadge, TimeAgo } from "@/components/app/misc";
import { formatNumber } from "@/components/app/metrics";
import { IntegrationLogo } from "@/features/integrations/components/integration-logo";
import { disconnectIntegrationAction, issueIngestTokenAction } from "@/features/integrations/actions";
import { refreshIpRangesAction } from "../actions";
import { cn } from "@/lib/utils";
import type { ConnectorStatus } from "@/server/analytics/bots/queries";

type IpRangeStatus = { key: string; operator: string; bots: string[]; prefixes: number; fetchedAt: string | null; error: string | null };

const CF_FIELDS = [
  "ClientIP",
  "ClientRequestHost",
  "ClientRequestMethod",
  "ClientRequestURI",
  "ClientRequestUserAgent",
  "EdgeResponseStatus",
  "EdgeResponseBytes",
  "EdgeStartTimestamp",
];
const AKAMAI_FIELDS = ["reqTimeSec", "cliIP", "reqHost", "reqMethod", "reqPath", "queryStr", "statusCode", "UA", "totalBytes"];

function Code({ children, copy, className }: { children: string; copy?: boolean; className?: string }) {
  return (
    <div className={cn("group relative min-w-0 rounded-lg border bg-muted/50", className)}>
      <pre className="scrollbar-none overflow-x-auto p-3 pr-10 font-mono text-[11.5px] leading-relaxed whitespace-pre">{children}</pre>
      {copy !== false && (
        <div className="absolute top-1.5 right-1.5">
          <CopyButton value={children} size="icon" />
        </div>
      )}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background">{n}</span>
      <div className="min-w-0 flex-1 space-y-2 pb-1">
        <div className="text-sm font-medium">{title}</div>
        {children}
      </div>
    </li>
  );
}

function ConnectorHeader({ provider, name, subtitle, status }: { provider: string; name: string; subtitle: string; status?: ConnectorStatus }) {
  const live = status?.live;
  return (
    <div className="flex items-start gap-3">
      <IntegrationLogo provider={provider} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold tracking-tight">{name}</h3>
          {status &&
            (live ? (
              <StatusBadge status="online" label="Receiving data" />
            ) : status.connected ? (
              <StatusBadge status="pending" label="Waiting for data" />
            ) : (
              <StatusBadge status="disabled" label="Not connected" dot={false} />
            ))}
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

function ConnectorStats({ status }: { status: ConnectorStatus }) {
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {[
        ["Last received", status.lastReceivedAt ? <TimeAgo key="t" date={status.lastReceivedAt} /> : "—"],
        ["Requests (7d)", formatNumber(status.requests7d)],
        ["Lines (7d)", formatNumber(status.lines7d)],
        ["Bot visits saved (7d)", formatNumber(status.saved7d)],
      ].map(([label, value]) => (
        <div key={label as string} className="rounded-lg bg-muted/60 px-2.5 py-2">
          <dt className="text-[11px] text-muted-foreground">{label}</dt>
          <dd className="text-sm font-semibold tabular">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Token create / rotate / revoke for a push connector. The plain token is shown once. */
function TokenManager({
  projectId,
  provider,
  status,
  canManage,
  onToken,
}: {
  projectId: string;
  provider: string;
  status: ConnectorStatus;
  canManage: boolean;
  onToken: (token: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [shown, setShown] = useState<string | null>(null);

  const issue = () =>
    start(async () => {
      const res = await issueIngestTokenAction(projectId, provider);
      if (res.ok) {
        setShown(res.data.token);
        onToken(res.data.token);
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <KeyRound className="size-4 shrink-0 text-muted-foreground" />
        {status.tokenPrefix ? (
          <span className="min-w-0 truncate">
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{status.tokenPrefix}…</code>
            {status.tokenCreatedAt && (
              <span className="ml-2 text-xs text-muted-foreground">
                created <TimeAgo date={status.tokenCreatedAt} />
              </span>
            )}
          </span>
        ) : (
          <span className="text-muted-foreground">No ingest token yet</span>
        )}
      </div>
      {canManage && (
        <div className="flex shrink-0 gap-2">
          {status.tokenPrefix ? (
            <>
              <ConfirmButton
                title="Rotate token?"
                description="A new token is created and the current one stops working immediately. Update your Worker secret / log shipper afterwards."
                confirmLabel="Rotate"
                onConfirm={issue}
              >
                <Button size="sm" variant="outline" disabled={pending}>
                  <RotateCw className="size-3.5" /> Rotate
                </Button>
              </ConfirmButton>
              <ConfirmButton
                title="Revoke token?"
                description="Requests with this token are rejected from now on. Stored bot visits are kept."
                confirmLabel="Revoke"
                destructive
                onConfirm={async () => {
                  const res = await disconnectIntegrationAction(projectId, provider);
                  if (res.ok) {
                    toast.success("Token revoked.");
                    router.refresh();
                  } else toast.error(res.error);
                }}
              >
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                  <Trash2 className="size-3.5" /> Revoke
                </Button>
              </ConfirmButton>
            </>
          ) : (
            <Button size="sm" onClick={issue} disabled={pending}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
              Generate token
            </Button>
          )}
        </div>
      )}
      <Dialog open={!!shown} onOpenChange={(v) => !v && setShown(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Your ingest token</DialogTitle>
            <DialogDescription>Copy it now — for security it is shown only once. Only a hash is stored.</DialogDescription>
          </DialogHeader>
          {shown && <Code>{shown}</Code>}
          <p className="text-xs text-muted-foreground">The setup snippets below now contain this token until you leave the page.</p>
          <DialogFooter>
            <Button onClick={() => setShown(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function BotSyncTab({
  projectId,
  appUrl,
  domain,
  connectors,
  ipRanges,
  canManage,
}: {
  projectId: string;
  appUrl: string;
  domain: string;
  connectors: ConnectorStatus[];
  ipRanges: IpRangeStatus[];
  canManage: boolean;
}) {
  const params = useSearchParams();
  const highlight = params.get("connector");
  const refs = useRef<Record<string, HTMLElement | null>>({});
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  useEffect(() => {
    if (highlight) refs.current[highlight]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [highlight]);

  const endpoint = `${appUrl}/api/webhooks/server-logs`;
  const workerUrl = `${appUrl}/api/public/cloudflare-worker/${projectId}`;
  const status = (p: string) => connectors.find((c) => c.provider === p)!;
  const tok = (p: string) => tokens[p] ?? "<YOUR_TOKEN>";
  const setToken = (p: string) => (t: string) => setTokens((s) => ({ ...s, [p]: t }));

  const cardCls = (key: string) =>
    cn("scroll-mt-24 space-y-4 rounded-2xl border bg-card p-4 shadow-soft transition-shadow sm:p-5", highlight === key && "ring-2 ring-brand/60");

  const logpushDest = `${endpoint}?header_Authorization=Bearer%20${tok("cloudflare")}`;
  const logpushCurl = `curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/logpush/jobs" \\
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  --data '{
    "name": "autoseo-ai-crawlers",
    "dataset": "http_requests",
    "destination_conf": "${logpushDest}",
    "output_options": {
      "field_names": ${JSON.stringify(CF_FIELDS)},
      "timestamp_format": "rfc3339"
    },
    "enabled": true
  }'`;

  const curlExample = `curl -X POST ${endpoint} \\
  -H "Authorization: Bearer ${tok("server_logs")}" \\
  -H "Content-Type: application/x-ndjson" \\
  --data-binary $'{"timestamp":"2026-09-24T08:15:02Z","ip":"20.171.207.185","method":"GET","host":"${domain}","path":"/pricing","status":200,"user_agent":"Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)","bytes":5120}\\n'`;

  const nginxFormat = `# nginx: JSON access log → ship with Vector / Fluent Bit (or upload the file)
log_format autoseo escape=json '{"timestamp":"$time_iso8601","ip":"$remote_addr",'
  '"method":"$request_method","host":"$host","path":"$request_uri","status":$status,'
  '"bytes":$body_bytes_sent,"user_agent":"$http_user_agent"}';
access_log /var/log/nginx/autoseo.ndjson autoseo;`;

  const vector = `# vector.toml — forwards only AI-crawler requests
[sources.nginx]
type = "file"
include = ["/var/log/nginx/autoseo.ndjson"]

[transforms.bots]
type = "filter"
inputs = ["nginx"]
condition = 'match(string!(parse_json!(.message).user_agent), r'(?i)gptbot|chatgpt-user|oai-searchbot|claude|perplexity|google|bingbot|applebot|bytespider|ccbot|meta-externalagent')'

[sinks.autoseo]
type = "http"
inputs = ["bots"]
uri = "${endpoint}"
encoding.codec = "text"
framing.method = "newline_delimited"
compression = "gzip"
request.headers.Authorization = "Bearer ${tok("server_logs")}"
batch.max_events = 5000`;

  const fluentBit = `# fluent-bit.conf
[INPUT]
    Name   tail
    Path   /var/log/nginx/autoseo.ndjson
    Parser json

[OUTPUT]
    Name        http
    Match       *
    Host        ${appUrl.replace(/^https?:\/\//, "").split(":")[0]}
    Port        ${appUrl.startsWith("https") ? 443 : (appUrl.split(":")[2] ?? 80)}
    URI         /api/webhooks/server-logs
    Format      json_lines
    Header      Authorization Bearer ${tok("server_logs")}
    tls         ${appUrl.startsWith("https") ? "On" : "Off"}`;

  return (
    <div className="space-y-4">
      {/* Cloudflare */}
      <section ref={(el) => void (refs.current.cloudflare = el)} className={cardCls("cloudflare")}>
        <ConnectorHeader provider="cloudflare" name="Cloudflare" subtitle="Worker (all plans) or Logpush (Enterprise) — real-time AI crawler visits." status={status("cloudflare")} />
        <TokenManager projectId={projectId} provider="cloudflare" status={status("cloudflare")} canManage={canManage} onToken={setToken("cloudflare")} />
        {status("cloudflare").connected && <ConnectorStats status={status("cloudflare")} />}
        <Tabs defaultValue="worker">
          <TabsList>
            <TabsTrigger value="worker">Worker</TabsTrigger>
            <TabsTrigger value="logpush">Logpush</TabsTrigger>
          </TabsList>
          <TabsContent value="worker" className="mt-3">
            <ol className="space-y-4">
              <Step n={1} title="Generate an ingest token above.">
                <p className="text-xs text-muted-foreground">It authenticates the Worker against this project.</p>
              </Step>
              <Step n={2} title="Download the Worker script (contains no secrets).">
                <Code>{`curl -o autoseo-bot-logger.js ${workerUrl}`}</Code>
                <a href={workerUrl} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
                  View script
                </a>
              </Step>
              <Step n={3} title="Deploy it and store the token as a secret.">
                <Code>{`npx wrangler deploy autoseo-bot-logger.js --name autoseo-bot-logger --compatibility-date 2026-01-01
npx wrangler secret put AUTOSEO_TOKEN --name autoseo-bot-logger
# paste: ${tok("cloudflare")}`}</Code>
                <p className="text-xs text-muted-foreground">Prefer the dashboard? Workers &amp; Pages → Create → paste the script, then Settings → Variables → add the secret AUTOSEO_TOKEN.</p>
              </Step>
              <Step n={4} title={`Route your site through the Worker: ${domain}/*`}>
                <p className="text-xs text-muted-foreground">
                  Cloudflare dashboard → your zone → Workers Routes → Add route <code className="rounded bg-muted px-1">{`${domain}/*`}</code> → worker autoseo-bot-logger. Responses are passed through unchanged; bot visits are reported in the background.
                </p>
              </Step>
            </ol>
          </TabsContent>
          <TabsContent value="logpush" className="mt-3 space-y-3">
            <p className="text-sm text-muted-foreground">Logpush (Enterprise plans) sends HTTP request logs to AutoSEO as gzip-compressed NDJSON. Only crawler requests are stored.</p>
            <div className="space-y-1.5">
              <p className="text-xs font-medium">HTTP destination</p>
              <Code>{logpushDest}</Code>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium">Fields (dataset http_requests)</p>
              <Code>{CF_FIELDS.join(",")}</Code>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium">Create the job via API</p>
              <Code>{logpushCurl}</Code>
            </div>
          </TabsContent>
        </Tabs>
      </section>

      {/* Akamai */}
      <section ref={(el) => void (refs.current.akamai = el)} className={cardCls("akamai")}>
        <ConnectorHeader provider="akamai" name="Akamai" subtitle="DataStream 2 → Custom HTTPS endpoint (JSON)." status={status("akamai")} />
        <TokenManager projectId={projectId} provider="akamai" status={status("akamai")} canManage={canManage} onToken={setToken("akamai")} />
        {status("akamai").connected && <ConnectorStats status={status("akamai")} />}
        <ol className="space-y-4">
          <Step n={1} title="In Akamai Control Center create a DataStream 2 stream for your property.">
            <p className="text-xs text-muted-foreground">Log format: JSON. Enable at least these data set fields:</p>
            <Code>{AKAMAI_FIELDS.join(", ")}</Code>
          </Step>
          <Step n={2} title="Destination: Custom HTTPS">
            <dl className="grid gap-2 text-xs sm:grid-cols-[140px_minmax(0,1fr)]">
              <dt className="text-muted-foreground">Endpoint URL</dt>
              <dd className="min-w-0">
                <Code>{endpoint}</Code>
              </dd>
              <dt className="text-muted-foreground">Custom header</dt>
              <dd className="min-w-0">
                <Code>{`Authorization: Bearer ${tok("akamai")}`}</Code>
              </dd>
              <dt className="text-muted-foreground">Authentication</dt>
              <dd>None (the header carries the token) · compression gzip allowed</dd>
            </dl>
          </Step>
          <Step n={3} title="Activate the stream — data appears within a few minutes." />
        </ol>
      </section>

      {/* Server logs / API */}
      <section ref={(el) => void (refs.current.server_logs = el)} className={cardCls("server_logs")}>
        <ConnectorHeader provider="server_logs" name="Server Logs / API" subtitle="Native — push NDJSON from nginx, Apache or any backend." status={status("server_logs")} />
        <TokenManager projectId={projectId} provider="server_logs" status={status("server_logs")} canManage={canManage} onToken={setToken("server_logs")} />
        {status("server_logs").connected && <ConnectorStats status={status("server_logs")} />}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="min-w-0 space-y-3">
            <div className="space-y-1.5">
              <p className="text-xs font-medium">Endpoint</p>
              <Code>{`POST ${endpoint}`}</Code>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium">Example</p>
              <Code>{curlExample}</Code>
            </div>
          </div>
          <div className="min-w-0 space-y-2 text-sm">
            <p className="text-xs font-medium">NDJSON fields (one JSON object per line)</p>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-xs">
                <tbody className="divide-y">
                  {[
                    ["timestamp", "ISO 8601 or unix s/ms", "required"],
                    ["user_agent", "Request User-Agent", "required"],
                    ["path", "Path + query (or full URL)", "required"],
                    ["ip", "Client IP (enables verification)", "recommended"],
                    ["status", "HTTP status code", "recommended"],
                    ["method, host, bytes", "Optional", ""],
                  ].map(([f, d, r]) => (
                    <tr key={f}>
                      <td className="px-2.5 py-1.5 font-mono">{f}</td>
                      <td className="px-2.5 py-1.5 text-muted-foreground">{d}</td>
                      <td className="px-2.5 py-1.5 text-right text-muted-foreground">{r}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              <li>Auth: <code>Authorization: Bearer fslg_…</code> · gzip bodies are detected automatically.</li>
              <li>Limits: 16 MB and 20 000 lines per request, 1 200 requests/min per token.</li>
              <li>Cloudflare Logpush and Akamai field names are accepted too; non-bot lines are ignored.</li>
              <li>Duplicates (same bot, timestamp, IP and path) are skipped. Response: <code>{"{success, received, botVisits, saved}"}</code>.</li>
            </ul>
          </div>
        </div>
        <Tabs defaultValue="nginx">
          <TabsList>
            <TabsTrigger value="nginx">nginx</TabsTrigger>
            <TabsTrigger value="vector">Vector</TabsTrigger>
            <TabsTrigger value="fluentbit">Fluent Bit</TabsTrigger>
          </TabsList>
          <TabsContent value="nginx" className="mt-3">
            <Code>{nginxFormat}</Code>
          </TabsContent>
          <TabsContent value="vector" className="mt-3">
            <Code>{vector}</Code>
          </TabsContent>
          <TabsContent value="fluentbit" className="mt-3">
            <Code>{fluentBit}</Code>
          </TabsContent>
        </Tabs>
      </section>

      {/* Coming soon */}
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          ["fastly", "Fastly", "Real-time log streaming (HTTPS endpoint)."],
          ["cloudfront", "AWS CloudFront", "Real-time logs via Kinesis."],
        ].map(([key, name, desc]) => (
          <section key={key} className="flex items-start gap-3 rounded-2xl border bg-card p-4 opacity-75 shadow-soft">
            <IntegrationLogo provider={key!} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">{name}</h3>
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  <Clock className="size-3" /> Coming soon
                </span>
              </div>
              <p className="text-sm text-muted-foreground">{desc} Until then, use the Server Logs API or upload log files.</p>
            </div>
          </section>
        ))}
      </div>

      {/* IP verification */}
      <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-soft sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="flex items-center gap-2 font-semibold tracking-tight">
              <ShieldCheck className="size-4 text-success" /> Crawler verification
            </h3>
            <p className="text-sm text-muted-foreground">
              Every bot request is checked against the IP ranges its operator publishes. Requests outside the ranges are flagged as spoofed. Lists refresh daily.
            </p>
          </div>
          {canManage && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await refreshIpRangesAction(projectId);
                  if (res.ok) toast.success("Refreshing IP range lists…");
                  else toast.error(res.error);
                })
              }
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Refresh lists
            </Button>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {ipRanges.map((r) => (
            <div key={r.key} className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs">
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {r.operator} · {r.bots.slice(0, 2).join(", ")}
                  {r.bots.length > 2 ? "…" : ""}
                </div>
                <div className="text-muted-foreground">
                  {r.prefixes ? `${formatNumber(r.prefixes)} ranges` : "not loaded"}
                  {r.fetchedAt && (
                    <>
                      {" "}
                      · <TimeAgo date={r.fetchedAt} />
                    </>
                  )}
                </div>
              </div>
              {r.error && !r.prefixes ? <AlertTriangle className="size-3.5 shrink-0 text-warning" /> : <ShieldCheck className="size-3.5 shrink-0 text-success" />}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
