"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bot, Library, Loader2, Plus, Trash2, UserRoundPen, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { EmptyState } from "@/components/app/empty-state";
import { Panel } from "@/components/app/page";
import { ConfirmButton } from "@/components/app/misc";
import { useUrlState } from "@/hooks/use-url-state";
import { createPersonaAction, deletePersonaAction, generatePersonasAction } from "../actions";
import type { Persona } from "./generate-dialog";

export function PersonasView({
  projectId,
  personas,
  runningTopics,
  canEdit,
  aiAvailable,
}: {
  projectId: string;
  personas: Persona[];
  runningTopics: string[];
  canEdit: boolean;
  aiAvailable: boolean;
}) {
  const router = useRouter();
  const [topicFilter, setTopicFilter] = useUrlState("topic", "");
  const [newTopic, setNewTopic] = useState("");
  const [pending, start] = useTransition();
  const topics = useMemo(() => [...new Set(personas.map((p) => p.topic))].sort(), [personas]);
  const shown = topicFilter ? personas.filter((p) => p.topic === topicFilter) : personas;

  useEffect(() => {
    if (!runningTopics.length) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [runningTopics.length, router]);

  const generate = (topic: string) =>
    start(async () => {
      const res = await generatePersonasAction(projectId, topic);
      if (!res.ok) return void toast.error(res.error);
      if (res.data.mode === "queued") toast("Generating expert personas…", { description: `For “${topic}”. This takes about a minute.` });
      else toast.success(`${res.data.created} personas added for “${topic}”`);
      setNewTopic("");
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <Panel contentClassName="flex flex-col gap-3 p-3 sm:flex-row sm:items-end sm:p-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="p-topic">Build a persona library for a topic</Label>
          <p className="text-xs text-muted-foreground">
            {aiAvailable
              ? "12–16 topic-specific expert perspectives (practitioner, tester, analyst, regulator, researcher…) generated for your market."
              : "Adds the 13 built-in expert archetypes adapted to the topic. Connect an AI provider for topic-specific personas."}
          </p>
          <Input id="p-topic" value={newTopic} onChange={(e) => setNewTopic(e.target.value)} placeholder="e.g. balcony solar, trail running shoes" disabled={!canEdit} />
        </div>
        <div className="flex gap-2">
          <Button onClick={() => generate(newTopic)} disabled={!canEdit || pending || newTopic.trim().length < 2}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : aiAvailable ? <Bot className="size-3.5" /> : <Library className="size-3.5" />}
            {aiAvailable ? "Generate personas" : "Add library"}
          </Button>
          {canEdit && <NewPersonaDialog projectId={projectId} defaultTopic={topicFilter || newTopic} />}
        </div>
      </Panel>

      {runningTopics.length > 0 && (
        <div className="flex items-center gap-2 rounded-xl border bg-info/8 px-3 py-2 text-sm text-info">
          <Loader2 className="size-3.5 animate-spin" /> Generating personas for {runningTopics.map((t) => `“${t}”`).join(", ")}…
        </div>
      )}

      {topics.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setTopicFilter(null)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${!topicFilter ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`}
          >
            All topics <span className="opacity-70 tabular">{personas.length}</span>
          </button>
          {topics.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTopicFilter(t)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${topicFilter === t ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`}
            >
              {t} <span className="opacity-70 tabular">{personas.filter((p) => p.topic === t).length}</span>
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Users}
            title="No expert personas yet"
            description="Personas give drafts a credible, consistent expert perspective — choose one when generating content."
          />
        </Panel>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((p) => (
            <div key={p.id} className="group flex flex-col rounded-2xl border bg-card p-4 shadow-soft">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                  <UserRoundPen className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold leading-tight">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{p.role}</div>
                </div>
                {canEdit && (
                  <ConfirmButton title={`Delete “${p.name}”?`} destructive confirmLabel="Delete" onConfirm={async () => {
                    const res = await deletePersonaAction(projectId, p.id);
                    if (!res.ok) toast.error(res.error);
                    router.refresh();
                  }}>
                    <Button variant="ghost" size="icon" className="size-7 opacity-60 group-hover:opacity-100" aria-label="Delete persona">
                      <Trash2 className="size-3.5" />
                    </Button>
                  </ConfirmButton>
                )}
              </div>
              <p className="mt-3 text-sm text-foreground/85">{p.bio}</p>
              {p.voice && <p className="mt-2 text-xs text-muted-foreground italic">Voice: {p.voice}</p>}
              {p.expertise.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {p.expertise.map((e) => (
                    <span key={e} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      {e}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-auto flex items-center justify-between pt-3 text-[11px] text-muted-foreground">
                <span>{p.topic}</span>
                <span className="capitalize">{p.source === "ai" ? "AI-generated" : p.source === "library" ? "Library" : "Custom"}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NewPersonaDialog({ projectId, defaultTopic }: { projectId: string; defaultTopic: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ topic: defaultTopic, name: "", role: "", expertise: "", bio: "", voice: "" });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = () =>
    start(async () => {
      const res = await createPersonaAction(projectId, {
        ...form,
        expertise: form.expertise
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Persona added");
      setOpen(false);
      router.refresh();
    });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setForm((f) => ({ ...f, topic: defaultTopic || f.topic }));
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus className="size-3.5" /> Custom
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Custom persona</DialogTitle>
          <DialogDescription>Describe an expert perspective (a role, not a real person).</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Topic</Label>
            <Input value={form.topic} onChange={set("topic")} />
          </div>
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={form.name} onChange={set("name")} placeholder="The Field Engineer" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Role</Label>
            <Input value={form.role} onChange={set("role")} placeholder="Senior PV installer" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Expertise (comma-separated)</Label>
            <Input value={form.expertise} onChange={set("expertise")} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Bio</Label>
            <Textarea rows={2} value={form.bio} onChange={set("bio")} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Voice</Label>
            <Textarea rows={2} value={form.voice} onChange={set("voice")} placeholder="How this expert writes" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending || form.name.trim().length < 2 || form.role.trim().length < 2 || form.topic.trim().length < 2}>
            Add persona
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
