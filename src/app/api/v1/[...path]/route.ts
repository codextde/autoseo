import { nanoid } from "nanoid";
import { envelope } from "@/server/api/handler";
import { corsPreflight } from "@/server/api/urls";

/** Unknown REST paths → JSON 404 in the standard envelope. */
function notFound(req: Request) {
  const path = new URL(req.url).pathname;
  return envelope(404, { data: null, error: { code: "not_found", message: `No endpoint ${req.method} ${path}. See /api/v1/openapi.json.` } }, `req_${nanoid(16)}`);
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const OPTIONS = corsPreflight;
