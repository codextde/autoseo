"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ExternalLink, Globe2, Loader2, Plus, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { PageHeader, Panel } from "@/components/app/page";
import { EngineIcon } from "@/components/app/engine-icon";
import { Favicon } from "@/components/app/favicon";
import { EmptyState } from "@/components/app/empty-state";
import { TimeAgo } from "@/components/app/misc";
import { useUrlPatch, useUrlState } from "@/hooks/use-url-state";
import { getCountry } from "@/lib/countries";
import { cn } from "@/lib/utils";
import { HowWeGetDataDialog } from "../shared/info-dialog";
import { ProviderNotice } from "../shared/bits";
import { LookupHistory } from "./lookup-history";
import { useLookupPoll } from "./use-lookup-poll";
import { MarkdownAnswer } from "./markdown-answer";
import { runPromptExplorerAction, trackPromptAction } from "../../actions/lookup";
import { EXPLORER_COUNTRIES, EXPLORER_MODELS, type ExplorerAnswer, type ExplorerModel, type ExplorerParams, type ExplorerResult, type LookupHistoryItem } from "../../types";

const MAX = 500;

export type PromptExplorerViewProps = {
  projectId: string;
  history: LookupHistoryItem[];
  providers: { dataforseo: boolean; llm: boolean };
  canRun: boolean;
  canTrack: boolean;
  defaults: { brand: string; country: string };
  current: {
    id: string;
    status: "queued" | "running" | "done" | "failed";
    error: string | null;
    costUsd: number;
    createdAt: string;
    params: ExplorerParams;
    result: ExplorerResult | null;
  } | null;
};

function AnswerCard({ a, brand }: { a: ExplorerAnswer; brand: string | null }) {
  const meta = EXPLORER_MODELS.find((m) => m.id === a.model)!;
  const [showThinking, setShowThinking] = useState(false);
  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-soft" style={{ borderLeft: `3px solid ${meta.accent}` }}>
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <EngineIcon id={meta.engine} size="sm" withTooltip={false} className={a.model === "autoseo" ? "!bg-brand" : undefined} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{meta.label}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {a.modelName ?? "—"}
            {a.model === "autoseo" && a.provider ? ` · via ${a.provider === "agent" ? "local agent" : a.provider}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {a.webSearch && a.status === "ok" && (
            <Badge variant="outline" className="h-5 gap-1 text-[10px]">
              <Globe2 className="size-3" /> web search
            </Badge>
          )}
          {a.outputTokens != null && <span className="text-[11px] text-muted-foreground tabular">{a.outputTokens.toLocaleString("en-US")} tok</span>}
          {a.costUsd > 0 && <span className="text-[11px] text-muted-foreground tabular">${a.costUsd.toFixed(4)}</span>}
          {brand && a.status === "ok" && (
            <Badge className={cn("h-5 gap-1 text-[10px]", a.brandMentioned ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>
              {a.brandMentioned ? <Check className="size-3" /> : <X className="size-3" />}
              {a.brandMentioned ? "Mentioned" : "Not mentioned"}
            </Badge>
          )}
        </div>
      </header>
      <div className="flex-1 space-y-4 p-4">
        {a.status === "error" ? (
          <div className="flex items-start gap-2 rounded-lg bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{a.error ?? "This model is temporarily unavailable. Please try again."}</span>
          </div>
        ) : (
          <>
            {a.thinking && (
              <div>
                <button type="button" onClick={() => setShowThinking((v) => !v)} className="text-xs font-medium text-muted-foreground hover:text-foreground">
                  {showThinking ? "Hide" : "Show"} thinking
                </button>
                {showThinking && <p className="mt-1.5 max-h-60 overflow-y-auto rounded-lg bg-muted/60 p-3 text-xs whitespace-pre-wrap text-muted-foreground">{a.thinking}</p>}
              </div>
            )}
            {a.text ? <MarkdownAnswer text={a.text} brand={brand} /> : <p className="text-sm text-muted-foreground">Empty answer.</p>}
            {a.citations.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Citations ({a.citations.length})</p>
                <ol className="space-y-1">
                  {a.citations.map((c, i) => (
                    <li key={c.url} className={cn("flex items-center gap-2 rounded-md px-1.5 py-1 text-xs", c.matchedBrand && "bg-warning/15")}>
                      <span className="w-4 text-muted-foreground tabular">{i + 1}</span>
                      <Favicon domain={c.domain} />
                      <a href={c.url} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 flex-1 truncate hover:underline">
                        {c.title || c.domain}
                      </a>
                      <span className="hidden shrink-0 text-muted-foreground sm:inline">{c.domain}</span>
                      <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {a.fanOutQueries.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Related queries the model considered</p>
                <div className="flex flex-wrap gap-1">
                  {a.fanOutQueries.map((q) => (
                    <span key={q} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px]">
                      {q}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </article>
  );
}

export function PromptExplorerView({ projectId, history, providers, canRun, canTrack, defaults, current }: PromptExplorerViewProps) {
  const router = useRouter();
  const [qParam] = useUrlState("q", "");
  const [hbParam] = useUrlState("hb", "");
  const [modelsParam] = useUrlState("models", "");
  const [webParam] = useUrlState("web", "");
  const [ccParam] = useUrlState("cc", "");
  const [patch] = useUrlPatch();
  const defaultModels: ExplorerModel[] = providers.dataforseo ? ["chat_gpt", "claude", "gemini", "perplexity"] : providers.llm ? ["autoseo"] : [];
  const [prompt, setPrompt] = useState((qParam || current?.params.prompt || "").slice(0, MAX));
  const [brand, setBrand] = useState(hbParam || current?.params.highlightBrand || defaults.brand);
  const [models, setModels] = useState<ExplorerModel[]>(
    modelsParam ? (modelsParam.split(",").filter((m) => EXPLORER_MODELS.some((x) => x.id === m)) as ExplorerModel[]) : (current?.params.models ?? defaultModels),
  );
  const [web, setWeb] = useState(webParam ? webParam !== "false" : (current?.params.webSearch ?? true));
  const [country, setCountry] = useState(ccParam || current?.params.country || defaults.country);
  const [pending, start] = useTransition();
  const [tracking, startTrack] = useTransition();
  const elapsed = useLookupPoll(projectId, current?.id ?? null, current?.status ?? null);
  const running = current && (current.status === "queued" || current.status === "running");

  const toggleModel = (m: ExplorerModel) => setModels((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));
  const available = (m: (typeof EXPLORER_MODELS)[number]) => (m.provider === "dataforseo" ? providers.dataforseo : providers.llm);

  const run = () =>
    start(async () => {
      const chosen = models.filter((m) => available(EXPLORER_MODELS.find((x) => x.id === m)!));
      if (!chosen.length) return void toast.error("Select at least one available model.");
      const res = await runPromptExplorerAction(projectId, { prompt: prompt.trim(), models: chosen, webSearch: web, country, highlightBrand: brand.trim() || null });
      if (!res.ok) return void toast.error(res.error);
      patch({ id: res.data.id, q: prompt.trim(), hb: brand.trim() || null, models: chosen.join(","), web: web ? null : "false", cc: country });
      router.refresh();
    });

  const track = (text: string) =>
    startTrack(async () => {
      const res = await trackPromptAction(projectId, text);
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.data.status === "duplicate" ? "This prompt is already tracked." : "Prompt added to the tracker.");
    });

  const answers = current?.result?.answers ?? [];
  const mentionedCount = answers.filter((a) => a.brandMentioned).length;

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader
        title="Prompt Explorer"
        description="Ask ChatGPT, Claude, Gemini and Perplexity the same prompt side-by-side — see what they answer, which sources they cite and whether your brand is mentioned."
        actions={
          <HowWeGetDataDialog
            title="How we get this data"
            steps={[
              { title: "Live model answers", body: "ChatGPT, Claude, Gemini and Perplexity are queried live through DataForSEO’s AI Optimization LLM Responses API (optionally with web search in the chosen country)." },
              { title: "Local agent / API", body: "“Local agent / API” runs the prompt through your connected Claude Code / Codex agent or configured AI API key." },
              { title: "Brand check", body: "We highlight your brand in the answers and mark citations whose URL or title contains it." },
            ]}
            footer="Cost per model: DataForSEO fee ($0.0006) + the model's token cost (usually $0.005–0.05). Charged to your DataForSEO account."
          />
        }
      />

      {!providers.dataforseo && !providers.llm && (
        <ProviderNotice title="No provider configured" href="/admin/data" linkLabel="Data Providers">
          Connect DataForSEO (ChatGPT, Claude, Gemini, Perplexity) in Admin → Data Providers, or a local agent / AI API key in Admin → AI Providers.
        </ProviderNotice>
      )}

      <Panel contentClassName="p-4 sm:p-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
          className="space-y-4"
        >
          <div className="space-y-1">
            <div className="flex items-end justify-between">
              <Label htmlFor="pe-prompt">Prompt</Label>
              <span className={cn("text-[11px] tabular", prompt.length > MAX - 30 ? "text-warning" : "text-muted-foreground")}>
                {prompt.length}/{MAX}
              </span>
            </div>
            <Textarea
              id="pe-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value.slice(0, MAX))}
              rows={3}
              placeholder="e.g. Which balcony power plant with storage is the best value in 2026?"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run();
              }}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-1.5">
              <Label>Models</Label>
              <div className="flex flex-wrap gap-1.5">
                {EXPLORER_MODELS.map((m) => {
                  const ok = available(m);
                  const on = models.includes(m.id) && ok;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      disabled={!ok}
                      onClick={() => toggleModel(m.id)}
                      title={ok ? undefined : m.provider === "dataforseo" ? "Requires DataForSEO" : "Requires a local agent or AI API key"}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                        on ? "border-foreground bg-foreground text-background" : "bg-background text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <EngineIcon id={m.engine} size="xs" withTooltip={false} className={m.id === "autoseo" ? "!bg-brand" : undefined} />
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pe-brand">Highlight brand</Label>
                <Input id="pe-brand" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Optional" maxLength={120} />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-2">
                  <Checkbox checked={web} onCheckedChange={(v) => setWeb(!!v)} /> Web search
                </Label>
                <NativeSelect value={country} onChange={(e) => setCountry(e.target.value)} disabled={!web} className="w-full">
                  {EXPLORER_COUNTRIES.map((c) => (
                    <NativeSelectOption key={c} value={c}>
                      {getCountry(c === "GB" ? "UK" : c)?.name ?? c}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            </div>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">{canRun ? "⌘/Ctrl + Enter to run · each model is billed separately" : "Running prompts requires the “Run paid SEO research” permission."}</p>
            <Button type="submit" disabled={!canRun || pending || !!running || prompt.trim().length < 3 || !models.some((m) => available(EXPLORER_MODELS.find((x) => x.id === m)!))}>
              {pending || running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Run prompt
            </Button>
          </div>
        </form>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-3">
          {!current ? (
            <Panel>
              <EmptyState icon={Sparkles} title="Run a prompt" description="Answers from every selected model appear side-by-side with citations, related queries and a brand check." />
            </Panel>
          ) : running ? (
            <Panel>
              <div className="flex flex-col items-center gap-2 py-14 text-center">
                <Loader2 className="size-6 animate-spin text-brand" />
                <p className="text-sm font-medium">Asking {current.params.models.length} model{current.params.models.length === 1 ? "" : "s"}…</p>
                <p className="text-xs text-muted-foreground">Answers with web search can take up to a minute · {elapsed}s</p>
              </div>
            </Panel>
          ) : current.status === "failed" && !answers.length ? (
            <Panel>
              <EmptyState icon={AlertTriangle} title="The prompt could not be run" description={current.error ?? "Unknown error"} />
            </Panel>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2.5 text-sm shadow-soft">
                <p className="min-w-0 flex-1 truncate font-medium">“{current.params.prompt}”</p>
                {current.params.highlightBrand && (
                  <span className="text-xs text-muted-foreground">
                    <b className="text-foreground tabular">
                      {mentionedCount}/{answers.filter((a) => a.status === "ok").length}
                    </b>{" "}
                    models mention {current.params.highlightBrand}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  <TimeAgo date={current.createdAt} /> · ${current.costUsd.toFixed(3)}
                </span>
                {canTrack && (
                  <Button size="sm" variant="outline" onClick={() => track(current.params.prompt)} disabled={tracking}>
                    {tracking ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Track this prompt
                  </Button>
                )}
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                {answers.map((a) => (
                  <AnswerCard key={a.model} a={a} brand={current.params.highlightBrand} />
                ))}
              </div>
            </>
          )}
        </div>
        <LookupHistory
          projectId={projectId}
          items={history}
          activeId={current?.id ?? null}
          canDelete={canRun}
          title="History"
          onSelect={(h) => {
            const p = h.params as unknown as ExplorerParams;
            patch({ id: h.id, q: p.prompt, hb: p.highlightBrand || null, models: p.models.join(","), web: p.webSearch ? null : "false", cc: p.country });
          }}
          renderSub={(h) => {
            const p = h.params as unknown as ExplorerParams;
            return (
              <span className="inline-flex items-center gap-0.5">
                {p.models?.map((m) => {
                  const meta = EXPLORER_MODELS.find((x) => x.id === m);
                  return meta ? <EngineIcon key={m} id={meta.engine} size="xs" withTooltip={false} className={m === "autoseo" ? "!bg-brand" : undefined} /> : null;
                })}
              </span>
            );
          }}
        />
      </div>
    </div>
  );
}
