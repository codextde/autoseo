import "server-only";
import type { CoolifySettings } from "@/server/settings";

/** Thin client for the Coolify v4 API (`/api/v1`, bearer token, JSON). */

export class CoolifyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "CoolifyError";
  }
}

export type CoolifyConnection = { baseUrl: string; apiToken: string };

export type CoolifyServer = { uuid: string; name: string; ip?: string; description?: string | null };
export type CoolifyProject = { uuid: string; name: string; description?: string | null };
export type CoolifyEnvironment = { uuid?: string; name: string };
export type CoolifyService = { uuid: string; name: string; description?: string | null; status?: string | null };
export type CoolifyServiceApplication = { uuid: string; name: string; fqdn?: string | null; status?: string | null };

export function connectionFromSettings(s: Pick<CoolifySettings, "baseUrl" | "apiToken">): CoolifyConnection {
  if (!s.baseUrl || !s.apiToken) throw new CoolifyError("Coolify is not configured (base URL and API token are required).", 0);
  return { baseUrl: s.baseUrl.replace(/\/+$/, "").replace(/\/api\/v1$/, ""), apiToken: s.apiToken };
}

function describe(status: number, body: unknown): string {
  const b = body as { message?: unknown; errors?: Record<string, string[]> } | null;
  const errors = b?.errors && typeof b.errors === "object" ? Object.values(b.errors).flat().join(" ") : "";
  const message = typeof b?.message === "string" ? b.message : typeof body === "string" && body.length < 300 ? body : "";
  if (status === 401) return "Coolify rejected the API token (401). Create a token with read + write + deploy permissions.";
  return [`Coolify API error ${status}`, message, errors].filter(Boolean).join(": ");
}

async function request<T>(
  conn: CoolifyConnection,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  timeoutMs = 20_000,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${conn.baseUrl}/api/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${conn.apiToken}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (err) {
    const reason = err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err);
    throw new CoolifyError(`Could not reach Coolify at ${conn.baseUrl}: ${reason}`, 0);
  }
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // plain text (e.g. /version)
  }
  if (!res.ok) throw new CoolifyError(describe(res.status, parsed), res.status, parsed);
  return parsed as T;
}

/** Newer Coolify exposes lifecycle actions as POST, older releases as GET: try POST, fall back on 404/405. */
async function lifecycle(conn: CoolifyConnection, path: string): Promise<unknown> {
  try {
    return await request(conn, "POST", path);
  } catch (err) {
    if (err instanceof CoolifyError && (err.status === 404 || err.status === 405)) return request(conn, "GET", path);
    throw err;
  }
}

export const coolify = {
  async version(conn: CoolifyConnection): Promise<string> {
    const v = await request<unknown>(conn, "GET", "/version", undefined, 10_000);
    return typeof v === "string" ? v.trim() : JSON.stringify(v);
  },

  listServers(conn: CoolifyConnection) {
    return request<CoolifyServer[]>(conn, "GET", "/servers");
  },

  listProjects(conn: CoolifyConnection) {
    return request<CoolifyProject[]>(conn, "GET", "/projects");
  },

  createProject(conn: CoolifyConnection, name: string, description: string) {
    return request<{ uuid: string }>(conn, "POST", "/projects", { name, description });
  },

  listEnvironments(conn: CoolifyConnection, projectUuid: string) {
    return request<CoolifyEnvironment[]>(conn, "GET", `/projects/${encodeURIComponent(projectUuid)}/environments`);
  },

  createEnvironment(conn: CoolifyConnection, projectUuid: string, name: string) {
    return request<{ uuid: string }>(conn, "POST", `/projects/${encodeURIComponent(projectUuid)}/environments`, { name });
  },

  listServices(conn: CoolifyConnection) {
    return request<CoolifyService[]>(conn, "GET", "/services");
  },

  createService(conn: CoolifyConnection, body: Record<string, unknown>) {
    return request<{ uuid: string; domains?: string[] }>(conn, "POST", "/services", body, 60_000);
  },

  getService(conn: CoolifyConnection, uuid: string) {
    return request<CoolifyService & Record<string, unknown>>(conn, "GET", `/services/${encodeURIComponent(uuid)}`);
  },

  listServiceApplications(conn: CoolifyConnection, uuid: string) {
    return request<CoolifyServiceApplication[]>(conn, "GET", `/services/${encodeURIComponent(uuid)}/applications`);
  },

  updateServiceApplication(conn: CoolifyConnection, uuid: string, appUuid: string, body: { url: string }) {
    return request<unknown>(
      conn,
      "PATCH",
      `/services/${encodeURIComponent(uuid)}/applications/${encodeURIComponent(appUuid)}`,
      body,
    );
  },

  setServiceEnvs(conn: CoolifyConnection, uuid: string, data: { key: string; value: string; is_literal: boolean }[]) {
    return request<unknown>(conn, "PATCH", `/services/${encodeURIComponent(uuid)}/envs/bulk`, { data });
  },

  startService(conn: CoolifyConnection, uuid: string) {
    return lifecycle(conn, `/services/${encodeURIComponent(uuid)}/start`);
  },

  stopService(conn: CoolifyConnection, uuid: string) {
    return lifecycle(conn, `/services/${encodeURIComponent(uuid)}/stop`);
  },

  restartService(conn: CoolifyConnection, uuid: string, opts: { latest?: boolean } = {}) {
    return lifecycle(conn, `/services/${encodeURIComponent(uuid)}/restart${opts.latest ? "?latest=true" : ""}`);
  },

  deleteService(conn: CoolifyConnection, uuid: string) {
    return request<unknown>(
      conn,
      "DELETE",
      `/services/${encodeURIComponent(uuid)}?delete_configurations=true&delete_volumes=true&docker_cleanup=true&delete_connected_networks=true`,
    );
  },
};

/** Coolify reports e.g. `running:healthy`, `running:unhealthy`, `starting`, `exited`, `degraded:unhealthy`. */
export function parseServiceStatus(status: unknown): { state: string; health: string | null } {
  const raw = typeof status === "string" ? status.toLowerCase() : "";
  const [state = "unknown", health = null] = raw.split(/[:()]/).filter(Boolean);
  return { state: state || "unknown", health };
}

/** `GET https://<host>/api/health` must answer 200 for an instance to count as ready. */
export async function checkInstanceHealth(host: string, timeoutMs = 8_000): Promise<boolean> {
  try {
    const res = await fetch(`https://${host}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
      cache: "no-store",
    });
    return res.status === 200;
  } catch {
    return false;
  }
}
