import "server-only";
import { fetchJson } from "../../net";
import type { PmClient } from "../types";
import { DONE_NAME_RE, PROGRESS_NAME_RE, requireField, requireTarget, truncate, type Creds, type Target } from "./common";

const BASE = "https://api.trello.com/1";

export function createTrelloClient(creds: Creds, target: Target): PmClient {
  const key = requireField(creds, "apiKey", "API key");
  const token = requireField(creds, "token", "Token");
  const url = (path: string, params: Record<string, string> = {}) => {
    const qs = new URLSearchParams({ ...params, key, token });
    return `${BASE}${path}${path.includes("?") ? "&" : "?"}${qs}`;
  };
  return {
    async test() {
      const me = await fetchJson<{ fullName: string; username: string }>(url("/members/me", { fields: "fullName,username" }));
      return { account: `${me.fullName} (@${me.username})` };
    },
    async listTargets() {
      const boards = await fetchJson<{ id: string; name: string; lists?: { id: string; name: string }[] }[]>(
        url("/members/me/boards", { filter: "open", fields: "name", lists: "open" }),
      );
      return boards.flatMap((b) => (b.lists ?? []).map((l) => ({ id: l.id, name: `${b.name} / ${l.name}` })));
    },
    async createIssue(task) {
      const list = requireTarget(target, "List");
      const card = await fetchJson<{ id: string; shortUrl?: string; url: string }>(url("/cards"), {
        method: "POST",
        json: {
          idList: list.id,
          name: truncate(task.title, 16000),
          desc: truncate(task.markdown, 16000),
          pos: "top",
          ...(task.dueDate ? { due: `${task.dueDate}T12:00:00.000Z` } : {}),
        },
      });
      return { externalId: card.id, url: card.shortUrl ?? card.url, status: list.name };
    },
    async getStatus(externalId) {
      const card = await fetchJson<{ closed: boolean; dueComplete: boolean; list?: { name: string } }>(
        url(`/cards/${encodeURIComponent(externalId)}`, { fields: "closed,dueComplete,idList", list: "true" }),
      );
      if (card.closed || card.dueComplete) return "done";
      const listName = card.list?.name ?? "";
      if (DONE_NAME_RE.test(listName)) return "done";
      if (PROGRESS_NAME_RE.test(listName)) return "in_progress";
      return "open";
    },
  };
}
