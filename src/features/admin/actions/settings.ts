"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db/client";
import { roles } from "@/server/db/schema";
import { actionAdmin, ActionError, runAction } from "@/server/auth/guards";
import { emailDomain, isValidEmail } from "@/server/auth/domains";
import { getAdminSettings, isSettingsKey, saveSettingsGroup } from "@/server/admin/settings";
import { isSafeImageUrl, saveImageUpload, UploadError, deleteUploadByUrl } from "@/server/admin/uploads";
import { getSetting, type SettingsKey } from "@/server/settings";
import { logAudit } from "@/server/audit";

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function normalizeDomains(list: unknown): string[] {
  const arr = z.array(z.string()).parse(list);
  const out: string[] = [];
  for (const raw of arr) {
    const d = raw.trim().toLowerCase().replace(/^@/, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!d) continue;
    if (!DOMAIN_RE.test(d)) throw new ActionError(`"${raw}" is not a valid domain (e.g. solakon.de).`, "invalid");
    if (!out.includes(d)) out.push(d);
  }
  return out;
}

function assertHttpUrl(field: string, value: unknown) {
  if (typeof value !== "string" || value === "") return;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
  } catch {
    throw new ActionError(`${field} must be a full http(s) URL.`, "invalid");
  }
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}){1,2}$/;

/** Group-specific validation on top of the zod schemas in the registry. */
async function validatePatch(group: SettingsKey, patch: Record<string, unknown>, actor: { email: string }) {
  if (group === "auth") {
    if ("allowedDomains" in patch) {
      const domains = normalizeDomains(patch.allowedDomains);
      if (domains.length) {
        const own = emailDomain(actor.email);
        if (!domains.some((d) => own === d || own.endsWith(`.${d}`))) {
          throw new ActionError(
            `Your own domain (@${own}) must stay on the list, otherwise you would lock yourself out.`,
            "invalid",
          );
        }
      }
      patch.allowedDomains = domains;
    }
    if (typeof patch.defaultRoleKey === "string") {
      const [role] = await db.select({ key: roles.key }).from(roles).where(eq(roles.key, patch.defaultRoleKey)).limit(1);
      if (!role) throw new ActionError("The default role does not exist.", "invalid");
    }
  }
  if (group === "smtp") {
    for (const f of ["fromEmail", "replyTo"] as const) {
      const v = patch[f];
      if (typeof v === "string" && v && !isValidEmail(v)) throw new ActionError(`${f === "fromEmail" ? "From" : "Reply-to"} address is not a valid email.`, "invalid");
    }
    if (typeof patch.host === "string") patch.host = patch.host.trim();
  }
  if (group === "general") {
    for (const f of ["docsUrl", "demoBookingUrl"] as const) assertHttpUrl(f === "docsUrl" ? "Docs URL" : "Demo booking URL", patch[f]);
    for (const f of ["logoUrl", "faviconUrl"] as const) {
      const v = patch[f];
      if (typeof v === "string" && !isSafeImageUrl(v, v.startsWith("/") ? "branding" : undefined)) {
        throw new ActionError("Logo/favicon must be an uploaded file or an http(s) URL.", "invalid");
      }
    }
    for (const f of ["primaryColor", "accentColor"] as const) {
      const v = patch[f];
      if (typeof v === "string" && !HEX_RE.test(v)) throw new ActionError("Colors must be hex values like #16a34a.", "invalid");
    }
    if (typeof patch.supportEmail === "string" && patch.supportEmail && !isValidEmail(patch.supportEmail)) {
      throw new ActionError("Support email is not a valid email address.", "invalid");
    }
  }
  if (group === "onboarding" && Array.isArray(patch.steps)) {
    const steps = patch.steps as string[];
    for (const req of ["website", "market"]) if (!steps.includes(req)) steps.unshift(req);
    patch.steps = [...new Set(steps)];
  }
  if (group === "ai" && Array.isArray(patch.fallbackOrder)) {
    patch.fallbackOrder = [...new Set(patch.fallbackOrder as string[])];
  }
  if (group === "freeTools") {
    if (typeof patch.ctaUrl === "string") {
      const url = patch.ctaUrl.trim();
      // Relative app paths ("/login") or absolute http(s) URLs — never protocol-relative or javascript:.
      if (url && !(url.startsWith("/") && !url.startsWith("//"))) assertHttpUrl("Call-to-action URL", url);
      patch.ctaUrl = url;
    }
    if (typeof patch.ctaLabel === "string") patch.ctaLabel = patch.ctaLabel.trim().slice(0, 80);
    if (typeof patch.turnstileSiteKey === "string") {
      const key = patch.turnstileSiteKey.trim();
      if (key && !/^[0-9A-Za-z_-]{8,128}$/.test(key)) throw new ActionError("The Turnstile site key looks invalid.", "invalid");
      patch.turnstileSiteKey = key;
    }
    if (typeof patch.turnstileSecretKey === "string") patch.turnstileSecretKey = patch.turnstileSecretKey.trim();
  }
  return patch;
}

const groupSchema = z.string().refine(isSettingsKey, "Unknown settings group");

/** Saves a settings group from the admin panel. */
export async function saveSettingsAction(group: string, patch: Record<string, unknown>) {
  return runAction(async () => {
    const ctx = await actionAdmin();
    const key = groupSchema.parse(group) as SettingsKey;
    const data = await validatePatch(key, { ...z.record(z.string(), z.unknown()).parse(patch) }, ctx.user);
    const before = key === "general" ? await getSetting("general") : null;
    const result = await saveSettingsGroup(key, data, { id: ctx.user.id, email: ctx.user.email });
    if (before) {
      // Uploaded branding files that are no longer referenced are removed from disk.
      const after = result.values as { logoUrl: string; faviconUrl: string };
      if (before.logoUrl !== after.logoUrl) await deleteUploadByUrl(before.logoUrl, "branding");
      if (before.faviconUrl !== after.faviconUrl) await deleteUploadByUrl(before.faviconUrl, "branding");
    }
    refresh();
    return result;
  });
}

export async function getSettingsAction(group: string) {
  return runAction(async () => {
    await actionAdmin();
    const key = groupSchema.parse(group) as SettingsKey;
    return getAdminSettings(key);
  });
}

/** Uploads the branding logo or favicon; returns the URL to store in the "general" group. */
export async function uploadBrandingAssetAction(formData: FormData) {
  return runAction(async () => {
    const ctx = await actionAdmin();
    const kind = z.enum(["logo", "favicon"]).parse(formData.get("kind"));
    const file = formData.get("file");
    if (!(file instanceof File)) throw new ActionError("No file received.", "invalid");
    try {
      const res = await saveImageUpload("branding", file, {
        maxBytes: 2 * 1024 * 1024,
        allowSvg: true,
        allowIco: kind === "favicon",
      });
      const general = await getSetting("general");
      const prev = kind === "logo" ? general.logoUrl : general.faviconUrl;
      await saveSettingsGroup("general", kind === "logo" ? { logoUrl: res.url } : { faviconUrl: res.url }, {
        id: ctx.user.id,
        email: ctx.user.email,
      });
      await deleteUploadByUrl(prev, "branding");
      void logAudit("branding.asset_uploaded", { actor: ctx.user, meta: { kind, size: res.size, ext: res.ext } });
      refresh();
      return { url: res.url };
    } catch (err) {
      if (err instanceof UploadError) throw new ActionError(err.message, "invalid");
      throw err;
    }
  });
}
