import { ShieldAlert } from "lucide-react";
import { AuthSplitLayout } from "@/components/app/auth-split-layout";
import { requireUser } from "@/server/auth/guards";
import { getAccessibleProjects } from "@/server/auth/context";
import { getBranding } from "@/server/branding";
import { denyAuthorization, pickAuthorizeParams, validateAuthorizeRequest } from "@/server/api/oauth/authorize";
import { API_CREDENTIALS_PERMISSION } from "@/server/api/auth";
import { ConsentForm, type ConsentWorkspace } from "@/features/api-settings/components/consent-form";

export const metadata = { title: "Authorize access" };

function hostOf(uri: string) {
  try {
    const u = new URL(uri);
    return u.host ? `${u.protocol === "https:" ? "" : `${u.protocol}//`}${u.host}` : `${u.protocol}//`;
  } catch {
    return uri;
  }
}

/** OAuth 2.1 authorization endpoint + consent screen (session-authenticated). */
export default async function AuthorizePage({ searchParams }: PageProps<"/oauth/authorize">) {
  const params = pickAuthorizeParams(await searchParams);
  const validation = await validateAuthorizeRequest(params);

  if (!validation.ok) {
    // Never auto-redirect on errors (RFC 9700 §4.11.2 — no open redirector): show the error and
    // let the user go back to the app explicitly when the redirect URI was verified.
    const back = validation.fatal ? null : validation.redirectTo;
    const detail = validation.fatal
      ? { error: validation.error, description: validation.description }
      : (() => {
          const q = new URL(validation.redirectTo).searchParams;
          return { error: q.get("error") ?? "invalid_request", description: q.get("error_description") ?? "Invalid request." };
        })();
    return (
      <AuthSplitLayout>
        <div className="space-y-4 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border bg-card text-destructive shadow-soft">
            <ShieldAlert className="size-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Authorization request rejected</h1>
          <p className="text-sm text-muted-foreground">{detail.description}</p>
          <p className="font-mono text-xs text-muted-foreground">error: {detail.error}</p>
          {back && (
            <a href={back} className="inline-flex text-sm font-medium underline underline-offset-4">
              Return to {hostOf(back)}
            </a>
          )}
        </div>
      </AuthSplitLayout>
    );
  }

  const ctx = await requireUser();
  const [projects, brand] = await Promise.all([getAccessibleProjects(), getBranding()]);
  const { request } = validation;
  // Approving an app issues long-lived credentials → same permission as creating API keys.
  const allowed = ctx.memberships.filter((m) => m.permissions.has(API_CREDENTIALS_PERMISSION));
  if (!allowed.length) {
    return (
      <AuthSplitLayout>
        <div className="space-y-4 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border bg-card text-destructive shadow-soft">
            <ShieldAlert className="size-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">You can&apos;t connect apps</h1>
          <p className="text-sm text-muted-foreground">
            Connecting {request.client.name} requires the “Integrations, API keys” permission in a workspace. Ask a workspace owner or
            admin to connect it or to grant you access.
          </p>
          {(() => {
            const back = denyAuthorization(request);
            return (
              <a href={back} className="inline-flex text-sm font-medium underline underline-offset-4">
                Return to {hostOf(back)}
              </a>
            );
          })()}
        </div>
      </AuthSplitLayout>
    );
  }
  const workspaces: ConsentWorkspace[] = allowed.map((m) => ({
    id: m.workspace.id,
    name: m.workspace.name,
    canWrite: m.permissions.has("prompts.manage"),
    projects: projects
      .filter((p) => p.workspaceId === m.workspace.id)
      .map((p) => ({ id: p.id, name: p.name, domain: p.domain })),
  }));

  return (
    <AuthSplitLayout
      aside={
        <div className="max-w-md rounded-2xl border bg-background/80 p-5 shadow-soft backdrop-blur">
          <p className="text-sm font-medium">Connect your AI assistant</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {request.client.name} will be able to query your AI visibility data through the {brand.appName} MCP server, limited to
            the projects and permissions you choose.
          </p>
        </div>
      }
    >
      <ConsentForm
        params={{ ...params }}
        client={{
          name: request.client.name,
          redirectHost: hostOf(request.redirectUri),
          clientUri: request.client.clientUri,
          registeredAt: request.client.createdAt.toISOString(),
        }}
        user={{ email: ctx.user.email, name: ctx.user.name }}
        workspaces={workspaces}
        requestedScopes={request.scopes}
        appName={brand.appName}
        logoUrl={brand.logoUrl || undefined}
      />
    </AuthSplitLayout>
  );
}
