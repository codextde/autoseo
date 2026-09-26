"use client";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/app/misc";
import { saveAdvancedAction } from "../actions";

export function AdvancedSettings({
  projectId,
  canManage,
  reportingCurrency,
  allowedDomains,
  publicKey,
}: {
  projectId: string;
  canManage: boolean;
  reportingCurrency: string;
  allowedDomains: string[];
  publicKey: string;
}) {
  const [currency, setCurrency] = useState(reportingCurrency);
  const [domains, setDomains] = useState(allowedDomains.join("\n"));
  const [busy, start] = useTransition();
  const save = () =>
    start(async () => {
      const r = await saveAdvancedAction(projectId, {
        reportingCurrency: currency.trim(),
        allowedDomains: domains
          .split(/[\n,]/)
          .map((d) => d.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
          .filter(Boolean),
      });
      if (!r.ok) toast.error(r.error);
      else toast.success("Settings saved");
    });
  return (
    <Panel title="Advanced" description="Reporting currency, allowed websites and your public snippet key.">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Reporting currency</Label>
          <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} disabled={!canManage} className="h-8 w-28 font-mono text-xs" />
          <p className="text-[11px] text-muted-foreground">Deal values in this currency are summed in KPIs (no FX conversion).</p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Allowed websites (optional)</Label>
          <Textarea value={domains} onChange={(e) => setDomains(e.target.value)} disabled={!canManage} rows={3} className="font-mono text-xs" placeholder={"example.com\n*.example.com"} />
          <p className="text-[11px] text-muted-foreground">When set, snippet events from other origins are rejected. Empty = any website with your key. Keep empty when you use the Shopify Custom Pixel (it runs in a sandboxed origin).</p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Public snippet key</Label>
          <div className="flex items-center gap-1.5">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-2 py-1.5 font-mono text-[11px]">{publicKey}</code>
            <CopyButton value={publicKey} size="icon" />
          </div>
          <p className="text-[11px] text-muted-foreground">Not a secret — it only allows sending survey answers and conversions for this project.</p>
        </div>
      </div>
      {canManage && (
        <div className="mt-4 flex justify-end">
          <Button size="sm" className="gap-1.5" onClick={save} disabled={busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Save
          </Button>
        </div>
      )}
    </Panel>
  );
}
