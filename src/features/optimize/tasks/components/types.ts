import type { TaskCategoryKey } from "@/features/optimize/constants";

export type RunState = {
  running: boolean;
  lastRun: {
    status: string;
    trigger: string;
    startedAt: string;
    finishedAt: string | null;
    error: string | null;
    stats: { created?: number; updated?: number; resolved?: number; reopened?: number; aiQueued?: number };
  } | null;
};

export type OptimizeSettingsView = {
  routing: Partial<Record<TaskCategoryKey, { assigneeId?: string | null; provider?: string | null; autoPush?: boolean }>>;
  autoResolve: boolean;
};
