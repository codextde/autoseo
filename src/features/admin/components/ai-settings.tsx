"use client";

import Link from "next/link";
import { Reorder, useDragControls } from "motion/react";
import { ArrowDown, ArrowUp, Bot, Brain, ExternalLink, GripVertical, KeyRound, Route, Sparkles } from "lucide-react";
import { Panel } from "@/components/app/page";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EngineIcon } from "@/components/app/engine-icon";
import { ENGINES, type EngineInfo } from "@/lib/engines";
import { cn } from "@/lib/utils";
import type { Settings } from "@/server/settings/registry";
import { NumberInput, Rows, SaveBar, SecretInput, SettingRow, SubHeading, TestButton, ToggleRow, useSettingsForm } from "./settings-kit";
import { testAiProviderAction, testLlmRoutingAction } from "../actions/tests";

type AiValues = Settings<"ai">;
type EngineValues = Settings<"engines">;
type FallbackProvider = AiValues["fallbackOrder"][number];

type ProviderMeta = {
  id: "anthropic" | "openai" | "openrouter" | "perplexity" | "gemini" | "xai" | "mistral" | "deepseek";
  name: string;
  keyField: keyof AiValues & string;
  modelField?: keyof AiValues & string;
  usedFor: string;
  keyUrl: string;
  color: string;
};

const PROVIDERS: ProviderMeta[] = [
  { id: "anthropic", name: "Anthropic", keyField: "anthropicApiKey", modelField: "anthropicModel", usedFor: "AI features fallback · Claude engine", keyUrl: "https://console.anthropic.com/settings/keys", color: "#d97757" },
  { id: "openai", name: "OpenAI", keyField: "openaiApiKey", modelField: "openaiModel", usedFor: "AI features fallback · ChatGPT engine", keyUrl: "https://platform.openai.com/api-keys", color: "#10a37f" },
  { id: "openrouter", name: "OpenRouter", keyField: "openrouterApiKey", modelField: "openrouterModel", usedFor: "AI features fallback (any model)", keyUrl: "https://openrouter.ai/settings/keys", color: "#6467f2" },
  { id: "perplexity", name: "Perplexity", keyField: "perplexityApiKey", usedFor: "Perplexity engine (Sonar API)", keyUrl: "https://www.perplexity.ai/account/api/keys", color: "#20808d" },
  { id: "gemini", name: "Google Gemini", keyField: "geminiApiKey", usedFor: "Gemini engine (Search grounding)", keyUrl: "https://aistudio.google.com/apikey", color: "#8e75ff" },
  { id: "xai", name: "xAI", keyField: "xaiApiKey", usedFor: "Grok engine (live search)", keyUrl: "https://console.x.ai", color: "#111111" },
  { id: "mistral", name: "Mistral AI", keyField: "mistralApiKey", usedFor: "Mistral engine", keyUrl: "https://console.mistral.ai/api-keys", color: "#fa520f" },
  { id: "deepseek", name: "DeepSeek", keyField: "deepseekApiKey", usedFor: "DeepSeek engine", keyUrl: "https://platform.deepseek.com/api_keys", color: "#4d6bfe" },
];

const FALLBACK_LABEL: Record<FallbackProvider, string> = { anthropic: "Anthropic", openai: "OpenAI", openrouter: "OpenRouter" };

const ENGINE_PROVIDER_LABEL = { auto: "Auto", dataforseo: "DataForSEO", api: "Direct API", agent: "Local agent", disabled: "Disabled" } as const;
type EngineProviderChoice = keyof typeof ENGINE_PROVIDER_LABEL;

function FallbackItem({
  value,
  index,
  total,
  configured,
  onMove,
}: {
  value: FallbackProvider;
  index: number;
  total: number;
  configured: boolean;
  onMove: (dir: -1 | 1) => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={value}
      dragListener={false}
      dragControls={controls}
      className="flex items-center gap-2 rounded-xl border bg-card p-2 pr-2.5 shadow-xs"
      whileDrag={{ scale: 1.02, boxShadow: "0 12px 32px -12px rgb(0 0 0 / 0.25)" }}
    >
      <button
        type="button"
        onPointerDown={(e) => controls.start(e)}
        className="cursor-grab touch-none rounded-md p-1 text-muted-foreground hover:bg-muted active:cursor-grabbing"
        aria-label="Drag to reorder"
      >
        <GripVertical className="size-4" />
      </button>
      <span className="flex size-6 items-center justify-center rounded-md bg-muted text-xs font-semibold tabular">{index + 1}</span>
      <span className="flex-1 text-sm font-medium">{FALLBACK_LABEL[value]}</span>
      {configured ? (
        <Badge variant="secondary" className="h-5 bg-success/12 text-[10px] text-success">
          Key set
        </Badge>
      ) : (
        <Badge variant="outline" className="h-5 text-[10px] text-muted-foreground">
          No key
        </Badge>
      )}
      <Button type="button" variant="ghost" size="icon" className="size-7" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">
        <ArrowUp className="size-3.5" />
      </Button>
      <Button type="button" variant="ghost" size="icon" className="size-7" disabled={index === total - 1} onClick={() => onMove(1)} aria-label="Move down">
        <ArrowDown className="size-3.5" />
      </Button>
    </Reorder.Item>
  );
}

export function AiSettings({
  ai,
  engines,
  dataForSeoConfigured,
  agentOnline,
  agentsEnabled,
}: {
  ai: { values: AiValues; secrets: Record<string, boolean> };
  engines: { values: EngineValues; secrets: Record<string, boolean> };
  dataForSeoConfigured: boolean;
  agentOnline: boolean;
  agentsEnabled: boolean;
}) {
  const a = useSettingsForm("ai", ai);
  const e = useSettingsForm("engines", engines);
  const v = a.values;

  const keySet = (field: string) => (a.secretEdits[field] !== undefined ? Boolean(a.secretEdits[field]) : Boolean(a.secrets[field]));

  const available = (engine: EngineInfo, p: Exclude<EngineProviderChoice, "auto" | "disabled">) => {
    if (!engine.providers.includes(p)) return { ok: false, why: "Not supported for this engine" };
    if (p === "dataforseo") return dataForSeoConfigured ? { ok: true, why: "" } : { ok: false, why: "Connect DataForSEO in Data Providers" };
    if (p === "api") return engine.apiKeySetting && keySet(engine.apiKeySetting) ? { ok: true, why: "" } : { ok: false, why: "Add the API key above" };
    return agentsEnabled ? { ok: true, why: agentOnline ? "" : "No agent online right now" } : { ok: false, why: "Local agents are disabled" };
  };

  const resolveAuto = (engine: EngineInfo) => engine.providers.find((p) => available(engine, p).ok) ?? null;

  const move = (index: number, dir: -1 | 1) => {
    const next = [...v.fallbackOrder];
    const [item] = next.splice(index, 1);
    next.splice(index + dir, 0, item!);
    a.set("fallbackOrder", next);
  };

  return (
    <div className="space-y-4">
      <Panel title="Routing" description="How AI work (analysis, suggestions, content, agent chat) is executed." icon={<Route className="size-4" />}>
        <Rows>
          <ToggleRow
            label="Prefer local agents"
            description={
              <>
                Send AI work to connected Claude Code / Codex agents first (uses their subscriptions — no API cost). Status:{" "}
                <span className={cn("font-medium", agentOnline ? "text-success" : "text-muted-foreground")}>
                  {agentOnline ? "agent online" : "no agent online"}
                </span>{" "}
                ·{" "}
                <Link href="/admin/agents" className="underline underline-offset-4">
                  Local agents
                </Link>
              </>
            }
            checked={v.preferLocalAgent}
            onCheckedChange={(x) => a.set("preferLocalAgent", x)}
          />
          <SettingRow label="Agent timeout" description="How long to wait for a local agent before falling back to API keys.">
            <NumberInput value={v.agentTimeoutSeconds} onChange={(x) => a.set("agentTimeoutSeconds", x)} min={10} max={3600} suffix="seconds" />
          </SettingRow>
          <SettingRow label="API fallback order" description="Tried top to bottom; providers without a key are skipped. Drag or use the arrows.">
            <Reorder.Group axis="y" values={v.fallbackOrder} onReorder={(next) => a.set("fallbackOrder", next)} className="space-y-1.5">
              {v.fallbackOrder.map((p, i) => (
                <FallbackItem
                  key={p}
                  value={p}
                  index={i}
                  total={v.fallbackOrder.length}
                  configured={keySet(`${p}ApiKey`)}
                  onMove={(dir) => move(i, dir)}
                />
              ))}
            </Reorder.Group>
          </SettingRow>
          <SettingRow label="End-to-end test" description={a.dirty ? "Save first — tests use the saved configuration." : "Runs a tiny prompt through the router."}>
            <div className="flex flex-wrap gap-3">
              <TestButton run={() => testLlmRoutingAction("api")} label={<><KeyRound className="size-3.5" /> Test API fallback</>} disabled={a.dirty} />
              <TestButton run={() => testLlmRoutingAction("agent")} label={<><Bot className="size-3.5" /> Test local agent</>} disabled={a.dirty || !agentsEnabled} />
            </div>
          </SettingRow>
        </Rows>
      </Panel>

      <Panel title="API keys" description="Keys are encrypted at rest and never sent back to the browser." icon={<KeyRound className="size-4" />} contentClassName="p-3 sm:p-4">
        <div className="grid gap-3 lg:grid-cols-2">
          {PROVIDERS.map((p) => {
            const set = Boolean(a.secrets[p.keyField]);
            return (
              <div key={p.id} className="flex flex-col gap-3 rounded-xl border bg-background/50 p-3.5">
                <div className="flex items-start gap-2.5">
                  <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{p.name}</span>
                      {set && (
                        <Badge variant="secondary" className="h-5 bg-success/12 text-[10px] text-success">
                          Connected
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{p.usedFor}</p>
                  </div>
                  <a href={p.keyUrl} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    Get key <ExternalLink className="size-3" />
                  </a>
                </div>
                <SecretInput isSet={set} value={a.secretEdits[p.keyField]} onChange={(x) => a.setSecret(p.keyField, x)} />
                {p.modelField && (
                  <div className="flex items-center gap-2">
                    <span className="w-12 shrink-0 text-xs text-muted-foreground">Model</span>
                    <Input
                      value={String(v[p.modelField] ?? "")}
                      onChange={(ev) => a.set(p.modelField!, ev.target.value as never)}
                      className="h-8 font-mono text-[13px]"
                    />
                  </div>
                )}
                <TestButton
                  run={() => testAiProviderAction(p.id)}
                  label="Test"
                  disabled={!set || a.secretEdits[p.keyField] !== undefined || (p.modelField ? v[p.modelField] !== ai.values[p.modelField] : false)}
                  disabledReason={!set ? "Save a key first" : "Save your changes first"}
                />
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel
        title="AI engines"
        description="Which backend answers tracked prompts for each engine. Auto picks the first available option."
        icon={<Sparkles className="size-4" />}
        contentClassName="p-0 sm:p-0"
      >
        <ul className="divide-y">
          {ENGINES.map((engine) => {
            const cfg = e.values[engine.id as keyof EngineValues];
            const auto = resolveAuto(engine);
            return (
              <li key={engine.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <EngineIcon id={engine.id} size="md" withTooltip={false} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{engine.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {cfg.provider === "auto"
                        ? auto
                          ? `Auto → ${ENGINE_PROVIDER_LABEL[auto]}`
                          : "Auto → no backend available yet"
                        : cfg.provider === "disabled"
                          ? "Not tracked"
                          : available(engine, cfg.provider).why || ENGINE_PROVIDER_LABEL[cfg.provider]}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={cfg.provider}
                    onValueChange={(x) => e.set(engine.id as keyof EngineValues, { ...cfg, provider: x as EngineProviderChoice })}
                  >
                    <SelectTrigger size="sm" className="h-8 w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(ENGINE_PROVIDER_LABEL) as EngineProviderChoice[]).map((p) => {
                        const state = p === "auto" || p === "disabled" ? { ok: true, why: "" } : available(engine, p);
                        const unsupported = p !== "auto" && p !== "disabled" && !engine.providers.includes(p);
                        return (
                          <SelectItem key={p} value={p} disabled={unsupported}>
                            <span className="flex items-center gap-2">
                              {ENGINE_PROVIDER_LABEL[p]}
                              {!unsupported && !state.ok && <span className="text-[10px] text-warning">setup needed</span>}
                              {unsupported && <span className="text-[10px] text-muted-foreground">n/a</span>}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <Input
                    value={cfg.model}
                    onChange={(ev) => e.set(engine.id as keyof EngineValues, { ...cfg, model: ev.target.value })}
                    placeholder="Default model"
                    className="h-8 w-40 font-mono text-xs"
                    disabled={cfg.provider === "disabled" || cfg.provider === "dataforseo"}
                    aria-label={`${engine.name} model override`}
                  />
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex items-start gap-2 border-t px-4 py-3 text-xs text-muted-foreground sm:px-5">
          <Brain className="mt-0.5 size-3.5 shrink-0" />
          Projects choose which engines they track in Project settings → Tracking. Disabled engines are hidden everywhere.
        </div>
      </Panel>

      <SubHeading className="sr-only">Save</SubHeading>
      <SaveBar
        dirty={a.dirty || e.dirty}
        saving={a.saving || e.saving}
        count={a.changedCount + e.changedCount}
        onReset={() => {
          a.reset();
          e.reset();
        }}
        onSave={async () => {
          if (a.dirty && !(await a.save())) return;
          if (e.dirty) await e.save();
        }}
      />
    </div>
  );
}
