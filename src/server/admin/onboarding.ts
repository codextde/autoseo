import "server-only";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { roles, workspaces } from "@/server/db/schema";
import { getSetting } from "@/server/settings";
import { getBranding } from "@/server/branding";
import { getAccessibleProjects, type UserContext } from "@/server/auth/context";
import { isDataForSeoConfigured } from "@/server/dataforseo/client";
import { hasOnlineAgent } from "@/server/agents/dispatch";
import { AiNotConfiguredError, availableLlmProviders } from "@/server/ai/llm";
import {
  suggestBrandProfile,
  suggestCompetitors,
  suggestPrompts,
  type BrandProfileSuggestion,
  type CompetitorSuggestion,
  type PromptSuggestion,
} from "@/server/ai/bootstrap";
import { createProject, isValidDomain, normalizeDomain } from "@/server/projects";
import { createInvitation } from "@/server/auth/membership";
import { rateLimit } from "@/server/rate-limit";
import { assertRoleWithinReach, type WorkspaceAccess } from "./access";
import { isValidEmail, normalizeEmail } from "@/server/auth/domains";
import { getCountry, LANGUAGES } from "@/lib/countries";
import { ENGINES } from "@/lib/engines";
import type {
  EngineAvailability,
  OnboardingPageData,
  OnboardingWorkspace,
  SuggestOutcome,
  WizardConfig,
} from "@/features/onboarding/types";

/* ─────────────────────────── Engine availability ─────────────────────────── */

/** Which AI engines can currently produce answers, and through which backend (for UI hints). */
export async function getEngineAvailability(): Promise<EngineAvailability[]> {
  const [engineSettings, ai, dfs, agentOnline] = await Promise.all([
    getSetting("engines"),
    getSetting("ai"),
    isDataForSeoConfigured().catch(() => false),
    hasOnlineAgent("any").catch(() => false),
  ]);
  const aiValues = ai as Record<string, unknown>;
  const map = engineSettings as Record<string, { provider: string; model: string } | undefined>;
  return ENGINES.map((e) => {
    const provider = map[e.id]?.provider ?? "auto";
    const hasKey = e.apiKeySetting ? Boolean(aiValues[e.apiKeySetting]) : false;
    const can = {
      dataforseo: e.providers.includes("dataforseo") && dfs,
      api: e.providers.includes("api") && hasKey,
      agent: e.providers.includes("agent") && agentOnline,
    };
    if (provider === "disabled") return { id: e.id, available: false, via: null, hint: "Disabled by an admin", disabled: true };
    if (provider === "dataforseo" || provider === "api" || provider === "agent") {
      const ok = can[provider as keyof typeof can];
      return {
        id: e.id,
        available: ok,
        via: ok ? provider : null,
        hint: ok
          ? `Answers via ${labelFor(provider)}`
          : provider === "dataforseo"
            ? "Needs DataForSEO (Admin → Data Providers)"
            : provider === "api"
              ? "Needs an API key (Admin → AI Providers)"
              : "Needs an online local agent",
        disabled: false,
      };
    }
    const via = (e.providers as string[]).find((p) => can[p as keyof typeof can]) ?? null;
    return {
      id: e.id,
      available: Boolean(via),
      via,
      hint: via
        ? `Answers via ${labelFor(via)}`
        : e.providers.includes("dataforseo")
          ? "Connect DataForSEO or an API key to track this engine"
          : e.providers.includes("api")
            ? "Add an API key in Admin → AI Providers"
            : "Needs a provider",
      disabled: false,
    };
  });
}

function labelFor(p: string) {
  return p === "dataforseo" ? "DataForSEO" : p === "api" ? "API" : p === "agent" ? "local agent" : p;
}

/* ───────────────────────────── Page data ───────────────────────────── */

export async function getWizardConfig(): Promise<WizardConfig> {
  const [ob, branding, auth] = await Promise.all([getSetting("onboarding"), getBranding(), getSetting("auth")]);
  const steps: WizardConfig["steps"] = ob.enabled
    ? ([...new Set(["website", "market", ...ob.steps])] as WizardConfig["steps"])
    : ["website", "market"];
  // website must come first, market second
  const ordered = ["website", "market", ...steps.filter((s) => s !== "website" && s !== "market")] as WizardConfig["steps"];
  return {
    enabled: ob.enabled,
    steps: ordered,
    defaultCountry: ob.defaultCountry,
    defaultLanguage: ob.defaultLanguage,
    defaultEngines: ob.defaultEngines,
    suggestedPromptCount: ob.suggestedPromptCount,
    suggestedCompetitorCount: ob.suggestedCompetitorCount,
    autoGeneratePrompts: ob.enabled && ob.autoGeneratePrompts,
    autoDiscoverCompetitors: ob.enabled && ob.autoDiscoverCompetitors,
    defaultTrackingFrequency: ob.defaultTrackingFrequency,
    welcomeTitle: ob.welcomeTitle,
    welcomeText: ob.welcomeText,
    welcomeTitleDe: ob.welcomeTitleDe,
    welcomeTextDe: ob.welcomeTextDe,
    allowPitchProjects: ob.allowPitchProjects,
    defaultPitchDays: ob.defaultPitchDays,
    showTourButton: ob.showTourButton && branding.showProductTour,
    showDemoButton: ob.showDemoButton && Boolean(branding.demoBookingUrl),
    demoBookingUrl: branding.demoBookingUrl,
    appName: branding.appName,
    logoUrl: branding.logoUrl,
    allowedDomains: auth.allowedDomains,
  };
}

/** Everything the onboarding page needs for the signed-in user. */
export async function getOnboardingPageData(ctx: UserContext): Promise<OnboardingPageData> {
  const [config, engines, providers, accessible, roleRows] = await Promise.all([
    getWizardConfig(),
    getEngineAvailability(),
    availableLlmProviders().catch(() => []),
    getAccessibleProjects(),
    db.select().from(roles).orderBy(asc(roles.sortOrder)),
  ]);

  const list: OnboardingWorkspace[] = [];
  for (const m of ctx.memberships) {
    if (ctx.isInstanceAdmin || m.permissions.has("projects.manage")) {
      list.push({
        id: m.workspace.id,
        name: m.workspace.name,
        canInvite: ctx.isInstanceAdmin || m.permissions.has("members.manage"),
      });
    }
  }
  if (ctx.isInstanceAdmin) {
    const all = await db.select().from(workspaces).orderBy(asc(workspaces.createdAt));
    for (const ws of all) if (!list.some((w) => w.id === ws.id)) list.push({ id: ws.id, name: ws.name, canInvite: true });
  }

  const lastProject = accessible.find((p) => p.id === ctx.user.lastProjectId) ?? accessible[0] ?? null;
  const [google, integ] = await Promise.all([getSetting("google"), getSetting("integrations")]);
  return {
    config,
    engines,
    aiAvailable: providers.length > 0,
    workspaces: list,
    roles: roleRows.filter((r) => r.key !== "owner").map((r) => ({ key: r.key, name: r.name, description: r.description ?? "" })),
    defaultRoleKey: roleRows.some((r) => r.key === "member") ? "member" : (roleRows[0]?.key ?? "member"),
    isInstanceAdmin: ctx.isInstanceAdmin,
    tourHref: lastProject ? `/p/${lastProject.id}/tour` : null,
    hasProjects: accessible.length > 0,
    homeHref: lastProject ? `/p/${lastProject.id}` : null,
    locale: ctx.user.locale === "de" ? "de" : "en",
    user: { name: ctx.user.name, email: ctx.user.email },
    integrations: {
      google: Boolean(google.oauthClientId && google.oauthClientSecret),
      bing: Boolean(integ.bingWebmasterApiKey),
      cloudflare: Boolean(integ.cloudflareApiToken),
      agent: engines.some((e) => e.via === "agent") || (await hasOnlineAgent("any").catch(() => false)),
    },
  };
}

/* ─────────────────────────────── Suggestions ─────────────────────────────── */

async function guarded<T>(fn: () => Promise<T>): Promise<SuggestOutcome<T>> {
  try {
    return { status: "ok", data: await fn() };
  } catch (err) {
    if (err instanceof AiNotConfiguredError) return { status: "unavailable", message: err.message };
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[onboarding] suggestion failed:", message);
    if (/not implemented/i.test(message)) {
      return { status: "unavailable", message: "AI suggestions are not available on this instance yet." };
    }
    return { status: "failed", message };
  }
}

export const brandInput = z.object({
  domain: z.string().trim().min(3).max(253),
  country: z.string().trim().min(2).max(3),
  language: z.string().trim().min(2).max(8),
  /** Workspace the project will be created in (routes AI work to its local agents). */
  workspaceId: z.string().max(40).optional(),
});

/** Who the suggestion is for (validated by the caller). */
export type SuggestScope = { workspaceId?: string | null; userId?: string | null };

export async function suggestBrand(input: z.input<typeof brandInput>, scope: SuggestScope = {}): Promise<SuggestOutcome<BrandProfileSuggestion>> {
  const data = brandInput.parse(input);
  const domain = normalizeDomain(data.domain);
  if (!isValidDomain(domain)) return { status: "failed", message: "Enter a valid domain first." };
  return guarded(() => suggestBrandProfile({ domain, country: data.country, language: data.language, ...scope }));
}

export const competitorsInput = brandInput.extend({
  brandName: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
});

export async function suggestCompetitorList(
  input: z.input<typeof competitorsInput>,
  scope: SuggestScope = {},
): Promise<SuggestOutcome<CompetitorSuggestion[]>> {
  const data = competitorsInput.parse(input);
  const ob = await getSetting("onboarding");
  const domain = normalizeDomain(data.domain);
  const res = await guarded(() =>
    suggestCompetitors({ ...data, domain, count: Math.max(1, ob.suggestedCompetitorCount), ...scope }),
  );
  if (res.status !== "ok") return res;
  // Never suggest the own domain; dedupe by name.
  const seen = new Set<string>();
  const list = res.data
    .filter((c) => c.name?.trim())
    .filter((c) => (c.domain ? normalizeDomain(c.domain) !== domain : true))
    .filter((c) => (seen.has(c.name.toLowerCase()) ? false : (seen.add(c.name.toLowerCase()), true)))
    .slice(0, 30);
  return { status: "ok", data: list };
}

export const promptsInput = competitorsInput.extend({
  competitors: z.array(z.string().trim().max(120)).max(50),
});

export async function suggestPromptList(input: z.input<typeof promptsInput>, scope: SuggestScope = {}): Promise<SuggestOutcome<PromptSuggestion[]>> {
  const data = promptsInput.parse(input);
  const ob = await getSetting("onboarding");
  const domain = normalizeDomain(data.domain);
  const res = await guarded(() => suggestPrompts({ ...data, domain, count: Math.max(1, ob.suggestedPromptCount), ...scope }));
  if (res.status !== "ok") return res;
  const seen = new Set<string>();
  return {
    status: "ok",
    data: res.data
      .filter((p) => p.text?.trim())
      .filter((p) => (seen.has(p.text.trim().toLowerCase()) ? false : (seen.add(p.text.trim().toLowerCase()), true)))
      .slice(0, 200),
  };
}

/* ──────────────────────────────── Create ──────────────────────────────── */

const ENGINE_IDS = ENGINES.map((e) => e.id) as [string, ...string[]];
const LANGUAGE_CODES = new Set(LANGUAGES.map((l) => l.code));

export const createInput = z.object({
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1, "Enter a project name").max(120),
  domain: z.string().trim().min(3).max(253),
  country: z.string().trim().min(2).max(3),
  language: z.string().trim().min(2).max(8),
  isPitch: z.boolean().default(false),
  pitchDays: z.number().int().min(1).max(365).default(30),
  brand: z
    .object({
      description: z.string().trim().max(2000).default(""),
      industry: z.string().trim().max(200).default(""),
      aliases: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
      logoUrl: z.string().trim().max(2000).nullable().default(null),
    })
    .default({ description: "", industry: "", aliases: [], logoUrl: null }),
  competitors: z
    .array(z.object({ name: z.string().trim().min(1).max(120), domain: z.string().trim().max(253).default("") }))
    .max(50)
    .default([]),
  prompts: z
    .array(
      z.object({
        text: z.string().trim().min(3).max(500),
        topic: z.string().trim().max(120).default(""),
        funnelStage: z.enum(["tofu", "mofu", "bofu"]).nullable().default(null),
        branded: z.boolean().default(false),
      }),
    )
    .max(200)
    .default([]),
  engines: z.array(z.enum(ENGINE_IDS)).max(ENGINE_IDS.length).default([]),
  trackingFrequency: z.enum(["daily", "weekly", "monthly"]).default("daily"),
  invites: z
    .array(z.object({ email: z.string().trim().max(320), roleKey: z.string().min(1).max(64) }))
    .max(50)
    .default([]),
  goToIntegrations: z.boolean().default(false),
});

export type CreateWizardInput = z.input<typeof createInput>;

export type CreateWizardResult = {
  projectId: string;
  redirectTo: string;
  invited: string[];
  inviteErrors: { email: string; error: string }[];
};

/**
 * Creates the project from the wizard draft (the caller must already have checked
 * `projects.manage` in the workspace). Invitations require `canInvite`.
 */
export async function createProjectFromWizard(
  raw: CreateWizardInput,
  actor: { id: string; email: string; name?: string | null },
  opts: { canInvite: boolean; access?: WorkspaceAccess },
): Promise<CreateWizardResult> {
  const input = createInput.parse(raw);
  const [ob, limits] = await Promise.all([getSetting("onboarding"), getSetting("limits")]);
  const domain = normalizeDomain(input.domain);
  if (!isValidDomain(domain)) throw new Error("Please enter a valid domain, e.g. example.com");
  const country = getCountry(input.country);
  if (!country) throw new Error("Unknown market.");
  const language = LANGUAGE_CODES.has(input.language) ? input.language : country.language;
  const logoUrl = input.brand.logoUrl && /^https:\/\//.test(input.brand.logoUrl) ? input.brand.logoUrl : null;

  const aliases = [...new Set(input.brand.aliases.filter((a) => a.toLowerCase() !== input.name.toLowerCase()))];
  const competitors = input.competitors
    .map((c) => ({ name: c.name, domain: c.domain ? normalizeDomain(c.domain) : null }))
    .filter((c) => !c.domain || (isValidDomain(c.domain) && c.domain !== domain));
  const prompts = input.prompts.slice(0, limits.maxPromptsPerProject).map((p) => ({
    text: p.text,
    topic: p.topic || null,
    funnelStage: p.funnelStage,
    branded: p.branded,
  }));

  const project = await createProject({
    workspaceId: input.workspaceId,
    name: input.name,
    domain,
    country: country.iso,
    language,
    description: input.brand.description || null,
    logoUrl,
    brand: {
      aliases,
      domains: [],
      description: input.brand.description || undefined,
      industry: input.brand.industry || undefined,
    },
    engines: input.engines.length ? input.engines : ob.defaultEngines,
    trackingFrequency: input.trackingFrequency,
    isPitch: ob.allowPitchProjects && input.isPitch,
    pitchDays: input.pitchDays,
    competitors,
    prompts,
    createdBy: { id: actor.id, email: actor.email },
  });

  const invited: string[] = [];
  const inviteErrors: { email: string; error: string }[] = [];
  if (opts.canInvite) {
    const roleRows = new Map((await db.select().from(roles)).map((r) => [r.key, r]));
    for (const inv of input.invites) {
      const email = normalizeEmail(inv.email);
      if (!email) continue;
      if (!isValidEmail(email)) {
        inviteErrors.push({ email, error: "Invalid email address" });
        continue;
      }
      const role = roleRows.get(inv.roleKey);
      if (!role || inv.roleKey === "owner") {
        inviteErrors.push({ email, error: "Invalid role" });
        continue;
      }
      if (opts.access) {
        try {
          // Same rules as Settings → Workspace: no roles beyond the inviter's own permissions.
          assertRoleWithinReach(opts.access, role);
        } catch (err) {
          inviteErrors.push({ email, error: err instanceof Error ? err.message : "Role not allowed" });
          continue;
        }
      }
      if (
        !rateLimit(`invite:ws:${input.workspaceId}`, 100, 24 * 60 * 60_000) ||
        !rateLimit(`invite:addr:${email}`, 5, 24 * 60 * 60_000)
      ) {
        inviteErrors.push({ email, error: "Daily invitation limit reached" });
        continue;
      }
      try {
        await createInvitation({
          workspaceId: input.workspaceId,
          email,
          roleKey: inv.roleKey,
          projectIds: [project.id],
          invitedBy: { id: actor.id, email: actor.email, name: actor.name },
        });
        invited.push(email);
      } catch (err) {
        inviteErrors.push({ email, error: err instanceof Error ? err.message : "Could not invite" });
      }
    }
  }

  return {
    projectId: project.id,
    redirectTo: input.goToIntegrations ? `/p/${project.id}/integrations` : `/p/${project.id}`,
    invited,
    inviteErrors,
  };
}

/** Does the workspace exist? (instance admins may create projects in any workspace) */
export async function workspaceExists(id: string) {
  const [ws] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, id)).limit(1);
  return Boolean(ws);
}
