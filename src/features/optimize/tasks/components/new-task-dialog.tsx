"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { TASK_CATEGORY_LIST, TASK_CATEGORY_META, type TaskCategoryKey } from "@/features/optimize/constants";
import { CategoryIcon, PriorityBadge, type MemberLite } from "@/features/optimize/shared/task-ui";
import { priorityScore } from "@/server/optimize/tasks/scoring";
import { createTaskAction } from "../actions";

export function NewTaskDialog({ projectId, members }: { projectId: string; members: MemberLite[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<TaskCategoryKey>("content");
  const [impact, setImpact] = useState(6);
  const [effort, setEffort] = useState(4);
  const [steps, setSteps] = useState("");
  const [assignee, setAssignee] = useState<string>("none");

  const submit = () =>
    start(async () => {
      const res = await createTaskAction(projectId, {
        title,
        description,
        category,
        impact,
        effort,
        steps: steps
          .split("\n")
          .map((s) => s.replace(/^\s*(\d+[.)]|[-*])\s*/, "").trim())
          .filter(Boolean),
        assigneeId: assignee === "none" ? null : assignee,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Task created");
      setOpen(false);
      setTitle("");
      setDescription("");
      setSteps("");
      router.push(`/p/${projectId}/tasks/${res.data.id}`);
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="size-3.5" /> New task
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>Manual tasks sit next to generated ones and are never auto-resolved.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="nt-title">Title</Label>
            <Input id="nt-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Add FAQ schema to the pricing page" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as TaskCategoryKey)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_CATEGORY_LIST.map((c) => (
                    <SelectItem key={c} value={c}>
                      <span className="flex items-center gap-2">
                        <CategoryIcon category={c} size="sm" className="size-5" />
                        {TASK_CATEGORY_META[c].label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Assignee</Label>
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name ?? m.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="flex justify-between">
                Impact <span className="text-muted-foreground tabular">{impact}/10</span>
              </Label>
              <Slider min={1} max={10} step={1} value={[impact]} onValueChange={(v) => setImpact(v[0] ?? impact)} />
            </div>
            <div className="space-y-2">
              <Label className="flex justify-between">
                Effort <span className="text-muted-foreground tabular">{effort}/10</span>
              </Label>
              <Slider min={1} max={10} step={1} value={[effort]} onValueChange={(v) => setEffort(v[0] ?? effort)} />
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            Priority <PriorityBadge priority={priorityScore(impact, effort)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nt-desc">Description</Label>
            <Textarea id="nt-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Why this matters (markdown supported)" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nt-steps">Steps (one per line)</Label>
            <Textarea id="nt-steps" rows={3} value={steps} onChange={(e) => setSteps(e.target.value)} placeholder={"Audit current FAQ\nWrite 5 answers\nAdd FAQPage JSON-LD"} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || title.trim().length < 3}>
            Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
