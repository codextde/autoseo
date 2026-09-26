import { getProjectContext } from "@/server/auth/context";
import { csvResponse, toCsv } from "@/server/optimize/csv";
import { listContent } from "@/server/optimize/content/service";
import { aeoBand } from "@/server/optimize/content/aeo-score";
import { CONTENT_STATUS_META } from "@/features/optimize/constants";
import { env } from "@/server/env";

export async function GET(_req: Request, ctx: RouteContext<"/p/[projectId]/content/export">) {
  const { projectId } = await ctx.params;
  const project = await getProjectContext(projectId);
  if (!project) return new Response("Not found", { status: 404 });
  const items = await listContent(projectId);
  const csv = toCsv(
    ["Title", "Type", "Status", "AEO score", "Band", "Baseline score", "Target prompt", "Target keyword", "Words", "Source URL", "Published URL", "Published via", "Updated", "Editor URL"],
    items.map((i) => [
      i.title,
      i.kind === "rewrite" ? "Optimized page" : "Article",
      CONTENT_STATUS_META[i.status].label,
      i.aeoScore ?? "",
      i.aeoScore != null ? aeoBand(i.aeoScore).label : "",
      i.baselineScore ?? "",
      i.targetPrompt ?? "",
      i.targetKeyword ?? "",
      i.wordCount,
      i.sourceUrl ?? "",
      i.publishedUrl ?? "",
      i.publishProvider ?? "",
      i.updatedAt.slice(0, 10),
      `${env.appUrl}/p/${projectId}/content/${i.id}`,
    ]),
  );
  return csvResponse(`content-${project.project.domain}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
