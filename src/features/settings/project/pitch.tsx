"use client";

import { useState } from "react";
import { differenceInCalendarDays, format } from "date-fns";
import { CalendarClock, Loader2, Presentation, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/app/page";
import { ConfirmButton } from "@/components/app/misc";
import { Meter } from "@/components/app/metrics";
import { cn } from "@/lib/utils";
import { setProjectPitchAction } from "../project-actions";
import { ReadOnlyNotice, type ProjectSettingsData } from "./shared";

const DAY_OPTIONS = [7, 14, 30, 60, 90];

export function PitchSettings({
  project,
  canManage,
  defaultDays,
  allowPitch,
}: {
  project: ProjectSettingsData;
  canManage: boolean;
  defaultDays: number;
  allowPitch: boolean;
}) {
  const [days, setDays] = useState(defaultDays);
  const [busy, setBusy] = useState(false);
  const expires = project.pitchExpiresAt ? new Date(project.pitchExpiresAt) : null;
  const created = new Date(project.createdAt);
  const left = expires ? differenceInCalendarDays(expires, new Date()) : null;
  const total = expires ? Math.max(1, differenceInCalendarDays(expires, created)) : 1;
  const options = [...new Set([...DAY_OPTIONS, defaultDays])].sort((a, b) => a - b);

  const run = async (isPitch: boolean, d?: number) => {
    setBusy(true);
    try {
      const res = await setProjectPitchAction(project.id, { isPitch, days: d });
      if (!res.ok) return void toast.error(res.error);
      toast.success(isPitch ? "Pitch period updated" : "Converted to a regular project");
    } finally {
      setBusy(false);
    }
  };

  const dayPicker = (
    <div className="flex flex-wrap gap-1.5">
      {options.map((n) => (
        <button
          key={n}
          type="button"
          disabled={!canManage}
          onClick={() => setDays(n)}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium tabular transition-colors disabled:opacity-50",
            days === n ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
          )}
        >
          {n} days
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      {!canManage && <ReadOnlyNotice />}
      {project.isPitch ? (
        <Panel
          title="Pitch project"
          icon={<Presentation className="size-4 text-warning" />}
          description="Pitch projects are temporary — they are archived automatically when the pitch period ends."
          actions={
            <Badge variant="secondary" className={cn("h-6 gap-1", left != null && left <= 3 ? "bg-destructive/10 text-destructive" : "bg-warning/15 text-warning")}>
              <CalendarClock className="size-3" />
              {left == null ? "No expiry" : left < 0 ? "Expired" : left === 0 ? "Expires today" : `${left} day${left === 1 ? "" : "s"} left`}
            </Badge>
          }
        >
          <div className="space-y-5">
            {expires && (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-muted-foreground">Expires</span>
                  <span className="font-medium tabular">{format(expires, "PPP")}</span>
                </div>
                <Meter value={Math.max(0, total - Math.max(0, left ?? 0))} max={total} tone={left != null && left <= 3 ? "destructive" : "warning"} />
              </div>
            )}
            <div className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">Won the pitch?</p>
                <p className="text-xs text-muted-foreground">Convert it into a regular project — all data is kept and it never expires.</p>
              </div>
              <ConfirmButton
                title="Convert to a regular project?"
                description="The project will no longer expire. All prompts, runs and reports are kept."
                confirmLabel="Convert"
                onConfirm={() => run(false)}
              >
                <Button disabled={!canManage || busy} className="shrink-0 gap-1.5">
                  <Sparkles className="size-4" /> Convert to regular project
                </Button>
              </ConfirmButton>
            </div>
            <div className="space-y-3">
              <p className="text-sm font-medium">Extend the pitch</p>
              <p className="text-xs text-muted-foreground">Sets a new expiry counted from today.</p>
              {dayPicker}
              <Button variant="outline" size="sm" disabled={!canManage || busy} onClick={() => void run(true, days)}>
                {busy && <Loader2 className="size-3.5 animate-spin" />} Expire in {days} days
              </Button>
            </div>
          </div>
        </Panel>
      ) : (
        <Panel title="Pitch mode" icon={<Presentation className="size-4 text-muted-foreground" />} description="Regular project — it never expires.">
          {allowPitch ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Turn this into a temporary pitch project (e.g. for a sales pitch). It will be archived automatically after the chosen period.
              </p>
              {dayPicker}
              <ConfirmButton
                title={`Turn into a pitch project?`}
                description={`The project will be archived automatically in ${days} days unless you convert it back.`}
                confirmLabel="Make pitch project"
                onConfirm={() => run(true, days)}
              >
                <Button variant="outline" size="sm" disabled={!canManage || busy}>
                  Make pitch project ({days} days)
                </Button>
              </ConfirmButton>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Pitch projects are disabled on this instance (Admin → Onboarding).</p>
          )}
        </Panel>
      )}
    </div>
  );
}
