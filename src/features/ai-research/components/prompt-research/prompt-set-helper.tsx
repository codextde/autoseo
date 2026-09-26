"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { COUNTRIES, LANGUAGES } from "@/lib/countries";
import { ChipsInput, FunnelIcon, ProviderNotice, ToggleChip } from "../shared/bits";
import { defaultConfigAction, generatePromptSetAction } from "../../actions/research";
import type { FunnelStage, PromptLength, PromptSetConfig, ResearchList } from "../../types";

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div>
        <Label className="text-sm font-medium">{title}</Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export function PromptSetHelperDialog({
  open,
  onOpenChange,
  projectId,
  lists,
  activeList,
  suggestions,
  project,
  providers,
  initialTopics,
  initialPersonas,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  lists: ResearchList[];
  activeList: ResearchList;
  suggestions: { topics: string[]; personas: string[]; competitors: string[] };
  project: { country: string; language: string };
  providers: { dataforseo: boolean; llm: boolean };
  initialTopics?: string[];
  initialPersonas?: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [loaded, setLoaded] = useState(false);
  const [target, setTarget] = useState<"current" | "new">("current");
  const [newName, setNewName] = useState("");
  const [cfg, setCfg] = useState<PromptSetConfig>({
    topics: initialTopics ?? [],
    personas: initialPersonas ?? [],
    funnelStages: ["tofu", "mofu", "bofu"],
    brandedShare: 20,
    competitorComparisons: suggestions.competitors.length > 0,
    competitors: suggestions.competitors.slice(0, 10),
    lengths: ["short", "medium", "long"],
    count: 40,
    language: project.language,
    country: project.country,
    instructions: "",
  });

  useEffect(() => {
    if (!open || loaded) return;
    void defaultConfigAction(projectId).then((res) => {
      if (res.ok) {
        setCfg((c) => ({
          ...res.data,
          topics: initialTopics?.length ? initialTopics : res.data.topics,
          personas: initialPersonas?.length ? initialPersonas : res.data.personas,
          instructions: c.instructions,
        }));
      }
      setLoaded(true);
    });
  }, [open, loaded, projectId, initialTopics, initialPersonas]);

  const set = <K extends keyof PromptSetConfig>(k: K, v: PromptSetConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const toggleIn = <T extends string>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const generating = activeList.status === "generating";

  const submit = () =>
    start(async () => {
      if (target === "new" && !newName.trim()) {
        toast.error("Please name the new list.");
        return;
      }
      const res = await generatePromptSetAction(projectId, target === "new" ? { newListName: newName.trim() } : { listId: activeList.id }, {
        ...cfg,
        instructions: cfg.instructions?.trim() || undefined,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Generating ${cfg.count} prompts — they appear in the list as they are created.`);
      onOpenChange(false);
      router.replace(`/p/${projectId}/ai/prompt-research?list=${res.data.listId}`, { scroll: false });
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b p-4 sm:p-5">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-brand" /> Prompt Set Helper
          </DialogTitle>
          <DialogDescription>Generate a balanced set of realistic AI prompts for your market — grouped by topic, funnel stage and persona.</DialogDescription>
        </DialogHeader>
        <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
          {!providers.llm && (
            <ProviderNotice title="No AI provider available" href="/admin/ai" linkLabel="AI Providers">
              Prompt generation runs on a connected local agent (Claude Code / Codex) or an API key.
            </ProviderNotice>
          )}
          <Section title="Target list">
            <div className="flex flex-wrap gap-2">
              <ToggleChip active={target === "current"} onClick={() => setTarget("current")}>
                Add to “{activeList.name}”
              </ToggleChip>
              <ToggleChip active={target === "new"} onClick={() => setTarget("new")}>
                New list
              </ToggleChip>
            </div>
            {target === "new" && <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Q4 comparison prompts" maxLength={120} />}
            {target === "current" && generating && <p className="text-xs text-warning">This list is currently generating — choose a new list or wait.</p>}
            {lists.length > 1 && target === "current" && <p className="text-xs text-muted-foreground">Switch lists in the toolbar to target another list.</p>}
          </Section>

          <Section title="Topics" hint="Leave empty to let the AI choose 5–8 topics. Suggestions come from Brand Knowledge.">
            <ChipsInput value={cfg.topics} onChange={(v) => set("topics", v)} placeholder="Add a topic and press Enter" suggestions={suggestions.topics} />
          </Section>

          <Section title="Personas" hint={suggestions.personas.length ? "Write prompts from these buyer personas' perspective." : "Generate personas in Brand Knowledge → Personas for persona-based prompts."}>
            <ChipsInput value={cfg.personas} onChange={(v) => set("personas", v)} placeholder="Add a persona" suggestions={suggestions.personas} max={20} />
          </Section>

          <div className="grid gap-5 sm:grid-cols-2">
            <Section title="Funnel stages">
              <div className="flex flex-wrap gap-1.5">
                {(["tofu", "mofu", "bofu"] as FunnelStage[]).map((s) => (
                  <ToggleChip
                    key={s}
                    active={cfg.funnelStages.includes(s)}
                    onClick={() => {
                      const next = toggleIn(cfg.funnelStages, s);
                      if (next.length) set("funnelStages", next);
                    }}
                  >
                    <FunnelIcon stage={s} withTooltip={false} className="size-3.5" />
                    {s.toUpperCase()}
                  </ToggleChip>
                ))}
              </div>
            </Section>
            <Section title="Prompt length">
              <div className="flex flex-wrap gap-1.5">
                {(["short", "medium", "long"] as PromptLength[]).map((l) => (
                  <ToggleChip
                    key={l}
                    active={cfg.lengths.includes(l)}
                    onClick={() => {
                      const next = toggleIn(cfg.lengths, l);
                      if (next.length) set("lengths", next);
                    }}
                  >
                    {l.charAt(0).toUpperCase() + l.slice(1)}
                  </ToggleChip>
                ))}
              </div>
            </Section>
          </div>

          <Section title={`Brand vs non-brand mix — ${cfg.brandedShare}% branded`} hint="Branded prompts name your brand; non-branded prompts show whether AI recommends you on its own.">
            <Slider value={[cfg.brandedShare]} min={0} max={100} step={5} onValueChange={([v]) => set("brandedShare", v ?? 0)} />
          </Section>

          <Section title="Competitor comparisons">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={cfg.competitorComparisons} onCheckedChange={(v) => set("competitorComparisons", v)} />
              Include “X vs Y” and “alternatives to …” prompts
            </label>
            {cfg.competitorComparisons && (
              <ChipsInput value={cfg.competitors} onChange={(v) => set("competitors", v)} placeholder="Competitor names" suggestions={suggestions.competitors} max={20} />
            )}
          </Section>

          <div className="grid gap-5 sm:grid-cols-3">
            <Section title={`Count — ${cfg.count}`}>
              <Slider value={[cfg.count]} min={10} max={200} step={10} onValueChange={([v]) => set("count", v ?? 40)} />
            </Section>
            <Section title="Language">
              <NativeSelect value={cfg.language} onChange={(e) => set("language", e.target.value)} className="w-full">
                {LANGUAGES.map((l) => (
                  <NativeSelectOption key={l.code} value={l.code}>
                    {l.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Section>
            <Section title="Market">
              <NativeSelect value={cfg.country} onChange={(e) => set("country", e.target.value)} className="w-full">
                {COUNTRIES.map((c) => (
                  <NativeSelectOption key={c.iso} value={c.iso}>
                    {c.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Section>
          </div>

          <Section title="Extra instructions (optional)">
            <Textarea
              value={cfg.instructions ?? ""}
              onChange={(e) => set("instructions", e.target.value)}
              maxLength={1000}
              rows={2}
              placeholder="e.g. Focus on questions from first-time buyers in rented apartments"
            />
          </Section>

          <p className="text-xs text-muted-foreground">
            Volumes: {providers.dataforseo ? "DataForSEO search volumes for each prompt's topic keyword." : "estimated by AI (connect DataForSEO in Admin → Data Providers for real search volumes)."}
          </p>
        </div>
        <DialogFooter className="m-0 rounded-b-xl border-t bg-muted/50 p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !providers.llm || (target === "current" && generating)}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Generate {cfg.count} prompts
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
