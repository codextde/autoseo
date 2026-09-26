"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { runFreeToolAction } from "../actions";
import { FREE_TOOLS, type FreeTool, type FreeToolSlug } from "../lib/registry";
import type { ToolRunResult } from "../lib/types";
import { DEFAULT_COUNTRY_CODE } from "../lib/countries";

export type ToolSurface = "app" | "public";

export type ToolRunnerValue = {
  surface: ToolSurface;
  run: (slug: FreeToolSlug, input: Record<string, unknown>, turnstileToken?: string) => Promise<ToolRunResult<unknown>>;
  appName: string;
  /** Public: Turnstile site key ("" = no verification). */
  turnstileSiteKey: string;
  /** App: `seo.run` (or admin) — needed for the DataForSEO tools. Public: always true. */
  canRunPaid: boolean;
  /** App: DataForSEO connected. Public: always true (the API answers 503 otherwise). */
  configured: boolean;
  isAdmin: boolean;
  projectId: string | null;
  projectDomain: string;
  defaultLocationCode: number;
  toolHref: (slug: FreeToolSlug) => string;
  /** App: link into the matching SEO feature (deep-linked when a query is given). */
  featureHref: (tool: FreeTool, query?: Record<string, string | number>) => string | null;
  cta: { href: string; label: string };
};

const RunnerContext = createContext<ToolRunnerValue | null>(null);

export function useToolRunner(): ToolRunnerValue {
  const ctx = useContext(RunnerContext);
  if (!ctx) throw new Error("useToolRunner must be used inside a ToolRunnerProvider");
  return ctx;
}

function withQuery(href: string, query?: Record<string, string | number>) {
  if (!query) return href;
  const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString();
  return qs ? `${href}?${qs}` : href;
}

/** Signed-in surface: runs through a server action (project access + `seo.run`, charged to the workspace). */
export function AppToolRunnerProvider({
  children,
  projectId,
  projectDomain,
  defaultLocationCode,
  canRunPaid,
  configured,
  isAdmin,
  appName,
}: {
  children: React.ReactNode;
  projectId: string;
  projectDomain: string;
  defaultLocationCode: number;
  canRunPaid: boolean;
  configured: boolean;
  isAdmin: boolean;
  appName: string;
}) {
  const value = useMemo<ToolRunnerValue>(
    () => ({
      surface: "app",
      appName,
      turnstileSiteKey: "",
      canRunPaid,
      configured,
      isAdmin,
      projectId,
      projectDomain,
      defaultLocationCode,
      run: async (slug, input) => {
        try {
          const res = await runFreeToolAction(projectId, slug, input);
          return res.ok ? { ok: true, data: res.data } : { ok: false, error: res.error, code: res.code };
        } catch {
          return { ok: false, error: "Something went wrong. Please try again." };
        }
      },
      toolHref: (slug) => `/p/${projectId}/seo/tools/${slug}`,
      featureHref: (tool, query) => withQuery(`/p/${projectId}${tool.feature.href}`, query),
      cta: { href: `/p/${projectId}/seo/tools`, label: "All SEO tools" },
    }),
    [projectId, projectDomain, defaultLocationCode, canRunPaid, configured, isAdmin, appName],
  );
  return <RunnerContext.Provider value={value}>{children}</RunnerContext.Provider>;
}

/** Public surface: POSTs JSON to `/api/free-tools/{tool}` (same-origin, Turnstile token attached). */
export function PublicToolRunnerProvider({
  children,
  appName,
  turnstileSiteKey,
  cta,
}: {
  children: React.ReactNode;
  appName: string;
  turnstileSiteKey: string;
  cta: { href: string; label: string };
}) {
  const value = useMemo<ToolRunnerValue>(
    () => ({
      surface: "public",
      appName,
      turnstileSiteKey,
      canRunPaid: true,
      configured: true,
      isAdmin: false,
      projectId: null,
      projectDomain: "",
      defaultLocationCode: DEFAULT_COUNTRY_CODE,
      run: async (slug, input, turnstileToken) => {
        try {
          const res = await fetch(`/api/free-tools/${slug}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...input, ...(turnstileToken ? { turnstileToken } : {}) }),
          });
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          if (!res.ok) return { ok: false, error: data.error || "Something went wrong. Please try again." };
          return { ok: true, data };
        } catch {
          return { ok: false, error: "Network error. Check your connection and try again." };
        }
      },
      toolHref: (slug) => `/free-tools/${slug}`,
      featureHref: () => null,
      cta,
    }),
    [appName, turnstileSiteKey, cta],
  );
  return <RunnerContext.Provider value={value}>{children}</RunnerContext.Provider>;
}

export type ToolStatus = "idle" | "loading" | "done" | "error";

/** The submit cycle every API-backed tool shares (open-seo `useToolRun`). */
export function useToolRun<T>(slug: FreeToolSlug) {
  const { run } = useToolRunner();
  const [status, setStatus] = useState<ToolStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [result, setResult] = useState<T | null>(null);

  const submit = async (input: Record<string, unknown>, turnstileToken?: string) => {
    setStatus("loading");
    setErrorMessage("");
    const res = await run(slug, input, turnstileToken);
    if (res.ok) {
      setResult(res.data as T);
      setStatus("done");
    } else {
      setErrorMessage(res.error);
      setStatus("error");
    }
  };

  return { status, errorMessage, result, submit, tool: FREE_TOOLS[slug] };
}
