import type { NextRequest } from "next/server";
import { getProjectContext } from "@/server/auth/context";
import { assetResponse, getAssetForProject, readAsset } from "@/server/reports/assets";
import { db } from "@/server/db/client";
import { reportAssets } from "@/server/db/schema";
import { and, eq } from "drizzle-orm";

/** Serves an uploaded report asset to members with access to the project (or the asset's own project). */
export async function GET(_req: NextRequest, ctx: RouteContext<"/p/[projectId]/reports/assets/[assetId]">) {
  const { projectId, assetId } = await ctx.params;
  if (!/^ras_[a-z0-9]{8,32}$/.test(assetId)) return new Response("Not found", { status: 404 });
  const pctx = await getProjectContext(projectId);
  if (!pctx) return new Response("Not found", { status: 404 });
  let asset = await getAssetForProject(assetId, pctx.project.workspaceId, projectId);
  if (!asset) {
    // "one deck, every client": a client logo of another project in the same workspace the user can access
    const [other] = await db
      .select()
      .from(reportAssets)
      .where(and(eq(reportAssets.id, assetId), eq(reportAssets.workspaceId, pctx.project.workspaceId)))
      .limit(1);
    if (other?.projectId && (await getProjectContext(other.projectId))) asset = other;
  }
  if (!asset) return new Response("Not found", { status: 404 });
  try {
    const data = await readAsset(asset);
    return assetResponse(asset, data, "private, max-age=86400");
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
