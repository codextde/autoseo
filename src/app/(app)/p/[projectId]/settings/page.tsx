import { Presentation } from "lucide-react";
import { requireProject } from "@/server/auth/guards";
import { getSetting } from "@/server/settings";
import { getEngineAvailability } from "@/server/admin/onboarding";
import { PageContainer, PageHeader, TabNav } from "@/components/app/page";
import { Favicon } from "@/components/app/favicon";
import { Badge } from "@/components/ui/badge";
import { GeneralSettings } from "@/features/settings/project/general";
import { BrandSettings } from "@/features/settings/project/brand";
import { TrackingSettings } from "@/features/settings/project/tracking";
import { PitchSettings } from "@/features/settings/project/pitch";
import { DangerZone } from "@/features/settings/project/danger";
import type { ProjectSettingsData } from "@/features/settings/project/shared";

export const metadata = { title: "Project settings" };

const TABS = [
  { key: "general", label: "General" },
  { key: "brand", label: "Brand" },
  { key: "tracking", label: "Tracking" },
  { key: "pitch", label: "Pitch" },
  { key: "danger", label: "Danger zone" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default async function ProjectSettingsPage({ params, searchParams }: PageProps<"/p/[projectId]/settings">) {
  const { projectId } = await params;
  const ctx = await requireProject(projectId);
  const sp = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === sp.tab) ? (sp.tab as TabKey) : "general";
  const p = ctx.project;
  const canManage = ctx.isInstanceAdmin || ctx.permissions.has("projects.manage");
  const canTrack = canManage || ctx.permissions.has("settings.manage");

  const project: ProjectSettingsData = {
    id: p.id,
    name: p.name,
    domain: p.domain,
    logoUrl: p.logoUrl,
    description: p.description,
    country: p.country,
    language: p.language,
    brand: { aliases: p.brand?.aliases ?? [], domains: p.brand?.domains ?? [], description: p.brand?.description, industry: p.brand?.industry },
    engines: p.engines,
    trackingFrequency: p.trackingFrequency,
    isPitch: p.isPitch,
    pitchExpiresAt: p.pitchExpiresAt?.toISOString() ?? null,
    archived: p.archived,
    createdAt: p.createdAt.toISOString(),
  };

  const [engines, onboarding] = await Promise.all([
    tab === "tracking" ? getEngineAvailability() : Promise.resolve([]),
    getSetting("onboarding"),
  ]);
  const base = `/p/${projectId}/settings`;

  return (
    <PageContainer className="max-w-5xl">
      <PageHeader
        eyebrow="Project"
        title={
          <span className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg border bg-background">
              <Favicon domain={p.domain} src={p.logoUrl} fallback={p.name} className="size-5" />
            </span>
            <span className="truncate">Settings</span>
            {p.isPitch && (
              <Badge variant="secondary" className="gap-1 bg-warning/15 text-warning">
                <Presentation className="size-3" /> Pitch
              </Badge>
            )}
            {p.archived && <Badge variant="secondary">Archived</Badge>}
          </span>
        }
        description={`${p.name} · ${p.domain}`}
      />
      <TabNav
        active={tab}
        tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: t.key === "general" ? base : `${base}?tab=${t.key}` }))}
      />
      {tab === "general" && <GeneralSettings key={p.updatedAt.toISOString()} project={project} canManage={canManage} />}
      {tab === "brand" && <BrandSettings key={p.updatedAt.toISOString()} project={project} canManage={canManage} />}
      {tab === "tracking" && (
        <TrackingSettings key={p.updatedAt.toISOString()} project={project} canEdit={canTrack} engines={engines} isAdmin={ctx.isInstanceAdmin} />
      )}
      {tab === "pitch" && (
        <PitchSettings project={project} canManage={canManage} defaultDays={onboarding.defaultPitchDays} allowPitch={onboarding.allowPitchProjects} />
      )}
      {tab === "danger" && <DangerZone project={project} canManage={canManage} />}
    </PageContainer>
  );
}
