import type { projects, competitors, TaskCategory, TaskContentPlan, TaskEvidence } from "@/server/db/schema";

export type SignalContext = {
  projectId: string;
  project: typeof projects.$inferSelect;
  competitors: (typeof competitors.$inferSelect)[];
  /** Analysis window (default 30 days) */
  since: Date;
  sinceDate: string;
  now: Date;
  /** Own brand names (project name + aliases), lowercased */
  brandNames: string[];
  ownDomains: string[];
  /** true when the table exists in the database (other modules' data is read defensively) */
  tableExists: (name: string) => Promise<boolean>;
  /** Builds the fingerprint for (provider, …subject) */
  fingerprint: (parts: Array<string | number | null | undefined>) => string;
  /** Fingerprints of this provider's currently open / in-progress tasks (for hysteresis) */
  openFingerprints: Set<string>;
};

/** One actionable finding produced by a signal provider. */
export type TaskFinding = {
  /** Subject parts for the fingerprint (e.g. prompt id, domain, engine) */
  subject: Array<string | number | null | undefined>;
  category: TaskCategory;
  /** Templated texts (replaced by AI-written texts when an AI provider is available) */
  title: string;
  summary: string;
  description: string;
  steps: string[];
  acceptanceCriteria: string[];
  contentPlan?: TaskContentPlan | null;
  impact: number;
  effort: number;
  evidence: TaskEvidence[];
  /** Datasets that agree on this finding (shown as "Based on …") */
  datasets: string[];
  targetUrls?: string[];
  targetPrompts?: string[];
  /** Resolve automatically once the signal disappears (default true) */
  autoResolvable?: boolean;
  /** Compact facts for the AI writer + change detection */
  data: Record<string, unknown>;
};

export type SignalOutcome = {
  findings: TaskFinding[];
  /**
   * Which previously created tasks of this provider may be auto-resolved when absent from
   * `findings`: "all" (the provider evaluated everything), a set of fingerprints it could
   * evaluate, or "none" (no data → never resolve on this run).
   */
  evaluated: "all" | "none" | Set<string>;
  note?: string;
};

export type TaskSignalProvider = {
  key: string;
  label: string;
  category: TaskCategory;
  description: string;
  datasets: string[];
  collect: (ctx: SignalContext) => Promise<SignalOutcome>;
};
