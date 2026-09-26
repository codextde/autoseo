import "server-only";
import { fetchJson } from "../../net";
import type { ExternalStatus, PmClient } from "../types";
import { requireField, requireTarget, urgencyFromImpact, type Creds, type Target } from "./common";

const BASE = "https://api.clickup.com/api/v2";

export function createClickUpClient(creds: Creds, target: Target): PmClient {
  const token = requireField(creds, "token", "API token");
  const api = <T>(path: string, init: { method?: string; json?: unknown } = {}) =>
    fetchJson<T>(`${BASE}${path}`, { ...init, headers: { authorization: token } });
  return {
    async test() {
      const me = await api<{ user: { username: string; email: string } }>("/user");
      return { account: me.user.email || me.user.username };
    },
    async listTargets() {
      const { teams } = await api<{ teams: { id: string; name: string }[] }>("/team");
      const out: { id: string; name: string }[] = [];
      for (const team of teams.slice(0, 5)) {
        const { spaces } = await api<{ spaces: { id: string; name: string }[] }>(`/team/${team.id}/space?archived=false`);
        for (const space of spaces.slice(0, 15)) {
          const [{ lists }, { folders }] = await Promise.all([
            api<{ lists: { id: string; name: string }[] }>(`/space/${space.id}/list?archived=false`),
            api<{ folders: { id: string; name: string; lists: { id: string; name: string }[] }[] }>(`/space/${space.id}/folder?archived=false`),
          ]);
          for (const l of lists) out.push({ id: l.id, name: `${space.name} / ${l.name}` });
          for (const f of folders) for (const l of f.lists ?? []) out.push({ id: l.id, name: `${space.name} / ${f.name} / ${l.name}` });
          if (out.length > 300) return out;
        }
      }
      return out;
    },
    async createIssue(task) {
      const list = requireTarget(target, "List");
      const created = await api<{ id: string; url: string; status?: { status: string } }>(`/list/${encodeURIComponent(list.id)}/task`, {
        method: "POST",
        json: {
          name: task.title,
          markdown_content: task.markdown,
          priority: urgencyFromImpact(task.impact),
          tags: task.labels.map((l) => l.toLowerCase()),
          ...(task.dueDate ? { due_date: new Date(`${task.dueDate}T12:00:00Z`).getTime() } : {}),
        },
      });
      return { externalId: created.id, url: created.url ?? `https://app.clickup.com/t/${created.id}`, status: created.status?.status ?? null };
    },
    async getStatus(externalId) {
      const t = await api<{ status: { status: string; type: string } }>(`/task/${encodeURIComponent(externalId)}`);
      const type = t.status?.type;
      if (type === "closed" || type === "done") return "done";
      const map: Record<string, ExternalStatus> = { open: "open", custom: "in_progress" };
      return map[type ?? ""] ?? "open";
    },
  };
}
