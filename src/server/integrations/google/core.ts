import "server-only";
import { getSetting } from "@/server/settings";
import { env } from "@/server/env";
import { PROVIDERS } from "@/lib/integrations-catalog";
import { httpJson } from "../http";

/** Products that need a Google grant: Search Console, GA4, Sheets export; "account" = link only. */
export type GoogleProduct = "gsc" | "ga4";
export type GoogleIntent = GoogleProduct | "sheets" | "account";

export const GOOGLE_SCOPE = {
  gsc: "https://www.googleapis.com/auth/webmasters.readonly",
  ga4: "https://www.googleapis.com/auth/analytics.readonly",
  sheets: "https://www.googleapis.com/auth/drive.file",
} as const;

export const GOOGLE_BASE_SCOPES = ["openid", "email", "profile"];

/** Scopes requested per intent (incremental consent: `include_granted_scopes=true` keeps earlier grants). */
export function scopesForIntent(intent: GoogleIntent): string[] {
  if (intent === "sheets") return [...GOOGLE_BASE_SCOPES, GOOGLE_SCOPE.sheets];
  return [...GOOGLE_BASE_SCOPES, GOOGLE_SCOPE.gsc, GOOGLE_SCOPE.ga4];
}

export const GOOGLE_PRODUCT_PROVIDER: Record<GoogleProduct, string> = {
  gsc: PROVIDERS.gsc,
  ga4: PROVIDERS.ga4,
};

export const GOOGLE_PRODUCT_SCOPE: Record<GoogleProduct, string> = {
  gsc: GOOGLE_SCOPE.gsc,
  ga4: GOOGLE_SCOPE.ga4,
};

export const GOOGLE_OAUTH_COOKIE = "autoseo_google_oauth";
export const GOOGLE_CALLBACK_PATH = "/api/oauth/google/callback";

export class GoogleNotConfiguredError extends Error {
  constructor() {
    super("Google OAuth is not configured. An admin can add the OAuth client in Admin → Data Providers.");
  }
}

export class GoogleReconnectRequiredError extends Error {
  constructor(message = "The Google connection expired or was revoked. Please reconnect.") {
    super(message);
  }
}

export class GoogleNotConnectedError extends Error {
  constructor(product: GoogleProduct) {
    super(product === "gsc" ? "Google Search Console is not connected." : "Google Analytics is not connected.");
  }
}

/** The linked account lacks a scope (e.g. Sheets export before `drive.file` was granted). */
export class GoogleScopeMissingError extends Error {
  constructor(
    public scope: string,
    message = "The Google account has not granted the required permission.",
  ) {
    super(message);
  }
}

export function googleRedirectUri(): string {
  return `${env.appUrl}${GOOGLE_CALLBACK_PATH}`;
}

export async function getGoogleOAuthStatus() {
  const g = await getSetting("google");
  return { configured: !!(g.oauthClientId && g.oauthClientSecret), redirectUri: googleRedirectUri() };
}

export async function requireGoogleClient() {
  const g = await getSetting("google");
  if (!g.oauthClientId || !g.oauthClientSecret) throw new GoogleNotConfiguredError();
  return { clientId: g.oauthClientId, clientSecret: g.oauthClientSecret };
}

export type GoogleTokenResponse = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  token_type?: string;
};

export async function refreshGoogleToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = await requireGoogleClient();
  return httpJson<GoogleTokenResponse>("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }),
    timeoutMs: 15_000,
  });
}

export type GoogleUserInfo = { sub: string | null; email: string | null; name: string | null; picture: string | null };

export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  try {
    const info = await httpJson<{ email?: string; sub?: string; name?: string; picture?: string }>(
      "https://openidconnect.googleapis.com/v1/userinfo",
      { headers: { Authorization: `Bearer ${accessToken}` }, timeoutMs: 10_000 },
    );
    return { sub: info.sub ?? null, email: info.email ?? null, name: info.name ?? null, picture: info.picture ?? null };
  } catch {
    return { sub: null, email: null, name: null, picture: null };
  }
}

/** Splits an OAuth scope string (space or comma separated) into a de-duplicated list. */
export function parseScopes(scope: string | string[] | null | undefined): string[] {
  const list = Array.isArray(scope) ? scope : (scope ?? "").split(/[\s,]+/);
  return [...new Set(list.map((s) => s.trim()).filter(Boolean))];
}
