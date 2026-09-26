import "server-only";
import { fetchJson } from "../../net";
import { markdownToHtml } from "../../markdown";
import type { PmClient } from "../types";
import { requireField, requireTarget, statusFromName, truncate, type Creds, type Target } from "./common";

type GqlResponse<T> = { data?: T; errors?: { message: string }[]; error_message?: string };

export function createMondayClient(creds: Creds, target: Target): PmClient {
  const token = requireField(creds, "token", "API token");
  const gql = async <T>(query: string, variables: Record<string, unknown> = {}): Promise<T> => {
    const res = await fetchJson<GqlResponse<T>>("https://api.monday.com/v2", {
      method: "POST",
      headers: { authorization: token, "API-Version": "2025-04" },
      json: { query, variables },
    });
    if (res.errors?.length) throw new Error(`monday.com: ${res.errors.map((e) => e.message).join("; ")}`);
    if (res.error_message) throw new Error(`monday.com: ${res.error_message}`);
    if (!res.data) throw new Error("monday.com returned no data.");
    return res.data;
  };
  let slug: string | null = null;
  const accountSlug = async () => {
    if (slug) return slug;
    const d = await gql<{ me: { account: { slug: string } } }>(`query { me { account { slug } } }`);
    slug = d.me.account.slug;
    return slug;
  };
  return {
    async test() {
      const d = await gql<{ me: { name: string; email: string; account: { name: string; slug: string } } }>(
        `query { me { name email account { name slug } } }`,
      );
      slug = d.me.account.slug;
      return { account: `${d.me.account.name} · ${d.me.email || d.me.name}` };
    },
    async listTargets() {
      const d = await gql<{ boards: { id: string; name: string; type?: string }[] }>(
        `query { boards(limit: 200, state: active) { id name type } }`,
      );
      return d.boards.filter((b) => !b.type || b.type === "board").map((b) => ({ id: String(b.id), name: b.name }));
    },
    async createIssue(task) {
      const board = requireTarget(target, "Board");
      const d = await gql<{ create_item: { id: string } }>(
        `mutation($board: ID!, $name: String!) { create_item(board_id: $board, item_name: $name) { id } }`,
        { board: board.id, name: truncate(task.title, 255) },
      );
      const itemId = String(d.create_item.id);
      await gql(`mutation($item: ID!, $body: String!) { create_update(item_id: $item, body: $body) { id } }`, {
        item: itemId,
        body: markdownToHtml(task.markdown),
      });
      const account = await accountSlug().catch(() => null);
      const url = account ? `https://${account}.monday.com/boards/${board.id}/pulses/${itemId}` : null;
      return { externalId: itemId, url, status: null };
    },
    async getStatus(externalId) {
      const d = await gql<{ items: { state: string; column_values: { type: string; text: string | null }[] }[] }>(
        `query($ids: [ID!]) { items(ids: $ids) { state column_values { type text } } }`,
        { ids: [externalId] },
      );
      const item = d.items[0];
      if (!item) return null;
      if (item.state === "archived" || item.state === "deleted") return "done";
      const status = item.column_values.find((c) => c.type === "status" && c.text);
      return statusFromName(status?.text) ?? "open";
    },
  };
}
