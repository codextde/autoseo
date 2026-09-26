import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { oauthClients } from "@/server/db/schema";
import { timingSafeEqualStr } from "@/server/crypto";
import { generateSecret, hashSecret } from "../tokens";

export type OAuthClient = typeof oauthClients.$inferSelect;

const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "about:", "blob:", "ftp:", "ws:", "wss:", "chrome:", "view-source:"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLoopbackHost(hostname: string) {
  return LOOPBACK_HOSTS.has(hostname) || /^127\.\d+\.\d+\.\d+$/.test(hostname);
}

/**
 * Redirect URI policy (OAuth 2.1 + RFC 8252): https anywhere, http only on loopback, or a
 * private-use custom scheme for native apps (cursor://, vscode://…). No fragments, no userinfo.
 */
export function validateRedirectUri(uri: string): string | null {
  if (typeof uri !== "string" || !uri || uri.length > 2048) return "redirect_uri is missing or too long";
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return `redirect_uri is not an absolute URI: ${uri.slice(0, 100)}`;
  }
  if (u.hash || uri.includes("#")) return "redirect_uri must not contain a fragment";
  if (u.username || u.password) return "redirect_uri must not contain credentials";
  const scheme = u.protocol.toLowerCase();
  if (BLOCKED_SCHEMES.has(scheme)) return `redirect_uri scheme ${scheme} is not allowed`;
  if (scheme === "https:") return u.hostname ? null : "redirect_uri must have a host";
  if (scheme === "http:") {
    return isLoopbackHost(u.hostname) ? null : "http redirect URIs are only allowed for loopback hosts (use https)";
  }
  if (!/^[a-z][a-z0-9+.-]*:$/.test(scheme)) return "redirect_uri has an invalid scheme";
  return null;
}

/** Exact match, except loopback http URIs where the port may vary (RFC 8252 §7.3). */
export function redirectUriMatches(registered: string, requested: string): boolean {
  if (registered === requested) return true;
  try {
    const a = new URL(registered);
    const b = new URL(requested);
    return (
      a.protocol === "http:" &&
      b.protocol === "http:" &&
      isLoopbackHost(a.hostname) &&
      a.hostname === b.hostname &&
      a.pathname === b.pathname &&
      a.search === b.search
    );
  } catch {
    return false;
  }
}

const optionalUrl = z
  .string()
  .max(2048)
  .optional()
  .transform((v) => {
    if (!v) return undefined;
    try {
      const u = new URL(v);
      return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
    } catch {
      return undefined;
    }
  });

/** RFC 7591 client metadata we accept. Unknown fields are ignored. */
export const registrationSchema = z.object({
  redirect_uris: z.array(z.string()).min(1, "redirect_uris is required").max(20),
  client_name: z.string().trim().max(200).optional(),
  token_endpoint_auth_method: z.enum(["none", "client_secret_post", "client_secret_basic"]).optional(),
  grant_types: z.array(z.string()).max(10).optional(),
  response_types: z.array(z.string()).max(10).optional(),
  scope: z.string().max(500).optional(),
  client_uri: optionalUrl,
  logo_uri: optionalUrl,
  software_id: z.string().max(200).optional(),
  software_version: z.string().max(100).optional(),
});

export class RegistrationError extends Error {
  constructor(
    public error: "invalid_redirect_uri" | "invalid_client_metadata",
    message: string,
  ) {
    super(message);
  }
}

export async function registerClient(raw: unknown, ip: string | null) {
  const parsed = registrationSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const isRedirect = issue?.path[0] === "redirect_uris";
    throw new RegistrationError(
      isRedirect ? "invalid_redirect_uri" : "invalid_client_metadata",
      issue ? `${issue.path.join(".") || "metadata"}: ${issue.message}` : "Invalid client metadata",
    );
  }
  const m = parsed.data;
  for (const uri of m.redirect_uris) {
    const err = validateRedirectUri(uri);
    if (err) throw new RegistrationError("invalid_redirect_uri", err);
  }
  const grantTypes = m.grant_types?.length ? m.grant_types : ["authorization_code", "refresh_token"];
  const unsupportedGrant = grantTypes.find((g) => g !== "authorization_code" && g !== "refresh_token");
  if (unsupportedGrant) throw new RegistrationError("invalid_client_metadata", `Unsupported grant_type: ${unsupportedGrant}`);
  const responseTypes = m.response_types?.length ? m.response_types : ["code"];
  if (responseTypes.some((r) => r !== "code")) throw new RegistrationError("invalid_client_metadata", "Only response_type \"code\" is supported");

  const authMethod = m.token_endpoint_auth_method ?? "none";
  const secret = authMethod === "none" ? null : generateSecret("as_cs_");
  const name = m.client_name?.trim() || "Unnamed MCP client";

  const [client] = await db
    .insert(oauthClients)
    .values({
      name,
      redirectUris: m.redirect_uris,
      grantTypes,
      responseTypes,
      tokenEndpointAuthMethod: authMethod,
      clientSecretHash: secret?.hash ?? null,
      scope: m.scope ?? null,
      clientUri: m.client_uri ?? null,
      logoUri: m.logo_uri ?? null,
      softwareId: m.software_id ?? null,
      softwareVersion: m.software_version ?? null,
      metadata: { ...m },
      registrationIp: ip,
    })
    .returning();

  return {
    client: client!,
    response: {
      client_id: client!.id,
      client_id_issued_at: Math.floor(client!.createdAt.getTime() / 1000),
      ...(secret ? { client_secret: secret.token, client_secret_expires_at: 0 } : {}),
      client_name: client!.name,
      redirect_uris: client!.redirectUris,
      grant_types: client!.grantTypes,
      response_types: client!.responseTypes,
      token_endpoint_auth_method: client!.tokenEndpointAuthMethod,
      ...(client!.scope ? { scope: client!.scope } : {}),
      ...(client!.clientUri ? { client_uri: client!.clientUri } : {}),
      ...(client!.logoUri ? { logo_uri: client!.logoUri } : {}),
    },
  };
}

export async function getClient(clientId: string | null | undefined): Promise<OAuthClient | null> {
  if (!clientId || clientId.length > 100) return null;
  const [row] = await db.select().from(oauthClients).where(eq(oauthClients.id, clientId)).limit(1);
  return row ?? null;
}

/**
 * Authenticates the client at the token / revocation endpoint (client_secret_basic,
 * client_secret_post or none for public clients). Returns null when authentication fails.
 */
export async function authenticateClient(req: Request, body: URLSearchParams): Promise<OAuthClient | null> {
  let clientId = body.get("client_id");
  let clientSecret = body.get("client_secret");
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("basic ")) {
    try {
      const decoded = Buffer.from(auth.slice(6).trim(), "base64").toString("utf8");
      const idx = decoded.indexOf(":");
      if (idx > 0) {
        clientId = decodeURIComponent(decoded.slice(0, idx));
        clientSecret = decodeURIComponent(decoded.slice(idx + 1));
      }
    } catch {
      return null;
    }
  }
  const client = await getClient(clientId);
  if (!client) return null;
  if (client.tokenEndpointAuthMethod === "none") return client;
  if (!clientSecret || !client.clientSecretHash) return null;
  return timingSafeEqualStr(hashSecret(clientSecret), client.clientSecretHash) ? client : null;
}
