import "server-only";
import { fetchJson } from "../../net";
import type { ExternalStatus, PmClient } from "../types";
import { requireField, requireTarget, urgencyFromImpact, type Creds, type Target } from "./common";

type GqlResponse<T> = { data?: T; errors?: { message: string }[] };

export function createLinearClient(creds: Creds, target: Target): PmClient {
  const apiKey = requireField(creds, "apiKey", "API key");
  const gql = async <T>(query: string, variables: Record<string, unknown> = {}): Promise<T> => {
    const res = await fetchJson<GqlResponse<T>>("https://api.linear.app/graphql", {
      method: "POST",
      // Personal API keys are sent as-is; OAuth tokens need "Bearer".
      headers: { authorization: apiKey.startsWith("lin_oauth_") ? `Bearer ${apiKey}` : apiKey },
      json: { query, variables },
    });
    if (res.errors?.length) throw new Error(`Linear: ${res.errors.map((e) => e.message).join("; ")}`);
    if (!res.data) throw new Error("Linear returned no data.");
    return res.data;
  };
  return {
    async test() {
      const d = await gql<{ viewer: { name: string; email: string }; organization: { name: string } }>(
        `query { viewer { name email } organization { name } }`,
      );
      return { account: `${d.organization.name} · ${d.viewer.email || d.viewer.name}` };
    },
    async listTargets() {
      const d = await gql<{ teams: { nodes: { id: string; name: string; key: string }[] } }>(
        `query { teams(first: 100) { nodes { id name key } } }`,
      );
      return d.teams.nodes.map((t) => ({ id: t.id, name: `${t.name} (${t.key})` }));
    },
    async createIssue(task) {
      const team = requireTarget(target, "Team");
      const d = await gql<{ issueCreate: { success: boolean; issue: { id: string; identifier: string; url: string; state: { name: string } } | null } }>(
        `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url state { name } } } }`,
        {
          input: {
            teamId: team.id,
            title: task.title,
            description: task.markdown,
            priority: urgencyFromImpact(task.impact),
            ...(task.dueDate ? { dueDate: task.dueDate } : {}),
          },
        },
      );
      if (!d.issueCreate.success || !d.issueCreate.issue) throw new Error("Linear did not create the issue.");
      return { externalId: d.issueCreate.issue.id, url: d.issueCreate.issue.url, status: d.issueCreate.issue.state?.name ?? null };
    },
    async getStatus(externalId) {
      const d = await gql<{ issue: { state: { type: string } } | null }>(
        `query($id: String!) { issue(id: $id) { state { type } } }`,
        { id: externalId },
      );
      const type = d.issue?.state.type;
      if (!type) return null;
      const map: Record<string, ExternalStatus> = {
        completed: "done",
        canceled: "done",
        started: "in_progress",
        triage: "open",
        backlog: "open",
        unstarted: "open",
      };
      return map[type] ?? "open";
    },
  };
}
