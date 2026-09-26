"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, LayoutTemplate, Loader2, MoreHorizontal, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/app/empty-state";
import { cn } from "@/lib/utils";
import { createAiReportAction, createAiTemplateAction, createReportAction, deleteTemplateAction, listTemplatesAction } from "../actions";
import type { DataBundle } from "../lib/bundle";
import { RANGE_PRESETS } from "../lib/period";
import { LIBRARY_TEMPLATES, buildLibraryDeck } from "../lib/templates/library";
import type { Theme } from "../lib/types";
import { ScaledSlide } from "./slide/scaled-slide";
import type { RenderCtx } from "./slide/slide-view";
import { appAssetUrl } from "./hooks";
import type { TemplateListItem } from "@/server/reports/service";

type TemplateItem = TemplateListItem;

const AI_PRESETS = [
  {
    key: "monthly",
    label: "Monthly client check-in",
    prompt:
      "Write the monthly AI visibility update for the client: verdict, KPI changes vs. last period, competitor movement, notable citations and sources, wins and gaps by prompt, and the 3 most important actions for next month.",
  },
  {
    key: "audit",
    label: "GEO audit narrative",
    prompt:
      "Write a GEO audit: how AI engines see the brand today, visibility and citation analysis per engine, competitor gap, sentiment, prompt coverage gaps and a prioritized 90-day roadmap with expected impact.",
  },
  {
    key: "competitors",
    label: "Competitive landscape",
    prompt:
      "Write a competitive landscape report: who AI recommends most, share of voice, head-to-head strengths and weaknesses, the sources that favour competitors and how to close the gap.",
  },
];

type NewReportProps = {
  projectId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  theme: Theme;
  bundle: DataBundle | null;
  appName: string;
  defaultTab?: "library" | "mine" | "ai";
  /** may create/delete workspace templates */
  canManageWorkspace?: boolean;
};

export function NewReportDialog(props: NewReportProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="flex max-h-[94dvh] w-full flex-col gap-0 p-0 sm:max-w-5xl">{props.open && <NewReportBody {...props} />}</DialogContent>
    </Dialog>
  );
}

function NewReportBody({ projectId, onOpenChange, theme, bundle, appName, defaultTab = "library", canManageWorkspace = false }: NewReportProps) {
  const router = useRouter();
  const [tab, setTab] = useState(defaultTab);
  const [selected, setSelected] = useState("pitch");
  const [title, setTitle] = useState("");
  const [range, setRange] = useState("30d");
  const [templates, setTemplates] = useState<TemplateItem[] | null>(null);
  const [pending, start] = useTransition();
  const [aiPrompt, setAiPrompt] = useState(AI_PRESETS[0]!.prompt);
  const [aiTemplate, setAiTemplate] = useState<string>("none");
  const [newTpl, setNewTpl] = useState<{ name: string; description: string; instructions: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void listTemplatesAction(projectId).then((r) => alive && setTemplates(r.ok ? r.data : []));
    return () => {
      alive = false;
    };
  }, [projectId]);

  const decks = useMemo(() => LIBRARY_TEMPLATES.map((t) => ({ t, deck: buildLibraryDeck(t.key, theme) })), [theme]);
  const ctxFor = (size: { w: number; h: number }, th: Theme): RenderCtx => ({
    deck: { theme: th, size },
    data: { bundle, report: { title: title || "Untitled report" } },
    assetUrl: appAssetUrl(projectId),
    mode: "view",
  });

  const deckTemplates = (templates ?? []).filter((t) => t.kind === "deck");
  const htmlTemplates = (templates ?? []).filter((t) => t.kind === "html");

  const selectedName =
    selected.startsWith("tpl:") ? deckTemplates.find((t) => `tpl:${t.id}` === selected)?.name : LIBRARY_TEMPLATES.find((t) => t.key === selected)?.name;

  const create = () =>
    start(async () => {
      const finalTitle = title.trim() || `${selectedName ?? "Report"} — ${bundle?.project.clientName ?? "Client"}`;
      const res = await createReportAction(projectId, { title: finalTitle, template: selected, dateRange: { preset: range as "30d" } });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onOpenChange(false);
      router.push(`/p/${projectId}/reports/${res.data.id}/edit`);
    });

  const createAi = () =>
    start(async () => {
      const preset = AI_PRESETS.find((p) => p.prompt === aiPrompt);
      const finalTitle = title.trim() || `${preset?.label ?? "AI report"} — ${bundle?.project.clientName ?? "Client"}`;
      const res = await createAiReportAction(projectId, {
        title: finalTitle,
        prompt: aiPrompt,
        templateId: aiTemplate === "none" ? null : aiTemplate,
        dateRange: { preset: range as "30d" },
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Report queued — the agent is writing it now.");
      onOpenChange(false);
      router.push(`/p/${projectId}/reports/${res.data.id}`);
    });

  return (
    <>
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>New report</DialogTitle>
          <DialogDescription>Start from a template — every number fills in live for this client.</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="min-h-0 flex-1 gap-0">
          <div className="border-b px-5 py-2">
            <TabsList>
              <TabsTrigger value="library">{appName} Library</TabsTrigger>
              <TabsTrigger value="mine">My Templates</TabsTrigger>
              <TabsTrigger value="ai">
                <Sparkles className="size-3.5" /> AI report
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="library" className="min-h-0 overflow-y-auto px-5 py-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {decks.map(({ t, deck }) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setSelected(t.key)}
                  onDoubleClick={create}
                  className={cn(
                    "group rounded-xl border bg-card p-2 text-left transition-all hover:shadow-soft",
                    selected === t.key ? "border-foreground ring-2 ring-foreground/15" : "hover:border-foreground/30",
                  )}
                >
                  <div className={cn("overflow-hidden rounded-lg", t.format === "classic" && "flex justify-center bg-muted")}>
                    {t.format === "classic" ? (
                      <div className="w-[34%]">
                        <ScaledSlide slide={deck.slides[0]!} ctx={ctxFor(deck.size, deck.theme)} rounded={false} />
                      </div>
                    ) : (
                      <ScaledSlide slide={deck.slides[0]!} ctx={ctxFor(deck.size, deck.theme)} />
                    )}
                  </div>
                  <div className="flex items-start justify-between gap-2 px-1 pt-2.5 pb-1">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{t.name}</div>
                      <div className="line-clamp-1 text-xs text-muted-foreground">{t.description}</div>
                    </div>
                    <Badge variant="secondary" className="shrink-0 text-[11px]">
                      {t.format === "classic" ? "v1 canvas" : `${deck.slides.length} ${deck.slides.length === 1 ? "slide" : "slides"}`}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="mine" className="min-h-0 overflow-y-auto px-5 py-4">
            {templates === null ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="aspect-video w-full rounded-xl" />
                ))}
              </div>
            ) : deckTemplates.length === 0 ? (
              <EmptyState icon={LayoutTemplate} title="No templates yet" description="Open a report and use Save → Save as template to reuse its design for every client." />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {deckTemplates.map((t) => (
                  <div
                    key={t.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelected(`tpl:${t.id}`)}
                    onKeyDown={(e) => e.key === "Enter" && setSelected(`tpl:${t.id}`)}
                    className={cn(
                      "rounded-xl border bg-card p-2 text-left transition-all hover:shadow-soft",
                      selected === `tpl:${t.id}` ? "border-foreground ring-2 ring-foreground/15" : "hover:border-foreground/30",
                    )}
                  >
                    {t.preview ? (
                      <ScaledSlide slide={t.preview.slide} ctx={ctxFor(t.preview.size, t.preview.theme)} />
                    ) : (
                      <div className="aspect-video rounded-lg bg-muted" />
                    )}
                    <div className="flex items-start justify-between gap-2 px-1 pt-2.5 pb-1">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{t.name}</div>
                        <div className="line-clamp-1 text-xs text-muted-foreground">{t.description || `${t.slideCount} slides`}</div>
                      </div>
                      {canManageWorkspace && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button size="icon-xs" variant="ghost" aria-label="Template actions">
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={async () => {
                              const r = await deleteTemplateAction(projectId, t.id);
                              if (!r.ok) toast.error(r.error);
                              else setTemplates((prev) => (prev ?? []).filter((x) => x.id !== t.id));
                            }}
                          >
                            <Trash2 /> Delete template
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
          <TabsContent value="ai" className="min-h-0 overflow-y-auto px-5 py-4">
            <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {AI_PRESETS.map((p) => (
                    <Button key={p.key} size="sm" variant={aiPrompt === p.prompt ? "secondary" : "outline"} onClick={() => setAiPrompt(p.prompt)}>
                      {p.label}
                    </Button>
                  ))}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ai-prompt">What should the report cover?</Label>
                  <Textarea id="ai-prompt" rows={7} value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} maxLength={4000} />
                  <p className="text-xs text-muted-foreground">
                    The agent (local Claude Code / Codex first, API fallback) writes a self-contained HTML report from this project&apos;s live data. It opens in a sandbox and can be shared by link.
                  </p>
                </div>
              </div>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Template</Label>
                  <Select value={aiTemplate} onValueChange={setAiTemplate}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No template</SelectItem>
                      {htmlTemplates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {!canManageWorkspace ? null : newTpl ? (
                  <div className="space-y-2 rounded-xl border p-3">
                    <Input placeholder="Monthly client check-in" value={newTpl.name} onChange={(e) => setNewTpl({ ...newTpl, name: e.target.value })} maxLength={80} />
                    <Input placeholder="The monthly update we send retainer clients." value={newTpl.description} onChange={(e) => setNewTpl({ ...newTpl, description: e.target.value })} maxLength={200} />
                    <Textarea
                      rows={5}
                      placeholder={"Audience…\nSections, in order…\nTone…\nSign off as…\nAccent: #1C4ED8"}
                      value={newTpl.instructions}
                      onChange={(e) => setNewTpl({ ...newTpl, instructions: e.target.value })}
                      maxLength={3000}
                    />
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setNewTpl(null)}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        disabled={pending || !newTpl.name.trim() || newTpl.instructions.trim().length < 3}
                        onClick={() =>
                          start(async () => {
                            const r = await createAiTemplateAction(projectId, newTpl);
                            if (!r.ok) {
                              toast.error(r.error);
                              return;
                            }
                            const list = await listTemplatesAction(projectId);
                            if (list.ok) setTemplates(list.data);
                            setAiTemplate(r.data.id);
                            setNewTpl(null);
                          })
                        }
                      >
                        Save template
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" className="w-full" onClick={() => setNewTpl({ name: "", description: "", instructions: "" })}>
                    <Plus className="size-3.5" /> New report template
                  </Button>
                )}
                <div className="rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">
                  <FileText className="mb-1 size-4" />
                  Templates describe audience, sections, tone and accent color. They are shared across the workspace.
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
        <DialogFooter className="flex-col gap-3 border-t px-5 py-4 sm:flex-row sm:items-end">
          <div className="grid flex-1 gap-3 sm:grid-cols-[1fr_180px]">
            <div className="space-y-1.5">
              <Label htmlFor="report-title">Report title</Label>
              <Input
                id="report-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={tab === "ai" ? "e.g. September check-in" : `${selectedName ?? "Report"} — ${bundle?.project.clientName ?? "Client"}`}
                maxLength={160}
                onKeyDown={(e) => e.key === "Enter" && (tab === "ai" ? createAi() : create())}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Date range</Label>
              <Select value={range} onValueChange={setRange}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RANGE_PRESETS.filter((p) => p.key !== "custom").map((p) => (
                    <SelectItem key={p.key} value={p.key}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {tab === "ai" ? (
            <Button onClick={createAi} disabled={pending || aiPrompt.trim().length < 3} className="sm:w-44">
              {pending ? <Loader2 className="animate-spin" /> : <Sparkles />} Generate report
            </Button>
          ) : (
            <Button onClick={create} disabled={pending || (tab === "mine" && !selected.startsWith("tpl:"))} className="sm:w-44">
              {pending ? <Loader2 className="animate-spin" /> : <Plus />} Create Report
            </Button>
          )}
        </DialogFooter>
    </>
  );
}
