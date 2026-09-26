import { buildOpenApiDocument } from "@/server/api/openapi";
import { getBranding } from "@/server/branding";
import { getSetting } from "@/server/settings";

/** GET /api/v1/openapi.json — public OpenAPI 3.1 description of the REST API. */
export async function GET() {
  const [brand, security] = await Promise.all([getBranding(), getSetting("security")]);
  return new Response(JSON.stringify(buildOpenApiDocument(brand.appName, security.apiRateLimitPerMinute), null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
