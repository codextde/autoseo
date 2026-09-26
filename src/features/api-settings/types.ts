import type { ApiScope } from "./scopes";

export type ApiKeyView = {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  projectIds: string[] | null;
  projectNames: string[];
  requestCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  createdBy: { id: string; name: string | null; email: string };
};

export type ApiUsage = {
  /** Last 30 days incl. today, oldest first (YYYY-MM-DD). */
  days: { date: string; requests: number; errors: number }[];
  today: number;
  total30: number;
  /** Requests made by ephemeral agent-chat session keys (excluded from the totals above). */
  sessionRequests30: number;
};

export type OAuthGrantView = {
  id: string;
  clientId: string;
  clientName: string;
  redirectHosts: string[];
  scopes: ApiScope[];
  projectIds: string[] | null;
  projectNames: string[];
  user: { id: string; name: string | null; email: string };
  createdAt: string;
  lastUsedAt: string | null;
  requestCount: number;
};
