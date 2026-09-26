/**
 * Docker Compose + environment for one managed instance (Coolify service), following
 * docs/MANAGED_INSTANCES.md. The compose file only contains `${VAR}` references: every secret is
 * set through Coolify's environment API. Pure so it can be unit tested.
 */

export const IMAGE_PATTERN = /^[a-z0-9][a-z0-9._\-/]*(?::[A-Za-z0-9._-]{1,128})?(?:@sha256:[a-f0-9]{64})?$/;
export const MEMORY_PATTERN = /^[1-9]\d{0,5}(?:\.\d+)?[bkmg]?$/i;

export type ComposeOptions = { image: string; memoryLimit: string };

export function assertComposeOptions(opts: ComposeOptions): void {
  if (!IMAGE_PATTERN.test(opts.image)) throw new Error(`Invalid Docker image "${opts.image}"`);
  if (!MEMORY_PATTERN.test(opts.memoryLimit)) throw new Error(`Invalid memory limit "${opts.memoryLimit}" (e.g. 1536m or 2g)`);
}

/** Variables the app container receives from Coolify's service environment (values set via the API). */
export const INSTANCE_ENV_KEYS = [
  "DOMAIN",
  "AUTOSEO_OWNER_EMAIL",
  "AUTOSEO_OWNER_NAME",
  "AUTOSEO_WORKSPACE_NAME",
  "AUTOSEO_SMTP_URL",
  "AUTOSEO_MAIL_FROM",
  "AUTOSEO_SSO_SECRET",
  "AUTOSEO_CLOUD_URL",
] as const;
export type InstanceEnvKey = (typeof INSTANCE_ENV_KEYS)[number];

export function buildCompose(opts: ComposeOptions): string {
  assertComposeOptions(opts);
  const env = ["SERVICE_FQDN_APP_3000", ...INSTANCE_ENV_KEYS.map((k) => `${k}=\${${k}}`)];
  env.splice(
    2,
    0,
    "DATABASE_URL=postgres://autoseo:${SERVICE_PASSWORD_POSTGRES}@postgres:5432/autoseo",
    "DATA_DIR=/data",
  );
  return `services:
  app:
    image: ${JSON.stringify(opts.image)}
    restart: unless-stopped
    mem_limit: ${JSON.stringify(opts.memoryLimit.toLowerCase())}
    environment:
${env.map((e) => `      - ${e}`).join("\n")}
    volumes:
      - autoseo-data:/data
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 90s
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    mem_limit: 512m
    environment:
      - POSTGRES_USER=autoseo
      - POSTGRES_PASSWORD=\${SERVICE_PASSWORD_POSTGRES}
      - POSTGRES_DB=autoseo
    volumes:
      - autoseo-pg:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U autoseo -d autoseo"]
      interval: 5s
      timeout: 5s
      retries: 20
volumes:
  autoseo-data: {}
  autoseo-pg: {}
`;
}

export type InstanceEnvInput = {
  host: string;
  ownerEmail: string;
  ownerName: string;
  workspaceName: string;
  smtpUrl: string | null;
  mailFrom: string | null;
  ssoSecret: string;
  cloudUrl: string;
};

/** Values for `PATCH /services/{uuid}/envs/bulk`. Empty strings clear a value (e.g. SMTP sharing turned off). */
export function buildInstanceEnv(input: InstanceEnvInput): { key: InstanceEnvKey; value: string; is_literal: true }[] {
  const values: Record<InstanceEnvKey, string> = {
    DOMAIN: input.host,
    AUTOSEO_OWNER_EMAIL: input.ownerEmail,
    AUTOSEO_OWNER_NAME: input.ownerName,
    AUTOSEO_WORKSPACE_NAME: input.workspaceName,
    AUTOSEO_SMTP_URL: input.smtpUrl ?? "",
    AUTOSEO_MAIL_FROM: input.smtpUrl ? (input.mailFrom ?? "") : "",
    AUTOSEO_SSO_SECRET: input.ssoSecret,
    AUTOSEO_CLOUD_URL: input.cloudUrl,
  };
  return INSTANCE_ENV_KEYS.map((key) => ({ key, value: values[key], is_literal: true as const }));
}

export function serviceName(slug: string): string {
  return `autoseo-${slug}`;
}

export function instanceHost(slug: string, baseDomain: string): string {
  return `${slug}.${baseDomain.replace(/^\.+|\.+$/g, "").toLowerCase()}`;
}

export function instanceUrl(host: string): string {
  return `https://${host}`;
}

/** Body for `POST /services` (the compose is base64 encoded, the domain goes through `urls`). */
export function buildCreateServiceBody(opts: {
  slug: string;
  host: string;
  ownerEmail: string;
  projectUuid: string;
  serverUuid: string;
  environmentName: string;
  image: string;
  memoryLimit: string;
}) {
  return {
    name: serviceName(opts.slug),
    description: `AutoSEO Cloud instance for ${opts.ownerEmail}`,
    project_uuid: opts.projectUuid,
    server_uuid: opts.serverUuid,
    environment_name: opts.environmentName,
    instant_deploy: false,
    docker_compose_raw: Buffer.from(buildCompose({ image: opts.image, memoryLimit: opts.memoryLimit }), "utf8").toString("base64"),
    urls: [{ name: "app", url: instanceUrl(opts.host) }],
  };
}
