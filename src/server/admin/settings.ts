import "server-only";
import { getSetting, settingsRegistry, updateSetting, type Settings, type SettingsKey } from "@/server/settings";
import { logAudit } from "@/server/audit";

/** Secret field names of a settings group. */
export type SecretKeys<K extends SettingsKey> = (typeof settingsRegistry)[K]["secrets"][number];

/** Client-safe representation of a settings group: secrets are blanked and flagged. */
export type AdminSettings<K extends SettingsKey> = {
  values: Settings<K>;
  /** true when the secret has a stored value */
  secrets: Record<string, boolean>;
};

export const SETTINGS_KEYS = Object.keys(settingsRegistry) as SettingsKey[];

export function isSettingsKey(key: string): key is SettingsKey {
  return (SETTINGS_KEYS as string[]).includes(key);
}

/** Loads a settings group for the admin UI (never includes secret values). */
export async function getAdminSettings<K extends SettingsKey>(key: K): Promise<AdminSettings<K>> {
  const value = (await getSetting(key)) as Record<string, unknown>;
  const secretKeys = settingsRegistry[key].secrets as readonly string[];
  const values: Record<string, unknown> = {};
  const secrets: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(value)) {
    if (secretKeys.includes(k)) {
      secrets[k] = typeof v === "string" ? v.length > 0 : Boolean(v);
      values[k] = "";
    } else values[k] = v;
  }
  return { values: values as Settings<K>, secrets };
}

function stableJson(v: unknown) {
  return JSON.stringify(v);
}

/**
 * Validates + saves a (partial) settings group and writes an audit entry listing the changed
 * fields (never the secret values). Secret fields: `"__keep__"`/undefined keep, `""` clears.
 */
export async function saveSettingsGroup<K extends SettingsKey>(
  key: K,
  patch: Record<string, unknown>,
  actor: { id: string; email: string },
): Promise<AdminSettings<K>> {
  const schema = settingsRegistry[key].schema;
  const allowed = new Set(Object.keys(schema.shape));
  const secretKeys = settingsRegistry[key].secrets as readonly string[];
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!allowed.has(k)) continue;
    clean[k] = v;
  }
  const before = (await getSetting(key)) as Record<string, unknown>;
  const after = (await updateSetting(key, clean as Partial<Settings<K>>, actor.id)) as Record<string, unknown>;
  const changed: string[] = [];
  const secretsChanged: string[] = [];
  for (const k of Object.keys(after)) {
    if (stableJson(before[k]) === stableJson(after[k])) continue;
    if (secretKeys.includes(k)) secretsChanged.push(k);
    else changed.push(k);
  }
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of changed) diff[k] = { from: before[k], to: after[k] };
  if (changed.length || secretsChanged.length) {
    await logAudit("settings.updated", {
      actor,
      targetType: "settings",
      targetId: key,
      meta: { group: key, changed, secretsChanged, diff },
    });
  }
  return getAdminSettings(key);
}
