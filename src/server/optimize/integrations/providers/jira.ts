import "server-only";
import { fetchJson } from "../../net";
import { markdownToAdf } from "../format";
import type { ExternalStatus, PmClient } from "../types";
import { normalizeSiteUrl, requireField, requireTarget, truncate, type Creds, type Target } from "./common";

export function createJiraClient(creds: Creds, target: Target): PmClient {
  const site = normalizeSiteUrl(requireField(creds, "siteUrl", "Site URL"));
  const email = requireField(creds, "email", "Email");
  const token = requireField(creds, "apiToken", "API token");
  const auth = `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
  const api = <T>(path: string, init: { method?: string; json?: unknown } = {}) =>
    fetchJson<T>(`${site}/rest/api/3${path}`, { ...init, headers: { authorization: auth } });

  async function issueTypeName(projectKey: string): Promise<{ id?: string; name: string }> {
    try {
      const res = await api<{ issueTypes?: { id: string; name: string; subtask: boolean }[]; values?: { id: string; name: string; subtask: boolean }[] }>(
        `/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes?maxResults=50`,
      );
      const types = (res.issueTypes ?? res.values ?? []).filter((t) => !t.subtask);
      const task = types.find((t) => t.name.toLowerCase() === "task") ?? types.find((t) => /task|aufgabe/i.test(t.name)) ?? types[0];
      if (task) return { id: task.id, name: task.name };
    } catch {
      // fall back to the default name
    }
    return { name: "Task" };
  }

  return {
    async test() {
      const me = await api<{ displayName: string; emailAddress?: string }>("/myself");
      return { account: `${new URL(site).host} · ${me.emailAddress || me.displayName}` };
    },
    async listTargets() {
      const res = await api<{ values: { id: string; key: string; name: string }[] }>("/project/search?maxResults=100&orderBy=name");
      return res.values.map((p) => ({ id: p.key, name: `${p.name} (${p.key})` }));
    },
    async createIssue(task) {
      const project = requireTarget(target, "Project");
      const type = await issueTypeName(project.id);
      const created = await api<{ id: string; key: string }>("/issue", {
        method: "POST",
        json: {
          fields: {
            project: { key: project.id },
            summary: truncate(task.title.replace(/\s+/g, " "), 250),
            description: markdownToAdf(task.markdown),
            issuetype: type.id ? { id: type.id } : { name: type.name },
            labels: task.labels.map((l) => l.replace(/\s+/g, "-")),
            ...(task.dueDate ? { duedate: task.dueDate } : {}),
          },
        },
      });
      return { externalId: created.key, url: `${site}/browse/${created.key}`, status: "To Do" };
    },
    async getStatus(externalId) {
      const res = await api<{ fields: { status: { name: string; statusCategory: { key: string } } } }>(
        `/issue/${encodeURIComponent(externalId)}?fields=status`,
      );
      const key = res.fields.status.statusCategory.key;
      const map: Record<string, ExternalStatus> = { done: "done", indeterminate: "in_progress", new: "open" };
      return map[key] ?? "open";
    },
  };
}
