import { site } from "@/lib/site";

/** `curl -fsSL https://autoseo.codext.de/install | bash` — redirects to the installer in the GitHub repository. */
export function GET() {
  return new Response(null, {
    status: 302,
    headers: { Location: site.installScript, "Cache-Control": "public, max-age=300" },
  });
}
