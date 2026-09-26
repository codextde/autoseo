import "server-only";
import type { ExternalStatus } from "../types";

export type Creds = Record<string, string>;
export type Target = { id: string; name: string } | null;

export class IntegrationConfigError extends Error {}

export function requireField(creds: Creds, key: string, label = key): string {
  const v = (creds[key] ?? "").trim();
  if (!v) throw new IntegrationConfigError(`${label} is required.`);
  return v;
}

export function requireTarget(target: Target, label: string): { id: string; name: string } {
  if (!target?.id) throw new IntegrationConfigError(`Choose a ${label.toLowerCase()} in the integration settings first.`);
  return target;
}

/** Normalizes a site URL the user typed ("example.com/", "https://x.atlassian.net/jira") to an origin (+ optional path). */
export function normalizeSiteUrl(raw: string, keepPath = false): string {
  let v = raw.trim();
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  const u = new URL(v);
  const path = keepPath ? u.pathname.replace(/\/+$/, "") : "";
  return `${u.protocol}//${u.host}${path}`;
}

/** Linear/ClickUp style 1 (urgent) … 4 (low) from impact 1–10. */
export function urgencyFromImpact(impact: number): 1 | 2 | 3 | 4 {
  if (impact >= 9) return 1;
  if (impact >= 7) return 2;
  if (impact >= 4) return 3;
  return 4;
}

export const DONE_NAME_RE = /\b(done|complete[d]?|closed|resolved|finished|erledigt|fertig|abgeschlossen|shipped)\b/i;
export const PROGRESS_NAME_RE = /\b(in progress|doing|started|working|review|in arbeit|in bearbeitung)\b/i;

export function statusFromName(name: string | null | undefined): ExternalStatus | null {
  if (!name) return null;
  if (DONE_NAME_RE.test(name)) return "done";
  if (PROGRESS_NAME_RE.test(name)) return "in_progress";
  return "open";
}

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
