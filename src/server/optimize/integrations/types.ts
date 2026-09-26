/**
 * Contracts for PM-tool and CMS integrations of the optimize module.
 * Credentials live in the core `integrations` table (`secret` = encryptJson(values of secret fields),
 * `config` = non-secret field values + selected target + account label).
 */

export type ProviderField = {
  key: string;
  label: string;
  type: "text" | "password" | "url" | "email" | "select";
  placeholder?: string;
  help?: string;
  required?: boolean;
  /** Stored encrypted in `integrations.secret` (never sent to the browser). */
  secret?: boolean;
  options?: { value: string; label: string }[];
};

export type ProviderMeta = {
  key: string;
  name: string;
  kind: "pm" | "cms";
  description: string;
  /** Where to create the token / how to set it up */
  setupSteps: string[];
  docsUrl?: string;
  fields: ProviderField[];
  /** Label for the target picker (team / project / list / board / collection / blog) */
  targetLabel?: string;
  supportsStatusSync?: boolean;
  /** CMS without write API (Framer) — export only */
  exportOnly?: boolean;
};

export type ConnectedIntegration = {
  id: string;
  provider: string;
  name: string;
  kind: "pm" | "cms";
  status: "connected" | "error" | "pending" | "disconnected";
  account: string | null;
  target: { id: string; name: string } | null;
  lastError: string | null;
  lastSyncAt: string | null;
};

/** What we send to a PM tool when pushing a task. */
export type PmTaskPayload = {
  taskId: string;
  title: string;
  /** Markdown body: summary, steps, acceptance criteria, evidence, link back */
  markdown: string;
  category: string;
  impact: number;
  effort: number;
  /** 0–100 priority score */
  priority: number;
  status: "open" | "in_progress" | "done" | "dismissed";
  dueDate: string | null;
  labels: string[];
  appUrl: string;
};

export type ExternalStatus = "open" | "in_progress" | "done";

export interface PmClient {
  test(): Promise<{ account: string }>;
  listTargets?(): Promise<{ id: string; name: string }[]>;
  createIssue(task: PmTaskPayload): Promise<{ externalId: string; url: string | null; status?: string | null }>;
  getStatus?(externalId: string): Promise<ExternalStatus | null>;
}

export type CmsDocument = {
  contentId: string;
  title: string;
  slug: string;
  markdown: string;
  /** Sanitized HTML rendered from markdown (incl. FAQ section) */
  html: string;
  metaTitle: string | null;
  metaDescription: string | null;
  excerpt: string;
  jsonLd: string | null;
  faqs: { question: string; answer: string }[];
};

export interface CmsClient {
  test(): Promise<{ account: string }>;
  listTargets?(): Promise<{ id: string; name: string }[]>;
  publish(
    doc: CmsDocument,
    opts: { existingId?: string | null; draft: boolean },
  ): Promise<{ externalId: string; url: string | null }>;
}
