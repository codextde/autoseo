import { getSkill } from "@/server/api/plugin";
import { PUBLIC_DOWNLOAD_HEADERS } from "@/server/api/plugin-http";

/** GET /api/plugin/skills/{slug} — one SKILL.md (add ?download=1 for an attachment). */
export async function GET(req: Request, ctx: RouteContext<"/api/plugin/skills/[slug]">) {
  const { slug } = await ctx.params;
  const skill = /^[a-z0-9-]{1,64}$/.test(slug) ? getSkill(slug) : null;
  if (!skill) return new Response("Skill not found.\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const download = new URL(req.url).searchParams.has("download");
  return new Response(skill.body, {
    headers: {
      ...PUBLIC_DOWNLOAD_HEADERS,
      "Content-Type": "text/markdown; charset=utf-8",
      ...(download ? { "Content-Disposition": `attachment; filename="SKILL.md"` } : {}),
    },
  });
}
