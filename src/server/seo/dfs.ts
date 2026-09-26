import "server-only";
import {
  DataForSeoError,
  DataForSeoNotConfiguredError,
  dfsGet,
  dfsPost,
  dfsPostTasks,
  isDataForSeoConfigured,
} from "@/server/dataforseo/client";
import { getSetting } from "@/server/settings";
import { BudgetExceededError } from "@/server/usage";
import { SeoValidationError } from "./lib/locations";
import { isNoResultsMessage } from "./lib/serp";
import { SeoError, type SeoContext } from "./context";

export { isDataForSeoConfigured };

/** Usage features (recorded on every paid call; shown in Settings → Usage). */
export type SeoFeature =
  | "keyword_research"
  | "domain_overview"
  | "backlinks"
  | "rank_tracking"
  | "local_seo";

const MAX_SERVER_ERROR_RETRIES = 2;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Converts provider / budget errors into user-facing SeoErrors. */
export function toSeoError(err: unknown): unknown {
  if (err instanceof SeoError) return err;
  if (err instanceof SeoValidationError) return new SeoError("VALIDATION_ERROR", err.message);
  if (err instanceof DataForSeoNotConfiguredError)
    return new SeoError("NOT_CONFIGURED", "DataForSEO is not configured. An admin can connect it in Admin → Data Providers.");
  if (err instanceof BudgetExceededError) return new SeoError("BUDGET", `${err.message} Raise the limit in Admin → Limits & Budgets.`);
  if (err instanceof DataForSeoError) {
    if (err.statusCode === 401) return new SeoError("AUTH_FAILED", "DataForSEO rejected the credentials. Check Admin → Data Providers.");
    if (err.statusCode === 402) return new SeoError("INSUFFICIENT_FUNDS", "The DataForSEO account has insufficient funds. Top up your DataForSEO balance.");
    if (err.statusCode === 429) return new SeoError("UPSTREAM", "DataForSEO rate limit reached — try again in a minute.");
    const msg = err.message;
    if (/insufficient funds|balance is too low|payment required|recharged/i.test(msg))
      return new SeoError("INSUFFICIENT_FUNDS", "The DataForSEO account has a billing or balance issue.");
    if (/Invalid Field/i.test(msg)) return new SeoError("VALIDATION_ERROR", msg.replace(/^DataForSEO:\s*/, ""));
    return new SeoError("UPSTREAM", msg);
  }
  return err;
}

type LiveOpts = {
  feature: SeoFeature;
  /** Return an empty result for DataForSEO "No Search Results" (40501) — still billed. */
  treatNoResultsAsEmpty?: boolean;
  /** Retry HTTP 5xx (safe for idempotent live reads). Never for task_post. */
  retry5xx?: boolean;
  estimatedCostUsd?: number;
  timeoutMs?: number;
};

export type LiveTask<T> = { result: T[]; cost: number; statusCode: number; statusMessage: string; data?: Record<string, unknown> };

/** One live DataForSEO task (POST [task]). Records usage (via dfsPost) and maps errors. */
export async function dfsLive<T = Record<string, unknown>>(
  ctx: Pick<SeoContext, "projectId" | "workspaceId" | "userId">,
  path: string,
  task: Record<string, unknown>,
  opts: LiveOpts,
): Promise<LiveTask<T>> {
  const retries = opts.retry5xx === false ? 0 : MAX_SERVER_ERROR_RETRIES;
  for (let attempt = 0; ; attempt++) {
    try {
      const t = await dfsPost<T>(
        path,
        [stripUndefined(task)],
        { projectId: ctx.projectId, workspaceId: ctx.workspaceId, userId: ctx.userId, feature: opts.feature },
        { estimatedCostUsd: opts.estimatedCostUsd, timeoutMs: opts.timeoutMs },
      );
      return { result: t.result ?? [], cost: Number(t.cost ?? 0), statusCode: t.status_code, statusMessage: t.status_message, data: t.data };
    } catch (err) {
      if (opts.treatNoResultsAsEmpty && err instanceof DataForSeoError && isNoResultsMessage(err.message)) {
        return { result: [], cost: 0, statusCode: 40501, statusMessage: "No Search Results." };
      }
      const is5xx = err instanceof DataForSeoError && err.statusCode != null && err.statusCode >= 500 && err.statusCode < 600;
      if (is5xx && attempt < retries) {
        await sleep(250 * (attempt + 1));
        continue;
      }
      throw toSeoError(err);
    }
  }
}

/** First `result[0].items` list of a live Labs/SERP/Backlinks task. */
export function firstItems<T>(task: LiveTask<{ items?: T[] | null; total_count?: number | null }>): { items: T[]; totalCount: number | null } {
  const r = task.result[0];
  return { items: (r?.items ?? []).filter((i): i is T => i != null), totalCount: r?.total_count ?? null };
}

/** Free GET endpoints (locations, categories, task_get, tasks_ready). */
export async function dfsGetTask<T = Record<string, unknown>>(
  ctx: Pick<SeoContext, "projectId">,
  path: string,
  feature: SeoFeature,
) {
  try {
    return await dfsGet<T>(path, { projectId: ctx.projectId, feature });
  } catch (err) {
    throw toSeoError(err);
  }
}

/** task_post batch (≤100 tasks). Billed at post time → never retried. */
export async function dfsTaskPost(
  ctx: Pick<SeoContext, "projectId" | "workspaceId" | "userId">,
  path: string,
  tasks: Record<string, unknown>[],
  feature: SeoFeature,
  estimatedCostUsd?: number,
) {
  try {
    return await dfsPostTasks(
      path,
      tasks.map(stripUndefined),
      { projectId: ctx.projectId, workspaceId: ctx.workspaceId, userId: ctx.userId, feature },
      { estimatedCostUsd },
    );
  } catch (err) {
    throw toSeoError(err);
  }
}

function stripUndefined(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}

/**
 * Free DataForSEO sandbox probe: validates a `location_name` exactly like production (open-seo
 * `assertSerpLocationNameAccepted`). Fails open on sandbox outages / 5xxxx.
 */
export async function assertSerpLocationNameAccepted(input: { locationName: string; languageCode: string; countryCode?: string }) {
  const s = await getSetting("dataforseo");
  if (!s.login || !s.password) return;
  let task: { status_code?: number; status_message?: string } | undefined;
  try {
    const res = await fetch("https://sandbox.dataforseo.com/v3/serp/google/organic/live/advanced", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${s.login}:${s.password}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([{ keyword: "pizza", location_name: input.locationName, language_code: input.languageCode, depth: 10 }]),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) return;
    const json = (await res.json()) as { tasks?: { status_code?: number; status_message?: string }[] };
    task = json.tasks?.[0];
  } catch (err) {
    console.warn("[seo] sandbox location validation unavailable, skipping", err instanceof Error ? err.message : err);
    return;
  }
  const code = task?.status_code ?? 0;
  if (code === 20000 || code < 40000 || code >= 50000) return;
  const message = task?.status_message ?? "";
  if (!/Invalid Field:\s*'location_name'/i.test(message)) {
    throw new SeoError("VALIDATION_ERROR", `DataForSEO rejected this tracker: ${message}`);
  }
  throw new SeoError(
    "VALIDATION_ERROR",
    `"${input.locationName}" is not a Google location name. Search for the city and pick one of the suggested locations.`,
  );
}
