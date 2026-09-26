import { registerClient, RegistrationError } from "@/server/api/oauth/clients";
import { checkRateLimit, clientIp } from "@/server/api/rate-limit";
import { CORS_HEADERS } from "@/server/api/urls";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS_HEADERS };

/** RFC 7591 dynamic client registration (open registration, rate-limited per IP). */
export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  // Per-IP limit plus a global cap (IPs can be spoofed) on open dynamic registration.
  const rl = checkRateLimit(`oauth-register:${ip}`, 30, 60 * 60 * 1000);
  const global = rl.allowed ? checkRateLimit("oauth-register:*", 300, 60 * 60 * 1000) : rl;
  if (!rl.allowed || !global.allowed) {
    return new Response(JSON.stringify({ error: "invalid_client_metadata", error_description: "Too many registrations, try again later." }), {
      status: 429,
      headers: { ...JSON_HEADERS, "Retry-After": String(Math.max(rl.retryAfter, global.retryAfter)) },
    });
  }
  const text = await req.text();
  if (text.length > 64 * 1024) {
    return new Response(JSON.stringify({ error: "invalid_client_metadata", error_description: "Metadata too large." }), { status: 413, headers: JSON_HEADERS });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(JSON.stringify({ error: "invalid_client_metadata", error_description: "Body must be JSON." }), { status: 400, headers: JSON_HEADERS });
  }
  try {
    const { response } = await registerClient(body, ip === "unknown" ? null : ip);
    return new Response(JSON.stringify(response), { status: 201, headers: JSON_HEADERS });
  } catch (err) {
    if (err instanceof RegistrationError) {
      return new Response(JSON.stringify({ error: err.error, error_description: err.message }), { status: 400, headers: JSON_HEADERS });
    }
    console.error("[oauth] registration failed", err);
    return new Response(JSON.stringify({ error: "server_error", error_description: "Registration failed." }), { status: 500, headers: JSON_HEADERS });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
