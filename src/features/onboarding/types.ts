/** Shared (isomorphic) types for the onboarding wizard. */

export type WizardStep = "website" | "market" | "brand" | "competitors" | "prompts" | "engines" | "integrations" | "invite";
export type WizardStepOrCreate = WizardStep | "create";

export const ALL_WIZARD_STEPS: WizardStep[] = [
  "website",
  "market",
  "brand",
  "competitors",
  "prompts",
  "engines",
  "integrations",
  "invite",
];

export type Locale = "en" | "de";

export type WizardConfig = {
  enabled: boolean;
  steps: WizardStep[];
  defaultCountry: string;
  defaultLanguage: string;
  defaultEngines: string[];
  suggestedPromptCount: number;
  suggestedCompetitorCount: number;
  autoGeneratePrompts: boolean;
  autoDiscoverCompetitors: boolean;
  defaultTrackingFrequency: "daily" | "weekly" | "monthly";
  welcomeTitle: string;
  welcomeText: string;
  welcomeTitleDe: string;
  welcomeTextDe: string;
  allowPitchProjects: boolean;
  defaultPitchDays: number;
  showTourButton: boolean;
  showDemoButton: boolean;
  demoBookingUrl: string;
  appName: string;
  logoUrl: string;
  allowedDomains: string[];
};

export type EngineAvailability = {
  id: string;
  available: boolean;
  /** backend that would answer ("dataforseo" | "api" | "agent") */
  via: string | null;
  hint: string;
  /** disabled by an admin in Admin → AI Providers */
  disabled: boolean;
};

export type OnboardingWorkspace = { id: string; name: string; canInvite: boolean };

export type OnboardingPageData = {
  config: WizardConfig;
  engines: EngineAvailability[];
  aiAvailable: boolean;
  workspaces: OnboardingWorkspace[];
  roles: { key: string; name: string; description: string }[];
  defaultRoleKey: string;
  isInstanceAdmin: boolean;
  tourHref: string | null;
  homeHref: string | null;
  hasProjects: boolean;
  locale: Locale;
  user: { name: string | null; email: string };
  integrations: { google: boolean; bing: boolean; cloudflare: boolean; agent: boolean };
};

export type SuggestOutcome<T> =
  | { status: "ok"; data: T }
  | { status: "unavailable"; message: string }
  | { status: "failed"; message: string };

export type DraftPrompt = {
  id: string;
  text: string;
  topic: string;
  funnelStage: "tofu" | "mofu" | "bofu" | null;
  branded: boolean;
  selected: boolean;
  /** suggested by AI (replaced when suggestions are regenerated) vs. added by the user */
  ai: boolean;
};

export type DraftCompetitor = { id: string; name: string; domain: string; ai: boolean };

export type WizardDraft = {
  workspaceId: string;
  domain: string;
  name: string;
  nameTouched: boolean;
  isPitch: boolean;
  pitchDays: number;
  country: string;
  language: string;
  languageTouched: boolean;
  brand: { description: string; industry: string; aliases: string[]; logoUrl: string | null };
  brandKey: string | null;
  competitors: DraftCompetitor[];
  competitorsKey: string | null;
  prompts: DraftPrompt[];
  promptsKey: string | null;
  engines: string[];
  frequency: "daily" | "weekly" | "monthly";
  goToIntegrations: boolean;
  invites: { id: string; email: string; roleKey: string }[];
};
