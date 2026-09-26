"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquareText, Pencil, Plus, Sparkles, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmButton } from "@/components/app/misc";
import { AnalysisShell } from "./analysis-shell";
import { FunnelIcon, ProviderNotice, ToggleChip } from "../shared/bits";
import { deletePersonaAction, generatePersonaPromptsAction, savePersonaAction } from "../../actions/knowledge";
import { FUNNEL_LABELS, type FunnelStage, type KnowledgeState, type Persona, type PersonasData } from "../../types";

const EMPTY: Persona = { id: "", name: "", role: "", description: "", goals: [], pains: [], questions: [], funnelStage: "tofu", share: null };

function lines(s: string) {
  return s
    .split("\n")
    .map((l) => l.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
}

function PersonaDialog({ projectId, persona, onClose }: { projectId: string; persona: Persona | null; onClose: () => void }) {
  const router = useRouter();
  const [p, setP] = useState<Persona>(persona ?? EMPTY);
  const [goals, setGoals] = useState((persona?.goals ?? []).join("\n"));
  const [pains, setPains] = useState((persona?.pains ?? []).join("\n"));
  const [questions, setQuestions] = useState((persona?.questions ?? []).join("\n"));
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const res = await savePersonaAction(projectId, {
        id: p.id || undefined,
        name: p.name,
        role: p.role,
        description: p.description,
        goals: lines(goals).slice(0, 12),
        pains: lines(pains).slice(0, 12),
        questions: lines(questions).slice(0, 20),
        funnelStage: p.funnelStage,
        share: p.share ?? null,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Persona saved");
      onClose();
      router.refresh();
    });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="border-b p-4">
          <DialogTitle>{persona?.id ? "Edit persona" : "New persona"}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} maxLength={120} placeholder="e.g. Eco-conscious renter Anna" />
            </div>
            <div className="space-y-1">
              <Label>Role / situation</Label>
              <Input value={p.role} onChange={(e) => setP({ ...p, role: e.target.value })} maxLength={200} placeholder="Tenant in a city apartment" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} rows={3} maxLength={2000} />
          </div>
          <div className="space-y-1">
            <Label>Funnel stage</Label>
            <div className="flex flex-wrap gap-1.5">
              {(["tofu", "mofu", "bofu"] as FunnelStage[]).map((s) => (
                <ToggleChip key={s} active={p.funnelStage === s} onClick={() => setP({ ...p, funnelStage: s })}>
                  <FunnelIcon stage={s} withTooltip={false} className="size-3.5" /> {FUNNEL_LABELS[s]}
                </ToggleChip>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Goals (one per line)</Label>
              <Textarea value={goals} onChange={(e) => setGoals(e.target.value)} rows={4} />
            </div>
            <div className="space-y-1">
              <Label>Pains (one per line)</Label>
              <Textarea value={pains} onChange={(e) => setPains(e.target.value)} rows={4} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Typical AI questions (one per line)</Label>
            <Textarea value={questions} onChange={(e) => setQuestions(e.target.value)} rows={5} />
          </div>
          <div className="space-y-1">
            <Label>Share of audience (%)</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={p.share ?? ""}
              onChange={(e) => setP({ ...p, share: e.target.value === "" ? null : Math.max(0, Math.min(100, Number(e.target.value))) })}
              className="w-28"
            />
          </div>
        </div>
        <DialogFooter className="m-0 rounded-b-xl border-t bg-muted/50 p-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || !p.name.trim()}>
            {pending && <Loader2 className="size-4 animate-spin" />} Save persona
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PersonaCard({ projectId, p, canManage, onEdit, canGenerate }: { projectId: string; p: Persona; canManage: boolean; onEdit: () => void; canGenerate: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const generate = () =>
    start(async () => {
      const res = await generatePersonaPromptsAction(projectId, p.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Generating 20 prompts for ${p.name}…`);
      router.push(`/p/${projectId}/ai/prompt-research?list=${res.data.listId}&personas=${encodeURIComponent(p.name)}`);
    });
  return (
    <article className="flex min-w-0 flex-col rounded-2xl border bg-card p-4 shadow-soft">
      <header className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand">
          {p.name
            .split(/\s+/)
            .slice(-2)
            .map((w) => w[0])
            .join("")
            .toUpperCase() || <UserRound className="size-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{p.name}</h3>
          <p className="truncate text-xs text-muted-foreground">{p.role}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <FunnelIcon stage={p.funnelStage} />
          {p.share != null && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular">{p.share}%</span>}
        </div>
      </header>
      {p.description && <p className="mt-3 text-sm text-muted-foreground">{p.description}</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Goals</p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {p.goals.map((g) => (
              <li key={g} className="flex gap-1.5">
                <span className="text-success">+</span>
                {g}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Pains</p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {p.pains.map((g) => (
              <li key={g} className="flex gap-1.5">
                <span className="text-destructive">−</span>
                {g}
              </li>
            ))}
          </ul>
        </div>
      </div>
      {p.questions.length > 0 && (
        <div className="mt-3 rounded-xl bg-muted/60 p-3">
          <p className="flex items-center gap-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            <MessageSquareText className="size-3" /> Asks AI
          </p>
          <ul className="mt-1.5 space-y-1 text-xs">
            {p.questions.slice(0, 5).map((q) => (
              <li key={q}>“{q}”</li>
            ))}
          </ul>
        </div>
      )}
      {canManage && (
        <footer className="mt-auto flex flex-wrap items-center gap-1.5 pt-4">
          <Button size="sm" onClick={generate} disabled={pending || !canGenerate}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Generate prompts
          </Button>
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <Pencil className="size-3.5" /> Edit
          </Button>
          <ConfirmButton
            title={`Delete ${p.name}?`}
            description="The persona is removed from Brand Knowledge. Prompts already generated for it stay."
            confirmLabel="Delete"
            destructive
            onConfirm={async () => {
              const res = await deletePersonaAction(projectId, p.id);
              if (!res.ok) toast.error(res.error);
              else router.refresh();
            }}
          >
            <Button size="sm" variant="ghost" className="text-muted-foreground">
              <Trash2 className="size-3.5" />
            </Button>
          </ConfirmButton>
        </footer>
      )}
    </article>
  );
}

export function PersonasTab({
  projectId,
  state,
  canManage,
  providers,
}: {
  projectId: string;
  state: KnowledgeState<PersonasData>;
  canManage: boolean;
  providers: { llm: boolean };
}) {
  const [editing, setEditing] = useState<Persona | null | "new">(null);
  const personas = state.data?.personas ?? [];
  return (
    <>
      <AnalysisShell
        projectId={projectId}
        kind="personas"
        state={state}
        canManage={canManage}
        source="Your audience"
        hasData={personas.length > 0}
        estimate="This usually takes a few minutes."
        blocked={
          !providers.llm ? (
            <div className="space-y-3">
              <ProviderNotice title="No AI provider available" href="/admin/ai" linkLabel="AI Providers">
                Personas are researched by your local agent or an AI API. You can also add personas manually.
              </ProviderNotice>
              {canManage && (
                <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
                  <Plus className="size-3.5" /> Add persona manually
                </Button>
              )}
            </div>
          ) : undefined
        }
        intro={
          <>
            <p className="text-base font-semibold text-foreground">Who buys from you?</p>
            <p>We research your brand, category and interest clusters and build buyer personas — with goals, pains and the questions they ask AI assistants. Personas feed the Prompt Set Helper.</p>
          </>
        }
      >
        {personas.length > 0 && (
          <div className="space-y-3">
            {canManage && (
              <div className="flex justify-end">
                <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
                  <Plus className="size-3.5" /> Add persona
                </Button>
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {personas.map((p) => (
                <PersonaCard key={p.id} projectId={projectId} p={p} canManage={canManage} canGenerate={providers.llm} onEdit={() => setEditing(p)} />
              ))}
            </div>
          </div>
        )}
      </AnalysisShell>
      {editing && <PersonaDialog projectId={projectId} persona={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
