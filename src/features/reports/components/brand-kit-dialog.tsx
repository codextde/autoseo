"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ImagePlus, Loader2, Moon, Sun, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getBrandKitAction, saveBrandKitAction } from "../actions";
import { FONT_OPTIONS, themeFromBrandKit, type BrandKit } from "../lib/theme";
import type { Theme } from "../lib/types";
import { uploadAsset } from "./editor/commands";

function logoSrc(v: string | undefined, assetUrl: (id: string) => string) {
  if (!v) return null;
  if (v.startsWith("asset:")) return assetUrl(v.slice(6));
  return v;
}

function LogoField({ value, onChange, projectId, scope, assetUrl }: { value?: string; onChange: (v: string | undefined) => void; projectId: string; scope: "workspace" | "project"; assetUrl: (id: string) => string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const src = logoSrc(value, assetUrl);
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-12 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-[repeating-conic-gradient(#8881_0%_25%,transparent_0%_50%)] [background-size:10px_10px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src ? <img src={src} alt="" className="max-h-10 max-w-24 object-contain" /> : <span className="text-[11px] text-muted-foreground">No logo</span>}
      </div>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? <Loader2 className="animate-spin" /> : <ImagePlus />} Upload
      </Button>
      {value && (
        <Button size="icon-sm" variant="ghost" onClick={() => onChange(undefined)} aria-label="Remove logo">
          <X />
        </Button>
      )}
      <input
        ref={ref}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          try {
            const a = await uploadAsset(projectId, f, "logo", scope);
            onChange(`asset:${a.id}`);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Upload failed");
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

function ColorInput({ value, onChange, placeholder }: { value?: string; onChange: (v: string | undefined) => void; placeholder: string }) {
  const [hex, setHex] = useState(value ?? "");
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setHex(value ?? "");
  }
  return (
    <div className="flex items-center gap-1.5">
      <input type="color" value={value ?? placeholder} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-8 w-9 shrink-0 cursor-pointer rounded border bg-transparent" />
      <Input
        value={hex}
        placeholder={placeholder}
        className="h-8 font-mono text-xs"
        onChange={(e) => setHex(e.target.value)}
        onBlur={() => onChange(/^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toUpperCase() : undefined)}
      />
    </div>
  );
}

type BrandKitProps = {
  projectId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  assetUrl: (id: string) => string;
  /** Apply the resulting theme to the current report. */
  onApply?: (theme: Theme) => void;
  onSaved?: () => void;
};

export function BrandKitDialog(props: BrandKitProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Brand kit</DialogTitle>
          <DialogDescription>Your agency branding is shared by every report in the workspace; client overrides apply to this project only.</DialogDescription>
        </DialogHeader>
        {props.open && <BrandKitBody {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function BrandKitBody({ projectId, onOpenChange, assetUrl, onApply, onSaved }: BrandKitProps) {
  const [ws, setWs] = useState<BrandKit | null>(null);
  const [client, setClient] = useState<BrandKit>({});
  const [defaults, setDefaults] = useState<BrandKit>({});
  const [canEditWorkspace, setCanEditWorkspace] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    void getBrandKitAction(projectId).then((r) => {
      if (!alive) return;
      if (!r.ok) return void toast.error(r.error);
      setWs(r.data.workspace);
      setClient(r.data.client);
      setDefaults(r.data.effective);
      setCanEditWorkspace(r.data.canEditWorkspace);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const preview = themeFromBrandKit({ ...defaults, ...(ws ?? {}), ...client });

  const save = (apply: boolean) =>
    start(async () => {
      const r = await saveBrandKitAction(projectId, canEditWorkspace ? { workspace: ws ?? {}, client } : { client });
      if (!r.ok) return void toast.error(r.error);
      if (apply) onApply?.(r.data.theme);
      onSaved?.();
      toast.success(apply ? "Brand kit applied to this report" : "Brand kit saved");
      onOpenChange(false);
    });

  const set = (patch: BrandKit) => setWs((prev) => ({ ...(prev ?? {}), ...patch }));

  return (
    <>
        {!ws ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center gap-3 rounded-xl border p-3" style={{ background: preview.colors.bg, color: preview.colors.text, borderColor: preview.colors.border }}>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: preview.colors.accent }}>
                  Preview
                </div>
                <div className="truncate text-lg font-bold" style={{ fontFamily: FONT_OPTIONS.find((f) => f.value === preview.fonts.heading)?.stack }}>
                  Is {client.clientName || defaults.clientName || "your brand"} visible in <span style={{ color: preview.colors.accent }}>AI search</span>?
                </div>
                <div className="text-xs" style={{ color: preview.colors.muted }}>
                  {ws.agencyName || defaults.agencyName || "Your agency"}
                </div>
              </div>
              <div className="flex gap-1">
                {[preview.colors.surface, preview.colors.accent, preview.colors.accent2, ...preview.chart.slice(1, 4)].map((c, i) => (
                  <span key={i} className="size-5 rounded-full ring-1 ring-black/10" style={{ background: c }} />
                ))}
              </div>
            </div>

            <fieldset disabled={!canEditWorkspace} className="space-y-3 disabled:opacity-60">
              <h3 className="text-sm font-semibold">Agency · workspace</h3>
              {!canEditWorkspace && <p className="text-xs text-muted-foreground">Only workspace admins can change the agency branding shared by all projects.</p>}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Agency name</Label>
                  <Input value={ws.agencyName ?? ""} placeholder={defaults.agencyName} onChange={(e) => set({ agencyName: e.target.value })} maxLength={120} />
                </div>
                <div className="space-y-1.5">
                  <Label>Logo</Label>
                  <LogoField value={ws.agencyLogo} onChange={(v) => set({ agencyLogo: v })} projectId={projectId} scope="workspace" assetUrl={assetUrl} />
                </div>
                <div className="space-y-1.5">
                  <Label>Website</Label>
                  <Input value={ws.agencyWebsite ?? ""} placeholder="agency.com" onChange={(e) => set({ agencyWebsite: e.target.value })} maxLength={200} />
                </div>
                <div className="space-y-1.5">
                  <Label>Contact email</Label>
                  <Input value={ws.agencyEmail ?? ""} placeholder="hello@agency.com" onChange={(e) => set({ agencyEmail: e.target.value })} maxLength={200} />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Look</Label>
                  <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-0.5">
                    {(["dark", "light"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => set({ mode: m })}
                        className={cn("flex items-center justify-center gap-1 rounded-md py-1.5 text-xs font-medium", (ws.mode ?? "dark") === m ? "bg-background shadow-xs" : "text-muted-foreground")}
                      >
                        {m === "dark" ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />} {m === "dark" ? "Dark" : "Light"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Accent color</Label>
                  <ColorInput value={ws.accentColor} placeholder="#3DDC84" onChange={(v) => set({ accentColor: v })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Secondary color</Label>
                  <ColorInput value={ws.secondaryColor} placeholder="#A3F7C4" onChange={(v) => set({ secondaryColor: v })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Background</Label>
                  <ColorInput value={ws.backgroundColor} placeholder={(ws.mode ?? "dark") === "dark" ? "#07100B" : "#FAFAF7"} onChange={(v) => set({ backgroundColor: v })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Text</Label>
                  <ColorInput value={ws.textColor} placeholder={(ws.mode ?? "dark") === "dark" ? "#F4F7F5" : "#101512"} onChange={(v) => set({ textColor: v })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Heading font</Label>
                  <Select value={ws.headingFont ?? "Geist"} onValueChange={(v) => set({ headingFont: v })}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FONT_OPTIONS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          <span style={{ fontFamily: f.stack }}>{f.label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 sm:col-start-3">
                  <Label>Body font</Label>
                  <Select value={ws.bodyFont ?? "Geist"} onValueChange={(v) => set({ bodyFont: v })}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FONT_OPTIONS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          <span style={{ fontFamily: f.stack }}>{f.label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </fieldset>

            <section className="space-y-3 border-t pt-4">
              <h3 className="text-sm font-semibold">Client · this project</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Client name</Label>
                  <Input value={client.clientName ?? ""} placeholder={defaults.clientName} onChange={(e) => setClient({ ...client, clientName: e.target.value })} maxLength={120} />
                </div>
                <div className="space-y-1.5">
                  <Label>Client logo</Label>
                  <LogoField value={client.clientLogo} onChange={(v) => setClient({ ...client, clientLogo: v })} projectId={projectId} scope="project" assetUrl={assetUrl} />
                </div>
                <div className="space-y-1.5">
                  <Label>Client accent (overrides agency accent)</Label>
                  <ColorInput value={client.accentColor} placeholder={ws.accentColor ?? "#3DDC84"} onChange={(v) => setClient({ ...client, accentColor: v })} />
                </div>
              </div>
            </section>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="outline" disabled={pending || !ws} onClick={() => save(false)}>
            Save
          </Button>
          {onApply && (
            <Button disabled={pending || !ws} onClick={() => save(true)}>
              {pending && <Loader2 className="animate-spin" />} Save & apply to report
            </Button>
          )}
        </DialogFooter>
    </>
  );
}
