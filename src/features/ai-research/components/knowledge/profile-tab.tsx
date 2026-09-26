"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNowStrict } from "date-fns";
import { Bot, Loader2, NotebookPen, Pencil, Pin, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Panel } from "@/components/app/page";
import { ConfirmButton } from "@/components/app/misc";
import { EmptyState } from "@/components/app/empty-state";
import { cn } from "@/lib/utils";
import { ChipsInput, ProviderNotice } from "../shared/bits";
import { useJobPoll } from "../shared/use-job-poll";
import { useStartAnalysis } from "./analysis-shell";
import { deleteContextNoteAction, saveContextNoteAction, saveProfileAction } from "../../actions/knowledge";
import { CONTEXT_CATEGORY_LABELS, type BrandProfile, type ContextCategory, type ContextNote, type KnowledgeState } from "../../types";

function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-sm">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function NoteDialog({ projectId, note, onClose }: { projectId: string; note: ContextNote | "new"; onClose: () => void }) {
  const router = useRouter();
  const init = note === "new" ? null : note;
  const [category, setCategory] = useState<ContextCategory>(init?.category ?? "business_overview");
  const [title, setTitle] = useState(init?.title ?? "");
  const [body, setBody] = useState(init?.body ?? "");
  const [pinned, setPinned] = useState(init?.pinned ?? false);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const res = await saveContextNoteAction(projectId, { id: init?.id, category, title, body, pinned });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Note saved");
      onClose();
      router.refresh();
    });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{init ? "Edit context note" : "New context note"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
            <Field label="Category">
              <NativeSelect value={category} onChange={(e) => setCategory(e.target.value as ContextCategory)} className="w-full">
                {(Object.keys(CONTEXT_CATEGORY_LABELS) as ContextCategory[]).map((c) => (
                  <NativeSelectOption key={c} value={c}>
                    {CONTEXT_CATEGORY_LABELS[c]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Title">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="e.g. Q4 goal: win comparison prompts" />
            </Field>
          </div>
          <Field label="Note" hint="Markdown supported. Agents read this as project context.">
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} maxLength={8000} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={pinned} onCheckedChange={(v) => setPinned(!!v)} /> Pin to top
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || !title.trim()}>
            {pending && <Loader2 className="size-4 animate-spin" />} Save note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProjectContext({ projectId, notes, canManage }: { projectId: string; notes: ContextNote[]; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<ContextNote | "new" | null>(null);
  const [cat, setCat] = useState<ContextCategory | "all">("all");
  const shown = notes.filter((n) => cat === "all" || n.category === cat);
  const cats = useMemo(() => [...new Set(notes.map((n) => n.category))], [notes]);
  const missing = (["business_overview", "goal", "positioning", "writing"] as ContextCategory[]).filter((c) => !notes.some((n) => n.category === c));
  return (
    <Panel
      title="Project context"
      icon={<NotebookPen className="size-4 text-muted-foreground" />}
      description="Structured notes shared with your agents (local agents, MCP, chat): goals, positioning, writing preferences, key pages and a research log."
      actions={
        canManage && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-3.5" /> Add note
          </Button>
        )
      }
      contentClassName="space-y-3 p-3 sm:p-4"
    >
      {missing.length > 0 && notes.length > 0 && (
        <p className="text-xs text-muted-foreground">Missing sections agents look for: {missing.map((m) => CONTEXT_CATEGORY_LABELS[m]).join(", ")}</p>
      )}
      {notes.length === 0 ? (
        <EmptyState
          compact
          icon={NotebookPen}
          title="No context notes yet"
          description="Tell your agents what matters: the business overview, the current goal, positioning and how you like content to be written."
          action={canManage ? { label: "Add first note", onClick: () => setEditing("new") } : undefined}
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-1">
            {(["all", ...cats] as (ContextCategory | "all")[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCat(c)}
                className={cn("rounded-md px-2 py-1 text-xs font-medium", cat === c ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground")}
              >
                {c === "all" ? `All (${notes.length})` : CONTEXT_CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
          <ul className="grid gap-3 md:grid-cols-2">
            {shown.map((n) => (
              <li key={n.id} className="flex min-w-0 flex-col rounded-xl border bg-background p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{CONTEXT_CATEGORY_LABELS[n.category]}</p>
                    <p className="flex items-center gap-1 text-sm font-medium">
                      {n.pinned && <Pin className="size-3 shrink-0 text-warning" />}
                      <span className="truncate">{n.title}</span>
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex shrink-0">
                      <Button variant="ghost" size="icon-sm" aria-label="Edit note" onClick={() => setEditing(n)}>
                        <Pencil className="size-3.5" />
                      </Button>
                      <ConfirmButton
                        title="Delete note?"
                        confirmLabel="Delete"
                        destructive
                        onConfirm={async () => {
                          const res = await deleteContextNoteAction(projectId, n.id);
                          if (!res.ok) toast.error(res.error);
                          else router.refresh();
                        }}
                      >
                        <Button variant="ghost" size="icon-sm" aria-label="Delete note" className="text-muted-foreground">
                          <Trash2 className="size-3.5" />
                        </Button>
                      </ConfirmButton>
                    </div>
                  )}
                </div>
                {n.body && <p className="mt-1.5 line-clamp-6 text-sm whitespace-pre-wrap text-muted-foreground">{n.body}</p>}
                <p className="mt-auto flex items-center gap-1 pt-2 text-[11px] text-muted-foreground">
                  {n.updatedBy !== "user" && <Bot className="size-3" />}
                  Updated by {n.updatedBy === "user" ? "a teammate" : n.updatedBy === "agent" ? "an agent" : "MCP"} · {formatDistanceToNowStrict(new Date(n.updatedAt), { addSuffix: true })}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
      {editing && <NoteDialog projectId={projectId} note={editing} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

export function ProfileTab({
  projectId,
  profile,
  state,
  notes,
  canEditProfile,
  canManage,
  providers,
}: {
  projectId: string;
  profile: BrandProfile;
  state: KnowledgeState<Record<string, unknown>>;
  notes: ContextNote[];
  canEditProfile: boolean;
  canManage: boolean;
  providers: { llm: boolean };
}) {
  const router = useRouter();
  const [p, setP] = useState(profile);
  const [pending, start] = useTransition();
  const running = state.status === "running";
  const job = useJobPoll(projectId, running ? state.jobId : null, { intervalMs: 4000 });
  const research = useStartAnalysis(projectId, "profile");
  const dirty = JSON.stringify(p) !== JSON.stringify(profile);
  const disabled = !canEditProfile;

  const save = () =>
    start(async () => {
      const res = await saveProfileAction(projectId, {
        name: p.name,
        description: p.description,
        industry: p.industry,
        aliases: p.aliases,
        domains: p.domains,
        valueProps: p.valueProps,
        tone: p.tone,
        categories: p.categories,
        audience: p.audience,
        differentiators: p.differentiators,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Brand profile saved");
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <Panel
        title="Brand profile"
        description="Used everywhere: brand detection in AI answers, prompt generation, personas and content."
        actions={
          <>
            {canManage && (
              <Button size="sm" variant="outline" onClick={research.run} disabled={research.pending || running || !providers.llm}>
                {running || research.pending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                {running ? "Researching…" : "Research with AI"}
              </Button>
            )}
            {canEditProfile && (
              <Button size="sm" onClick={save} disabled={pending || !dirty}>
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save
              </Button>
            )}
          </>
        }
        contentClassName="space-y-4 p-4 sm:p-5"
      >
        {running && (
          <p className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> {job?.progress?.message ?? "Researching your brand…"} Empty fields are filled automatically; your edits are never overwritten.
          </p>
        )}
        {state.status === "failed" && state.error && <p className="rounded-lg bg-destructive/5 px-3 py-2 text-xs text-destructive">AI research failed: {state.error}</p>}
        {!providers.llm && canManage && (
          <ProviderNotice title="AI research unavailable" href="/admin/ai" linkLabel="AI Providers" tone="info">
            Connect a local agent or API key to research the profile automatically.
          </ProviderNotice>
        )}
        {disabled && <p className="text-xs text-muted-foreground">Only members who can configure projects can edit the brand profile.</p>}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Brand name">
            <Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} disabled={disabled} maxLength={120} />
          </Field>
          <Field label="Industry">
            <Input value={p.industry} onChange={(e) => setP({ ...p, industry: e.target.value })} disabled={disabled} maxLength={160} placeholder="e.g. Solar energy / balcony power plants" />
          </Field>
          <Field label="Description" className="md:col-span-2">
            <Textarea value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} disabled={disabled} rows={3} maxLength={2000} />
          </Field>
          <Field label="Aliases" hint="Spellings and product lines that count as your brand in AI answers.">
            <ChipsInput value={p.aliases} onChange={(v) => setP({ ...p, aliases: v })} disabled={disabled} placeholder="Add alias" />
          </Field>
          <Field label="Own domains" hint={`${p.primaryDomain} is always included. Citations of these domains count as own citations.`}>
            <ChipsInput value={p.domains} onChange={(v) => setP({ ...p, domains: v })} disabled={disabled} placeholder="shop.example.com" />
          </Field>
          <Field label="Product / service categories">
            <ChipsInput value={p.categories} onChange={(v) => setP({ ...p, categories: v })} disabled={disabled} placeholder="Add category" />
          </Field>
          <Field label="Value propositions">
            <ChipsInput value={p.valueProps} onChange={(v) => setP({ ...p, valueProps: v })} disabled={disabled} placeholder="Add value proposition" max={20} />
          </Field>
          <Field label="Differentiators">
            <ChipsInput value={p.differentiators} onChange={(v) => setP({ ...p, differentiators: v })} disabled={disabled} placeholder="What sets you apart" max={20} />
          </Field>
          <Field label="Tone of voice">
            <Input value={p.tone} onChange={(e) => setP({ ...p, tone: e.target.value })} disabled={disabled} maxLength={500} placeholder="e.g. friendly, clear, no jargon" />
          </Field>
          <Field label="Audience" className="md:col-span-2">
            <Textarea value={p.audience} onChange={(e) => setP({ ...p, audience: e.target.value })} disabled={disabled} rows={2} maxLength={1000} />
          </Field>
        </div>
        {profile.generatedAt && <p className="text-[11px] text-muted-foreground">AI research last ran {formatDistanceToNowStrict(new Date(profile.generatedAt), { addSuffix: true })}.</p>}
      </Panel>
      <ProjectContext projectId={projectId} notes={notes} canManage={canManage} />
    </div>
  );
}
