"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Check, Loader2, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Panel } from "@/components/app/page";
import { cn } from "@/lib/utils";
import { AI_DETAILS, DEFAULT_SURVEY } from "@/server/attribution/channels";
import { AI_DETAIL_IDS, type SurveyConfig } from "@/server/attribution/types";
import { saveSurveyAction } from "../actions";

/* ───────────────────────────── Live preview ───────────────────────────── */

function contrastOn(hex: string) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return "#ffffff";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!) > 0.45 ? "#111111" : "#ffffff";
}

export function SurveyPreview({ survey, lang, className }: { survey: SurveyConfig; lang: "en" | "de"; className?: string }) {
  const [step, setStep] = useState<"q" | "ai" | "other" | "done">("q");
  const [other, setOther] = useState("");
  const channels = survey.channels.filter((c) => c.enabled);
  const t = (en: string, de: string) => (lang === "de" ? de : en);
  const style = { background: survey.backgroundColor, color: survey.textColor };
  const pos =
    survey.position === "center"
      ? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      : survey.position === "bottom-left"
        ? "left-3 bottom-3"
        : "right-3 bottom-3";
  return (
    <div className={cn("relative h-[360px] overflow-hidden rounded-xl border bg-[repeating-linear-gradient(135deg,var(--muted)_0_8px,transparent_8px_16px)]", className)}>
      <div className="flex items-center gap-1.5 border-b bg-background/80 px-3 py-2 backdrop-blur">
        <span className="size-2 rounded-full bg-destructive/60" />
        <span className="size-2 rounded-full bg-warning/60" />
        <span className="size-2 rounded-full bg-success/60" />
        <span className="ml-2 truncate rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">your-website.com</span>
      </div>
      <div
        className={cn("absolute w-[min(340px,calc(100%-24px))] rounded-2xl border border-black/10 p-4 text-[13px] shadow-xl", pos)}
        style={style}
        role="dialog"
        aria-label="Survey preview"
      >
        <button type="button" className="absolute top-2 right-2 rounded-md p-1 opacity-60 hover:opacity-100" onClick={() => setStep("q")} aria-label="Close preview">
          <X className="size-3.5" />
        </button>
        {step === "done" ? (
          <p className="pr-6 font-semibold">{t(survey.thankYouEn, survey.thankYouDe)}</p>
        ) : step === "ai" ? (
          <>
            <p className="mb-3 pr-6 font-semibold">{t("Which AI assistant?", "Welcher KI-Assistent?")}</p>
            <div className="grid grid-cols-2 gap-1.5">
              {survey.aiOptions.map((id) => (
                <button key={id} type="button" onClick={() => setStep("done")} className="rounded-lg border border-current/20 px-2.5 py-1.5 text-left hover:bg-black/5">
                  {AI_DETAILS[id].label}
                </button>
              ))}
            </div>
            <div className="mt-2 text-right">
              <button type="button" className="px-2 py-1 opacity-60" onClick={() => setStep("done")}>
                {t("Skip", "Überspringen")}
              </button>
            </div>
          </>
        ) : step === "other" ? (
          <>
            <p className="mb-2 pr-6 font-semibold">{t(survey.questionEn, survey.questionDe)}</p>
            <input
              value={other}
              onChange={(e) => setOther(e.target.value)}
              placeholder={t(survey.otherPlaceholderEn, survey.otherPlaceholderDe)}
              className="w-full rounded-lg border border-current/25 bg-transparent px-2.5 py-1.5 outline-none"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" className="px-2 py-1 opacity-60" onClick={() => setStep("q")}>
                {t("Back", "Zurück")}
              </button>
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 font-semibold"
                style={{ background: survey.primaryColor, color: contrastOn(survey.primaryColor) }}
                onClick={() => setStep("done")}
              >
                {t("Send", "Senden")}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mb-3 pr-6 font-semibold">{t(survey.questionEn, survey.questionDe)}</p>
            <div className="grid grid-cols-2 gap-1.5">
              {channels.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="rounded-lg border border-current/20 px-2.5 py-1.5 text-left transition-colors hover:bg-black/5"
                  style={{ borderColor: undefined }}
                  onClick={() => setStep(c.id === "other" ? "other" : c.id === "ai_search" && survey.aiDetails && survey.aiOptions.length ? "ai" : "done")}
                >
                  {lang === "de" ? c.labelDe : c.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────── Editor ───────────────────────────── */

function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs font-medium">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ToggleRow({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-start justify-between gap-4 py-2">
      <span>
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </label>
  );
}

function ColorField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#111111"}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="h-8 w-10 cursor-pointer rounded-md border bg-transparent p-0.5"
          aria-label={label}
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="h-8 font-mono text-xs" maxLength={7} />
      </div>
    </Field>
  );
}

export function SurveyEditor({
  projectId,
  initial,
  canManage,
  compact,
  onSaved,
}: {
  projectId: string;
  initial: SurveyConfig;
  canManage: boolean;
  compact?: boolean;
  onSaved?: () => void;
}) {
  const [s, setS] = useState<SurveyConfig>(initial);
  const [lang, setLang] = useState<"en" | "de">("en");
  const [exclude, setExclude] = useState(initial.excludePaths.join("\n"));
  const [saving, start] = useTransition();
  const dirty = JSON.stringify({ ...s, excludePaths: exclude.split("\n").map((x) => x.trim()).filter(Boolean) }) !== JSON.stringify(initial);
  const set = <K extends keyof SurveyConfig>(k: K, v: SurveyConfig[K]) => setS((p) => ({ ...p, [k]: v }));
  const ro = !canManage;

  const moveChannel = (i: number, dir: -1 | 1) => {
    const next = [...s.channels];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    set("channels", next);
  };

  const save = () =>
    start(async () => {
      const r = await saveSurveyAction(projectId, { ...s, excludePaths: exclude.split("\n").map((x) => x.trim()).filter(Boolean) });
      if (!r.ok) toast.error(r.error);
      else {
        toast.success("Survey saved — the snippet picks it up within 5 minutes");
        onSaved?.();
      }
    });

  return (
    <div className={cn("grid gap-4", compact ? "lg:grid-cols-[1fr_340px]" : "lg:grid-cols-[1fr_380px]")}>
      <div className="min-w-0 space-y-4">
        <Panel title="Question" description="Shown in the popup — pick EN/DE per visitor language automatically or force one language.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Question (English)">
              <Input value={s.questionEn} onChange={(e) => set("questionEn", e.target.value)} disabled={ro} maxLength={200} />
            </Field>
            <Field label="Frage (Deutsch)">
              <Input value={s.questionDe} onChange={(e) => set("questionDe", e.target.value)} disabled={ro} maxLength={200} />
            </Field>
            <Field label="Language">
              <Select value={s.language} onValueChange={(v) => set("language", v as SurveyConfig["language"])} disabled={ro}>
                <SelectTrigger className="h-8 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Automatic (page / browser language)</SelectItem>
                  <SelectItem value="en">Always English</SelectItem>
                  <SelectItem value="de">Always German</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Thank you (EN)">
                <Input value={s.thankYouEn} onChange={(e) => set("thankYouEn", e.target.value)} disabled={ro} maxLength={120} />
              </Field>
              <Field label="Danke (DE)">
                <Input value={s.thankYouDe} onChange={(e) => set("thankYouDe", e.target.value)} disabled={ro} maxLength={120} />
              </Field>
            </div>
          </div>
        </Panel>

        <Panel title="Channels" description="Answer options in display order. “Other” asks for free text; answers mentioning ChatGPT, Claude, Perplexity … still count as AI Search.">
          <ul className="space-y-2">
            {s.channels.map((c, i) => (
              <li key={c.id} className="flex flex-col gap-2 rounded-xl border p-2.5 sm:flex-row sm:items-center">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={c.enabled}
                    disabled={ro}
                    onCheckedChange={(v) => set("channels", s.channels.map((x, j) => (j === i ? { ...x, enabled: v } : x)))}
                    aria-label={`Show ${c.label}`}
                  />
                  <span className="w-20 shrink-0 font-mono text-[11px] text-muted-foreground">{c.id}</span>
                </div>
                <div className="grid flex-1 grid-cols-2 gap-2">
                  <Input
                    value={c.label}
                    disabled={ro}
                    className="h-8 text-xs"
                    aria-label="Label (EN)"
                    onChange={(e) => set("channels", s.channels.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                  />
                  <Input
                    value={c.labelDe}
                    disabled={ro}
                    className="h-8 text-xs"
                    aria-label="Label (DE)"
                    onChange={(e) => set("channels", s.channels.map((x, j) => (j === i ? { ...x, labelDe: e.target.value } : x)))}
                  />
                </div>
                <div className="flex gap-1 self-end sm:self-auto">
                  <Button variant="ghost" size="icon" className="size-7" disabled={ro || i === 0} onClick={() => moveChannel(i, -1)} aria-label="Move up">
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-7" disabled={ro || i === s.channels.length - 1} onClick={() => moveChannel(i, 1)} aria-label="Move down">
                    <ArrowDown className="size-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4 border-t pt-3">
            <ToggleRow label="Ask which AI assistant" hint="After “AI Search”, show a second step with the options below." checked={s.aiDetails} onChange={(v) => set("aiDetails", v)} disabled={ro} />
            {s.aiDetails && (
              <div className="mt-1 flex flex-wrap gap-2">
                {AI_DETAIL_IDS.map((id) => {
                  const on = s.aiOptions.includes(id);
                  return (
                    <label key={id} className={cn("flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", on && "border-foreground bg-muted")}>
                      <Checkbox
                        checked={on}
                        disabled={ro}
                        className="size-3.5"
                        onCheckedChange={(v) => set("aiOptions", v ? [...s.aiOptions, id] : s.aiOptions.filter((x) => x !== id))}
                      />
                      {AI_DETAILS[id].label}
                    </label>
                  );
                })}
              </div>
            )}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="“Other” placeholder (EN)">
                <Input value={s.otherPlaceholderEn} onChange={(e) => set("otherPlaceholderEn", e.target.value)} disabled={ro} maxLength={80} />
              </Field>
              <Field label="“Other” placeholder (DE)">
                <Input value={s.otherPlaceholderDe} onChange={(e) => set("otherPlaceholderDe", e.target.value)} disabled={ro} maxLength={80} />
              </Field>
            </div>
          </div>
        </Panel>

        <Panel title="When to ask" description="The snippet never shows the popup when it captured an existing “How did you hear about us?” field.">
          <div className="divide-y">
            <ToggleRow label="Survey popup enabled" checked={s.enabled} onChange={(v) => set("enabled", v)} disabled={ro} />
            <ToggleRow label="After form submits" hint="Leads: shows right after a form without the question is submitted (also across page navigations)." checked={s.triggers.formSubmit} onChange={(v) => set("triggers", { ...s.triggers, formSubmit: v })} disabled={ro} />
            <ToggleRow label="After purchases" hint="When a GA/Meta purchase event or trackConversion() is detected on the page." checked={s.triggers.purchase} onChange={(v) => set("triggers", { ...s.triggers, purchase: v })} disabled={ro} />
            <div className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
              <span>
                <span className="block text-sm">On page load</span>
                <span className="block text-xs text-muted-foreground">Ask every new visitor after a delay (use sparingly).</span>
              </span>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={600}
                  value={s.triggers.pageLoadDelaySec}
                  disabled={ro || !s.triggers.pageLoad}
                  onChange={(e) => set("triggers", { ...s.triggers, pageLoadDelaySec: Math.max(0, Math.min(600, Number(e.target.value) || 0)) })}
                  className="h-8 w-20 text-xs"
                  aria-label="Delay in seconds"
                />
                <span className="text-xs text-muted-foreground">sec</span>
                <Switch checked={s.triggers.pageLoad} onCheckedChange={(v) => set("triggers", { ...s.triggers, pageLoad: v })} disabled={ro} />
              </div>
            </div>
            <ToggleRow label="Ask once per visitor" hint="Stored in localStorage (no cookies). Answered or dismissed visitors are never asked again." checked={s.askOnce} onChange={(v) => set("askOnce", v)} disabled={ro} />
            <ToggleRow label="Detect existing questions" hint="Capture answers of “How did you hear about us?” / “Wie bist du auf uns aufmerksam geworden?” fields in your forms." checked={s.detectExistingQuestions} onChange={(v) => set("detectExistingQuestions", v)} disabled={ro} />
            <ToggleRow label="Capture conversions passively" hint="GA/Google Ads purchase & generate_lead, Meta Pixel Purchase & Lead — deduplicated by transaction id." checked={s.captureConversions} onChange={(v) => set("captureConversions", v)} disabled={ro} />
          </div>
          <Field label="Never show on these paths" hint="One path prefix per line, e.g. /account or /checkout." className="mt-3">
            <Textarea value={exclude} onChange={(e) => setExclude(e.target.value)} disabled={ro} rows={3} className="font-mono text-xs" placeholder="/account" />
          </Field>
        </Panel>

        <Panel title="Look & feel">
          <div className="grid gap-3 sm:grid-cols-3">
            <ColorField label="Primary / button" value={s.primaryColor} onChange={(v) => set("primaryColor", v)} disabled={ro} />
            <ColorField label="Background" value={s.backgroundColor} onChange={(v) => set("backgroundColor", v)} disabled={ro} />
            <ColorField label="Text" value={s.textColor} onChange={(v) => set("textColor", v)} disabled={ro} />
            <Field label="Position">
              <Select value={s.position} onValueChange={(v) => set("position", v as SurveyConfig["position"])} disabled={ro}>
                <SelectTrigger className="h-8 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bottom-right">Bottom right</SelectItem>
                  <SelectItem value="bottom-left">Bottom left</SelectItem>
                  <SelectItem value="center">Center</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </Panel>
      </div>

      <div className="space-y-3 lg:sticky lg:top-20 lg:self-start">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Live preview</span>
          <ToggleGroup type="single" size="sm" variant="outline" spacing={0} value={lang} onValueChange={(v) => v && setLang(v as "en" | "de")}>
            <ToggleGroupItem value="en" className="px-2.5 text-xs">
              EN
            </ToggleGroupItem>
            <ToggleGroupItem value="de" className="px-2.5 text-xs">
              DE
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <SurveyPreview survey={s} lang={lang} />
        {canManage && (
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground"
              onClick={() => {
                setS({ ...DEFAULT_SURVEY });
                setExclude("");
              }}
            >
              <RotateCcw className="size-3.5" /> Defaults
            </Button>
            <Button size="sm" className="gap-1.5" onClick={save} disabled={saving || !dirty}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              {dirty ? "Save survey" : "Saved"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
