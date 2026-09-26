import "server-only";

/** Reads an OAuth endpoint body (form-encoded per spec; JSON tolerated). Max 64 KB. */
export async function readFormOrJson(req: Request): Promise<URLSearchParams | null> {
  const text = await req.text().catch(() => "");
  if (text.length > 64 * 1024) return null;
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (type.includes("application/json")) {
    try {
      const obj = JSON.parse(text) as Record<string, unknown>;
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(obj)) if (typeof v === "string" || typeof v === "number") params.set(k, String(v));
      return params;
    } catch {
      return null;
    }
  }
  return new URLSearchParams(text);
}
