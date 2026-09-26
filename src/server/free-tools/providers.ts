import "server-only";
import { z } from "zod";
import { DataForSeoError, dfsPost, type DfsContext } from "@/server/dataforseo/client";
import { env } from "@/server/env";
import type { DomainAgeRow } from "@/features/free-tools/lib/types";

/** One live DataForSEO task → `tasks[0].result[0]` (null for an empty "No Search Results" answer). */
export type DfsFetch = (path: string, payload: Record<string, unknown>) => Promise<Record<string, unknown> | null>;

function isNoResults(message: string | null | undefined) {
  return message?.toLowerCase().includes("no search results") ?? false;
}

/**
 * DataForSEO fetcher for the free tools (open-seo `fetchDataforseoResult`): POST `[payload]`, 30 s timeout, the task
 * must be 20000 or "No Search Results" (a successful empty result — an obscure keyword or an unknown domain lands
 * there). Goes through `dfsPost`, so the admin budget (Admin → Limits) is asserted and the real cost is recorded in
 * `usage_events` — against the workspace in-app, or as instance-level usage (no workspace) for the public tools.
 */
export function dataforseoFetcher(ctx: DfsContext, estimatedCostPerCallUsd: number): DfsFetch {
  return async (path, payload) => {
    try {
      const task = await dfsPost<Record<string, unknown>>(path, [payload], ctx, {
        timeoutMs: 30_000,
        estimatedCostUsd: estimatedCostPerCallUsd,
      });
      if (task.status_code !== 20000 && !isNoResults(task.status_message)) {
        throw new DataForSeoError(`DataForSEO task ${task.status_code} on ${path}: ${task.status_message}`, task.status_code, path);
      }
      return task.result?.[0] ?? null;
    } catch (err) {
      if (err instanceof DataForSeoError && isNoResults(err.message)) return null;
      throw err;
    }
  };
}

/* ───────────────────────────── RDAP (domain age) ───────────────────────────── */

const rdapSchema = z
  .object({
    events: z
      .array(z.object({ eventAction: z.string().nullable().optional(), eventDate: z.string().nullable().optional() }).passthrough())
      .nullable()
      .optional(),
    entities: z
      .array(z.object({ roles: z.array(z.string()).nullable().optional(), vcardArray: z.unknown().optional() }).passthrough())
      .nullable()
      .optional(),
  })
  .passthrough();

function emptyRow(domain: string, error: string | null): DomainAgeRow {
  return { domain, created: null, updated: null, expires: null, registrar: null, ageYears: null, ageMonths: null, error };
}

export function ageSince(isoDate: string, now = new Date()): { years: number; months: number } | null {
  const created = new Date(isoDate);
  if (Number.isNaN(created.getTime())) return null;
  let months = (now.getFullYear() - created.getFullYear()) * 12 + (now.getMonth() - created.getMonth());
  if (now.getDate() < created.getDate()) months -= 1;
  if (months < 0) return { years: 0, months: 0 };
  return { years: Math.floor(months / 12), months: months % 12 };
}

/** RDAP entities carry the registrar name in a jCard `fn` entry. */
export function readRegistrar(entities: Array<{ roles?: string[] | null; vcardArray?: unknown }>): string | null {
  const registrar = entities.find((e) => e.roles?.some((r) => r.toLowerCase() === "registrar"));
  if (!registrar || !Array.isArray(registrar.vcardArray)) return null;
  const fields = registrar.vcardArray[1];
  if (!Array.isArray(fields)) return null;
  for (const field of fields) {
    if (Array.isArray(field) && field[0] === "fn" && typeof field[3] === "string") return field[3];
  }
  return null;
}

/**
 * RDAP lookup via rdap.org (redirects to the registry that holds the record). Never throws: every failure becomes a
 * row with an `error` (open-seo wording). The domain is a validated hostname and the host is fixed (no SSRF surface).
 */
export async function lookupDomainAge(domain: string): Promise<DomainAgeRow> {
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  let res: Response;
  try {
    res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      headers: {
        Accept: "application/rdap+json",
        // rdap.org answers 403 to requests without a User-Agent.
        "User-Agent": `autoseo-free-tools (+${env.appUrl}/free-tools/domain-age-checker)`,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch (err) {
    console.error(`[free-tools] RDAP lookup failed for ${domain}:`, err instanceof Error ? err.message : err);
    return emptyRow(domain, "Registration lookup timed out");
  }

  // rdap.org 404s without redirecting when no registry serves that TLD; a 404 from the registry it redirected to
  // means the domain isn't registered.
  const answeredByRegistry = !!res.url && !res.url.startsWith("https://rdap.org/");
  if (!res.ok) {
    return emptyRow(domain, res.status === 404 && answeredByRegistry ? "No registration record found" : `No public registration data for .${tld}`);
  }
  const parsed = rdapSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) return emptyRow(domain, `No public registration data for .${tld}`);

  const events = parsed.data.events ?? [];
  const eventDate = (action: string) => events.find((e) => e.eventAction?.toLowerCase() === action)?.eventDate ?? null;
  const created = eventDate("registration");
  const age = created ? ageSince(created) : null;
  return {
    domain,
    created,
    updated: eventDate("last changed"),
    expires: eventDate("expiration"),
    registrar: readRegistrar(parsed.data.entities ?? []),
    ageYears: age?.years ?? null,
    ageMonths: age?.months ?? null,
    error: created ? null : "No registration date published",
  };
}
