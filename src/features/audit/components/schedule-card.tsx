"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing, CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Panel } from "@/components/app/page";
import { saveAuditScheduleAction } from "../actions";

export type ScheduleState = {
  enabled: boolean;
  frequency: "weekly" | "monthly";
  nextRunAt: string | null;
  lastRunAt: string | null;
  config: {
    startUrl?: string;
    maxPages?: number;
    lighthouse?: boolean;
    urls?: string[];
    dropThreshold?: number;
    emails?: string[];
  };
};

export function ScheduleCard({
  projectId,
  kind,
  schedule,
  canEdit,
  defaultUrl,
  maxPagesLimit,
}: {
  projectId: string;
  kind: "site_audit" | "crawlability";
  schedule: ScheduleState | null;
  canEdit: boolean;
  defaultUrl?: string;
  maxPagesLimit?: number;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(schedule?.enabled ?? false);
  const [frequency, setFrequency] = useState<"weekly" | "monthly">(schedule?.frequency ?? "weekly");
  const [maxPages, setMaxPages] = useState(String(schedule?.config.maxPages ?? 100));
  const [startUrl, setStartUrl] = useState(schedule?.config.startUrl ?? defaultUrl ?? "");
  const [lighthouse, setLighthouse] = useState(schedule?.config.lighthouse ?? false);
  const [threshold, setThreshold] = useState(String(schedule?.config.dropThreshold ?? 5));
  const [emails, setEmails] = useState((schedule?.config.emails ?? []).join(", "));
  const [urls, setUrls] = useState((schedule?.config.urls ?? []).join("\n"));
  const [pending, start] = useTransition();
  const label = kind === "site_audit" ? "re-audit" : "crawlability check";

  const save = () =>
    start(async () => {
      const res = await saveAuditScheduleAction(projectId, {
        kind,
        enabled,
        frequency,
        startUrl: kind === "site_audit" ? startUrl : undefined,
        maxPages: kind === "site_audit" ? Math.min(Math.max(Number(maxPages) || 100, 10), maxPagesLimit ?? 100_000) : undefined,
        lighthouse: kind === "site_audit" ? lighthouse : undefined,
        lighthouseProvider: "psi",
        urls: kind === "crawlability" ? urls.split(/\s+/).filter(Boolean) : undefined,
        dropThreshold: Math.max(0, Math.min(100, Number(threshold) || 0)),
        emails: emails
          .split(/[\s,;]+/)
          .map((e) => e.trim())
          .filter(Boolean),
      });
      if (res.ok) {
        toast.success(enabled ? `${frequency === "weekly" ? "Weekly" : "Monthly"} ${label} scheduled` : "Schedule disabled");
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <Panel
      title="Scheduled runs"
      description={`Automatic ${frequency} ${label} with an alert when the score drops.`}
      icon={<CalendarClock className="size-4 text-muted-foreground" />}
      actions={<Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canEdit} aria-label="Enable schedule" />}
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Frequency</Label>
            <Select value={frequency} onValueChange={(v) => setFrequency(v as "weekly" | "monthly")} disabled={!canEdit}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${kind}-thr`} className="flex items-center gap-1.5">
              <BellRing className="size-3.5 text-muted-foreground" /> Alert on drop of
            </Label>
            <div className="flex items-center gap-2">
              <Input id={`${kind}-thr`} value={threshold} onChange={(e) => /^\d*$/.test(e.target.value) && setThreshold(e.target.value)} className="tabular" disabled={!canEdit} />
              <span className="shrink-0 text-xs text-muted-foreground">points</span>
            </div>
          </div>
        </div>
        {kind === "site_audit" && (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px]">
            <div className="space-y-1.5">
              <Label htmlFor="sched-url">Start URL</Label>
              <Input id="sched-url" value={startUrl} onChange={(e) => setStartUrl(e.target.value)} disabled={!canEdit} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sched-pages">Max pages</Label>
              <Input id="sched-pages" value={maxPages} onChange={(e) => /^\d*$/.test(e.target.value) && setMaxPages(e.target.value)} className="tabular" disabled={!canEdit} />
            </div>
          </div>
        )}
        {kind === "site_audit" && (
          <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
            <span>Include Lighthouse (PageSpeed Insights)</span>
            <Switch checked={lighthouse} onCheckedChange={setLighthouse} disabled={!canEdit} />
          </label>
        )}
        {kind === "crawlability" && (
          <div className="space-y-1.5">
            <Label htmlFor="sched-urls">Extra URLs (optional, one per line)</Label>
            <Textarea id="sched-urls" rows={2} value={urls} onChange={(e) => setUrls(e.target.value)} placeholder="https://example.com/pricing" disabled={!canEdit} />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor={`${kind}-emails`}>Also email (optional)</Label>
          <Input id={`${kind}-emails`} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="seo@company.com, cmo@company.com" disabled={!canEdit} />
          <p className="text-[11px] text-muted-foreground">You get an in-app notification and an email; set the threshold to 0 to disable alerts.</p>
        </div>
        <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground tabular" suppressHydrationWarning>
            {schedule?.enabled && schedule.nextRunAt ? `Next run ${format(new Date(schedule.nextRunAt), "EEE, MMM d · HH:mm")}` : "Not scheduled"}
            {schedule?.lastRunAt ? ` · last ${format(new Date(schedule.lastRunAt), "MMM d")}` : ""}
          </p>
          <Button onClick={save} disabled={!canEdit || pending} size="sm" className="gap-1.5">
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            Save schedule
          </Button>
        </div>
      </div>
    </Panel>
  );
}
