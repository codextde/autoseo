import { PageContainer } from "@/components/app/page";
import { requireProject } from "@/server/auth/guards";
import { getLookup } from "@/server/ai/lookup/history";
import { loadLookups } from "@/features/ai-research/queries";
import { PromptExplorerView } from "@/features/ai-research/components/lookup/prompt-explorer-view";
import { EXPLORER_COUNTRIES, type ExplorerParams, type ExplorerResult } from "@/features/ai-research/types";

export const metadata = { title: "Prompt Explorer" };

export default async function PromptExplorerPage({ params, searchParams }: PageProps<"/p/[projectId]/ai/prompt-explorer">) {
  const { projectId } = await params;
  const ctx = await requireProject(projectId);
  const sp = await searchParams;
  const id = typeof sp.id === "string" ? sp.id : null;
  const [data, row] = await Promise.all([loadLookups(projectId, "prompt_explorer"), id ? getLookup(projectId, id) : Promise.resolve(null)]);
  const current =
    row && row.kind === "prompt_explorer"
      ? {
          id: row.id,
          status: row.status,
          error: row.error,
          costUsd: row.costUsd,
          createdAt: row.createdAt.toISOString(),
          params: row.params as unknown as ExplorerParams,
          result: row.status === "done" || row.status === "failed" ? ((row.result as unknown as ExplorerResult)?.answers ? (row.result as unknown as ExplorerResult) : null) : null,
        }
      : null;
  const iso = ctx.project.country === "UK" ? "GB" : ctx.project.country;
  return (
    <PageContainer wide>
      <PromptExplorerView
        key={current?.id ?? "new"}
        projectId={projectId}
        history={data.history}
        providers={{ dataforseo: data.providers.dataforseo, llm: data.providers.llm }}
        canRun={ctx.permissions.has("seo.run")}
        canTrack={ctx.permissions.has("prompts.manage")}
        defaults={{ brand: data.profile.name, country: (EXPLORER_COUNTRIES as readonly string[]).includes(iso) ? iso : "US" }}
        current={current}
      />
    </PageContainer>
  );
}
