"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageUp, Link2, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Panel } from "@/components/app/page";
import { Favicon } from "@/components/app/favicon";
import { Rows, SaveBar, SettingRow } from "@/features/admin/components/settings-kit";
import { CountryPicker, LanguageSelect } from "@/features/onboarding/components/market-fields";
import { getCountry } from "@/lib/countries";
import { uploadProjectLogoAction } from "../project-actions";
import { ReadOnlyNotice, useProjectForm, type ProjectSettingsData } from "./shared";

export function GeneralSettings({ project, canManage }: { project: ProjectSettingsData; canManage: boolean }) {
  const router = useRouter();
  const form = useProjectForm(
    project.id,
    {
      name: project.name,
      domain: project.domain,
      description: project.description ?? "",
      country: project.country,
      language: project.language,
      logoUrl: project.logoUrl ?? "",
    },
    (v, changed) => {
      const patch: Record<string, unknown> = {};
      for (const k of changed) patch[k] = k === "logoUrl" || k === "description" ? v[k] || null : v[k];
      return patch;
    },
  );
  const v = form.values;
  const disabled = !canManage;
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [showUrl, setShowUrl] = useState(Boolean(project.logoUrl && !project.logoUrl.startsWith("/api/uploads/")));

  const upload = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) return void toast.error("The logo must be smaller than 2 MB.");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await uploadProjectLogoAction(project.id, fd);
      if (!res.ok) return void toast.error(res.error);
      form.commit("logoUrl", res.data.url);
      toast.success("Logo updated");
      router.refresh();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-4">
      {!canManage && <ReadOnlyNotice />}
      <Panel title="General" description="Name, website and the market this project is tracked in.">
        <Rows>
          <SettingRow label="Project name" htmlFor="ps-name">
            <Input id="ps-name" value={v.name} maxLength={120} disabled={disabled} onChange={(e) => form.set("name", e.target.value)} />
          </SettingRow>
          <SettingRow label="Domain" htmlFor="ps-domain" description="The main website of the brand. Changing it affects new tracking runs.">
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2">
                <Favicon domain={v.domain} />
              </span>
              <Input
                id="ps-domain"
                value={v.domain}
                disabled={disabled}
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
                className="pl-8"
                onChange={(e) => form.set("domain", e.target.value)}
              />
            </div>
          </SettingRow>
          <SettingRow label="Logo" description="PNG, JPG, WebP, GIF or SVG — max. 2 MB. Used in the project switcher and reports.">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-background">
                  <Favicon domain={v.domain} src={v.logoUrl || null} fallback={v.name} className="size-7" />
                </span>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f);
                  }}
                />
                <Button type="button" variant="outline" size="sm" disabled={disabled || uploading} onClick={() => fileRef.current?.click()}>
                  {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <ImageUp className="size-3.5" />} Upload
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => setShowUrl((s) => !s)}>
                  <Link2 className="size-3.5" /> URL
                </Button>
                {v.logoUrl && (
                  <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => form.set("logoUrl", "")} className="text-muted-foreground">
                    <Trash2 className="size-3.5" /> Remove
                  </Button>
                )}
              </div>
              {showUrl && (
                <Input
                  value={v.logoUrl.startsWith("/api/uploads/") ? "" : v.logoUrl}
                  placeholder="https://…/logo.png"
                  disabled={disabled}
                  inputMode="url"
                  onChange={(e) => form.set("logoUrl", e.target.value.trim())}
                />
              )}
            </div>
          </SettingRow>
          <SettingRow label="Description" htmlFor="ps-desc" description="Internal note about the project or client.">
            <Textarea
              id="ps-desc"
              rows={3}
              maxLength={2000}
              value={v.description}
              disabled={disabled}
              onChange={(e) => form.set("description", e.target.value)}
            />
          </SettingRow>
          <SettingRow label="Market" description="Country AI engines are asked from. New prompts inherit it.">
            <CountryPicker
              value={v.country}
              disabled={disabled}
              onChange={(iso) => {
                form.set("country", iso);
                const lang = getCountry(iso)?.language;
                if (lang && !getCountry(iso)?.languages.includes(v.language)) form.set("language", lang);
              }}
            />
          </SettingRow>
          <SettingRow label="Language">
            <LanguageSelect value={v.language} country={v.country} disabled={disabled} onChange={(code) => form.set("language", code)} />
          </SettingRow>
        </Rows>
      </Panel>
      <SaveBar dirty={form.dirty} saving={form.saving} onSave={() => void form.save()} onReset={form.reset} count={form.changedCount} />
    </div>
  );
}
