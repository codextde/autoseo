import "server-only";
import PptxGenJS from "pptxgenjs";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { reportAssets } from "@/server/db/schema";
import { buildPptx } from "@/features/reports/lib/pptx";
import type { DataBundle } from "@/features/reports/lib/bundle";
import type { Deck } from "@/features/reports/lib/types";
import { readAsset } from "./assets";
import { fetchPublicImage } from "./safe-fetch";

/** Server-side PPTX export (API/automation and the /pptx route). Icons are embedded as SVG. */
export async function buildReportPptxBuffer(opts: { deck: Deck; bundle: DataBundle | null; title: string; subtitle?: string | null; workspaceId: string }): Promise<Buffer> {
  const loadImage = async (src: string): Promise<string | null> => {
    if (src.startsWith("asset:")) {
      const [row] = await db
        .select()
        .from(reportAssets)
        .where(and(eq(reportAssets.id, src.slice(6)), eq(reportAssets.workspaceId, opts.workspaceId)))
        .limit(1);
      if (!row) return null;
      try {
        const data = await readAsset(row);
        return `data:${row.mimeType};base64,${data.toString("base64")}`;
      } catch {
        return null;
      }
    }
    return fetchPublicImage(src);
  };
  const pptx = await buildPptx(
    PptxGenJS,
    opts.deck,
    { bundle: opts.bundle, report: { title: opts.title, subtitle: opts.subtitle } },
    { loadImage, assetUrl: (id) => `asset:${id}` },
    { title: opts.title, company: opts.bundle?.agency.name ?? "" },
  );
  const out = await pptx.write({ outputType: "nodebuffer", compression: true });
  return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer);
}
