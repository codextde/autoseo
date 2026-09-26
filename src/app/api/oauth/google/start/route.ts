import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getProjectContext } from "@/server/auth/context";
import { env } from "@/server/env";
import {
  createGoogleAuthRequest,
  getGoogleOAuthStatus,
  GOOGLE_CALLBACK_PATH,
  GOOGLE_OAUTH_COOKIE,
  sanitizeReturnPath,
} from "@/server/integrations/google/oauth";

const query = z.object({
  projectId: z.string().min(3).max(64),
  /** gsc / ga4 = connect a product; sheets = grant Sheets export; account = link / reconnect an account. */
  product: z.enum(["gsc", "ga4", "sheets", "account"]),
  loginHint: z.string().email().max(320).optional(),
  returnTo: z.string().max(500).optional(),
});

/**
 * Starts the Google OAuth (authorization code + PKCE) flow. GSC / GA4 / account linking need
 * `settings.manage`; granting Sheets export (drive.file) only needs project access.
 */
export async function GET(req: NextRequest) {
  const parsed = query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { projectId, product } = parsed.data;
  const ctx = await getProjectContext(projectId);
  if (!ctx) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`, env.appUrl));
  const fallback =
    product === "gsc"
      ? `/p/${projectId}/analytics/search-console?tab=settings`
      : product === "ga4"
        ? `/p/${projectId}/analytics/traffic?tab=settings`
        : `/p/${projectId}/integrations`;
  const returnTo = sanitizeReturnPath(parsed.data.returnTo, fallback);
  const back = (params: Record<string, string>) => {
    const url = new URL(returnTo, env.appUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return NextResponse.redirect(url);
  };
  if (product !== "sheets" && !ctx.permissions.has("settings.manage") && !ctx.isInstanceAdmin)
    return back({ google_error: "forbidden", google_product: product });
  const status = await getGoogleOAuthStatus();
  if (!status.configured) return back({ google_error: "not_configured", google_product: product });

  const { url, cookieValue } = await createGoogleAuthRequest({
    projectId,
    intent: product,
    userId: ctx.user.id,
    returnTo,
    loginHint: parsed.data.loginHint ?? null,
  });
  const res = NextResponse.redirect(url);
  res.cookies.set(GOOGLE_OAUTH_COOKIE, cookieValue, {
    httpOnly: true,
    secure: !env.isLocal,
    sameSite: "lax",
    path: GOOGLE_CALLBACK_PATH,
    maxAge: 600,
  });
  return res;
}
