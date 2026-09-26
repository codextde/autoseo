import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { contentPersonas, optimizeTasks } from "@/server/db/schema";
import { requireProject } from "@/server/auth/guards";
import { availableLlmProviders } from "@/server/ai/llm";
import { getContent, scoreHistory } from "@/server/optimize/content/service";
import { listConnectedIntegrations } from "@/server/optimize/integrations";
import { ContentEditor } from "@/features/optimize/content/components/content-editor";

export const metadata: Metadata = { title: "Content editor" };

export default async function ContentEditorPage({ params }: PageProps<"/p/[projectId]/content/[contentId]">) {
  const { projectId, contentId } = await params;
  const ctx = await requireProject(projectId);
  const content = await getContent(projectId, contentId);
  if (!content) notFound();
  const [persona, task, connected, llm, history] = await Promise.all([
    content.personaId
      ? db
          .select()
          .from(contentPersonas)
          .where(and(eq(contentPersonas.id, content.personaId), eq(contentPersonas.projectId, projectId)))
          .limit(1)
          .then((r) => r[0] ?? null)
      : null,
    content.taskId
      ? db
          .select({ id: optimizeTasks.id, title: optimizeTasks.title })
          .from(optimizeTasks)
          .where(and(eq(optimizeTasks.id, content.taskId), eq(optimizeTasks.projectId, projectId)))
          .limit(1)
          .then((r) => r[0] ?? null)
      : null,
    listConnectedIntegrations(projectId, "cms"),
    availableLlmProviders().catch(() => []),
    scoreHistory(content.id),
  ]);
  const can = (p: "prompts.manage" | "settings.manage") => ctx.isInstanceAdmin || ctx.permissions.has(p);
  return (
    <ContentEditor
      key={`${content.status === "generating" ? "gen" : "ready"}-${content.id}`}
      projectId={projectId}
      project={{ name: ctx.project.name, domain: ctx.project.domain, logoUrl: ctx.project.logoUrl, language: ctx.project.language }}
      content={{
        ...content,
        createdAt: content.createdAt.toISOString(),
        updatedAt: content.updatedAt.toISOString(),
        publishedAt: content.publishedAt?.toISOString() ?? null,
      }}
      persona={persona}
      task={task}
      connected={connected}
      canEdit={can("prompts.manage")}
      canManage={can("settings.manage")}
      aiAvailable={llm.length > 0}
      history={history}
    />
  );
}
