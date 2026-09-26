import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  buildCompose,
  buildCreateServiceBody,
  buildInstanceEnv,
  INSTANCE_ENV_KEYS,
  instanceHost,
  serviceName,
} from "./compose";

const opts = { image: "ghcr.io/codextde/autoseo:latest", memoryLimit: "1536m" };

describe("buildCompose", () => {
  const yaml = buildCompose(opts);
  const doc = parse(yaml) as {
    services: Record<string, { image: string; mem_limit: string; environment: string[]; volumes: string[]; healthcheck: { test: string[] }; depends_on?: unknown }>;
    volumes: Record<string, unknown>;
  };

  it("is valid YAML with the app + postgres services and both volumes", () => {
    expect(Object.keys(doc.services).sort()).toEqual(["app", "postgres"]);
    expect(Object.keys(doc.volumes).sort()).toEqual(["autoseo-data", "autoseo-pg"]);
    expect(doc.services.app!.image).toBe(opts.image);
    expect(doc.services.app!.mem_limit).toBe("1536m");
    expect(doc.services.app!.volumes).toEqual(["autoseo-data:/data"]);
    expect(doc.services.app!.depends_on).toEqual({ postgres: { condition: "service_healthy" } });
    expect(doc.services.app!.healthcheck.test).toEqual(["CMD", "curl", "-fsS", "http://127.0.0.1:3000/api/health"]);
    expect(doc.services.postgres!.image).toBe("postgres:17-alpine");
    expect(doc.services.postgres!.mem_limit).toBe("512m");
    expect(doc.services.postgres!.volumes).toEqual(["autoseo-pg:/var/lib/postgresql/data"]);
  });

  it("exposes the app on port 3000 and wires every instance variable through ${VAR} references", () => {
    const env = doc.services.app!.environment;
    expect(env[0]).toBe("SERVICE_FQDN_APP_3000");
    expect(env).toContain("DATABASE_URL=postgres://autoseo:${SERVICE_PASSWORD_POSTGRES}@postgres:5432/autoseo");
    expect(env).toContain("DATA_DIR=/data");
    for (const key of INSTANCE_ENV_KEYS) expect(env).toContain(`${key}=\${${key}}`);
    expect(doc.services.postgres!.environment).toContain("POSTGRES_PASSWORD=${SERVICE_PASSWORD_POSTGRES}");
  });

  it("contains no secret values — every assignment is a literal constant or a ${VAR} reference", () => {
    const allowedLiterals = new Set(["DATA_DIR=/data", "POSTGRES_USER=autoseo", "POSTGRES_DB=autoseo"]);
    for (const service of Object.values(doc.services)) {
      for (const entry of service.environment) {
        if (!entry.includes("=")) continue;
        const value = entry.slice(entry.indexOf("=") + 1);
        const onlyRefs = value.replace(/\$\{[A-Z0-9_]+\}/g, "");
        if (allowedLiterals.has(entry)) continue;
        expect(onlyRefs, entry).not.toMatch(/[a-f0-9]{32,}|smtps?:\/\/[^@]*:[^@]*@|sk_(live|test)_/i);
        expect(value, entry).toMatch(/\$\{[A-Z0-9_]+\}/);
      }
    }
    expect(yaml).not.toMatch(/sk_(live|test)_|whsec_|smtps?:\/\//);
  });

  it("rejects image or memory values that could inject YAML", () => {
    expect(() => buildCompose({ ...opts, image: "evil\n    privileged: true" })).toThrow(/Invalid Docker image/);
    expect(() => buildCompose({ ...opts, image: "Upper/Case" })).toThrow(/Invalid Docker image/);
    expect(() => buildCompose({ ...opts, memoryLimit: "1g\nprivileged: true" })).toThrow(/Invalid memory limit/);
    expect(() => buildCompose({ image: "ghcr.io/codextde/autoseo@sha256:" + "a".repeat(64), memoryLimit: "2g" })).not.toThrow();
  });
});

describe("buildCreateServiceBody", () => {
  const body = buildCreateServiceBody({
    slug: "acme",
    host: instanceHost("acme", "autoseo.codext.de"),
    ownerEmail: "owner@acme.com",
    projectUuid: "prj",
    serverUuid: "srv",
    environmentName: "production",
    ...opts,
  });

  it("names the service autoseo-<slug> and sets the domain through `urls`", () => {
    expect(body.name).toBe("autoseo-acme");
    expect(serviceName("acme")).toBe("autoseo-acme");
    expect(body.urls).toEqual([{ name: "app", url: "https://acme.autoseo.codext.de" }]);
    expect(body).toMatchObject({ project_uuid: "prj", server_uuid: "srv", environment_name: "production", instant_deploy: false });
  });

  it("sends the compose base64 encoded", () => {
    expect(Buffer.from(body.docker_compose_raw, "base64").toString("utf8")).toBe(buildCompose(opts));
  });
});

describe("buildInstanceEnv", () => {
  const input = {
    host: "acme.autoseo.codext.de",
    ownerEmail: "owner@acme.com",
    ownerName: "Owner",
    workspaceName: "Acme $HOME `x`",
    smtpUrl: "smtp://u:p%40ss@smtp.example.com:587",
    mailFrom: "AutoSEO <noreply@autoseo.codext.de>",
    ssoSecret: "f".repeat(64),
    cloudUrl: "https://autoseo.codext.de",
  };

  it("sets every contract variable as a literal (no Coolify interpolation)", () => {
    const env = buildInstanceEnv(input);
    expect(env.map((e) => e.key)).toEqual([...INSTANCE_ENV_KEYS]);
    expect(env.every((e) => e.is_literal)).toBe(true);
    const map = Object.fromEntries(env.map((e) => [e.key, e.value]));
    expect(map).toEqual({
      DOMAIN: "acme.autoseo.codext.de",
      AUTOSEO_OWNER_EMAIL: "owner@acme.com",
      AUTOSEO_OWNER_NAME: "Owner",
      AUTOSEO_WORKSPACE_NAME: "Acme $HOME `x`",
      AUTOSEO_SMTP_URL: input.smtpUrl,
      AUTOSEO_MAIL_FROM: input.mailFrom,
      AUTOSEO_SSO_SECRET: input.ssoSecret,
      AUTOSEO_CLOUD_URL: "https://autoseo.codext.de",
    });
  });

  it("clears SMTP values when instances don't share the SMTP server", () => {
    const map = Object.fromEntries(buildInstanceEnv({ ...input, smtpUrl: null }).map((e) => [e.key, e.value]));
    expect(map.AUTOSEO_SMTP_URL).toBe("");
    expect(map.AUTOSEO_MAIL_FROM).toBe("");
  });
});

describe("instanceHost", () => {
  it("joins slug and base domain", () => {
    expect(instanceHost("acme", "autoseo.codext.de")).toBe("acme.autoseo.codext.de");
    expect(instanceHost("acme", ".Autoseo.Codext.de.")).toBe("acme.autoseo.codext.de");
  });
});
