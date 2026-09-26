"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertCircle,
  BarChart3,
  Bot,
  Check,
  Cloud,
  Globe,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Favicon } from "@/components/app/favicon";
import { EngineIcon } from "@/components/app/engine-icon";
import { ChipsInput } from "@/features/admin/components/settings-kit";
import { ENGINES } from "@/lib/engines";
import { flagEmoji, getCountry, LANGUAGES } from "@/lib/countries";
import { cn } from "@/lib/utils";
import type { Translate } from "../i18n";
import type { Locale, OnboardingPageData, WizardDraft, WizardStepOrCreate } from "../types";
import { cleanDomainInput, emailAllowed, isDomain, isEmail, nameFromDomain, uid } from "../lib";
import { CountryPicker, LanguageSelect } from "./market-fields";
import { createOnboardingDemoAction } from "../actions";

export type AiState = { status: "idle" | "loading" | "done" | "unavailable" | "failed" | "dismissed"; message?: string };

export type StepProps = {
  draft: WizardDraft;
  update: (patch: Partial<WizardDraft> | ((d: WizardDraft) => Partial<WizardDraft>)) => void;
  t: Translate;
  locale: Locale;
  data: OnboardingPageData;
  preview?: boolean;
  showErrors: boolean;
};

export function StepHeader({ title, text, badge }: { title: React.ReactNode; text?: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <div className="mb-7 space-y-2">
      {badge}
      <h1 className="text-[26px] leading-tight font-semibold tracking-tight text-balance @2xl/onb:text-3xl">{title}</h1>
      {text && <p className="text-[15px] leading-relaxed text-muted-foreground text-balance">{text}</p>}
    </div>
  );
}

function FieldError({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.p
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="flex items-center gap-1 text-xs text-destructive"
        >
          <AlertCircle className="size-3" /> {children}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

/** Loading / unavailable / failed banner for AI-assisted steps. */
export function AiBanner({
  state,
  loadingText,
  t,
  isAdmin,
  onDismiss,
  onRetry,
}: {
  state: AiState;
  loadingText: string;
  t: Translate;
  isAdmin: boolean;
  onDismiss?: () => void;
  onRetry?: () => void;
}) {
  if (state.status === "loading") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-5 flex items-center gap-3 rounded-2xl border bg-card p-3.5 shadow-soft"
      >
        <span className="relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <Sparkles className="size-4" />
          <span className="absolute inset-0 animate-ping rounded-xl bg-brand/15" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="shimmer-text truncate text-sm font-medium">{loadingText}</p>
          <p className="text-xs text-muted-foreground">{t("ai.loadingHint")}</p>
        </div>
        {onDismiss && (
          <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0" onClick={onDismiss}>
            {t("ai.manual")}
          </Button>
        )}
      </motion.div>
    );
  }
  if (state.status === "unavailable" || state.status === "failed") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-5 flex items-start gap-3 rounded-2xl border border-dashed bg-muted/40 p-3.5"
      >
        <Sparkles className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1 text-sm">
          <p className="text-muted-foreground">{state.status === "unavailable" ? t("ai.unavailable") : t("ai.failed")}</p>
          {isAdmin && state.status === "unavailable" && (
            <Link href="/admin/ai" className="inline-flex text-xs font-medium text-brand hover:underline">
              {t("ai.configure")} →
            </Link>
          )}
        </div>
        {onRetry && state.status === "failed" && (
          <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0" onClick={onRetry}>
            <RefreshCw className="size-3.5" />
          </Button>
        )}
      </motion.div>
    );
  }
  return null;
}

/* ─────────────────────────────── Website ─────────────────────────────── */

const PITCH_DAYS = [7, 14, 30, 60, 90];

/** Lets first-time users explore a demo project before configuring AI providers or DataForSEO. */
function DemoShortcut({ workspaceId, t }: { workspaceId: string; t: Translate }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{t("website.demoTitle")}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{t("website.demoText")}</p>
      </div>
      <Button
        type="button"
        variant="outline"
        className="shrink-0"
        disabled={pending || !workspaceId}
        onClick={() =>
          start(async () => {
            const res = await createOnboardingDemoAction(workspaceId);
            if (!res.ok) {
              toast.error(res.error);
              return;
            }
            router.push(`/p/${res.data.projectId}`);
          })
        }
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        {pending ? t("website.demoLoading") : t("website.demoButton")}
      </Button>
    </div>
  );
}

export function WebsiteStep({ draft, update, t, locale, data, preview, showErrors }: StepProps) {
  const c = data.config;
  const domain = cleanDomainInput(draft.domain);
  const valid = isDomain(domain);
  const title = data.hasProjects
    ? t("website.titleAnother")
    : locale === "de"
      ? c.welcomeTitleDe || t("welcomeTitle")
      : c.welcomeTitle || t("welcomeTitle");
  const text = data.hasProjects
    ? t("website.textAnother")
    : locale === "de"
      ? c.welcomeTextDe || t("welcomeText")
      : c.welcomeText || t("welcomeText");
  const days = [...new Set([...PITCH_DAYS, c.defaultPitchDays])].sort((a, b) => a - b);
  return (
    <div>
      <StepHeader title={title} text={text} />
      <div className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="onb-domain">{t("website.domain")}</Label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2">
              {valid ? <Favicon domain={domain} className="size-4" /> : <Globe className="size-4 text-muted-foreground" />}
            </span>
            <Input
              id="onb-domain"
              inputMode="url"
              autoComplete="url"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="yourbrand.com"
              value={draft.domain}
              aria-invalid={showErrors && !valid}
              onChange={(e) => {
                const value = e.target.value;
                update((d) => {
                  const cleaned = cleanDomainInput(value);
                  return { domain: value, ...(d.nameTouched ? {} : { name: isDomain(cleaned) ? nameFromDomain(cleaned) : "" }) };
                });
              }}
              onBlur={() => domain && update({ domain })}
              className="h-11 pl-9 text-base"
            />
          </div>
          <p className="text-xs text-muted-foreground">{t("website.domainHint")}</p>
          <FieldError show={showErrors && !valid}>{t("error.domain")}</FieldError>
        </div>

        <div className="space-y-2">
          <Label htmlFor="onb-name">{t("website.name")}</Label>
          <Input
            id="onb-name"
            value={draft.name}
            maxLength={120}
            placeholder="Acme Inc."
            aria-invalid={showErrors && !draft.name.trim()}
            onChange={(e) => update({ name: e.target.value, nameTouched: true })}
            className="h-11 text-base"
          />
          <FieldError show={showErrors && !draft.name.trim()}>{t("error.name")}</FieldError>
        </div>

        {data.workspaces.length > 1 && (
          <div className="space-y-2">
            <Label htmlFor="onb-ws">{t("website.workspace")}</Label>
            <Select value={draft.workspaceId} onValueChange={(v) => update({ workspaceId: v })}>
              <SelectTrigger id="onb-ws" className="h-11! w-full bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {data.workspaces.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {c.allowPitchProjects && (
          <div className="rounded-2xl border bg-card p-4 shadow-soft">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="onb-pitch" className="text-sm">
                  {t("website.pitch")}
                  <Badge variant="secondary" className="h-5 text-[10px]">
                    {t("optional")}
                  </Badge>
                </Label>
                <p className="text-xs leading-relaxed text-muted-foreground">{t("website.pitchHint")}</p>
              </div>
              <Switch id="onb-pitch" checked={draft.isPitch} onCheckedChange={(v) => update({ isPitch: v })} />
            </div>
            <AnimatePresence initial={false}>
              {draft.isPitch && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4 text-sm">
                    <span className="text-muted-foreground">{t("website.pitchDays")}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {days.map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => update({ pitchDays: n })}
                          className={cn(
                            "rounded-full border px-3 py-1 text-xs font-medium tabular transition-colors",
                            draft.pitchDays === n ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
                          )}
                        >
                          {n} {t("days")}
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {!data.hasProjects && !preview && <DemoShortcut workspaceId={draft.workspaceId} t={t} />}
      </div>
    </div>
  );
}

/* ─────────────────────────────── Market ─────────────────────────────── */

export function MarketStep({ draft, update, t }: StepProps) {
  return (
    <div>
      <StepHeader title={t("market.title")} text={t("market.text")} />
      <div className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="onb-country">{t("market.country")}</Label>
          <CountryPicker
            id="onb-country"
            value={draft.country}
            searchPlaceholder={t("market.search")}
            emptyText={t("market.noResults")}
            className="h-11"
            onChange={(iso) =>
              update((d) => ({
                country: iso,
                ...(d.languageTouched ? {} : { language: getCountry(iso)?.language ?? d.language }),
              }))
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="onb-language">{t("market.language")}</Label>
          <LanguageSelect
            id="onb-language"
            value={draft.language}
            country={draft.country}
            recommendedLabel={t("market.recommended")}
            allLabel={t("market.all")}
            className="h-11!"
            onChange={(code) => update({ language: code, languageTouched: true })}
          />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────── Brand ─────────────────────────────── */

export function BrandStep({ draft, update, t, data, ai, onDismissAi, onRetryAi }: StepProps & { ai: AiState; onDismissAi: () => void; onRetryAi: () => void }) {
  const loading = ai.status === "loading";
  return (
    <div>
      <StepHeader
        title={t("brand.title")}
        text={ai.status === "done" ? t("brand.textAi") : t("brand.text")}
        badge={
          ai.status === "done" ? (
            <Badge variant="secondary" className="gap-1 bg-brand-soft text-brand">
              <Sparkles className="size-3" /> {t("ai.suggested")}
            </Badge>
          ) : undefined
        }
      />
      <AiBanner
        state={ai}
        t={t}
        isAdmin={data.isInstanceAdmin}
        loadingText={t("ai.loadingBrand", { domain: cleanDomainInput(draft.domain) })}
        onDismiss={onDismissAi}
        onRetry={onRetryAi}
      />
      <div className={cn("space-y-5 transition-opacity", loading && "pointer-events-none opacity-50")}>
        <div className="space-y-2">
          <Label htmlFor="onb-brand-name">{t("brand.name")}</Label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2">
              <Favicon domain={cleanDomainInput(draft.domain)} src={draft.brand.logoUrl} fallback={draft.name} className="size-4" />
            </span>
            <Input
              id="onb-brand-name"
              value={draft.name}
              maxLength={120}
              onChange={(e) => update({ name: e.target.value, nameTouched: true })}
              className="h-11 pl-9 text-base"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="onb-brand-desc">{t("brand.description")}</Label>
          {loading ? (
            <Skeleton className="h-20 w-full rounded-lg" />
          ) : (
            <Textarea
              id="onb-brand-desc"
              rows={3}
              maxLength={2000}
              placeholder={t("brand.descriptionPh")}
              value={draft.brand.description}
              onChange={(e) => update((d) => ({ brand: { ...d.brand, description: e.target.value } }))}
              className="min-h-20 text-base"
            />
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="onb-brand-industry">{t("brand.industry")}</Label>
          <Input
            id="onb-brand-industry"
            maxLength={200}
            placeholder={t("brand.industryPh")}
            value={draft.brand.industry}
            onChange={(e) => update((d) => ({ brand: { ...d.brand, industry: e.target.value } }))}
            className="h-11 text-base"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="onb-brand-aliases">{t("brand.aliases")}</Label>
          <ChipsInput
            id="onb-brand-aliases"
            value={draft.brand.aliases}
            placeholder={t("brand.aliasesPh")}
            normalize={(s) => s.trim().slice(0, 120)}
            onChange={(aliases) => update((d) => ({ brand: { ...d.brand, aliases: aliases.slice(0, 50) } }))}
          />
          <p className="text-xs text-muted-foreground">{t("brand.aliasesHint")}</p>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── Competitors ───────────────────────────── */

export function CompetitorsStep({
  draft,
  update,
  t,
  data,
  ai,
  onDismissAi,
  onRetryAi,
  onRegenerate,
}: StepProps & { ai: AiState; onDismissAi: () => void; onRetryAi: () => void; onRegenerate?: () => void }) {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const market = getCountry(draft.country)?.name ?? draft.country;
  const add = () => {
    const n = name.trim();
    if (!n) return;
    if (draft.competitors.some((c) => c.name.toLowerCase() === n.toLowerCase())) {
      setName("");
      setDomain("");
      return;
    }
    const d = cleanDomainInput(domain);
    update((prev) => ({
      competitors: [...prev.competitors, { id: uid("c"), name: n.slice(0, 120), domain: isDomain(d) ? d : "", ai: false }],
    }));
    setName("");
    setDomain("");
  };
  const loading = ai.status === "loading";
  return (
    <div>
      <StepHeader title={t("competitors.title")} text={t("competitors.text")} />
      <AiBanner
        state={ai}
        t={t}
        isAdmin={data.isInstanceAdmin}
        loadingText={t("ai.loadingCompetitors", { market })}
        onDismiss={onDismissAi}
        onRetry={onRetryAi}
      />
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="tabular">{t("competitors.count", { n: draft.competitors.length })}</span>
          {onRegenerate && !loading && (
            <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={onRegenerate}>
              <Sparkles className="size-3" /> {ai.status === "done" ? t("ai.regenerate") : t("ai.suggest")}
            </Button>
          )}
        </div>
        <div className="overflow-hidden rounded-2xl border bg-card shadow-soft">
          {loading && draft.competitors.length === 0 ? (
            <div className="divide-y">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="size-5 rounded" />
                  <Skeleton className="h-4 w-40" />
                </div>
              ))}
            </div>
          ) : draft.competitors.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("competitors.empty")}</p>
          ) : (
            <ul className="divide-y">
              <AnimatePresence initial={false}>
                {draft.competitors.map((c) => (
                  <motion.li
                    key={c.id}
                    layout
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex items-center gap-3 px-4 py-2.5"
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border bg-background">
                      <Favicon domain={c.domain} fallback={c.name} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.name}</p>
                      {c.domain && <p className="truncate text-xs text-muted-foreground">{c.domain}</p>}
                    </div>
                    {c.ai && <Sparkles className="size-3.5 shrink-0 text-brand/70" aria-label={t("ai.suggested")} />}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove"
                      onClick={() => update((prev) => ({ competitors: prev.competitors.filter((x) => x.id !== c.id) }))}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
          <form
            className="flex flex-col gap-2 border-t bg-muted/30 p-3 @md/onb:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("competitors.name")} maxLength={120} className="h-10 bg-background text-base" />
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder={t("competitors.domain")}
              inputMode="url"
              autoCapitalize="none"
              className="h-10 bg-background text-base"
            />
            <Button type="submit" variant="secondary" className="h-10 shrink-0 gap-1" disabled={!name.trim()}>
              <Plus className="size-4" /> {t("competitors.add")}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────── Prompts ─────────────────────────────── */

const STAGE_LABEL: Record<string, string> = { tofu: "TOFU", mofu: "MOFU", bofu: "BOFU" };

export function PromptsStep({
  draft,
  update,
  t,
  data,
  ai,
  onDismissAi,
  onRetryAi,
  onRegenerate,
}: StepProps & { ai: AiState; onDismissAi: () => void; onRetryAi: () => void; onRegenerate?: () => void }) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const selected = draft.prompts.filter((p) => p.selected).length;
  const groups = useMemo(() => {
    const map = new Map<string, typeof draft.prompts>();
    for (const p of draft.prompts) {
      const key = p.topic || t("prompts.other");
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return [...map.entries()];
  }, [draft, t]);
  const setAll = (value: boolean, ids?: string[]) =>
    update((d) => ({ prompts: d.prompts.map((p) => (!ids || ids.includes(p.id) ? { ...p, selected: value } : p)) }));
  const add = () => {
    const v = text.trim();
    if (v.length < 3) return;
    if (draft.prompts.some((p) => p.text.toLowerCase() === v.toLowerCase())) return setText("");
    update((d) => ({
      prompts: [...d.prompts, { id: uid("p"), text: v.slice(0, 500), topic: t("prompts.custom"), funnelStage: null, branded: false, selected: true, ai: false }],
    }));
    setText("");
  };
  const loading = ai.status === "loading";
  return (
    <div>
      <StepHeader title={t("prompts.title")} text={t("prompts.text")} />
      <AiBanner
        state={ai}
        t={t}
        isAdmin={data.isInstanceAdmin}
        loadingText={t("ai.loadingPrompts")}
        onDismiss={onDismissAi}
        onRetry={onRetryAi}
      />
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="tabular">{t("prompts.selected", { n: selected, total: draft.prompts.length })}</span>
          <div className="flex items-center gap-1">
            {draft.prompts.length > 0 && (
              <>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAll(true)}>
                  {t("prompts.all")}
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAll(false)}>
                  {t("prompts.none")}
                </Button>
              </>
            )}
            {onRegenerate && !loading && (
              <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={onRegenerate}>
                <Sparkles className="size-3" /> {ai.status === "done" ? t("ai.regenerate") : t("ai.suggest")}
              </Button>
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border bg-card shadow-soft">
          {loading && draft.prompts.length === 0 ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="size-4 rounded" />
                  <Skeleton className="h-4" style={{ width: `${55 + ((i * 13) % 35)}%` }} />
                </div>
              ))}
            </div>
          ) : draft.prompts.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("prompts.empty")}</p>
          ) : (
            <div className="max-h-[440px] divide-y overflow-y-auto overscroll-contain">
              {groups.map(([topic, items]) => {
                const ids = items.map((p) => p.id);
                const all = items.every((p) => p.selected);
                const some = items.some((p) => p.selected);
                return (
                  <div key={topic}>
                    <div className="sticky top-0 z-[1] flex items-center gap-2.5 bg-muted/80 px-4 py-2 backdrop-blur">
                      <Checkbox checked={all ? true : some ? "indeterminate" : false} onCheckedChange={(v) => setAll(v === true, ids)} aria-label={topic} />
                      <span className="flex-1 truncate text-xs font-semibold">{topic}</span>
                      <span className="text-[11px] text-muted-foreground tabular">
                        {items.filter((p) => p.selected).length}/{items.length}
                      </span>
                    </div>
                    <ul>
                      {items.map((p) => (
                        <li key={p.id} className={cn("group flex items-start gap-2.5 px-4 py-2.5 transition-colors", !p.selected && "opacity-55")}>
                          <Checkbox
                            className="mt-0.5"
                            checked={p.selected}
                            onCheckedChange={(v) => update((d) => ({ prompts: d.prompts.map((x) => (x.id === p.id ? { ...x, selected: v === true } : x)) }))}
                            aria-label={p.text}
                          />
                          {editing === p.id ? (
                            <form
                              className="flex min-w-0 flex-1 gap-1.5"
                              onSubmit={(e) => {
                                e.preventDefault();
                                const v = editText.trim();
                                if (v.length >= 3) update((d) => ({ prompts: d.prompts.map((x) => (x.id === p.id ? { ...x, text: v.slice(0, 500) } : x)) }));
                                setEditing(null);
                              }}
                            >
                              <Input autoFocus value={editText} onChange={(e) => setEditText(e.target.value)} className="h-8 text-base md:text-sm" />
                              <Button type="submit" size="icon-sm" aria-label="Save">
                                <Check className="size-3.5" />
                              </Button>
                            </form>
                          ) : (
                            <>
                              <p className="min-w-0 flex-1 text-sm leading-snug">{p.text}</p>
                              <div className="flex shrink-0 items-center gap-1">
                                {p.branded && (
                                  <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                                    {t("prompts.branded")}
                                  </Badge>
                                )}
                                {p.funnelStage && (
                                  <Badge variant="secondary" className="hidden h-5 px-1.5 text-[10px] @md/onb:inline-flex">
                                    {STAGE_LABEL[p.funnelStage]}
                                  </Badge>
                                )}
                                <button
                                  type="button"
                                  className="rounded p-1 text-muted-foreground opacity-100 hover:bg-muted hover:text-foreground @2xl/onb:opacity-0 @2xl/onb:group-hover:opacity-100"
                                  aria-label="Edit"
                                  onClick={() => {
                                    setEditing(p.id);
                                    setEditText(p.text);
                                  }}
                                >
                                  <Pencil className="size-3.5" />
                                </button>
                                {!p.ai && (
                                  <button
                                    type="button"
                                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                                    aria-label="Remove"
                                    onClick={() => update((d) => ({ prompts: d.prompts.filter((x) => x.id !== p.id) }))}
                                  >
                                    <Trash2 className="size-3.5" />
                                  </button>
                                )}
                              </div>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
          <form
            className="flex gap-2 border-t bg-muted/30 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("prompts.addPh")} maxLength={500} className="h-10 bg-background text-base" />
            <Button type="submit" variant="secondary" className="h-10 shrink-0 gap-1" disabled={text.trim().length < 3}>
              <Plus className="size-4" /> <span className="hidden @md/onb:inline">{t("prompts.add")}</span>
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────── Engines ─────────────────────────────── */

export function EnginesStep({ draft, update, t, data, showErrors }: StepProps) {
  const availability = new Map(data.engines.map((e) => [e.id, e]));
  const engines = ENGINES.filter((e) => !availability.get(e.id)?.disabled);
  const anyUnavailable = draft.engines.some((id) => !availability.get(id)?.available);
  const toggle = (id: string) =>
    update((d) => ({ engines: d.engines.includes(id) ? d.engines.filter((x) => x !== id) : [...d.engines, id] }));
  return (
    <div>
      <StepHeader title={t("engines.title")} text={t("engines.text")} />
      <div className="grid grid-cols-1 gap-2 @md/onb:grid-cols-2">
        {engines.map((e) => {
          const on = draft.engines.includes(e.id);
          const a = availability.get(e.id);
          return (
            <button
              key={e.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(e.id)}
              className={cn(
                "group relative flex items-center gap-3 rounded-2xl border bg-card p-3 text-left shadow-soft transition-all",
                on ? "border-foreground/80 ring-1 ring-foreground/80" : "hover:border-foreground/25",
              )}
            >
              <EngineIcon id={e.id} size="md" withTooltip={false} active={on || Boolean(a?.available)} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{e.name}</p>
                <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                  <span className={cn("size-1.5 shrink-0 rounded-full", a?.available ? "bg-success" : "bg-muted-foreground/40")} />
                  {a?.available ? e.vendor : t("engines.unavailable")}
                </p>
              </div>
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                  on ? "border-foreground bg-foreground text-background" : "border-input",
                )}
              >
                {on && <Check className="size-3" />}
              </span>
            </button>
          );
        })}
      </div>
      <FieldError show={showErrors && draft.engines.length === 0}>{t("error.engines")}</FieldError>
      {anyUnavailable && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t("engines.note")}</p>}

      <div className="mt-6 space-y-2">
        <Label>{t("engines.frequency")}</Label>
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
          {(["daily", "weekly", "monthly"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => update({ frequency: f })}
              className={cn(
                "rounded-lg py-2 text-sm font-medium transition-colors",
                draft.frequency === f ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(f)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── Integrations ───────────────────────────── */

export function IntegrationsStep({ draft, update, t, data }: StepProps) {
  const items = [
    { key: "gsc", icon: Search, title: t("integrations.gsc"), text: t("integrations.gscText"), ready: data.integrations.google },
    { key: "bing", icon: BarChart3, title: t("integrations.bing"), text: t("integrations.bingText"), ready: data.integrations.bing },
    { key: "cloudflare", icon: Cloud, title: t("integrations.cloudflare"), text: t("integrations.cloudflareText"), ready: data.integrations.cloudflare },
    { key: "agent", icon: Bot, title: t("integrations.agent"), text: t("integrations.agentText"), ready: data.integrations.agent },
  ];
  return (
    <div>
      <StepHeader title={t("integrations.title")} text={t("integrations.text")} />
      <div className="grid gap-2">
        {items.map((it) => (
          <div key={it.key} className="flex items-center gap-3 rounded-2xl border bg-card p-3.5 shadow-soft">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border bg-background">
              <it.icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{it.title}</p>
              <p className="text-xs text-muted-foreground">{it.text}</p>
            </div>
            <Badge
              variant="secondary"
              className={cn("hidden h-5 shrink-0 text-[10px] @md/onb:inline-flex", it.ready ? "bg-success/12 text-success" : "text-muted-foreground")}
            >
              {it.ready ? t("integrations.ready") : t("integrations.needsAdmin")}
            </Badge>
          </div>
        ))}
      </div>
      <div className="mt-5 flex items-start justify-between gap-4 rounded-2xl border border-dashed p-4">
        <div className="space-y-1">
          <Label htmlFor="onb-go-int" className="text-sm">
            {t("integrations.goAfter")}
          </Label>
          <p className="text-xs text-muted-foreground">{t("integrations.goAfterHint")}</p>
        </div>
        <Switch id="onb-go-int" checked={draft.goToIntegrations} onCheckedChange={(v) => update({ goToIntegrations: v })} />
      </div>
    </div>
  );
}

/* ─────────────────────────────── Invite ─────────────────────────────── */

export function InviteStep({ draft, update, t, data }: StepProps) {
  const ws = data.workspaces.find((w) => w.id === draft.workspaceId);
  const [email, setEmail] = useState("");
  const [roleKey, setRoleKey] = useState(data.defaultRoleKey);
  const [error, setError] = useState<string | null>(null);
  const domains = data.config.allowedDomains;
  const add = () => {
    const list = email
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (!list.length) return;
    const next = [...draft.invites];
    for (const e of list) {
      if (!isEmail(e)) return setError(`${t("invite.invalid")} (${e})`);
      if (!emailAllowed(e, domains)) return setError(`${t("invite.notAllowed")} (${e})`);
      if (next.some((i) => i.email === e)) continue;
      next.push({ id: uid("i"), email: e, roleKey });
    }
    update({ invites: next.slice(0, 50) });
    setEmail("");
    setError(null);
  };
  if (!ws?.canInvite) {
    return (
      <div>
        <StepHeader title={t("invite.title")} text={t("invite.text")} />
        <div className="flex items-start gap-3 rounded-2xl border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground">
          <UserPlus className="mt-0.5 size-4 shrink-0" /> {t("invite.noPermission")}
        </div>
      </div>
    );
  }
  const roleName = (key: string) => data.roles.find((r) => r.key === key)?.name ?? key;
  return (
    <div>
      <StepHeader title={t("invite.title")} text={t("invite.text")} />
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <div className="flex flex-col gap-2 @md/onb:flex-row">
          <Input
            type="email"
            inputMode="email"
            autoCapitalize="none"
            placeholder={t("invite.emailPh")}
            value={email}
            aria-invalid={Boolean(error)}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            className="h-11 text-base"
          />
          <div className="flex gap-2">
            <Select value={roleKey} onValueChange={setRoleKey}>
              <SelectTrigger className="h-11! w-full bg-background @md/onb:w-36" aria-label={t("invite.role")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {data.roles.map((r) => (
                  <SelectItem key={r.key} value={r.key}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" className="h-11 shrink-0 gap-1" disabled={!email.trim()}>
              <Plus className="size-4" /> {t("invite.add")}
            </Button>
          </div>
        </div>
        <FieldError show={Boolean(error)}>{error}</FieldError>
        {domains.length > 0 && (
          <p className="text-xs text-muted-foreground">{t("invite.domains", { domains: domains.map((d) => `@${d}`).join(", ") })}</p>
        )}
      </form>
      <div className="mt-4 overflow-hidden rounded-2xl border bg-card shadow-soft">
        {draft.invites.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("invite.empty")}</p>
        ) : (
          <ul className="divide-y">
            {draft.invites.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand uppercase">
                  {i.email.slice(0, 2)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{i.email}</span>
                <Badge variant="secondary" className="h-5 shrink-0 text-[10px]">
                  {roleName(i.roleKey)}
                </Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove"
                  onClick={() => update((d) => ({ invites: d.invites.filter((x) => x.id !== i.id) }))}
                >
                  <X className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────── Review ─────────────────────────────── */

export function ReviewStep({
  draft,
  t,
  data,
  steps,
  onEdit,
}: StepProps & { steps: WizardStepOrCreate[]; onEdit: (step: WizardStepOrCreate) => void }) {
  const country = getCountry(draft.country);
  const language = LANGUAGES.find((l) => l.code === draft.language)?.name ?? draft.language;
  const selectedPrompts = draft.prompts.filter((p) => p.selected);
  const rows: { step: WizardStepOrCreate; label: string; value: React.ReactNode }[] = [
    {
      step: "website",
      label: t("create.website"),
      value: (
        <span className="flex min-w-0 items-center gap-2">
          <Favicon domain={cleanDomainInput(draft.domain)} fallback={draft.name} />
          <span className="truncate">
            <span className="font-medium">{draft.name}</span> <span className="text-muted-foreground">· {cleanDomainInput(draft.domain)}</span>
          </span>
        </span>
      ),
    },
    {
      step: "market",
      label: t("create.market"),
      value: (
        <span className="truncate">
          {flagEmoji(country?.iso)} {country?.name ?? draft.country} · {language}
        </span>
      ),
    },
  ];
  if (steps.includes("brand"))
    rows.push({
      step: "brand",
      label: t("create.brand"),
      value: <span className="line-clamp-2">{draft.brand.description || draft.brand.industry || t("create.none")}</span>,
    });
  if (steps.includes("competitors"))
    rows.push({
      step: "competitors",
      label: t("create.competitors"),
      value: draft.competitors.length ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="flex -space-x-1">
            {draft.competitors.slice(0, 5).map((c) => (
              <span key={c.id} className="flex size-5 items-center justify-center rounded-full border bg-background">
                <Favicon domain={c.domain} fallback={c.name} className="size-3" />
              </span>
            ))}
          </span>
          <span className="truncate">{draft.competitors.map((c) => c.name).join(", ")}</span>
        </span>
      ) : (
        t("create.none")
      ),
    });
  if (steps.includes("prompts"))
    rows.push({ step: "prompts", label: t("create.prompts"), value: <span className="tabular">{selectedPrompts.length}</span> });
  rows.push({
    step: steps.includes("engines") ? "engines" : "create",
    label: t("create.engines"),
    value: (
      <span className="flex flex-wrap items-center gap-1">
        {draft.engines.map((id) => (
          <EngineIcon key={id} id={id} size="xs" />
        ))}
        <span className="ml-1 text-muted-foreground">· {t(draft.frequency)}</span>
      </span>
    ),
  });
  if (steps.includes("invite") && draft.invites.length)
    rows.push({ step: "invite", label: t("create.invites"), value: draft.invites.map((i) => i.email).join(", ") });

  return (
    <div>
      <StepHeader title={t("create.title")} text={t("create.text")} />
      {draft.isPitch && data.config.allowPitchProjects && (
        <div className="mb-3 flex items-center gap-2 rounded-xl bg-warning/12 px-3 py-2 text-xs font-medium text-warning">
          <Sparkles className="size-3.5" /> {t("create.pitch", { n: draft.pitchDays })}
        </div>
      )}
      <dl className="divide-y overflow-hidden rounded-2xl border bg-card shadow-soft">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3 px-4 py-3 text-sm">
            <dt className="w-28 shrink-0 text-xs text-muted-foreground">{r.label}</dt>
            <dd className="min-w-0 flex-1">{r.value}</dd>
            {r.step !== "create" && (
              <button type="button" onClick={() => onEdit(r.step)} className="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground">
                {t("create.edit")}
              </button>
            )}
          </div>
        ))}
      </dl>
    </div>
  );
}
