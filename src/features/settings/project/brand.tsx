"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Panel } from "@/components/app/page";
import { ChipsInput, Rows, SaveBar, SettingRow } from "@/features/admin/components/settings-kit";
import { cleanDomainInput, isDomain } from "@/features/onboarding/lib";
import { ReadOnlyNotice, useProjectForm, type ProjectSettingsData } from "./shared";

export function BrandSettings({ project, canManage }: { project: ProjectSettingsData; canManage: boolean }) {
  const form = useProjectForm(
    project.id,
    {
      aliases: project.brand.aliases,
      domains: project.brand.domains,
      industry: project.brand.industry ?? "",
      description: project.brand.description ?? "",
    },
    (v) => ({ brand: { aliases: v.aliases, domains: v.domains, industry: v.industry, description: v.description } }),
  );
  const v = form.values;
  const disabled = !canManage;
  return (
    <div className="space-y-4">
      {!canManage && <ReadOnlyNotice />}
      <Panel title="Brand recognition" description="How we detect your brand and your own sources in AI answers.">
        <Rows>
          <SettingRow
            label="Brand name"
            description={
              <>
                Mentions of <span className="font-medium text-foreground">{project.name}</span> always count. Rename the project in General.
              </>
            }
          >
            <Input value={project.name} disabled readOnly />
          </SettingRow>
          <SettingRow label="Alternative names" description="Spellings, abbreviations and product lines that count as your brand (e.g. “Solakon”, “SOLAKON Balkonkraftwerk”).">
            {disabled ? (
              <p className="text-sm text-muted-foreground">{v.aliases.length ? v.aliases.join(", ") : "None"}</p>
            ) : (
              <ChipsInput
                value={v.aliases}
                onChange={(a) => form.set("aliases", a.slice(0, 50))}
                normalize={(s) => s.trim().slice(0, 120)}
                placeholder="Type a name and press Enter"
              />
            )}
          </SettingRow>
          <SettingRow label="Own domains" description="Additional domains (shops, help centers, country sites) that count as your own citations.">
            {disabled ? (
              <p className="text-sm text-muted-foreground">{v.domains.length ? v.domains.join(", ") : "None"}</p>
            ) : (
              <ChipsInput
                value={v.domains}
                onChange={(d) => form.set("domains", d.slice(0, 50))}
                normalize={cleanDomainInput}
                validate={(d) => (isDomain(d) ? (d === project.domain ? "That's already the main domain." : null) : `“${d}” is not a valid domain.`)}
                placeholder="shop.example.com"
              />
            )}
          </SettingRow>
          <SettingRow label="Industry" htmlFor="pb-industry">
            <Input id="pb-industry" value={v.industry} maxLength={200} disabled={disabled} placeholder="e.g. Solar energy" onChange={(e) => form.set("industry", e.target.value)} />
          </SettingRow>
          <SettingRow label="Brand description" htmlFor="pb-desc" description="Used as context for AI analyses (sentiment, prompt suggestions, content).">
            <Textarea
              id="pb-desc"
              rows={4}
              maxLength={2000}
              value={v.description}
              disabled={disabled}
              placeholder="What does the brand offer, and for whom?"
              onChange={(e) => form.set("description", e.target.value)}
            />
          </SettingRow>
        </Rows>
      </Panel>
      <SaveBar dirty={form.dirty} saving={form.saving} onSave={() => void form.save()} onReset={form.reset} count={form.changedCount} />
    </div>
  );
}
