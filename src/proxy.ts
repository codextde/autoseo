import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PREFIXES = [
  "/login",
  "/auth",
  "/invite",
  "/setup",
  "/share",
  // Public free SEO tools (each page checks the admin "publicEnabled" switch itself).
  "/free-tools",
  "/api",
  "/.well-known",
  "/oauth",
  "/install",
  "/_next",
  "/favicon",
  "/brand",
  "/robots.txt",
  "/manifest.webmanifest",
];

/**
 * Lightweight gate: forwards the pathname to server components (for `?next=` redirects) and
 * redirects visitors without a session cookie to /login. Real session validation happens in
 * server components / route handlers (`requireUser`).
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname + search);

  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p));
  const hasSession =
    request.cookies.has("__Host-autoseo_session") || request.cookies.has("autoseo_session");

  if (!isPublic && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname + search)}` : "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // api/webhooks/server-logs is excluded: the proxy buffers request bodies only up to 10 MB, the log ingest accepts 16 MB.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/webhooks/server-logs|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt|js|css|woff2?)$).*)"],
};
