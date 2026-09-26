import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { promptTagLinks, prompts, promptTags } from "@/server/db/schema";

export type PromptInfo = {
  id: string;
  text: string;
  country: string;
  topic: string | null;
  funnelStage: string | null;
  status: string;
  tags: { id: string; name: string; color: string | null }[];
};

/** All prompts of a project with their tags (small table; loaded whole). */
export async function getPromptMap(projectId: string): Promise<Map<string, PromptInfo>> {
  const [ps, links] = await Promise.all([
    db
      .select({
        id: prompts.id,
        text: prompts.text,
        country: prompts.country,
        topic: prompts.topic,
        funnelStage: prompts.funnelStage,
        status: prompts.status,
      })
      .from(prompts)
      .where(eq(prompts.projectId, projectId)),
    db
      .select({ promptId: promptTagLinks.promptId, id: promptTags.id, name: promptTags.name, color: promptTags.color })
      .from(promptTagLinks)
      .innerJoin(promptTags, eq(promptTags.id, promptTagLinks.tagId))
      .where(eq(promptTags.projectId, projectId)),
  ]);
  const map = new Map<string, PromptInfo>(ps.map((p) => [p.id, { ...p, tags: [] }]));
  for (const l of links) map.get(l.promptId)?.tags.push({ id: l.id, name: l.name, color: l.color });
  return map;
}

/** tag id → active prompt ids (for tag slicing). */
export async function getTagGroups(projectId: string): Promise<{ tags: { id: string; name: string; color: string | null }[]; groups: Map<string, string[]> }> {
  const rowsT = await db
    .select({ tagId: promptTags.id, name: promptTags.name, color: promptTags.color, promptId: prompts.id })
    .from(promptTags)
    .leftJoin(promptTagLinks, eq(promptTagLinks.tagId, promptTags.id))
    .leftJoin(prompts, and(eq(prompts.id, promptTagLinks.promptId), eq(prompts.status, "active")))
    .where(eq(promptTags.projectId, projectId));
  const groups = new Map<string, string[]>();
  const tags = new Map<string, { id: string; name: string; color: string | null }>();
  for (const r of rowsT) {
    tags.set(r.tagId, { id: r.tagId, name: r.name, color: r.color });
    if (!groups.has(r.tagId)) groups.set(r.tagId, []);
    if (r.promptId) groups.get(r.tagId)!.push(r.promptId);
  }
  return { tags: [...tags.values()].sort((a, b) => a.name.localeCompare(b.name)), groups };
}
