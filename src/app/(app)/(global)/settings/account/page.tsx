import { PageContainer, PageHeader } from "@/components/app/page";
import { requireUser } from "@/server/auth/guards";
import { listUserSessions } from "@/server/auth/session";
import { listVisibleProjects } from "@/server/admin/account";
import { getSetting } from "@/server/settings";
import { ProfilePanel } from "@/features/settings/account/profile-panel";
import { PreferencesPanel } from "@/features/settings/account/preferences-panel";
import { SessionsPanel } from "@/features/settings/account/sessions-panel";
import { AccountProjectsList } from "@/features/settings/account/projects-list";
import { PrivacyPanel } from "@/features/settings/account/privacy-panel";

export const metadata = { title: "Account" };

export default async function AccountPage() {
  const ctx = await requireUser();
  const [sessions, projects, auth] = await Promise.all([
    listUserSessions(ctx.user.id),
    listVisibleProjects(ctx),
    getSetting("auth"),
  ]);
  const canCreate = ctx.isInstanceAdmin || ctx.memberships.some((m) => m.permissions.has("projects.manage"));
  const active = projects.filter((p) => !p.archived);

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader title="Account" description="Your profile, preferences, signed-in devices and personal data." />
      <ProfilePanel
        user={{
          name: ctx.user.name,
          email: ctx.user.email,
          avatarUrl: ctx.user.avatarUrl,
          createdAt: ctx.user.createdAt.toISOString(),
        }}
      />
      <PreferencesPanel locale={ctx.user.locale === "de" ? "de" : "en"} />
      <SessionsPanel
        currentSessionId={ctx.sessionId}
        sessionDays={auth.sessionDays}
        sessions={sessions.map((s) => ({
          id: s.id,
          deviceLabel: s.deviceLabel,
          userAgent: s.userAgent,
          ip: s.ip,
          lastSeenAt: s.lastSeenAt.toISOString(),
          createdAt: s.createdAt.toISOString(),
          expiresAt: s.expiresAt.toISOString(),
        }))}
      />
      <AccountProjectsList
        canCreate={canCreate}
        projects={active.map((p) => ({
          id: p.id,
          name: p.name,
          domain: p.domain,
          logoUrl: p.logoUrl,
          country: p.country,
          workspaceName: p.workspaceName,
          isPitch: p.isPitch,
          isDefault: p.id === ctx.user.lastProjectId,
        }))}
      />
      <PrivacyPanel email={ctx.user.email} />
    </PageContainer>
  );
}
