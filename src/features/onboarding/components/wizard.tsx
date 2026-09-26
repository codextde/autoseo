"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Loader2, Lock, LogOut, Rocket } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Favicon } from "@/components/app/favicon";
import { EngineIcon } from "@/components/app/engine-icon";
import { logoutAction } from "@/features/shell/actions";
import { flagEmoji, getCountry } from "@/lib/countries";
import { cn } from "@/lib/utils";
import { STEP_LABELS, translator } from "../i18n";
import { cleanDomainInput, initialDraft, isDomain, previewDraft, suggestionKey, uid } from "../lib";
import type { Locale, OnboardingPageData, WizardDraft, WizardStepOrCreate } from "../types";
import {
  createOnboardingProjectAction,
  setWizardLocaleAction,
  suggestBrandAction,
  suggestCompetitorsAction,
  suggestPromptsAction,
} from "../actions";
import { OnboardingShell, StepProgress } from "./shell";
import {
  BrandStep,
  CompetitorsStep,
  EnginesStep,
  IntegrationsStep,
  InviteStep,
  MarketStep,
  PromptsStep,
  ReviewStep,
  StepHeader,
  WebsiteStep,
  type AiState,
} from "./steps";

const STORAGE_KEY = "autoseo.onboarding.draft.v1";
type AiKind = "brand" | "competitors" | "prompts";

function stepValid(step: WizardStepOrCreate, d: WizardDraft): boolean {
  if (step === "website") return isDomain(cleanDomainInput(d.domain)) && d.name.trim().length > 0 && Boolean(d.workspaceId);
  if (step === "market") return Boolean(d.country && d.language);
  if (step === "engines") return d.engines.length > 0;
  return true;
}

export function OnboardingWizard({
  data,
  preview,
  previewStep,
  previewLocale,
}: {
  data: OnboardingPageData;
  /** Admin live preview: sample data, no server calls, step/locale controlled by the admin page. */
  preview?: boolean;
  previewStep?: number;
  previewLocale?: Locale;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const steps = useMemo<WizardStepOrCreate[]>(() => [...data.config.steps, "create"], [data.config.steps]);

  const [localeState, setLocaleState] = useState<Locale>(data.locale);
  const locale = preview ? (previewLocale ?? "en") : localeState;
  const t = useMemo(() => translator(locale), [locale]);

  /* ───────────── draft ───────────── */
  const [draftState, setDraftState] = useState<WizardDraft>(() => initialDraft(data));
  const sampleDraft = useMemo(() => (preview ? previewDraft(data) : null), [preview, data]);
  const draft = sampleDraft ?? draftState;
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  });
  const [hydrated, setHydrated] = useState(false);

  const update = useCallback(
    (patch: Partial<WizardDraft> | ((d: WizardDraft) => Partial<WizardDraft>)) => {
      if (preview) return;
      setDraftState((d) => ({ ...d, ...(typeof patch === "function" ? patch(d) : patch) }));
    },
    [preview],
  );

  // Restore the draft from sessionStorage (survives reloads within the tab).
  useEffect(() => {
    if (preview) return;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { email?: string; draft?: WizardDraft };
        if (saved.email === data.user.email && saved.draft) {
          const d = saved.draft;
          const ws = data.workspaces.some((w) => w.id === d.workspaceId) ? d.workspaceId : (data.workspaces[0]?.id ?? "");
          const restored = { ...initialDraft(data), ...d, workspaceId: ws };
          draftRef.current = restored;
          // Restoring client-only persisted state after hydration (sessionStorage is not available on the server).
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setDraftState(restored);
        }
      }
    } catch {
      /* ignore corrupt storage */
    }
    setHydrated(true);
  }, [preview, data]);

  useEffect(() => {
    if (preview || !hydrated) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ email: data.user.email, draft: draftState }));
    } catch {
      /* storage full / disabled */
    }
  }, [draftState, hydrated, preview, data.user.email]);

  /* ───────────── step navigation ───────────── */
  const firstInvalid = steps.findIndex((s) => !stepValid(s, draft));
  const maxReachable = firstInvalid === -1 ? steps.length - 1 : firstInvalid;
  const urlStep = Number.parseInt(params.get("step") ?? "0", 10);
  const requested = preview ? (previewStep ?? 0) : Number.isFinite(urlStep) ? urlStep : 0;
  const index = Math.max(0, Math.min(steps.length - 1, preview ? requested : Math.min(requested, hydrated ? maxReachable : 0)));
  const step = steps[index]!;
  const [direction, setDirection] = useState(1);
  const [showErrors, setShowErrors] = useState(false);

  const go = useCallback(
    (i: number) => {
      if (preview) return;
      const next = Math.max(0, Math.min(steps.length - 1, i));
      setDirection(next >= index ? 1 : -1);
      setShowErrors(false);
      const qs = new URLSearchParams(params.toString());
      if (next === 0) qs.delete("step");
      else qs.set("step", String(next));
      router.replace(qs.toString() ? `${pathname}?${qs}` : pathname, { scroll: false });
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [preview, steps.length, index, params, router, pathname],
  );

  /* ───────────── AI suggestions ───────────── */
  const idle: AiState = { status: "idle" };
  const [aiState, setAiState] = useState<Record<AiKind, AiState>>({ brand: idle, competitors: idle, prompts: idle });
  const ai: Record<AiKind, AiState> = preview
    ? { brand: { status: "done" }, competitors: { status: "done" }, prompts: { status: "done" } }
    : aiState;
  const reqIds = useRef<Record<AiKind, number>>({ brand: 0, competitors: 0, prompts: 0 });
  const setAi = (kind: AiKind, s: AiState) => setAiState((prev) => ({ ...prev, [kind]: s }));

  const runSuggestionRef = useRef<((kind: AiKind) => Promise<void>) | null>(null);
  const runSuggestion = useCallback(
    async (kind: AiKind) => {
      if (preview) return;
      const d = draftRef.current;
      const key = suggestionKey(d);
      const domain = cleanDomainInput(d.domain);
      if (!isDomain(domain)) return;
      const keyField = kind === "brand" ? "brandKey" : kind === "competitors" ? "competitorsKey" : "promptsKey";
      if (!data.aiAvailable) {
        setAi(kind, { status: "unavailable" });
        update({ [keyField]: key } as Partial<WizardDraft>);
        return;
      }
      const id = ++reqIds.current[kind];
      setAi(kind, { status: "loading" });
      const base = { domain, country: d.country, language: d.language };
      const res =
        kind === "brand"
          ? await suggestBrandAction(base)
          : kind === "competitors"
            ? await suggestCompetitorsAction({ ...base, brandName: d.name || domain, description: d.brand.description || undefined })
            : await suggestPromptsAction({
                ...base,
                brandName: d.name || domain,
                description: d.brand.description || undefined,
                competitors: d.competitors.map((c) => c.name).slice(0, 50),
              });
      if (reqIds.current[kind] !== id) return; // dismissed or superseded
      if (!res.ok) {
        setAi(kind, { status: "failed", message: res.error });
        return;
      }
      const outcome = res.data;
      if (outcome.status !== "ok") {
        setAi(kind, { status: outcome.status, message: outcome.message });
        update({ [keyField]: key } as Partial<WizardDraft>);
        return;
      }
      if (kind === "brand") {
        const s = outcome.data as { name: string; description: string; industry: string; aliases: string[]; logoUrl: string | null };
        update((cur) => ({
          brandKey: key,
          name: cur.nameTouched || !s.name ? cur.name : s.name.slice(0, 120),
          brand: {
            description: cur.brand.description || (s.description ?? "").slice(0, 2000),
            industry: cur.brand.industry || (s.industry ?? "").slice(0, 200),
            aliases: [...new Set([...cur.brand.aliases, ...(s.aliases ?? []).map((a) => a.slice(0, 120))])]
              .filter((a) => a.toLowerCase() !== (cur.nameTouched ? cur.name : s.name).toLowerCase())
              .slice(0, 50),
            logoUrl: cur.brand.logoUrl ?? (s.logoUrl && s.logoUrl.startsWith("https://") ? s.logoUrl : null),
          },
        }));
      } else if (kind === "competitors") {
        const list = outcome.data as { name: string; domain: string | null }[];
        update((cur) => {
          const manual = cur.competitors.filter((c) => !c.ai);
          const names = new Set(manual.map((c) => c.name.toLowerCase()));
          const fresh = list
            .filter((c) => !names.has(c.name.toLowerCase()))
            .map((c) => ({ id: uid("c"), name: c.name.slice(0, 120), domain: c.domain ? cleanDomainInput(c.domain) : "", ai: true }));
          return { competitorsKey: key, competitors: [...fresh, ...manual].slice(0, 50) };
        });
      } else {
        const list = outcome.data as { text: string; topic: string; funnelStage: "tofu" | "mofu" | "bofu"; branded: boolean }[];
        update((cur) => {
          const manual = cur.prompts.filter((p) => !p.ai);
          const texts = new Set(manual.map((p) => p.text.toLowerCase()));
          const fresh = list
            .filter((p) => !texts.has(p.text.toLowerCase()))
            .map((p) => ({
              id: uid("p"),
              text: p.text.slice(0, 500),
              topic: (p.topic ?? "").slice(0, 120),
              funnelStage: p.funnelStage ?? null,
              branded: Boolean(p.branded),
              selected: true,
              ai: true,
            }));
          return { promptsKey: key, prompts: [...fresh, ...manual].slice(0, 200) };
        });
      }
      setAi(kind, { status: "done" });
      // Chain: prepare the next AI step in the background (brand → competitors → prompts).
      const cfg = data.config;
      const after = draftRef.current;
      const wantsCompetitors = steps.includes("competitors") && cfg.autoDiscoverCompetitors;
      const wantsPrompts = steps.includes("prompts") && cfg.autoGeneratePrompts;
      if (kind === "brand" && wantsCompetitors) {
        if (after.competitorsKey !== key) void runSuggestionRef.current?.("competitors");
      } else if (kind !== "prompts" && wantsPrompts && after.promptsKey !== key) {
        void runSuggestionRef.current?.("prompts");
      }
    },
    [preview, data.aiAvailable, data.config, steps, update],
  );
  useEffect(() => {
    runSuggestionRef.current = runSuggestion;
  }, [runSuggestion]);

  const dismissAi = (kind: AiKind) => {
    reqIds.current[kind] += 1;
    setAi(kind, { status: "dismissed" });
    const keyField = kind === "brand" ? "brandKey" : kind === "competitors" ? "competitorsKey" : "promptsKey";
    update({ [keyField]: suggestionKey(draftRef.current) } as Partial<WizardDraft>);
  };

  // Auto-run suggestions when entering an AI step whose data is stale (deferred so StrictMode's
  // double effect run is cancelled by the cleanup).
  const aiStateRef = useRef(aiState);
  useEffect(() => {
    aiStateRef.current = aiState;
  });
  useEffect(() => {
    if (preview || !hydrated) return;
    const timer = setTimeout(() => {
      const d = draftRef.current;
      const key = suggestionKey(d);
      const cfg = data.config;
      const st = aiStateRef.current;
      const run = runSuggestionRef.current;
      if (!run) return;
      if (step === "brand" && d.brandKey !== key && st.brand.status !== "loading") void run("brand");
      if (step === "competitors" && cfg.autoDiscoverCompetitors && d.competitorsKey !== key && st.competitors.status !== "loading")
        void run("competitors");
      if (step === "prompts" && cfg.autoGeneratePrompts && d.promptsKey !== key && st.prompts.status !== "loading") void run("prompts");
    }, 0);
    return () => clearTimeout(timer);
  }, [step, hydrated, preview, data.config]);

  /** Starts the next AI step early (e.g. brand analysis while the user picks the market). */
  const prefetchAfter = (i: number) => {
    const key = suggestionKey(draftRef.current);
    const cfg = data.config;
    for (const s of steps.slice(i + 1)) {
      if (s === "brand") {
        if (draftRef.current.brandKey !== key && ai.brand.status !== "loading") void runSuggestion("brand");
        return;
      }
      if (s === "competitors" && cfg.autoDiscoverCompetitors) {
        if (draftRef.current.competitorsKey !== key && ai.competitors.status !== "loading") void runSuggestion("competitors");
        return;
      }
      if (s === "prompts" && cfg.autoGeneratePrompts) {
        if (draftRef.current.promptsKey !== key && ai.prompts.status !== "loading") void runSuggestion("prompts");
        return;
      }
    }
  };

  /* ───────────── create ───────────── */
  const [creating, setCreating] = useState(false);
  const create = async () => {
    if (preview) return;
    const d = draftRef.current;
    const invalid = steps.findIndex((s) => !stepValid(s, d));
    if (invalid !== -1 && invalid < steps.length - 1) {
      go(invalid);
      setShowErrors(true);
      return;
    }
    setCreating(true);
    try {
      const res = await createOnboardingProjectAction({
        workspaceId: d.workspaceId,
        name: d.name.trim(),
        domain: cleanDomainInput(d.domain),
        country: d.country,
        language: d.language,
        isPitch: data.config.allowPitchProjects && d.isPitch,
        pitchDays: d.pitchDays,
        brand: {
          description: steps.includes("brand") ? d.brand.description : "",
          industry: steps.includes("brand") ? d.brand.industry : "",
          aliases: steps.includes("brand") ? d.brand.aliases : [],
          logoUrl: d.brand.logoUrl,
        },
        competitors: steps.includes("competitors") ? d.competitors.map((c) => ({ name: c.name, domain: c.domain })) : [],
        prompts: steps.includes("prompts")
          ? d.prompts
              .filter((p) => p.selected)
              .map((p) => ({ text: p.text, topic: p.topic, funnelStage: p.funnelStage, branded: p.branded }))
          : [],
        engines: d.engines,
        trackingFrequency: d.frequency,
        invites: steps.includes("invite") ? d.invites.map((i) => ({ email: i.email, roleKey: i.roleKey })) : [],
        goToIntegrations: steps.includes("integrations") && d.goToIntegrations,
      });
      if (!res.ok) {
        toast.error(res.error || t("create.error"));
        setCreating(false);
        return;
      }
      toast.success(t("create.success"));
      if (res.data.inviteErrors.length) {
        toast.warning(t("create.inviteWarn", { n: res.data.inviteErrors.length }), {
          description: res.data.inviteErrors.map((e) => `${e.email}: ${e.error}`).join("\n"),
        });
      }
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      router.push(res.data.redirectTo);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("create.error"));
      setCreating(false);
    }
  };

  const next = () => {
    if (!stepValid(step, draft)) {
      setShowErrors(true);
      return;
    }
    if (step === "create") return void create();
    prefetchAfter(index);
    go(index + 1);
  };

  // ⌘/Ctrl + Enter continues.
  const nextRef = useRef(next);
  useEffect(() => {
    nextRef.current = next;
  });
  useEffect(() => {
    if (preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        nextRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);

  const changeLocale = (l: Locale) => {
    if (preview) return;
    setLocaleState(l);
    void setWizardLocaleAction(l);
  };

  /* ───────────── render ───────────── */
  const tourHref = data.config.showTourButton ? data.tourHref : null;
  const demoHref = data.config.showDemoButton && data.config.demoBookingUrl ? data.config.demoBookingUrl : null;

  if (!preview && data.workspaces.length === 0) {
    return (
      <OnboardingShell
        appName={data.config.appName}
        logoUrl={data.config.logoUrl}
        locale={locale}
        onLocaleChange={changeLocale}
        t={t}
        tourHref={tourHref}
        demoHref={demoHref}
        aside={<AsideCard t={t} />}
      >
        <div className="pt-10">
          <span className="mb-6 flex size-12 items-center justify-center rounded-2xl bg-muted">
            <Lock className="size-5 text-muted-foreground" />
          </span>
          <StepHeader title={t("noAccess.title")} text={t("noAccess.text")} />
          <div className="flex flex-wrap gap-2">
            {data.homeHref && (
              <Button asChild className="h-10 gap-1.5">
                <Link href={data.homeHref}>
                  {t("noAccess.home")} <ArrowRight className="size-4" />
                </Link>
              </Button>
            )}
            <form action={logoutAction}>
              <Button type="submit" variant="outline" className="h-10 gap-1.5">
                <LogOut className="size-4" /> {t("signOut")}
              </Button>
            </form>
          </div>
        </div>
      </OnboardingShell>
    );
  }

  const stepProps = { draft, update, t, locale, data, preview, showErrors };
  const skippable = step === "integrations" || step === "invite";

  const content = (() => {
    switch (step) {
      case "website":
        return <WebsiteStep {...stepProps} />;
      case "market":
        return <MarketStep {...stepProps} />;
      case "brand":
        return <BrandStep {...stepProps} ai={ai.brand} onDismissAi={() => dismissAi("brand")} onRetryAi={() => void runSuggestion("brand")} />;
      case "competitors":
        return (
          <CompetitorsStep
            {...stepProps}
            ai={ai.competitors}
            onDismissAi={() => dismissAi("competitors")}
            onRetryAi={() => void runSuggestion("competitors")}
            onRegenerate={data.aiAvailable && !preview ? () => void runSuggestion("competitors") : undefined}
          />
        );
      case "prompts":
        return (
          <PromptsStep
            {...stepProps}
            ai={ai.prompts}
            onDismissAi={() => dismissAi("prompts")}
            onRetryAi={() => void runSuggestion("prompts")}
            onRegenerate={data.aiAvailable && !preview ? () => void runSuggestion("prompts") : undefined}
          />
        );
      case "engines":
        return <EnginesStep {...stepProps} />;
      case "integrations":
        return <IntegrationsStep {...stepProps} />;
      case "invite":
        return <InviteStep {...stepProps} />;
      case "create":
        return <ReviewStep {...stepProps} steps={steps} onEdit={(s) => go(steps.indexOf(s))} />;
    }
  })();

  return (
    <OnboardingShell
      appName={data.config.appName}
      logoUrl={data.config.logoUrl}
      locale={locale}
      onLocaleChange={changeLocale}
      t={t}
      preview={preview}
      tourHref={tourHref}
      demoHref={demoHref}
      aside={<AsideCard t={t} draft={draft} />}
      progress={
        <StepProgress
          total={steps.length}
          current={index}
          label={STEP_LABELS[locale][step] ?? step}
          t={t}
          maxReachable={maxReachable}
          onJump={preview ? undefined : go}
        />
      }
      footer={
        <div className="flex items-center gap-2">
          {index > 0 ? (
            <Button type="button" variant="ghost" className="h-11 gap-1.5 px-3" onClick={() => go(index - 1)} disabled={creating}>
              <ArrowLeft className="size-4" /> <span className="hidden @sm/onb:inline">{t("back")}</span>
            </Button>
          ) : (
            <span />
          )}
          <div className="ml-auto flex items-center gap-2">
            {skippable && (
              <Button type="button" variant="ghost" className="h-11 text-muted-foreground" onClick={() => go(index + 1)} disabled={creating}>
                {t("skip")}
              </Button>
            )}
            <Button type="button" className="h-11 min-w-32 gap-1.5 px-5 text-[15px]" onClick={next} disabled={creating}>
              {step === "create" ? (
                creating ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> {t("creating")}
                  </>
                ) : (
                  <>
                    <Rocket className="size-4" /> {t("create")}
                  </>
                )
              ) : (
                <>
                  {t("continue")} <ArrowRight className="size-4" />
                </>
              )}
            </Button>
          </div>
        </div>
      }
    >
      {preview && (
        <div className="mb-4 inline-flex rounded-full bg-warning/15 px-2.5 py-1 text-[11px] font-medium text-warning">{t("previewBadge")}</div>
      )}
      <AnimatePresence mode="wait" initial={false} custom={direction}>
        <motion.div
          key={step}
          custom={direction}
          initial={{ opacity: 0, x: direction * 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: direction * -24 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          {content}
        </motion.div>
      </AnimatePresence>
    </OnboardingShell>
  );
}

/** Right-hand card: live summary of the project being created. */
function AsideCard({ t, draft }: { t: ReturnType<typeof translator>; draft?: WizardDraft }) {
  const domain = draft ? cleanDomainInput(draft.domain) : "";
  const valid = isDomain(domain);
  if (!draft || !valid) {
    return (
      <div className="max-w-md rounded-2xl border bg-background/80 p-5 shadow-soft backdrop-blur">
        <p className="text-sm font-medium">{t("asideTitle")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("asideText")}</p>
      </div>
    );
  }
  const country = getCountry(draft.country);
  const selectedPrompts = draft.prompts.filter((p) => p.selected).length;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-md rounded-2xl border bg-background/85 p-4 shadow-soft backdrop-blur"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-background">
          <Favicon domain={domain} src={draft.brand.logoUrl} fallback={draft.name} className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{draft.name || domain}</p>
          <p className="truncate text-xs text-muted-foreground">
            {domain} · {flagEmoji(country?.iso)} {country?.name}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          {draft.engines.slice(0, 6).map((id) => (
            <EngineIcon key={id} id={id} size="xs" withTooltip={false} />
          ))}
        </span>
        <span className={cn("tabular", draft.competitors.length && "text-foreground")}>{t("competitors.count", { n: draft.competitors.length })}</span>
        <span className={cn("tabular", selectedPrompts && "text-foreground")}>{selectedPrompts} prompts</span>
      </div>
    </motion.div>
  );
}
