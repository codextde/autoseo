import "server-only";
import { safeFetch } from "../../net";
import { webhookHeaders } from "../signature";
import type { PmClient } from "../types";
import { requireField, type Creds } from "./common";

export type WebhookEvent = "ping" | "task.created" | "task.updated" | "task.resolved" | "task.pushed";

/** Signed POST to the configured URL (SSRF-safe). Throws on non-2xx so jobs retry. */
export async function deliverWebhook(creds: Creds, event: WebhookEvent, payload: Record<string, unknown>) {
  const url = requireField(creds, "url", "Webhook URL");
  const secret = requireField(creds, "signingSecret", "Signing secret");
  const body = JSON.stringify({ event, ...payload, sentAt: new Date().toISOString() });
  // purpose "integration": the admin's internal-host allowlist applies (e.g. a self-hosted n8n); safeFetch validates the URL.
  const res = await safeFetch(url, {
    method: "POST",
    headers: webhookHeaders(secret, event, body),
    body,
    timeoutMs: 15_000,
    maxBytes: 256 * 1024,
    maxRedirects: 0,
    purpose: "integration",
  });
  if (!res.ok) throw new Error(`Webhook responded with HTTP ${res.status}`);
  return { status: res.status };
}

/** The webhook acts as a PM target: "push" sends a `task.pushed` event. */
export function createWebhookClient(creds: Creds): PmClient {
  return {
    async test() {
      const url = new URL(requireField(creds, "url", "Webhook URL"));
      await deliverWebhook(creds, "ping", { message: "AutoSEO webhook connected" });
      return { account: url.host };
    },
    async createIssue(task) {
      await deliverWebhook(creds, "task.pushed", { tasks: [task] });
      return { externalId: "", url: null, status: null };
    },
  };
}
