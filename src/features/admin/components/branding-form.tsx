"use client";

import { useRef, useState } from "react";
import { ImageUp, Link2, Loader2, Palette, Trash2, Type, Globe2, LifeBuoy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/app/page";
import { LogoMark } from "@/components/app/logo";
import { cn } from "@/lib/utils";
import { Segmented } from "@/features/settings/account/segmented";
import { getSettingsAction, uploadBrandingAssetAction } from "../actions/settings";
import { Rows, SaveBar, SettingRow, ToggleRow, useSettingsForm } from "./settings-kit";
import { BrandingPreview } from "./branding-preview";

export type GeneralSettings = {
  appName: string;
  tagline: string;
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  accentColor: string;
  defaultLocale: "en" | "de";
  supportEmail: string;
  docsUrl: string;
  demoBookingUrl: string;
  showProductTour: boolean;
};

type Initial = { values: GeneralSettings; secrets: Record<string, boolean> };

const PRIMARY_PRESETS = ["#0f0f0f", "#1e293b", "#1d4ed8", "#7c3aed", "#be123c", "#047857"];
const ACCENT_PRESETS = ["#16a34a", "#0ea5e9", "#6366f1", "#f59e0b", "#ec4899", "#14b8a6"];
const HEX = /^#(?:[0-9a-fA-F]{3}){1,2}$/;

/** Wrapper that re-mounts the form with fresh server values after an asset upload. */
export function BrandingEditor({ initial }: { initial: Initial }) {
  const [state, setState] = useState({ initial, key: 0 });
  return (
    <BrandingForm
      key={state.key}
      initial={state.initial}
      onReload={async () => {
        const res = await getSettingsAction("general");
        if (res.ok) setState((s) => ({ initial: res.data as unknown as Initial, key: s.key + 1 }));
      }}
    />
  );
}

function ColorField({
  id,
  value,
  onChange,
  presets,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  presets: string[];
}) {
  const [text, setText] = useState(value);
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setText(value);
  }
  const valid = HEX.test(text);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label
          className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-lg border shadow-xs"
          style={{ background: HEX.test(value) ? value : "transparent" }}
        >
          <input
            type="color"
            value={HEX.test(value) && value.length === 7 ? value : "#000000"}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label="Pick color"
          />
        </label>
        <Input
          id={id}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (HEX.test(e.target.value)) onChange(e.target.value);
          }}
          aria-invalid={!valid}
          className="max-w-32 font-mono text-[13px] uppercase"
          maxLength={7}
          spellCheck={false}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={cn(
              "size-6 rounded-full border-2 transition-transform hover:scale-110",
              value.toLowerCase() === c ? "border-foreground" : "border-background ring-1 ring-border",
            )}
            style={{ background: c }}
            aria-label={`Use ${c}`}
          />
        ))}
      </div>
    </div>
  );
}

function AssetField({
  kind,
  value,
  onChange,
  onUploaded,
  dirty,
}: {
  kind: "logo" | "favicon";
  value: string;
  onChange: (v: string) => void;
  onUploaded: (url: string) => void;
  dirty: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [urlMode, setUrlMode] = useState(Boolean(value) && !value.startsWith("/api/uploads/"));
  const accept =
    kind === "favicon"
      ? "image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/webp"
      : "image/png,image/jpeg,image/svg+xml,image/webp,image/gif";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-[repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] bg-[length:12px_12px]",
            kind === "logo" ? "size-14" : "size-10",
          )}
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="size-full object-contain p-1.5" />
          ) : (
            <LogoMark className={kind === "logo" ? "size-9" : "size-6"} />
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ImageUp className="size-3.5" />} Upload
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setUrlMode((m) => !m)}>
            <Link2 className="size-3.5" /> URL
          </Button>
          {value && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")} className="text-muted-foreground">
              <Trash2 className="size-3.5" /> Reset
            </Button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) return void toast.error("The file is larger than 2 MB.");
            const fd = new FormData();
            fd.set("kind", kind);
            fd.set("file", file);
            setBusy(true);
            try {
              const res = await uploadBrandingAssetAction(fd);
              if (!res.ok) return void toast.error(res.error);
              toast.success(kind === "logo" ? "Logo uploaded" : "Favicon uploaded");
              setUrlMode(false);
              if (dirty) onChange(res.data.url);
              else onUploaded(res.data.url);
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
      {urlMode && (
        <Input value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder="https://cdn.example.com/logo.svg" className="font-mono text-[13px]" />
      )}
    </div>
  );
}

function BrandingForm({ initial, onReload }: { initial: Initial; onReload: () => Promise<void> }) {
  const form = useSettingsForm<GeneralSettings>("general", initial);
  const v = form.values;

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <Panel title="Identity" icon={<Type className="size-4 text-muted-foreground" />} description="Shown in the sidebar, browser tab, emails and on the sign-in page.">
          <Rows>
            <SettingRow label="App name" htmlFor="b-name">
              <Input id="b-name" value={v.appName} maxLength={60} onChange={(e) => form.set("appName", e.target.value)} />
            </SettingRow>
            <SettingRow label="Tagline" description="Used as meta description and on the sign-in page." htmlFor="b-tag">
              <Input id="b-tag" value={v.tagline} maxLength={140} onChange={(e) => form.set("tagline", e.target.value)} />
            </SettingRow>
            <SettingRow label="Logo" description="Square works best. PNG, JPG, SVG or WebP · max 2 MB.">
              <AssetField kind="logo" value={v.logoUrl} dirty={form.dirty} onChange={(x) => form.set("logoUrl", x)} onUploaded={() => void onReload()} />
            </SettingRow>
            <SettingRow label="Favicon" description="Browser tab icon. ICO, PNG or SVG.">
              <AssetField kind="favicon" value={v.faviconUrl} dirty={form.dirty} onChange={(x) => form.set("faviconUrl", x)} onUploaded={() => void onReload()} />
            </SettingRow>
          </Rows>
        </Panel>

        <Panel title="Colors" icon={<Palette className="size-4 text-muted-foreground" />} description="Applied to emails, reports and branded surfaces. Preview updates live.">
          <Rows>
            <SettingRow label="Primary color" description="Buttons and call-to-actions (e.g. the sign-in button in emails)." htmlFor="b-primary">
              <ColorField id="b-primary" value={v.primaryColor} onChange={(x) => form.set("primaryColor", x)} presets={PRIMARY_PRESETS} />
            </SettingRow>
            <SettingRow label="Accent color" description="Highlights, active states and charts." htmlFor="b-accent">
              <ColorField id="b-accent" value={v.accentColor} onChange={(x) => form.set("accentColor", x)} presets={ACCENT_PRESETS} />
            </SettingRow>
          </Rows>
        </Panel>

        <Panel title="Localization & links" icon={<Globe2 className="size-4 text-muted-foreground" />}>
          <Rows>
            <SettingRow label="Default language" description="For new users, emails and the sign-in page. Users can change their own language.">
              <Segmented
                value={v.defaultLocale}
                onChange={(x) => form.set("defaultLocale", x)}
                options={[
                  { value: "en", label: "English", icon: <span aria-hidden>🇬🇧</span> },
                  { value: "de", label: "Deutsch", icon: <span aria-hidden>🇩🇪</span> },
                ]}
              />
            </SettingRow>
            <SettingRow label="Docs URL" description="Adds a “Docs” button to the top bar." htmlFor="b-docs">
              <Input id="b-docs" type="url" value={v.docsUrl} placeholder="https://docs.example.com" onChange={(e) => form.set("docsUrl", e.target.value.trim())} />
            </SettingRow>
            <SettingRow label="Demo booking URL" description="Adds a “Get Demo” button (top bar & onboarding)." htmlFor="b-demo">
              <Input id="b-demo" type="url" value={v.demoBookingUrl} placeholder="https://cal.com/you/demo" onChange={(e) => form.set("demoBookingUrl", e.target.value.trim())} />
            </SettingRow>
          </Rows>
        </Panel>

        <Panel title="Support" icon={<LifeBuoy className="size-4 text-muted-foreground" />}>
          <Rows>
            <SettingRow label="Support email" description="Shown on error pages and in emails." htmlFor="b-support">
              <Input id="b-support" type="email" value={v.supportEmail} placeholder="support@example.com" onChange={(e) => form.set("supportEmail", e.target.value.trim())} />
            </SettingRow>
            <ToggleRow
              label="Product tour"
              description="Show the “Product Tour” button in the sidebar and the guided tour for new users."
              checked={v.showProductTour}
              onCheckedChange={(x) => form.set("showProductTour", x)}
            />
          </Rows>
        </Panel>

        <SaveBar dirty={form.dirty} saving={form.saving} onSave={() => void form.save()} onReset={form.reset} count={form.changedCount} />
      </div>

      <aside className="space-y-2 xl:sticky xl:top-20">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-medium tracking-wider text-muted-foreground uppercase">Live preview</span>
          {form.dirty && <span className="text-[11px] text-warning">unsaved</span>}
        </div>
        <BrandingPreview
          appName={v.appName}
          tagline={v.tagline}
          logoUrl={v.logoUrl}
          primaryColor={HEX.test(v.primaryColor) ? v.primaryColor : "#0f0f0f"}
          accentColor={HEX.test(v.accentColor) ? v.accentColor : "#16a34a"}
        />
      </aside>
    </div>
  );
}
