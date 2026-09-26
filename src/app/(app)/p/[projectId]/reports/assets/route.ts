import type { NextRequest } from "next/server";
import { getProjectContext } from "@/server/auth/context";
import { rateLimit } from "@/server/rate-limit";
import { ActionError } from "@/server/auth/guards";
import { MAX_ASSET_BYTES, saveAsset } from "@/server/reports/assets";
import { canManageWorkspaceReports } from "@/server/reports/access";
import { rejectCrossSite } from "@/server/http/request";

/** Upload an image for reports (multipart: file, kind=image|logo|icon, scope=project|workspace). */
export async function POST(req: NextRequest, ctx: RouteContext<"/p/[projectId]/reports/assets">) {
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;
  const { projectId } = await ctx.params;
  const pctx = await getProjectContext(projectId);
  if (!pctx) return Response.json({ error: "Not found" }, { status: 404 });
  if (!pctx.permissions.has("reports.manage")) return Response.json({ error: "You don't have permission to upload report assets." }, { status: 403 });
  if (!rateLimit(`reports:upload:${pctx.user.id}`, 120, 60 * 60_000)) return Response.json({ error: "Too many uploads — try again later." }, { status: 429 });
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_ASSET_BYTES + 64 * 1024) return Response.json({ error: "Images must be 8 MB or smaller." }, { status: 413 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected multipart form data." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file uploaded." }, { status: 400 });
  const kindRaw = String(form.get("kind") ?? "image");
  const kind = kindRaw === "logo" || kindRaw === "icon" ? kindRaw : "image";
  const scope = form.get("scope") === "workspace" ? "workspace" : "project";
  if (scope === "workspace" && !canManageWorkspaceReports(pctx)) {
    return Response.json({ error: "Only workspace admins can upload workspace-wide images (agency logo)." }, { status: 403 });
  }
  try {
    const asset = await saveAsset({
      workspaceId: pctx.project.workspaceId,
      projectId: scope === "workspace" ? null : projectId,
      kind,
      fileName: file.name,
      data: Buffer.from(await file.arrayBuffer()),
      userId: pctx.user.id,
    });
    return Response.json({ asset: { id: asset.id, width: asset.width, height: asset.height, fileName: asset.fileName, mimeType: asset.mimeType } });
  } catch (err) {
    const message = err instanceof ActionError ? err.message : "Upload failed.";
    if (!(err instanceof ActionError)) console.error("[reports] upload failed", err);
    return Response.json({ error: message }, { status: 400 });
  }
}
