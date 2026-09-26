import { getCurrentSession } from "@/server/auth/session";
import { getUserInstance } from "@/server/instances";
import { toInstanceView } from "@/server/instance-view";

/** Polled by the dashboard (every 5 s) while an instance is being set up. */
export async function GET() {
  const current = await getCurrentSession();
  if (!current) return Response.json({ error: "Not signed in" }, { status: 401 });
  const instance = await getUserInstance(current.user.id);
  return Response.json(
    { instance: instance ? toInstanceView(instance) : null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
