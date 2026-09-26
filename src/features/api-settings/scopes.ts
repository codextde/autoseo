/**
 * API / MCP scopes (isomorphic — used by the settings UI, the REST API, the MCP server and the
 * OAuth consent screen).
 */
export const API_SCOPES = ["read", "write", "spend", "export"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const SCOPE_INFO: Record<ApiScope, { label: string; description: string }> = {
  read: {
    label: "Read",
    description: "Projects, prompts, AI visibility metrics, competitors, sources, tasks and reports.",
  },
  write: {
    label: "Write",
    description: "Create projects, add prompts and tags, record attribution — bounded by your role.",
  },
  spend: {
    label: "Spend credits",
    description:
      "Run anything that can cost money: DataForSEO research (keywords, SERP, domains, backlinks, rank checks, local SEO), AI generation and tracking runs — also requires the “Run paid SEO research” / matching role permission.",
  },
  export: {
    label: "Export",
    description: "Bulk export of prompts, answers and results.",
  },
};

export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}

/** Parses a space/comma separated scope string, keeping only known scopes (read is always implied). */
export function parseScopes(value: string | null | undefined): ApiScope[] {
  const out = new Set<ApiScope>(["read"]);
  for (const s of (value ?? "").split(/[\s,]+/)) {
    const v = s.trim().toLowerCase();
    if (isApiScope(v)) out.add(v);
  }
  return API_SCOPES.filter((s) => out.has(s));
}

/** Display prefixes of issued credentials. */
export const API_KEY_PREFIX = "as_live_";
export const OAUTH_ACCESS_TOKEN_PREFIX = "as_oat_";
export const OAUTH_REFRESH_TOKEN_PREFIX = "as_ort_";
