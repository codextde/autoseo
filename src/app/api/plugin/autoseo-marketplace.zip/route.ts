import { marketplaceBundleZip } from "@/server/api/plugin";
import { pluginInstance, zipResponse } from "@/server/api/plugin-http";

/**
 * GET /api/plugin/autoseo-marketplace.zip — a local marketplace root (Claude Code, Codex and Cursor
 * manifests + plugins/autoseo), e.g. `codex plugin marketplace add ./autoseo-marketplace`.
 */
export async function GET() {
  const { zip, sha256 } = marketplaceBundleZip(await pluginInstance());
  return zipResponse(zip, "autoseo-marketplace.zip", sha256);
}
