import "server-only";
import { getBranding } from "@/server/branding";
import { env } from "@/server/env";

/** Instance identity used in generated plugin files. */
export async function pluginInstance() {
  const brand = await getBranding();
  return { appUrl: env.appUrl, appName: brand.appName || "AutoSEO" };
}

export const PUBLIC_DOWNLOAD_HEADERS: Record<string, string> = {
  "Cache-Control": "public, max-age=300",
  "Access-Control-Allow-Origin": "*",
  "X-Content-Type-Options": "nosniff",
};

export function zipResponse(zip: Buffer, filename: string, sha256: string): Response {
  return new Response(new Uint8Array(zip), {
    headers: {
      ...PUBLIC_DOWNLOAD_HEADERS,
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(zip.length),
      ETag: `"${sha256}"`,
      "X-Content-SHA256": sha256,
    },
  });
}
