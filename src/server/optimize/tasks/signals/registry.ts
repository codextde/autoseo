import "server-only";
import type { TaskSignalProvider } from "./types";

const providers = new Map<string, TaskSignalProvider>();

/** Registers a task signal provider (pluggable — other modules may register their own). */
export function registerTaskSignal(provider: TaskSignalProvider): TaskSignalProvider {
  providers.set(provider.key, provider);
  return provider;
}

export function getTaskSignals(): TaskSignalProvider[] {
  return [...providers.values()];
}

export function getTaskSignal(key: string): TaskSignalProvider | undefined {
  return providers.get(key);
}
