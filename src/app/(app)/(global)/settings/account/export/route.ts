import { getUserContext } from "@/server/auth/context";
import { buildUserExport } from "@/server/admin/erasure";
import { rateLimit } from "@/server/rate-limit";
import { logAudit } from "@/server/audit";

/** GDPR data export: everything stored about the signed-in user as a JSON download. */
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  if (!rateLimit(`data-export:${ctx.user.id}`, 5, 60 * 60_000)) {
    return new Response("Too many exports. Please try again later.", { status: 429, headers: { "Retry-After": "3600" } });
  }
  const data = await buildUserExport(ctx.user.id);
  void logAudit("user.data_exported", { actor: { id: ctx.user.id, email: ctx.user.email }, targetType: "user", targetId: ctx.user.id });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="autoseo-data-export-${date}.json"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
