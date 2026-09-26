import "server-only";
import { fetchJson } from "../../net";
import type { ExternalStatus, PmClient } from "../types";
import { requireField, requireTarget, truncate, type Creds, type Target } from "./common";

const BASE = "https://api.awork.com/api/v1";

export function createAworkClient(creds: Creds, target: Target): PmClient {
  const apiKey = requireField(creds, "apiKey", "API key");
  const api = <T>(path: string, init: { method?: string; json?: unknown } = {}) =>
    fetchJson<T>(`${BASE}${path}`, { ...init, headers: { authorization: `Bearer ${apiKey}` } });
  let workspaceUrl: string | null = null;
  const getWorkspaceUrl = async () => {
    if (workspaceUrl) return workspaceUrl;
    const me = await api<{ workspace?: { url?: string } }>("/me");
    workspaceUrl = me.workspace?.url?.replace(/\/+$/, "") ?? null;
    return workspaceUrl;
  };
  return {
    async test() {
      const me = await api<{ firstName?: string; lastName?: string; workspace?: { name?: string; url?: string } }>("/me");
      workspaceUrl = me.workspace?.url?.replace(/\/+$/, "") ?? null;
      return { account: `${me.workspace?.name ?? "awork"} · ${[me.firstName, me.lastName].filter(Boolean).join(" ")}` };
    },
    async listTargets() {
      const projects = await api<{ id: string; name: string; isArchived?: boolean }[]>("/projects?pageSize=500");
      return projects.filter((p) => !p.isArchived).map((p) => ({ id: p.id, name: p.name }));
    },
    async createIssue(task) {
      const project = requireTarget(target, "Project");
      const created = await api<{ id: string; taskStatus?: { name?: string } }>("/tasks", {
        method: "POST",
        json: {
          name: truncate(task.title, 1000),
          description: task.markdown,
          baseType: "projecttask",
          entityId: project.id,
          isPrio: task.impact >= 8,
          ...(task.dueDate ? { dueOn: `${task.dueDate}T12:00:00Z` } : {}),
        },
      });
      const base = await getWorkspaceUrl().catch(() => null);
      return { externalId: created.id, url: base ? `${base}/tasks/${created.id}/details` : null, status: created.taskStatus?.name ?? null };
    },
    async getStatus(externalId) {
      const t = await api<{ taskStatus?: { type?: string } }>(`/tasks/${encodeURIComponent(externalId)}`);
      const map: Record<string, ExternalStatus> = { done: "done", progress: "in_progress", review: "in_progress", stuck: "in_progress", todo: "open" };
      return map[t.taskStatus?.type ?? ""] ?? "open";
    },
  };
}
