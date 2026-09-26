import path from "node:path";

/**
 * The only environment configuration the cloud app reads. Integration credentials (SMTP, Stripe,
 * Coolify) are entered in /admin and stored encrypted in the database.
 */
function normalizeDomain(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  if (!value) return "autoseo.codext.de";
  return value.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

const domain = normalizeDomain(process.env.DOMAIN);
const isLocal = /^(localhost|127\.0\.0\.1|\[::1\]|[^.]+\.localhost|.+\.test)(:\d+)?$/.test(domain);

export const env = {
  domain,
  /** Public base URL, e.g. https://autoseo.codext.de (no trailing slash). */
  appUrl: process.env.APP_URL?.trim().replace(/\/+$/, "") || `${isLocal ? "http" : "https"}://${domain}`,
  isLocal,
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: process.env.DATABASE_URL ?? "postgres://autoseo:autoseo@localhost:54329/autoseo_cloud",
  dataDir: process.env.DATA_DIR ?? path.join(process.cwd(), "data"),
  adminEmails: (process.env.ADMIN_EMAILS ?? "")
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
};

export function isAdminEmail(email: string): boolean {
  return env.adminEmails.includes(email.trim().toLowerCase());
}
