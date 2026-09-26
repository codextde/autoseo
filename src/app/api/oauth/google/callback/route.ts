import { NextResponse, type NextRequest } from "next/server";
import { getProjectContext } from "@/server/auth/context";
import { env } from "@/server/env";
import { logAudit } from "@/server/audit";
import { timingSafeEqualStr } from "@/server/crypto";
import {
  exchangeGoogleCode,
  GOOGLE_CALLBACK_PATH,
  GOOGLE_OAUTH_COOKIE,
  completeGoogleAuth,
  GoogleReconnectRequiredError,
  GoogleScopeMissingError,
  sanitizeReturnPath,
  verifyState,
} from "@/server/integrations/google/oauth";
import { IntegrationHttpError } from "@/server/integrations/http";

/** OAuth redirect target registered in the Google Cloud console. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const state = verifyState(sp.get("state"));
  const fallback = state
    ? state.k === "gsc"
      ? `/p/${state.p}/analytics/search-console?tab=settings`
      : state.k === "ga4"
        ? `/p/${state.p}/analytics/traffic?tab=settings`
        : `/p/${state.p}/integrations`
    : "/";
  const returnTo = sanitizeReturnPath(state?.r, fallback);
  const finish = (params: Record<string, string>) => {
    const url = new URL(returnTo, env.appUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = NextResponse.redirect(url, 303);
    res.cookies.set(GOOGLE_OAUTH_COOKIE, "", { path: GOOGLE_CALLBACK_PATH, maxAge: 0 });
    return res;
  };

  if (!state) return finish({ google_error: "state_mismatch" });
  const product = state.k;
  if (sp.get("error")) return finish({ google_error: sp.get("error") === "access_denied" ? "access_denied" : "oauth_error", google_product: product });

  const cookie = req.cookies.get(GOOGLE_OAUTH_COOKIE)?.value ?? "";
  const [nonce, verifier] = cookie.split(".");
  if (!nonce || !verifier || !timingSafeEqualStr(nonce, state.n)) return finish({ google_error: "state_mismatch", google_product: product });

  const ctx = await getProjectContext(state.p);
  if (!ctx || ctx.user.id !== state.u) return finish({ google_error: "state_mismatch", google_product: product });
  if (product !== "sheets" && !ctx.permissions.has("settings.manage") && !ctx.isInstanceAdmin)
    return finish({ google_error: "forbidden", google_product: product });

  const code = sp.get("code");
  if (!code) return finish({ google_error: "oauth_error", google_product: product });

  try {
    const tokens = await exchangeGoogleCode(code, verifier);
    const { account } = await completeGoogleAuth({ projectId: state.p, intent: product, tokens, userId: ctx.user.id });
    await logAudit(product === "gsc" || product === "ga4" ? "integration.connect" : "integration.google_account_link", {
      actor: { id: ctx.user.id, email: ctx.user.email },
      targetType: product === "gsc" || product === "ga4" ? "integration" : "google_account",
      targetId: product === "gsc" ? "google_search_console" : product === "ga4" ? "google_analytics" : account.id,
      workspaceId: ctx.project.workspaceId,
      projectId: state.p,
      meta: { googleAccountId: account.id, email: account.email, intent: product },
    });
    return finish({
      google_connected: product,
      google_account: account.id,
      ...(product === "gsc" || product === "ga4" ? { picker: product } : {}),
    });
  } catch (err) {
    console.error("[oauth/google] callback failed", err);
    if (err instanceof GoogleReconnectRequiredError || err instanceof GoogleScopeMissingError) {
      return finish({ google_error: "missing_scope", google_product: product, google_message: err.message.slice(0, 200) });
    }
    if (err instanceof IntegrationHttpError && err.status === 400) return finish({ google_error: "invalid_grant", google_product: product });
    return finish({ google_error: "oauth_error", google_product: product });
  }
}
