import { z } from "zod";
import { getProjectContext } from "@/server/auth/context";
import { hasContentType, rejectCrossSite } from "@/server/http/request";
import { CHUNK_BYTES, INLINE_LIMIT_BYTES, initUpload, listUploads, MAX_UPLOAD_BYTES, UploadError } from "@/server/analytics/bots/uploads";
import { serializeUpload } from "@/server/analytics/bots/queries";

export const dynamic = "force-dynamic";

const initSchema = z.object({
  projectId: z.string().min(3).max(64),
  filename: z.string().min(1).max(500),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  format: z.enum(["auto", "nginx", "apache", "cloudflare", "akamai", "ndjson", "custom"]).default("auto"),
});

/** Starts a chunked log upload. */
export async function POST(req: Request) {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  if (!hasContentType(req, "application/json")) return Response.json({ error: "Expected application/json" }, { status: 415 });
  let input: z.infer<typeof initSchema>;
  try {
    input = initSchema.parse(await req.json());
  } catch {
    return Response.json({ error: "Invalid request (files up to 1 GB are supported)." }, { status: 400 });
  }
  const ctx = await getProjectContext(input.projectId);
  if (!ctx) return Response.json({ error: "Not found" }, { status: 404 });
  if (!ctx.permissions.has("settings.manage")) return Response.json({ error: "Forbidden" }, { status: 403 });
  try {
    const upload = await initUpload({ ...input, userId: ctx.user.id });
    return Response.json({
      upload: serializeUpload(upload),
      chunkSize: CHUNK_BYTES,
      background: input.size > INLINE_LIMIT_BYTES,
    });
  } catch (err) {
    if (err instanceof UploadError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

/** Recent uploads of a project. */
export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
  const ctx = projectId ? await getProjectContext(projectId) : null;
  if (!ctx) return Response.json({ error: "Not found" }, { status: 404 });
  const rows = await listUploads(ctx.project.id, 10);
  return Response.json({ uploads: rows.map(serializeUpload) });
}
