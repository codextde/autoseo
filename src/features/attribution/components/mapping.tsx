"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Check, ChevronsUpDown, FlaskConical, Loader2, Pause, Play, RefreshCw, Send, Trash2, Workflow } from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/app/page";
import { EmptyState } from "@/components/app/empty-state";
import { ConfirmButton, StatusBadge, TimeAgo } from "@/components/app/misc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useUrlState } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import { MAPPING_PRESETS, PROVIDERS } from "@/server/attribution/providers";
import type { FieldMapping, MappingTarget, WorkflowKind } from "@/server/attribution/types";
import type { WorkflowDTO } from "@/server/attribution/workflows";
import { deleteWorkflowAction, generateWebhookTokenAction, previewWorkflowAction, saveWorkflowAction, sendTestPayloadAction } from "../actions";
import { CodeBlock, SecretReveal } from "./code-block";
import { ChannelBadge, SourceIcon, providerName } from "./shared";

const TARGETS: Array<{ key: MappingTarget; label: string; hint?: string }> = [
  { key: "channel", label: "Channel / answer", hint: "The “How did you hear about us?” answer — required for responses" },
  { key: "channelDetail", label: "AI assistant", hint: "Optional second answer (ChatGPT, Perplexity …)" },
  { key: "freetext", label: "Free-text answer" },
  { key: "email", label: "Email", hint: "SHA-256 hashed on arrival, never stored" },
  { key: "externalId", label: "Respondent / record ID", hint: "Also used to de-duplicate retries" },
  { key: "name", label: "Name" },
  { key: "dealValue", label: "Deal value" },
  { key: "dealCurrency", label: "Currency" },
  { key: "transactionId", label: "Order / transaction ID", hint: "Strongest merge key — required for conversion workflows" },
  { key: "formId", label: "Form ID" },
  { key: "formName", label: "Form name" },
  { key: "pageUrl", label: "Page URL" },
  { key: "occurredAt", label: "Date" },
];

const EXAMPLES: Record<string, string> = {
  raw: JSON.stringify(
    { channelId: "ChatGPT", respondentEmail: "lead@example.com", respondentExternalId: "crm-123", dealValue: 1200, dealCurrency: "EUR", formId: "contact", pageUrl: "https://example.com/contact" },
    null,
    2,
  ),
  order: JSON.stringify({ transactionId: "SO-1001", dealValue: 499.0, dealCurrency: "EUR", respondentEmail: "lead@example.com" }, null, 2),
  typeform: JSON.stringify(
    {
      event_id: "01HX",
      event_type: "form_response",
      form_response: {
        form_id: "lT4Z3j",
        token: "a3a12ec67a1365927098a606107fac15",
        submitted_at: new Date().toISOString(),
        definition: {
          id: "lT4Z3j",
          title: "Contact Form",
          fields: [
            { id: "f1", ref: "email", title: "Your email", type: "email" },
            { id: "f2", ref: "hdyhau", title: "How did you hear about us?", type: "multiple_choice" },
          ],
        },
        answers: [
          { type: "email", email: "lead@example.com", field: { id: "f1", ref: "email", type: "email" } },
          { type: "choice", choice: { label: "Perplexity" }, field: { id: "f2", ref: "hdyhau", type: "multiple_choice" } },
        ],
      },
    },
    null,
    2,
  ),
};

function PathPicker({
  fields,
  value,
  onChange,
  disabled,
}: {
  fields: WorkflowDTO["fields"];
  value: { path?: string; constant?: string } | undefined;
  onChange: (v: { path?: string; constant?: string } | undefined) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const current = value?.path ?? (value?.constant ? `= "${value.constant}"` : "");
  const sample = value?.path ? fields.find((f) => f.path === value.path)?.sample : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} className="h-auto min-h-8 w-full justify-between gap-2 bg-background px-2.5 py-1.5 text-left text-xs font-normal">
          <span className="min-w-0">
            <span className={cn("block truncate font-mono", !current && "font-sans text-muted-foreground")}>{current || "Not mapped"}</span>
            {sample && <span className="block truncate text-[11px] text-muted-foreground">e.g. {sample}</span>}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(420px,calc(100vw-24px))] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search fields…" className="h-9" />
          <CommandList className="max-h-72">
            <CommandEmpty>No field found.</CommandEmpty>
            <CommandGroup heading="Sample payload">
              {value && (
                <CommandItem
                  value="__clear"
                  onSelect={() => {
                    onChange(undefined);
                    setOpen(false);
                  }}
                  className="text-muted-foreground"
                >
                  Clear mapping
                </CommandItem>
              )}
              {fields.map((f) => (
                <CommandItem
                  key={f.path}
                  value={`${f.path} ${f.sample}`}
                  onSelect={() => {
                    onChange({ path: f.path });
                    setOpen(false);
                  }}
                  className="flex-col items-start gap-0"
                >
                  <span className="flex w-full items-center gap-1.5 font-mono text-[11px]">
                    {value?.path === f.path && <Check className="size-3" />}
                    <span className="truncate">{f.path}</span>
                  </span>
                  <span className="w-full truncate text-[11px] text-muted-foreground">{f.sample}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        <div className="space-y-2 border-t p-2">
          <div className="flex gap-1.5">
            <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Custom path, e.g. data.fields[label=Source].answer" className="h-7 font-mono text-[11px]" />
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              disabled={!custom.trim()}
              onClick={() => {
                onChange({ path: custom.trim() });
                setCustom("");
                setOpen(false);
              }}
            >
              Path
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              disabled={!custom.trim()}
              onClick={() => {
                onChange({ constant: custom.trim() });
                setCustom("");
                setOpen(false);
              }}
            >
              Constant
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">Paths support nesting (a.b.c), indexes ([0]), selectors ([field.ref=abc]) and [*] for the first non-empty element.</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

type Preview = { mapped: Record<string, unknown>; result: string; error: string | null; channel: { channel: string; detail: string | null } | null };

function WorkflowEditor({ projectId, workflow, canManage, onClose }: { projectId: string; workflow: WorkflowDTO; canManage: boolean; onClose: () => void }) {
  const [mapping, setMapping] = useState<FieldMapping>(workflow.mapping);
  const [kind, setKind] = useState<WorkflowKind>(workflow.kind);
  const [name, setName] = useState(workflow.name);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, start] = useTransition();

  const runPreview = (m = mapping, k = kind) =>
    start(async () => {
      const r = await previewWorkflowAction(projectId, workflow.id, { mapping: m, kind: k });
      if (r.ok) setPreview(r.data as Preview);
    });

  useEffect(() => {
    runPreview(workflow.mapping, workflow.kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow.id]);

  const save = (status?: "active" | "paused") =>
    start(async () => {
      const r = await saveWorkflowAction(projectId, workflow.id, { name, kind, mapping, status: status ?? (workflow.status === "paused" ? "paused" : "active") });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(r.data.reprocessing ? "Mapping saved — pending payloads are being processed" : r.data.status === "paused" ? "Workflow paused" : "Mapping saved — future payloads parse automatically");
      onClose();
    });

  const remove = async () => {
    const r = await deleteWorkflowAction(projectId, workflow.id);
    if (!r.ok) toast.error(r.error);
    else {
      toast.success("Workflow deleted");
      onClose();
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <div className="space-y-1">
          <Label className="text-xs">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage} className="h-8 text-sm" maxLength={120} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Stores payloads as</Label>
          <Select
            value={kind}
            onValueChange={(v) => {
              setKind(v as WorkflowKind);
              runPreview(mapping, v as WorkflowKind);
            }}
            disabled={!canManage}
          >
            <SelectTrigger className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto (response if an answer is mapped)</SelectItem>
              <SelectItem value="response">Responses</SelectItem>
              <SelectItem value="conversion">Conversions (orders / deals)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {canManage && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/40 p-2.5 text-xs">
          <span className="text-muted-foreground">Apply preset:</span>
          {MAPPING_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className="rounded-full border bg-background px-2 py-0.5 hover:bg-muted"
              onClick={() => {
                const next = { ...mapping, ...p.mapping };
                setMapping(next);
                runPreview(next);
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {workflow.fields.length === 0 && <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">No sample payload stored yet — send a test webhook first.</p>}

      <div className="divide-y rounded-xl border">
        {TARGETS.map((t) => (
          <div key={t.key} className="grid gap-2 p-3 sm:grid-cols-[180px_1fr] sm:items-center">
            <div>
              <div className="text-sm font-medium">{t.label}</div>
              {t.hint && <div className="text-[11px] text-muted-foreground">{t.hint}</div>}
            </div>
            <PathPicker
              fields={workflow.fields}
              value={mapping[t.key]}
              disabled={!canManage}
              onChange={(v) => {
                const next = { ...mapping };
                if (v) next[t.key] = v;
                else delete next[t.key];
                setMapping(next);
                runPreview(next);
              }}
            />
          </div>
        ))}
      </div>

      <section className="space-y-2">
        <h4 className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          <FlaskConical className="size-3.5" /> Preview (sample payload)
          {busy && <Loader2 className="size-3 animate-spin" />}
        </h4>
        {preview ? (
          <div className="space-y-2 rounded-xl border bg-muted/20 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={preview.result === "invalid" ? "destructive" : "secondary"}>
                {preview.result === "response" ? "Stored as response" : preview.result === "conversion" ? "Stored as conversion" : "Not parseable yet"}
              </Badge>
              {preview.channel && <ChannelBadge channel={preview.channel.channel} detail={preview.channel.detail} />}
            </div>
            {preview.error && <p className="text-xs text-destructive">{preview.error}</p>}
            <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1 text-xs">
              {Object.entries(preview.mapped)
                .filter(([k]) => k !== "metadata")
                .map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{TARGETS.find((t) => t.key === k)?.label ?? k}</dt>
                    <dd className="truncate font-mono">{String(v)}</dd>
                  </div>
                ))}
            </dl>
            <p className="text-[11px] text-muted-foreground">Emails in the stored sample are masked; real payloads are hashed on arrival.</p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Map a field to see how the sample parses.</p>
        )}
      </section>

      {canManage && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <ConfirmButton title="Delete this workflow?" description="Future payloads of this shape create a new workflow. Pending payloads are discarded." destructive confirmLabel="Delete" onConfirm={remove}>
            <Button variant="ghost" size="sm" className="gap-1.5 text-destructive">
              <Trash2 className="size-3.5" /> Delete
            </Button>
          </ConfirmButton>
          <div className="flex gap-2">
            {workflow.status === "active" && (
              <Button variant="outline" size="sm" className="gap-1.5" disabled={busy} onClick={() => save("paused")}>
                <Pause className="size-3.5" /> Pause
              </Button>
            )}
            <Button size="sm" className="gap-1.5" disabled={busy} onClick={() => save("active")}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              {workflow.status === "active" ? "Save mapping" : "Save & activate"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function WebhookEndpointCard({
  projectId,
  canManage,
  endpoint,
  tokenPrefix,
  tokenCreatedAt,
}: {
  projectId: string;
  canManage: boolean;
  endpoint: string;
  tokenPrefix: string | null;
  tokenCreatedAt: string | null;
}) {
  const [revealed, setRevealed] = useState<{ url: string; token: string } | null>(null);
  const [busy, start] = useTransition();
  const generate = () =>
    start(async () => {
      const r = await generateWebhookTokenAction(projectId);
      if (!r.ok) toast.error(r.error);
      else setRevealed(r.data);
    });
  const shown = revealed?.url ?? `${endpoint}?token=${tokenPrefix ? `${tokenPrefix}…` : "YOUR_TOKEN"}`;
  const curl = `curl -X POST '${shown}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"channelId":"ChatGPT","respondentEmail":"lead@example.com","dealValue":1200,"dealCurrency":"EUR"}'`;
  return (
    <Panel
      title="Project webhook"
      description="One endpoint for CRMs, form tools and automations. Rate limit: 120 requests per minute."
      actions={
        canManage && (
          <ConfirmButton
            title={tokenPrefix ? "Rotate the webhook token?" : "Generate webhook URL?"}
            description={tokenPrefix ? "The current token stops working immediately. Integration-specific URLs are not affected." : "The full URL is shown once — copy it right away."}
            confirmLabel={tokenPrefix ? "Rotate" : "Generate"}
            onConfirm={generate}
          >
            <Button size="sm" variant={tokenPrefix ? "outline" : "default"} className="gap-1.5" disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              {tokenPrefix ? "Rotate token" : "Generate URL"}
            </Button>
          </ConfirmButton>
        )
      }
    >
      <div className="space-y-3">
        {revealed ? (
          <SecretReveal title="Copy the URL now — the token is shown only once (we store a SHA-256 hash)." items={[{ label: "Webhook URL", value: revealed.url }]} />
        ) : (
          <p className="text-xs text-muted-foreground">
            {tokenPrefix ? (
              <>
                Active token <code className="rounded bg-muted px-1 font-mono">{tokenPrefix}…</code> · created <TimeAgo date={tokenCreatedAt} />
              </>
            ) : (
              "No project token yet — generate one (or connect an integration, which gets its own URL)."
            )}
          </p>
        )}
        <CodeBlock code={curl} label="Example request" maxHeight={160} />
      </div>
    </Panel>
  );
}

function TestPayloadCard({ projectId, onCreated }: { projectId: string; onCreated: (workflowId: string) => void }) {
  const [json, setJson] = useState(EXAMPLES.typeform!);
  const [source, setSource] = useState("auto");
  const [result, setResult] = useState<{ status: number; body: Record<string, unknown> } | null>(null);
  const [busy, start] = useTransition();
  const send = () =>
    start(async () => {
      const r = await sendTestPayloadAction(projectId, json, source === "auto" ? null : source);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setResult(r.data);
      const wf = r.data.body.workflowId;
      if (typeof wf === "string") {
        toast.info("Workflow created — map the fields once");
        onCreated(wf);
      } else if (r.data.status < 300) toast.success("Payload stored");
      else toast.error(String(r.data.body.error ?? "Payload rejected"));
    });
  return (
    <Panel title="Send a test webhook" description="Paste a real payload from your tool. Unknown shapes create a Field Mapping workflow you map once.">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Examples:</span>
          <button type="button" className="rounded-full border px-2 py-0.5 hover:bg-muted" onClick={() => setJson(EXAMPLES.typeform!)}>
            Typeform
          </button>
          <button type="button" className="rounded-full border px-2 py-0.5 hover:bg-muted" onClick={() => setJson(EXAMPLES.raw!)}>
            Our schema
          </button>
          <button type="button" className="rounded-full border px-2 py-0.5 hover:bg-muted" onClick={() => setJson(EXAMPLES.order!)}>
            Order only
          </button>
          <div className="ml-auto">
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger size="sm" className="h-7 min-w-40 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Source: detect automatically</SelectItem>
                {PROVIDERS.filter((p) => p.kind === "webhook" || p.kind === "signed_webhook").map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    Source: {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Textarea value={json} onChange={(e) => setJson(e.target.value)} rows={10} className="font-mono text-[11px]" spellCheck={false} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          {result ? (
            <span className={cn("text-xs", result.status < 300 ? "text-success" : "text-destructive")}>
              HTTP {result.status} · {JSON.stringify(result.body)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Runs the same pipeline as the real endpoint (without the token check).</span>
          )}
          <Button size="sm" className="gap-1.5" onClick={send} disabled={busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Send test
          </Button>
        </div>
      </div>
    </Panel>
  );
}

export function FieldMappingTab({
  projectId,
  canManage,
  workflows,
  endpoint,
  tokenPrefix,
  tokenCreatedAt,
}: {
  projectId: string;
  canManage: boolean;
  workflows: WorkflowDTO[];
  endpoint: string;
  tokenPrefix: string | null;
  tokenCreatedAt: string | null;
}) {
  const [openId, setOpenId] = useUrlState("wf", "");
  const open = useMemo(() => workflows.find((w) => w.id === openId) ?? null, [workflows, openId]);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        {canManage && <TestPayloadCard projectId={projectId} onCreated={(id) => setOpenId(id)} />}
        <WebhookEndpointCard projectId={projectId} canManage={canManage} endpoint={endpoint} tokenPrefix={tokenPrefix} tokenCreatedAt={tokenCreatedAt} />
      </div>

      <Panel title="Workflows" description="One workflow per incoming payload shape. Map fields once — future payloads parse automatically." contentClassName="p-0">
        {workflows.length === 0 ? (
          <EmptyState
            icon={Workflow}
            title="No workflows yet"
            description="Send a test webhook (above) or point any tool to your webhook URL. Payloads that don't match our schema create a workflow here."
          />
        ) : (
          <ul className="divide-y">
            {workflows.map((w) => (
              <li key={w.id}>
                <button type="button" onClick={() => setOpenId(w.id)} className="flex w-full flex-col gap-2 p-4 text-left hover:bg-muted/40 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <SourceIcon provider={w.provider} size="md" />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{w.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {providerName(w.provider)} · last payload <TimeAgo date={w.lastPayloadAt} />
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {w.pendingCount > 0 && (
                      <Badge variant="outline" className="h-5 text-[10px] text-warning">
                        {w.pendingCount} waiting
                      </Badge>
                    )}
                    <span className="text-muted-foreground tabular">
                      {w.processedCount} parsed · {w.failedCount} failed
                    </span>
                    <StatusBadge
                      status={w.status === "active" ? "active" : w.status === "paused" ? "disabled" : "pending"}
                      label={w.status === "active" ? "Active" : w.status === "paused" ? "Paused" : "Needs mapping"}
                    />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Field mapping</SheetTitle>
            <SheetDescription>Map incoming fields (incl. nested paths like Typeform answers) to the attribution schema.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-8">{open && <WorkflowEditor key={open.id} projectId={projectId} workflow={open} canManage={canManage} onClose={() => setOpenId(null)} />}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
