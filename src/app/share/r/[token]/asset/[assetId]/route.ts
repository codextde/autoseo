import type { NextRequest } from "next/server";
import { getShareAccess } from "@/server/reports/share-access";
import { assetResponse, getAssetForProject, readAsset } from "@/server/reports/assets";

/** Images used by a shared deck (workspace-level or the report project's own assets only). */
export async function GET(_req: NextRequest, ctx: RouteContext<"/share/r/[token]/asset/[assetId]">) {
  const { token, assetId } = await ctx.params;
  if (!/^ras_[a-z0-9]{8,32}$/.test(assetId)) return new Response("Not found", { status: 404 });
  const access = await getShareAccess(token);
  if (access.state !== "ok") return new Response("Not found", { status: 404 });
  const { r } = access.found;
  const asset = await getAssetForProject(assetId, r.workspaceId, r.projectId);
  if (!asset) return new Response("Not found", { status: 404 });
  try {
    const data = await readAsset(asset);
    const res = assetResponse(asset, data, "public, max-age=300");
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
    return res;
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
