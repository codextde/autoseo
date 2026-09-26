"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Bot,
  CalendarDays,
  CircleCheck,
  ExternalLink,
  FilePlus2,
  History,
  Link2,
  ListChecks,
  MessageSquare,
  MoreHorizontal,
  PenLine,
  Radar,
  Send,
  Sparkles,
  Target,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PageContainer, Panel } from "@/components/app/page";
import { TimeAgo } from "@/components/app/misc";
import { IntegrationConnect, PushToPmButton } from "@/features/optimize/integrations/components";
import { ProviderGlyph } from "@/features/optimize/integrations/components/provider-glyph";
import type { ConnectedIntegration } from "@/server/optimize/integrations/types";
import type { optimizeTasks } from "@/server/db/schema/optimize";
import { priorityScore } from "@/server/optimize/tasks/scoring";
import { PROVIDER_LABELS, TASK_CATEGORY_META, type TaskStatusKey } from "@/features/optimize/constants";
import { CategoryBadge, MemberAvatar, PriorityBadge, ScoreDots, type MemberLite } from "@/features/optimize/shared/task-ui";
import { Markdown } from "@/features/optimize/shared/markdown";
import { createContentFromTaskAction } from "@/features/optimize/content/actions";
import {
  assignTasksAction,
  commentOnTaskAction,
  deleteTasksAction,
  setTaskStatusAction,
  toggleTaskStepAction,
  updateTaskAction,
} from "../actions";
import { safeHttpUrl } from "@/features/optimize/shared/safe-url";
import { EvidenceView } from "./evidence-view";
import { StatusMenu, StatusPill } from "./status";
import { PageCrumb } from "@/components/app/page-crumb";

type Task = typeof optimizeTasks.$inferSelect;
type Activity = {
  id: string;
  kind: string;
  body: string | null;
  createdAt: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  userAvatar: string | null;
};

type Props = {
  projectId: string;
  task: Omit<Task, "createdAt" | "updatedAt" | "firstDetectedAt" | "lastDetectedAt" | "resolvedAt"> & {
    createdAt: string;
    updatedAt: string;
    firstDetectedAt: string;
    lastDetectedAt: string;
    resolvedAt: string | null;
  };
  activity: Activity[];
  members: MemberLite[];
  connected: ConnectedIntegration[];
  canEdit: boolean;
  canManage: boolean;
  contentLinks: { id: string; title: string; status: string }[];
};

const ACTIVITY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  created: Radar,
  comment: MessageSquare,
  auto_resolved: Sparkles,
  pushed: Send,
  synced: Link2,
  step: ListChecks,
  edited: PenLine,
  priority: PenLine,
  evidence: History,
  reopened: History,
};

export function TaskDetail({ projectId, task, activity, members, connected, canEdit, canManage, contentLinks }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [comment, setComment] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [impact, setImpact] = useState(task.impact);
  const [effort, setEffort] = useState(task.effort);
  const memberMap = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const assignee = task.assigneeId ? memberMap.get(task.assigneeId) : null;
  const done = task.steps.filter((s) => s.done).length;
  const datasets = Array.isArray(task.signalData?.datasets) ? (task.signalData.datasets as string[]) : [];
  const meta = TASK_CATEGORY_META[task.category];

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? "Something went wrong");
      if (success) toast.success(success);
      router.refresh();
    });

  const setStatus = (s: TaskStatusKey) => act(() => setTaskStatusAction(projectId, [task.id], s), `Marked as ${s.replace("_", " ")}`);
  const setAssignee = (id: string | null) => act(() => assignTasksAction(projectId, [task.id], id), id ? "Assigned" : "Unassigned");
  const toggleStep = (stepId: string, value: boolean) => act(() => toggleTaskStepAction(projectId, task.id, stepId, value));
  const savePriority = () => act(() => updateTaskAction(projectId, task.id, { impact, effort }), "Priority updated");
  const postComment = () =>
    start(async () => {
      const res = await commentOnTaskAction(projectId, task.id, comment);
      if (!res.ok) return void toast.error(res.error);
      setComment("");
      router.refresh();
    });
  const draftContent = () =>
    start(async () => {
      const res = await createContentFromTaskAction(projectId, task.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Draft created from the content plan");
      router.push(`/p/${projectId}/content/${res.data.id}`);
    });

  const plan = task.contentPlan;
  const planHasContent = !!plan && Object.values(plan).some((v) => (Array.isArray(v) ? v.length > 0 : !!v));

  return (
    <PageContainer className="max-w-[1280px]">
      <div className="flex flex-col gap-4">
        <Link href={`/p/${projectId}/tasks`} className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> All tasks
        </Link>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CategoryBadge category={task.category} />
              <PriorityBadge priority={task.priority} impact={task.impact} effort={task.effort} />
              {task.status === "done" && task.resolution === "auto" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-success/12 px-2 py-0.5 text-[11px] font-medium text-success">
                  <Sparkles className="size-3" /> Auto-resolved <TimeAgo date={task.resolvedAt} />
                </span>
              )}
              {task.source === "generator" && !task.signalActive && task.status !== "done" && (
                <span className="rounded-full bg-success/12 px-2 py-0.5 text-[11px] font-medium text-success">Signal no longer detected</span>
              )}
              {task.source === "generator" && task.signalActive && task.status === "done" && task.resolution === "manual" && (
                <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">Marked done — signal still detected</span>
              )}
            </div>
            <PageCrumb label={task.title} />
            <h1 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">{task.title}</h1>
            {task.summary && <p className="max-w-3xl text-sm text-muted-foreground">{task.summary}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? <StatusMenu value={task.status} onChange={setStatus} disabled={pending} /> : <StatusPill status={task.status} />}
            <IntegrationConnect projectId={projectId} kind="pm" connected={connected} canManage={canManage} />
            <PushToPmButton projectId={projectId} taskIds={[task.id]} connected={connected} canEdit={canEdit} />
            {canEdit && task.status !== "done" && (
              <Button size="sm" onClick={() => setStatus("done")} disabled={pending}>
                <CircleCheck className="size-3.5" /> Mark done
              </Button>
            )}
            {canEdit && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="size-7" aria-label="More actions">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setEditOpen(true)}>
                    <PenLine className="size-3.5" /> Edit task
                  </DropdownMenuItem>
                  {planHasContent && (
                    <DropdownMenuItem onClick={draftContent}>
                      <FilePlus2 className="size-3.5" /> Draft content from plan
                    </DropdownMenuItem>
                  )}
                  {task.status !== "dismissed" && <DropdownMenuItem onClick={() => setStatus("dismissed")}>Dismiss</DropdownMenuItem>}
                  {task.status !== "open" && <DropdownMenuItem onClick={() => setStatus("open")}>Reopen</DropdownMenuItem>}
                  {task.source === "manual" && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() =>
                          start(async () => {
                            const res = await deleteTasksAction(projectId, [task.id]);
                            if (!res.ok) return void toast.error(res.error);
                            router.push(`/p/${projectId}/tasks`);
                          })
                        }
                      >
                        <Trash2 className="size-3.5" /> Delete
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          {task.description && (
            <Panel title="Why this matters">
              <Markdown>{task.description}</Markdown>
              {datasets.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  Based on
                  {datasets.map((d) => (
                    <span key={d} className="rounded-md bg-muted px-1.5 py-0.5 font-medium">
                      {d}
                    </span>
                  ))}
                </div>
              )}
            </Panel>
          )}

          {task.steps.length > 0 && (
            <Panel
              title="Steps"
              icon={<ListChecks className="size-4 text-muted-foreground" />}
              actions={
                <span className="text-xs text-muted-foreground tabular">
                  {done}/{task.steps.length} done
                </span>
              }
            >
              <Progress value={(done / task.steps.length) * 100} className="mb-3 h-1.5" />
              <ol className="space-y-1">
                {task.steps.map((s, i) => (
                  <li key={s.id}>
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-muted/60">
                      <Checkbox
                        className="mt-0.5"
                        checked={s.done}
                        disabled={!canEdit || pending}
                        onCheckedChange={(v) => toggleStep(s.id, v === true)}
                      />
                      <span className="w-5 shrink-0 text-xs text-muted-foreground tabular">{i + 1}.</span>
                      <span className={s.done ? "text-sm text-muted-foreground line-through" : "text-sm"}>{s.text}</span>
                    </label>
                  </li>
                ))}
              </ol>
            </Panel>
          )}

          {task.acceptanceCriteria.length > 0 && (
            <Panel title="Acceptance criteria" icon={<Target className="size-4 text-muted-foreground" />} description={task.autoResolvable && task.source === "generator" ? "Re-checked automatically on every analysis — the task resolves itself once the signal is gone." : undefined}>
              <ul className="space-y-2">
                {task.acceptanceCriteria.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <CircleCheck className={`mt-0.5 size-4 shrink-0 ${task.status === "done" ? "text-success" : "text-muted-foreground/50"}`} />
                    {c}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title="Evidence" description={`Last detected ${new Date(task.lastDetectedAt).toLocaleString()}`}>
            <EvidenceView evidence={task.evidence} />
          </Panel>

          {planHasContent && plan && (
            <Panel
              title="Content plan"
              icon={<FilePlus2 className="size-4 text-muted-foreground" />}
              actions={
                canEdit ? (
                  <Button size="sm" variant="outline" onClick={draftContent} disabled={pending}>
                    <Sparkles className="size-3.5" /> Draft in Content
                  </Button>
                ) : undefined
              }
            >
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                {plan.workingTitle && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-muted-foreground">Working title</dt>
                    <dd className="font-medium">{plan.workingTitle}</dd>
                  </div>
                )}
                {plan.format && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Format</dt>
                    <dd>{plan.format}</dd>
                  </div>
                )}
                {(plan.targetPrompt || plan.targetKeyword) && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Target</dt>
                    <dd>{plan.targetPrompt ?? plan.targetKeyword}</dd>
                  </div>
                )}
                {plan.wordCount ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Length</dt>
                    <dd className="tabular">~{plan.wordCount.toLocaleString()} words</dd>
                  </div>
                ) : null}
                {plan.schemaTypes?.length ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Schema</dt>
                    <dd>{plan.schemaTypes.join(", ")}</dd>
                  </div>
                ) : null}
              </dl>
              {plan.outline?.length ? (
                <div className="mt-4">
                  <div className="mb-1.5 text-xs text-muted-foreground">Outline</div>
                  <ol className="space-y-1 text-sm">
                    {plan.outline.map((o, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="w-6 shrink-0 text-xs text-muted-foreground tabular">H2</span>
                        {o}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
              {plan.questions?.length ? (
                <div className="mt-4">
                  <div className="mb-1.5 text-xs text-muted-foreground">Questions to answer</div>
                  <div className="flex flex-wrap gap-1.5">
                    {plan.questions.map((q) => (
                      <span key={q} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                        {q}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {plan.notes && <p className="mt-4 text-xs text-muted-foreground">{plan.notes}</p>}
              {contentLinks.length > 0 && (
                <div className="mt-4 space-y-1 border-t pt-3">
                  <div className="text-xs text-muted-foreground">Drafts from this task</div>
                  {contentLinks.map((c) => (
                    <Link key={c.id} href={`/p/${projectId}/content/${c.id}`} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
                      <span className="truncate">{c.title}</span>
                      <span className="text-xs text-muted-foreground capitalize">{c.status.replace("_", " ")}</span>
                    </Link>
                  ))}
                </div>
              )}
            </Panel>
          )}

          {(task.targetUrls.length > 0 || task.targetPrompts.length > 0) && (
            <Panel title="Targets">
              <div className="grid gap-4 sm:grid-cols-2">
                {task.targetUrls.length > 0 && (
                  <div className="min-w-0">
                    <div className="mb-1.5 text-xs text-muted-foreground">URLs</div>
                    <ul className="space-y-1">
                      {task.targetUrls.filter((u) => (u.startsWith("/") && !u.startsWith("//")) || safeHttpUrl(u)).map((u) => (
                        <li key={u} className="min-w-0">
                          <a
                            href={u}
                            target={u.startsWith("/") ? undefined : "_blank"}
                            rel="noopener noreferrer nofollow"
                            className="flex items-center gap-1.5 truncate text-sm text-brand hover:underline"
                          >
                            <ExternalLink className="size-3 shrink-0" />
                            <span className="truncate">{u.replace(/^https?:\/\/(www\.)?/, "")}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {task.targetPrompts.length > 0 && (
                  <div className="min-w-0">
                    <div className="mb-1.5 text-xs text-muted-foreground">Prompts</div>
                    <ul className="space-y-1 text-sm">
                      {task.targetPrompts.map((p) => (
                        <li key={p} className="line-clamp-2">
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Panel>
          )}
        </div>

        <aside className="min-w-0 space-y-4">
          <Panel title="Details" contentClassName="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Assignee</Label>
              {canEdit ? (
                <Select value={task.assigneeId ?? "none"} onValueChange={(v) => setAssignee(v === "none" ? null : v)} disabled={pending}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {members.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        <span className="flex items-center gap-2">
                          <MemberAvatar member={m} size="xs" /> {m.name ?? m.email}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex items-center gap-2 text-sm">
                  <MemberAvatar member={assignee} /> {assignee ? (assignee.name ?? assignee.email) : "Unassigned"}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">Owner: {meta.owner}</p>
            </div>

            <div className="space-y-3 rounded-xl bg-muted/50 p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Impact</span>
                <span className="flex items-center gap-2 tabular">
                  <ScoreDots value={impact} /> {impact}/10
                </span>
              </div>
              {canEdit && <Slider min={1} max={10} step={1} value={[impact]} onValueChange={(v) => setImpact(v[0] ?? impact)} />}
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Effort</span>
                <span className="flex items-center gap-2 tabular">
                  <ScoreDots value={effort} tone="muted" /> {effort}/10
                </span>
              </div>
              {canEdit && <Slider min={1} max={10} step={1} value={[effort]} onValueChange={(v) => setEffort(v[0] ?? effort)} />}
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Priority score</span>
                <PriorityBadge priority={priorityScore(impact, effort)} />
              </div>
              {canEdit && (impact !== task.impact || effort !== task.effort) && (
                <Button size="sm" className="w-full" onClick={savePriority} disabled={pending}>
                  Save priority
                </Button>
              )}
            </div>

            <dl className="space-y-2 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Status</dt>
                <dd>
                  <StatusPill status={task.status} />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="flex items-center gap-1 text-muted-foreground">
                  <CalendarDays className="size-3" /> Due
                </dt>
                <dd>
                  {canEdit ? (
                    <Input
                      type="date"
                      defaultValue={task.dueDate ?? ""}
                      className="h-7 w-36 text-xs"
                      onBlur={(e) => {
                        const v = e.target.value || null;
                        if (v !== task.dueDate) act(() => updateTaskAction(projectId, task.id, { dueDate: v }), "Due date saved");
                      }}
                    />
                  ) : (
                    (task.dueDate ?? "—")
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">First detected</dt>
                <dd>
                  <TimeAgo date={task.firstDetectedAt} />
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Last re-checked</dt>
                <dd>
                  <TimeAgo date={task.lastDetectedAt} />
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Source</dt>
                <dd className="flex items-center gap-1">
                  {task.source === "manual" ? "Created manually" : task.writtenBy === "ai" ? (
                    <>
                      <Bot className="size-3" /> AI-written from signals
                    </>
                  ) : task.writtenBy === "user" ? (
                    "Edited by the team"
                  ) : (
                    "Generated from signals"
                  )}
                </dd>
              </div>
            </dl>

            {task.external.length > 0 && (
              <div className="space-y-1.5 border-t pt-3">
                <div className="text-xs text-muted-foreground">Synced to</div>
                {task.external.map((e) => (
                  <a
                    key={`${e.provider}-${e.externalId}`}
                    href={safeHttpUrl(e.url) ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <ProviderGlyph provider={e.provider} size="sm" />
                    <span className="min-w-0 flex-1 truncate">{PROVIDER_LABELS[e.provider] ?? e.provider}</span>
                    {e.status && <span className="text-[11px] text-muted-foreground capitalize">{e.status.replace("_", " ")}</span>}
                    {safeHttpUrl(e.url) && <ExternalLink className="size-3 text-muted-foreground" />}
                  </a>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Activity" icon={<History className="size-4 text-muted-foreground" />} contentClassName="space-y-4">
            {canEdit && (
              <div className="space-y-2">
                <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment…" rows={2} className="text-sm" />
                <div className="flex justify-end">
                  <Button size="sm" onClick={postComment} disabled={pending || !comment.trim()}>
                    <MessageSquare className="size-3.5" /> Comment
                  </Button>
                </div>
              </div>
            )}
            <ol className="relative space-y-3 before:absolute before:top-2 before:bottom-2 before:left-[11px] before:w-px before:bg-border">
              {activity.map((a) => {
                const Icon = ACTIVITY_ICON[a.kind] ?? History;
                const actor = a.userId ? { name: a.userName, email: a.userEmail ?? "", avatarUrl: a.userAvatar, id: a.userId } : null;
                return (
                  <li key={a.id} className="relative flex gap-3">
                    {actor ? (
                      <MemberAvatar member={actor} size="xs" className="relative z-[1] mt-0.5 ring-2 ring-card" />
                    ) : (
                      <span className="relative z-[1] mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted ring-2 ring-card">
                        <Icon className="size-3 text-muted-foreground" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{actor ? (actor.name ?? actor.email) : "AutoSEO"}</span> ·{" "}
                        <TimeAgo date={a.createdAt} />
                      </div>
                      {a.body && (
                        <div className={a.kind === "comment" ? "mt-1 rounded-lg bg-muted/60 px-2.5 py-1.5 text-sm whitespace-pre-wrap" : "mt-0.5 text-sm"}>
                          {a.body}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
              {activity.length === 0 && <li className="text-sm text-muted-foreground">No activity yet.</li>}
            </ol>
          </Panel>
        </aside>
      </div>

      {canEdit && <EditTaskDialog open={editOpen} onOpenChange={setEditOpen} projectId={projectId} task={task} />}
    </PageContainer>
  );
}

function EditTaskDialog({
  open,
  onOpenChange,
  projectId,
  task,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  task: Props["task"];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(task.title);
  const [summary, setSummary] = useState(task.summary);
  const [description, setDescription] = useState(task.description);
  const [steps, setSteps] = useState(task.steps.map((s) => s.text).join("\n"));
  const [criteria, setCriteria] = useState(task.acceptanceCriteria.join("\n"));
  const lines = (s: string) =>
    s
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  const save = () =>
    start(async () => {
      const res = await updateTaskAction(projectId, task.id, { title, summary, description, steps: lines(steps), acceptanceCriteria: lines(criteria) });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Task updated");
      onOpenChange(false);
      router.refresh();
    });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit task</DialogTitle>
          <DialogDescription>Edited texts are kept on re-analysis — evidence keeps updating.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Summary</Label>
            <Input value={summary} onChange={(e) => setSummary(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Description (markdown)</Label>
            <Textarea rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Steps (one per line)</Label>
              <Textarea rows={6} value={steps} onChange={(e) => setSteps(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Acceptance criteria (one per line)</Label>
              <Textarea rows={6} value={criteria} onChange={(e) => setCriteria(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || title.trim().length < 3}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
