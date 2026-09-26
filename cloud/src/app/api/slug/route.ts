import { getCurrentSession } from "@/server/auth/session";
import { getRequestMeta } from "@/server/http";
import { checkSlugAvailability } from "@/server/instances";
import { rateLimit } from "@/server/rate-limit";

/** Live availability check for the "Choose your address" field. */
export async function GET(req: Request) {
  const current = await getCurrentSession();
  if (!current) return Response.json({ error: "Not signed in" }, { status: 401 });
  const { ip } = await getRequestMeta();
  if (!rateLimit(`slug:${current.user.id}`, 120, 60_000) || !rateLimit(`slug:ip:${ip ?? "?"}`, 300, 60_000)) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }
  const slug = new URL(req.url).searchParams.get("slug") ?? "";
  const result = await checkSlugAvailability(slug.slice(0, 64));
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
