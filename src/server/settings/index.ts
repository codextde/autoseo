import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { appSettings } from "@/server/db/schema";
import { decryptJson, encryptJson } from "@/server/crypto";
import { settingsRegistry, type Settings, type SettingsKey } from "./registry";

export { settingsRegistry };
export type { Settings, SettingsKey };

type CacheEntry = { value: unknown; at: number };
const cache = new Map<SettingsKey, CacheEntry>();
const TTL_MS = 5_000;

function splitSecrets<K extends SettingsKey>(key: K, value: Record<string, unknown>) {
  const secretKeys = settingsRegistry[key].secrets as readonly string[];
  const plain: Record<string, unknown> = {};
  const secret: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (secretKeys.includes(k)) secret[k] = v;
    else plain[k] = v;
  }
  return { plain, secret };
}

/** Read a settings group with defaults applied (secrets decrypted, server-only). */
export async function getSetting<K extends SettingsKey>(key: K): Promise<Settings<K>> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Settings<K>;
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  let merged: Record<string, unknown> = {};
  if (row) {
    merged = { ...((row.value as Record<string, unknown>) ?? {}) };
    if (row.secret) {
      try {
        Object.assign(merged, decryptJson<Record<string, unknown>>(row.secret));
      } catch (err) {
        console.error(`[settings] could not decrypt secrets for "${key}"`, err);
      }
    }
  }
  const parsed = settingsRegistry[key].schema.parse(merged) as Settings<K>;
  cache.set(key, { value: parsed, at: Date.now() });
  return parsed;
}

/** Fields that decide where a group's secrets are sent; changing one clears kept secrets. */
const DESTINATION_FIELDS: Partial<Record<SettingsKey, string[]>> = {
  smtp: ["preset", "sesRegion", "host", "port", "user"],
};

/**
 * Update a settings group. Secret fields that are `undefined` or the sentinel "__keep__" keep
 * their existing value, so the admin UI never has to know the secret — unless a destination field
 * of the group changed, in which case the secret has to be entered again.
 */
export async function updateSetting<K extends SettingsKey>(
  key: K,
  patch: Partial<Settings<K>>,
  actorId?: string | null,
): Promise<Settings<K>> {
  const current = (await getSetting(key)) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined || v === "__keep__") continue;
    next[k] = v;
  }
  // A kept secret must never follow a changed destination (e.g. SMTP password → attacker host).
  const destination = DESTINATION_FIELDS[key] ?? [];
  if (destination.some((f) => JSON.stringify(next[f]) !== JSON.stringify(current[f]))) {
    const patchRecord = patch as Record<string, unknown>;
    const kept = (settingsRegistry[key].secrets as readonly string[]).filter((s) => {
      const provided = patchRecord[s];
      return (provided === undefined || provided === "__keep__") && typeof current[s] === "string" && current[s] !== "";
    });
    if (kept.length) {
      throw new Error(`The server settings changed — enter the ${kept.join(", ")} again to keep using it.`);
    }
  }
  const validated = settingsRegistry[key].schema.parse(next) as Record<string, unknown>;
  const { plain, secret } = splitSecrets(key, validated);
  const secretPayload = Object.keys(secret).length ? encryptJson(secret) : null;
  await db
    .insert(appSettings)
    .values({ key, value: plain, secret: secretPayload, updatedBy: actorId ?? null })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: plain, secret: secretPayload, updatedBy: actorId ?? null, updatedAt: new Date() },
    });
  cache.delete(key);
  return validated as Settings<K>;
}

/** Client-safe view: secrets replaced by a boolean "is set" marker. */
export async function getPublicSetting<K extends SettingsKey>(
  key: K,
): Promise<Record<string, unknown> & { __secrets: Record<string, boolean> }> {
  const value = (await getSetting(key)) as Record<string, unknown>;
  const secretKeys = settingsRegistry[key].secrets as readonly string[];
  const out: Record<string, unknown> = {};
  const flags: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(value)) {
    if (secretKeys.includes(k)) {
      flags[k] = typeof v === "string" ? v.length > 0 : Boolean(v);
      out[k] = "";
    } else out[k] = v;
  }
  return { ...out, __secrets: flags };
}

export function invalidateSettingsCache() {
  cache.clear();
}
