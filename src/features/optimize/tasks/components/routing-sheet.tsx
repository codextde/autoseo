"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Route } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { TASK_CATEGORY_LIST, TASK_CATEGORY_META, type TaskCategoryKey } from "@/features/optimize/constants";
import { CategoryIcon, type MemberLite } from "@/features/optimize/shared/task-ui";
import type { ConnectedIntegration } from "@/server/optimize/integrations/types";
import { saveTaskSettingsAction } from "../actions";
import type { OptimizeSettingsView } from "./types";

export function RoutingSheet({
  projectId,
  members,
  connected,
  settings,
  canManage,
}: {
  projectId: string;
  members: MemberLite[];
  connected: ConnectedIntegration[];
  settings: OptimizeSettingsView;
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [routing, setRouting] = useState(settings.routing);
  const [autoResolve, setAutoResolve] = useState(settings.autoResolve);
  const [pending, start] = useTransition();
  const pm = connected.filter((c) => c.kind === "pm" && c.status !== "disconnected");

  const patch = (cat: TaskCategoryKey, p: Partial<NonNullable<OptimizeSettingsView["routing"][TaskCategoryKey]>>) =>
    setRouting((r) => ({ ...r, [cat]: { ...(r[cat] ?? {}), ...p } }));

  const save = () =>
    start(async () => {
      const res = await saveTaskSettingsAction(projectId, { routing, autoResolve });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Routing saved");
      setOpen(false);
      router.refresh();
    });

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setRouting(settings.routing);
          setAutoResolve(settings.autoResolve);
        }
      }}
    >
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <Route className="size-3.5" /> Routing
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Task routing</SheetTitle>
          <SheetDescription>New tasks are assigned by category — and can be pushed to your PM tool automatically.</SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-4">
          {TASK_CATEGORY_LIST.map((cat) => {
            const rule = routing[cat] ?? {};
            return (
              <div key={cat} className="rounded-xl border p-3">
                <div className="mb-2.5 flex items-start gap-2.5">
                  <CategoryIcon category={cat} size="sm" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{TASK_CATEGORY_META[cat].label}</div>
                    <div className="text-xs text-muted-foreground">Owner: {TASK_CATEGORY_META[cat].owner}</div>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Select value={rule.assigneeId ?? "none"} onValueChange={(v) => patch(cat, { assigneeId: v === "none" ? null : v })}>
                    <SelectTrigger size="sm" className="w-full text-xs">
                      <SelectValue placeholder="Default assignee" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No default assignee</SelectItem>
                      {members.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name ?? m.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={rule.provider ?? "none"}
                    onValueChange={(v) => patch(cat, { provider: v === "none" ? null : v, autoPush: v === "none" ? false : rule.autoPush })}
                    disabled={!canManage || pm.length === 0}
                  >
                    <SelectTrigger size="sm" className="w-full text-xs">
                      <SelectValue placeholder="PM tool" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{pm.length ? "Don't push" : "No PM tool connected"}</SelectItem>
                      {pm.map((p) => (
                        <SelectItem key={p.provider} value={p.provider}>
                          {p.name}
                          {p.target ? ` · ${p.target.name}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {rule.provider && (
                  <label className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    Push new {TASK_CATEGORY_META[cat].label.toLowerCase()} tasks automatically
                    <Switch checked={!!rule.autoPush} onCheckedChange={(v) => patch(cat, { autoPush: v })} disabled={!canManage} />
                  </label>
                )}
              </div>
            );
          })}
          <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/40 p-3">
            <div>
              <Label className="text-sm">Auto-resolve</Label>
              <p className="text-xs text-muted-foreground">Mark tasks done when re-checks show the signal is gone.</p>
            </div>
            <Switch checked={autoResolve} onCheckedChange={setAutoResolve} />
          </div>
          {!canManage && <p className="text-xs text-muted-foreground">PM-tool routing requires the Integrations permission.</p>}
        </div>
        <SheetFooter>
          <Button onClick={save} disabled={pending}>
            Save routing
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
