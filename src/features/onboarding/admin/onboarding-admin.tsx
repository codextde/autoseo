"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Reorder, useDragControls } from "motion/react";
import { ArrowDown, ArrowUp, ExternalLink, GripVertical, Lock, Monitor, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/app/page";
import { EngineIcon } from "@/components/app/engine-icon";
import {
  NumberInput,
  Rows,
  SaveBar,
  SettingRow,
  ToggleRow,
  useSettingsForm,
} from "@/features/admin/components/settings-kit";
import { ENGINES } from "@/lib/engines";
import { cn } from "@/lib/utils";
import { STEP_LABELS, translator } from "../i18n";
import { ALL_WIZARD_STEPS, type Locale, type OnboardingPageData, type WizardConfig, type WizardStep } from "../types";
import { CountryPicker, LanguageSelect } from "../components/market-fields";
import { OnboardingWizard } from "../components/wizard";
import { PreviewFrame } from "./preview-frame";

type OnboardingValues = {
  enabled: boolean;
  steps: WizardStep[];
  defaultCountry: string;
  defaultLanguage: string;
  defaultEngines: string[];
  suggestedPromptCount: number;
  suggestedCompetitorCount: number;
  autoGeneratePrompts: boolean;
  autoDiscoverCompetitors: boolean;
  defaultTrackingFrequency: "daily" | "weekly" | "monthly";
  welcomeTitle: string;
  welcomeText: string;
  welcomeTitleDe: string;
  welcomeTextDe: string;
  allowPitchProjects: boolean;
  defaultPitchDays: number;
  showTourButton: boolean;
  showDemoButton: boolean;
};

const LOCKED: WizardStep[] = ["website", "market"];
const STEP_HINTS: Record<WizardStep, string> = {
  website: "Domain, project name, workspace and pitch option",
  market: "Tracking country and language",
  brand: "AI-filled brand profile (description, industry, aliases)",
  competitors: "AI-discovered competitors, editable",
  prompts: "AI-generated prompts grouped by topic",
  engines: "Which AI engines to track and how often",
  integrations: "Search Console, Bing, Cloudflare, local agent",
  invite: "Invite teammates to the new project",
};

function StepRow({
  step,
  enabled,
  onToggle,
  onMove,
  index,
  count,
}: {
  step: WizardStep;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  onMove: (dir: -1 | 1) => void;
  index: number;
  count: number;
}) {
  const controls = useDragControls();
  const locked = LOCKED.includes(step);
  return (
    <Reorder.Item
      value={step}
      dragListener={false}
      dragControls={controls}
      className={cn("flex items-center gap-2 rounded-xl border bg-card px-2 py-2 shadow-xs", !enabled && "bg-muted/40")}
      whileDrag={{ scale: 1.02, boxShadow: "0 12px 28px -12px rgb(0 0 0 / 0.3)" }}
    >
      {locked ? (
        <span className="flex size-7 shrink-0 items-center justify-center text-muted-foreground" title="Always first">
          <Lock className="size-3.5" />
        </span>
      ) : (
        <button
          type="button"
          className="flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted active:cursor-grabbing"
          onPointerDown={(e) => controls.start(e)}
          aria-label={`Drag ${STEP_LABELS.en[step]}`}
        >
          <GripVertical className="size-4" />
        </button>
      )}
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular">{index + 1}</span>
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm font-medium", !enabled && "text-muted-foreground")}>{STEP_LABELS.en[step]}</p>
        <p className="truncate text-[11px] text-muted-foreground">{STEP_HINTS[step]}</p>
      </div>
      {!locked && (
        <div className="flex shrink-0 items-center">
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Move up" disabled={index <= LOCKED.length} onClick={() => onMove(-1)}>
            <ArrowUp />
          </Button>
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Move down" disabled={index >= count - 1} onClick={() => onMove(1)}>
            <ArrowDown />
          </Button>
        </div>
      )}
      <Switch checked={enabled} disabled={locked} onCheckedChange={onToggle} aria-label={`Enable ${STEP_LABELS.en[step]}`} />
    </Reorder.Item>
  );
}

export function OnboardingAdmin({
  initial,
  base,
  branding,
}: {
  initial: { values: OnboardingValues; secrets: Record<string, boolean> };
  base: OnboardingPageData;
  branding: { showProductTour: boolean; demoBookingUrl: string };
}) {
  const form = useSettingsForm<OnboardingValues>("onboarding", initial);
  const v = form.values;

  // Order of disabled steps (enabled ones follow the saved order; disabled ones are listed after them).
  const [ghost, setGhost] = useState<WizardStep[]>(() => ALL_WIZARD_STEPS.filter((s) => !LOCKED.includes(s)));
  const order: WizardStep[] = [
    ...LOCKED,
    ...v.steps.filter((s) => !LOCKED.includes(s)),
    ...ghost.filter((s) => !LOCKED.includes(s) && !v.steps.includes(s)),
  ];

  const applyOrder = (next: WizardStep[], enabledSet?: Set<WizardStep>) => {
    const fixed = [...LOCKED, ...next.filter((s) => !LOCKED.includes(s))];
    setGhost(fixed.filter((s) => !LOCKED.includes(s)));
    const en = enabledSet ?? new Set(v.steps);
    form.set("steps", fixed.filter((s) => LOCKED.includes(s) || en.has(s)));
  };
  const toggleStep = (step: WizardStep, on: boolean) => {
    const en = new Set(v.steps);
    if (on) en.add(step);
    else en.delete(step);
    applyOrder(order, en);
  };
  const move = (step: WizardStep, dir: -1 | 1) => {
    const i = order.indexOf(step);
    const j = i + dir;
    if (j < LOCKED.length || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j]!, next[i]!];
    applyOrder(next);
  };

  /* ───────── live preview ───────── */
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [locale, setLocale] = useState<Locale>("en");
  const [previewStep, setPreviewStep] = useState(0);
  const previewData = useMemo<OnboardingPageData>(() => {
    const steps: WizardStep[] = v.enabled ? [...LOCKED, ...v.steps.filter((s) => !LOCKED.includes(s))] : [...LOCKED];
    const config: WizardConfig = {
      ...base.config,
      enabled: v.enabled,
      steps,
      defaultCountry: v.defaultCountry,
      defaultLanguage: v.defaultLanguage,
      defaultEngines: v.defaultEngines,
      suggestedPromptCount: v.suggestedPromptCount,
      suggestedCompetitorCount: v.suggestedCompetitorCount,
      autoGeneratePrompts: v.enabled && v.autoGeneratePrompts,
      autoDiscoverCompetitors: v.enabled && v.autoDiscoverCompetitors,
      defaultTrackingFrequency: v.defaultTrackingFrequency,
      welcomeTitle: v.welcomeTitle,
      welcomeText: v.welcomeText,
      welcomeTitleDe: v.welcomeTitleDe,
      welcomeTextDe: v.welcomeTextDe,
      allowPitchProjects: v.allowPitchProjects,
      defaultPitchDays: v.defaultPitchDays,
      showTourButton: v.showTourButton && branding.showProductTour,
      showDemoButton: v.showDemoButton && Boolean(branding.demoBookingUrl),
    };
    return {
      ...base,
      config,
      hasProjects: false,
      tourHref: config.showTourButton ? (base.tourHref ?? "/") : null,
      workspaces: base.workspaces.length ? base.workspaces : [{ id: "preview", name: "Workspace", canInvite: true }],
    };
  }, [v, base, branding]);
  const stepCount = previewData.config.steps.length + 1;
  const safeStep = Math.min(previewStep, stepCount - 1);
  const previewSteps = [...previewData.config.steps, "create"] as const;
  const t = translator("en");

  return (
    <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
      <div className="min-w-0 space-y-4">
        <Panel title="Wizard" description="The guided setup new users see at /onboarding (also used for additional projects).">
          <Rows>
            <ToggleRow
              label="Guided onboarding"
              description="When off, the wizard only asks for website and market — no AI suggestions."
              checked={v.enabled}
              onCheckedChange={(x) => form.set("enabled", x)}
            />
          </Rows>
        </Panel>

        <Panel
          title="Steps"
          description="Enable, disable and reorder the steps. Website and market always come first; the review step is always last."
          actions={<span className="text-xs text-muted-foreground tabular">{v.steps.length + 1} steps incl. review</span>}
          className={cn(!v.enabled && "opacity-60")}
        >
          <Reorder.Group axis="y" values={order} onReorder={(next) => applyOrder(next as WizardStep[])} className="space-y-1.5">
            {order.map((step, i) => (
              <StepRow
                key={step}
                step={step}
                index={i}
                count={order.length}
                enabled={LOCKED.includes(step) || v.steps.includes(step)}
                onToggle={(on) => toggleStep(step, on)}
                onMove={(dir) => move(step, dir)}
              />
            ))}
          </Reorder.Group>
        </Panel>

        <Panel title="Defaults" description="Pre-selected values for new projects — users can change them in the wizard.">
          <Rows>
            <SettingRow label="Default market">
              <CountryPicker value={v.defaultCountry} onChange={(iso) => form.set("defaultCountry", iso)} />
            </SettingRow>
            <SettingRow label="Default language">
              <LanguageSelect value={v.defaultLanguage} country={v.defaultCountry} onChange={(code) => form.set("defaultLanguage", code)} />
            </SettingRow>
            <SettingRow label="Default AI engines" description="Engines without a provider are saved and start tracking once one is connected.">
              <div className="flex flex-wrap gap-1.5">
                {ENGINES.map((e) => {
                  const on = v.defaultEngines.includes(e.id);
                  const a = base.engines.find((x) => x.id === e.id);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      aria-pressed={on}
                      title={a?.hint}
                      onClick={() =>
                        form.set("defaultEngines", on ? v.defaultEngines.filter((x) => x !== e.id) : [...v.defaultEngines, e.id])
                      }
                      className={cn(
                        "flex items-center gap-1.5 rounded-full border py-1 pr-2.5 pl-1 text-xs font-medium transition-colors",
                        on ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-muted",
                      )}
                    >
                      <EngineIcon id={e.id} size="xs" withTooltip={false} active={on || Boolean(a?.available)} />
                      {e.shortName}
                      {a && !a.available && <span className={cn("size-1.5 rounded-full", on ? "bg-background/50" : "bg-muted-foreground/40")} />}
                    </button>
                  );
                })}
              </div>
            </SettingRow>
            <SettingRow label="Default tracking frequency">
              <div className="grid max-w-sm grid-cols-3 gap-1 rounded-xl bg-muted p-1">
                {(["daily", "weekly", "monthly"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => form.set("defaultTrackingFrequency", f)}
                    className={cn(
                      "rounded-lg py-1.5 text-xs font-medium capitalize transition-colors",
                      v.defaultTrackingFrequency === f ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </SettingRow>
          </Rows>
        </Panel>

        <Panel
          title="AI suggestions"
          description={
            base.aiAvailable ? (
              "Suggestions run on an online local agent or the configured API providers."
            ) : (
              <>
                No AI provider is available right now — users will enter everything manually.{" "}
                <Link href="/admin/ai" className="font-medium text-brand hover:underline">
                  Configure AI providers
                </Link>
              </>
            )
          }
        >
          <Rows>
            <ToggleRow
              label="Discover competitors automatically"
              description="Suggest competitors based on the brand profile and market."
              checked={v.autoDiscoverCompetitors}
              onCheckedChange={(x) => form.set("autoDiscoverCompetitors", x)}
            />
            <SettingRow label="Suggested competitors" description="How many competitors to suggest (0–30).">
              <NumberInput value={v.suggestedCompetitorCount} min={0} max={30} onChange={(n) => form.set("suggestedCompetitorCount", n)} />
            </SettingRow>
            <ToggleRow
              label="Generate prompts automatically"
              description="Write prompts customers would ask AI assistants, grouped by topic."
              checked={v.autoGeneratePrompts}
              onCheckedChange={(x) => form.set("autoGeneratePrompts", x)}
            />
            <SettingRow label="Suggested prompts" description="How many prompts to generate (0–200).">
              <NumberInput value={v.suggestedPromptCount} min={0} max={200} onChange={(n) => form.set("suggestedPromptCount", n)} />
            </SettingRow>
          </Rows>
        </Panel>

        <Panel title="Welcome text" description="Shown on the first step for users without projects. Leave the German fields empty to use the built-in translation.">
          <Rows>
            <SettingRow label="Title" badge={<Badge variant="secondary" className="h-4 text-[10px]">EN</Badge>} htmlFor="ob-title">
              <Input id="ob-title" value={v.welcomeTitle} maxLength={120} onChange={(e) => form.set("welcomeTitle", e.target.value)} />
            </SettingRow>
            <SettingRow label="Text" badge={<Badge variant="secondary" className="h-4 text-[10px]">EN</Badge>} htmlFor="ob-text">
              <Textarea id="ob-text" rows={2} maxLength={400} value={v.welcomeText} onChange={(e) => form.set("welcomeText", e.target.value)} />
            </SettingRow>
            <SettingRow label="Title" badge={<Badge variant="secondary" className="h-4 text-[10px]">DE</Badge>} htmlFor="ob-title-de">
              <Input
                id="ob-title-de"
                value={v.welcomeTitleDe}
                maxLength={120}
                placeholder={translator("de")("welcomeTitle")}
                onChange={(e) => form.set("welcomeTitleDe", e.target.value)}
              />
            </SettingRow>
            <SettingRow label="Text" badge={<Badge variant="secondary" className="h-4 text-[10px]">DE</Badge>} htmlFor="ob-text-de">
              <Textarea
                id="ob-text-de"
                rows={2}
                maxLength={400}
                value={v.welcomeTextDe}
                placeholder={translator("de")("welcomeText")}
                onChange={(e) => form.set("welcomeTextDe", e.target.value)}
              />
            </SettingRow>
          </Rows>
        </Panel>

        <Panel title="Pitch projects & side buttons">
          <Rows>
            <ToggleRow
              label="Allow pitch projects"
              description="Temporary projects (e.g. for sales pitches) that are archived automatically when they expire."
              checked={v.allowPitchProjects}
              onCheckedChange={(x) => form.set("allowPitchProjects", x)}
            />
            <SettingRow label="Default pitch duration">
              <NumberInput value={v.defaultPitchDays} min={1} max={365} suffix="days" onChange={(n) => form.set("defaultPitchDays", n)} />
            </SettingRow>
            <ToggleRow
              label="“Product tour” button"
              description={branding.showProductTour ? "Shown next to the wizard for users who already have a project." : "The product tour is disabled in Admin → Branding."}
              checked={v.showTourButton}
              onCheckedChange={(x) => form.set("showTourButton", x)}
            />
            <ToggleRow
              label="“Book demo” button"
              description={
                branding.demoBookingUrl ? (
                  `Links to ${branding.demoBookingUrl}`
                ) : (
                  <>
                    Set a demo booking URL in{" "}
                    <Link href="/admin/branding" className="font-medium text-brand hover:underline">
                      Admin → Branding
                    </Link>{" "}
                    to show it.
                  </>
                )
              }
              checked={v.showDemoButton}
              onCheckedChange={(x) => form.set("showDemoButton", x)}
            />
          </Rows>
        </Panel>
        <SaveBar dirty={form.dirty} saving={form.saving} onSave={() => void form.save()} onReset={form.reset} count={form.changedCount} />
      </div>

      <div className="min-w-0">
        <div className="space-y-3 2xl:sticky 2xl:top-20">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">Live preview</h2>
              <p className="text-xs text-muted-foreground">Reflects unsaved changes · sample data</p>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="flex rounded-lg bg-muted p-0.5">
                {(["en", "de"] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLocale(l)}
                    className={cn("rounded-md px-2 py-1 text-[11px] font-medium uppercase", locale === l ? "bg-background shadow-xs" : "text-muted-foreground")}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <div className="flex rounded-lg bg-muted p-0.5">
                <button
                  type="button"
                  aria-label="Desktop preview"
                  onClick={() => setDevice("desktop")}
                  className={cn("rounded-md p-1.5", device === "desktop" ? "bg-background shadow-xs" : "text-muted-foreground")}
                >
                  <Monitor className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Mobile preview"
                  onClick={() => setDevice("mobile")}
                  className={cn("rounded-md p-1.5", device === "mobile" ? "bg-background shadow-xs" : "text-muted-foreground")}
                >
                  <Smartphone className="size-3.5" />
                </button>
              </div>
              <Button asChild variant="outline" size="sm" className="h-7">
                <Link href="/onboarding" target="_blank">
                  Open <ExternalLink className="size-3" />
                </Link>
              </Button>
            </div>
          </div>
          <div className="scrollbar-none -mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
            {previewSteps.map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={() => setPreviewStep(i)}
                className={cn(
                  "flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium whitespace-nowrap transition-colors",
                  i === safeStep ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="tabular opacity-60">{i + 1}</span> {STEP_LABELS[locale][s]}
              </button>
            ))}
          </div>
          <PreviewFrame device={device} width={device === "desktop" ? 1280 : 390} height={device === "desktop" ? 800 : 780}>
            <OnboardingWizard data={previewData} preview previewStep={safeStep} previewLocale={locale} />
          </PreviewFrame>
          <p className="text-center text-[11px] text-muted-foreground">{t("previewBadge")}</p>
        </div>
      </div>
    </div>
  );
}
