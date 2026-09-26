import "server-only";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { env } from "@/server/env";
import { hmac, timingSafeEqualStr } from "@/server/crypto";
import { db } from "@/server/db/client";
import { projects } from "@/server/db/schema";
import { getIntegration, saveIntegration } from "../store";
import { httpJson, IntegrationHttpError } from "../http";
import {
  fetchGoogleUserInfo,
  GOOGLE_PRODUCT_PROVIDER,
  GOOGLE_PRODUCT_SCOPE,
  GOOGLE_SCOPE,
  GoogleNotConfiguredError,
  GoogleNotConnectedError,
  GoogleReconnectRequiredError,
  GoogleScopeMissingError,
  googleRedirectUri,
  parseScopes,
  requireGoogleClient,
  scopesForIntent,
  type GoogleIntent,
  type GoogleProduct,
  type GoogleTokenResponse,
} from "./core";
import { getAccountAccessToken, migrateLegacyGoogleGrants, upsertGoogleAccount, type GoogleAccountRow } from "./accounts";

// Re-exports: callers import the Google basics from here.
export {
  fetchGoogleUserInfo,
  getGoogleOAuthStatus,
  GOOGLE_CALLBACK_PATH,
  GOOGLE_OAUTH_COOKIE,
  GOOGLE_PRODUCT_PROVIDER,
  GOOGLE_PRODUCT_SCOPE,
  GOOGLE_SCOPE,
  GoogleNotConfiguredError,
  GoogleNotConnectedError,
  GoogleReconnectRequiredError,
  GoogleScopeMissingError,
  googleRedirectUri,
} from "./core";
export type { GoogleIntent, GoogleProduct } from "./core";

/* ───────────────────────────── State (HMAC-signed) + PKCE ───────────────────────────── */

type StatePayload = { p: string; k: GoogleIntent; u: string; r: string; n: string; e: number };

const INTENTS: GoogleIntent[] = ["gsc", "ga4", "sheets", "account"];

function b64url(buf: Buffer | string) {
  return Buffer.from(buf).toString("base64url");
}

export function signState(payload: StatePayload): string {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${hmac(body, "google-oauth-state")}`;
}

export function verifyState(state: string | null): StatePayload | null {
  if (!state) return null;
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  if (!timingSafeEqualStr(sig, hmac(body, "google-oauth-state"))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload;
    if (typeof payload.e !== "number" || payload.e < Date.now()) return null;
    if (!INTENTS.includes(payload.k)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Only same-origin absolute paths are allowed as post-auth redirect targets. */
export function sanitizeReturnPath(path: string | null | undefined, fallback: string): string {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return fallback;
  // Control characters (e.g. "/\t/evil.com") are stripped by URL parsing and could form "//host".
  if (/[\u0000-\u001F\u007F]/.test(path)) return fallback;
  try {
    const base = new URL(env.appUrl);
    const resolved = new URL(path, base);
    if (resolved.origin !== base.origin) return fallback;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
}

export async function createGoogleAuthRequest(input: {
  projectId: string;
  intent: GoogleIntent;
  userId: string;
  returnTo: string;
  loginHint?: string | null;
}): Promise<{ url: string; cookieValue: string }> {
  const { clientId } = await requireGoogleClient();
  const nonce = crypto.randomBytes(16).toString("base64url");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = signState({ p: input.projectId, k: input.intent, u: input.userId, r: input.returnTo, n: nonce, e: Date.now() + 10 * 60_000 });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: scopesForIntent(input.intent).join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: input.loginHint ? "consent" : "select_account consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  if (input.loginHint) params.set("login_hint", input.loginHint);
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, cookieValue: `${nonce}.${verifier}` };
}

export async function exchangeGoogleCode(code: string, verifier: string): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = await requireGoogleClient();
  return httpJson<GoogleTokenResponse>("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: googleRedirectUri(),
    }),
  });
}

const MISSING_SCOPE_COPY: Record<GoogleIntent, string> = {
  gsc: "Search Console access was not granted. Please tick the Search Console permission on the Google consent screen.",
  ga4: "Analytics access was not granted. Please tick the Google Analytics permission on the Google consent screen.",
  sheets: "Google Sheets access was not granted. Please allow AutoSEO to create spreadsheets on the Google consent screen.",
  account: "",
};

/**
 * Finishes a consent: links (or refreshes) the workspace Google account and, for GSC/GA4, attaches
 * it to the project's integration (status "pending" until a property is picked).
 */
export async function completeGoogleAuth(input: {
  projectId: string;
  intent: GoogleIntent;
  userId: string;
  tokens: GoogleTokenResponse;
}): Promise<{ account: GoogleAccountRow }> {
  const [project] = await db.select({ workspaceId: projects.workspaceId }).from(projects).where(eq(projects.id, input.projectId)).limit(1);
  if (!project) throw new Error("Project not found");
  const info = await fetchGoogleUserInfo(input.tokens.access_token);
  if (!info.sub) throw new GoogleReconnectRequiredError("Google did not return the account id. Please try again.");
  const granted = parseScopes(input.tokens.scope);
  const required = input.intent === "sheets" ? GOOGLE_SCOPE.sheets : input.intent === "account" ? null : GOOGLE_PRODUCT_SCOPE[input.intent];
  if (required && !granted.includes(required)) throw new GoogleScopeMissingError(required, MISSING_SCOPE_COPY[input.intent]);
  const account = await upsertGoogleAccount({ workspaceId: project.workspaceId, userId: input.userId, info: { ...info, sub: info.sub }, tokens: input.tokens });
  if (input.intent === "gsc" || input.intent === "ga4") await attachGoogleAccount(input.projectId, input.intent, account, input.userId);
  return { account };
}

/** Points the project's GSC/GA4 integration at an account (keeps the selection when it is the same account). */
export async function attachGoogleAccount(projectId: string, product: GoogleProduct, account: GoogleAccountRow, userId: string) {
  const provider = GOOGLE_PRODUCT_PROVIDER[product];
  const existing = await getIntegration(projectId, provider);
  const cfg = existing?.config ?? {};
  const sameAccount = cfg.googleAccountId === account.id;
  if (sameAccount && existing?.status === "connected") return existing;
  return saveIntegration({
    projectId,
    provider,
    status: sameAccount && existing?.status === "error" ? "connected" : "pending",
    config: sameAccount
      ? { ...cfg, email: account.email }
      : { ...cfg, googleAccountId: account.id, email: account.email, connectedAt: new Date().toISOString() },
    secret: null,
    connectedBy: existing?.connectedBy ?? userId,
    lastError: null,
  });
}

/* ───────────────────────────── Access tokens ───────────────────────────── */

/** Returns a valid access token for the project's Google product connection (via its linked account). */
export async function getGoogleAccessToken(projectId: string, product: GoogleProduct): Promise<string> {
  let row = await getIntegration(projectId, GOOGLE_PRODUCT_PROVIDER[product]);
  if (!row) throw new GoogleNotConnectedError(product);
  // Demo projects carry sample integration rows without a grant — never call Google for them.
  if ((row.config as { demo?: unknown } | null)?.demo === true)
    throw new GoogleReconnectRequiredError("Live Google reports aren't available for demo data. Connect Google in a real project to see this panel.");
  if (row.secret && !row.config.googleAccountId) {
    await migrateLegacyGoogleGrants({ projectId });
    row = (await getIntegration(projectId, GOOGLE_PRODUCT_PROVIDER[product]))!;
  }
  const accountId = typeof row.config.googleAccountId === "string" ? row.config.googleAccountId : null;
  if (!accountId) throw new GoogleReconnectRequiredError();
  const [project] = await db.select({ workspaceId: projects.workspaceId }).from(projects).where(eq(projects.id, projectId)).limit(1);
  return getAccountAccessToken(accountId, { workspaceId: project?.workspaceId, scope: GOOGLE_PRODUCT_SCOPE[product] });
}

/** Best-effort revocation of a refresh token at Google (invalidates the whole grant of that account). */
export async function revokeGoogleToken(refreshToken: string | null) {
  if (!refreshToken) return;
  try {
    await httpJson(`https://oauth2.googleapis.com/revoke`, { method: "POST", body: new URLSearchParams({ token: refreshToken }), timeoutMs: 10_000 });
  } catch {
    // ignore — the user can revoke in their Google account settings
  }
}

/** Maps Google API errors to friendly messages. */
export function googleApiErrorMessage(err: unknown, product: GoogleProduct | "sheets"): string {
  if (
    err instanceof GoogleReconnectRequiredError ||
    err instanceof GoogleNotConfiguredError ||
    err instanceof GoogleNotConnectedError ||
    err instanceof GoogleScopeMissingError
  )
    return err.message;
  if (err instanceof IntegrationHttpError) {
    const label = product === "gsc" ? "Search Console" : product === "ga4" ? "Google Analytics" : "Google Sheets";
    const upstream = extractGoogleError(err.body);
    if (err.status === 401) return `${label} denied access — please reconnect.`;
    if (err.status === 403) {
      if (/SERVICE_DISABLED|has not been used|is disabled/i.test(err.body))
        return `The ${label} API is not enabled for the Google Cloud project of the OAuth client. An admin must enable it in Google Cloud Console.`;
      return `${label} denied access (no permission for this property, or access was revoked).${upstream ? ` ${upstream}` : ""}`;
    }
    if (err.status === 404) return `${label} property not found.`;
    if (err.status === 429) return `${label} rate limit reached — try again in a few minutes.`;
    if (err.status === 400) return `${label} rejected the request.${upstream ? ` ${upstream}` : ""}`;
    return `${label} API error (${err.status || "network"}): ${upstream || err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export function extractGoogleError(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; error_description?: string };
    if (typeof parsed.error === "object" && parsed.error?.message) return parsed.error.message;
    if (parsed.error_description) return parsed.error_description;
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    // not JSON
  }
  return body.slice(0, 200);
}
