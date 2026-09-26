import "server-only";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/server/db/client";
import { reportAssets } from "@/server/db/schema";
import { env } from "@/server/env";
import { newId } from "@/server/db/schema/_helpers";
import { ActionError } from "@/server/auth/guards";

export const MAX_ASSET_BYTES = 8 * 1024 * 1024;

export type AssetRow = typeof reportAssets.$inferSelect;

type Detected = { mime: string; ext: string; width: number | null; height: number | null };

function pngSize(b: Buffer) {
  return b.length >= 24 ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } : null;
}
function gifSize(b: Buffer) {
  return b.length >= 10 ? { width: b.readUInt16LE(6), height: b.readUInt16LE(8) } : null;
}
function jpegSize(b: Buffer) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}
function webpSize(b: Buffer) {
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8 " && b.length >= 30) return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L" && b.length >= 25) {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X" && b.length >= 30) return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  return null;
}
function svgSize(text: string) {
  const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
  if (vb) return { width: Math.round(Number(vb[1])), height: Math.round(Number(vb[2])) };
  const w = /\swidth\s*=\s*["']([\d.]+)/i.exec(text);
  const h = /\sheight\s*=\s*["']([\d.]+)/i.exec(text);
  return w && h ? { width: Math.round(Number(w[1])), height: Math.round(Number(h[1])) } : null;
}

/** Detects the image type from magic bytes (never trusts the client-provided MIME type). */
export function detectImage(buf: Buffer): Detected | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") return { mime: "image/png", ext: "png", ...(pngSize(buf) ?? { width: null, height: null }) };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg", ...(jpegSize(buf) ?? { width: null, height: null }) };
  if (buf.toString("ascii", 0, 4) === "GIF8") return { mime: "image/gif", ext: "gif", ...(gifSize(buf) ?? { width: null, height: null }) };
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP")
    return { mime: "image/webp", ext: "webp", ...(webpSize(buf) ?? { width: null, height: null }) };
  const head = buf.subarray(0, 2048).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) {
    const text = buf.toString("utf8");
    // Reject active content outright rather than trying to sanitize it.
    if (/<script|<foreignobject|<iframe|<embed|<object|javascript:|\son[a-z]+\s*=|<!entity/i.test(text)) return null;
    return { mime: "image/svg+xml", ext: "svg", ...(svgSize(text) ?? { width: null, height: null }) };
  }
  return null;
}

function assetDir(workspaceId: string) {
  return path.join(env.dataDir, "report-assets", workspaceId.replace(/[^a-z0-9_]/gi, ""));
}

export async function saveAsset(opts: {
  workspaceId: string;
  projectId: string | null;
  kind: "image" | "logo" | "icon";
  fileName: string;
  data: Buffer;
  userId: string;
}): Promise<AssetRow> {
  if (opts.data.length === 0) throw new ActionError("The file is empty.", "invalid");
  if (opts.data.length > MAX_ASSET_BYTES) throw new ActionError("Images must be 8 MB or smaller.", "invalid");
  const detected = detectImage(opts.data);
  if (!detected) throw new ActionError("Unsupported file. Upload a PNG, JPEG, GIF, WebP or a script-free SVG.", "invalid");
  const id = newId("ras");
  const dir = assetDir(opts.workspaceId);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${id}.${detected.ext}`);
  await fs.writeFile(file, opts.data, { mode: 0o640 });
  const [row] = await db
    .insert(reportAssets)
    .values({
      id,
      workspaceId: opts.workspaceId,
      projectId: opts.projectId,
      kind: opts.kind,
      fileName: opts.fileName.slice(0, 200) || `image.${detected.ext}`,
      mimeType: detected.mime,
      sizeBytes: opts.data.length,
      width: detected.width,
      height: detected.height,
      storagePath: path.relative(env.dataDir, file),
      sha256: crypto.createHash("sha256").update(opts.data).digest("hex"),
      createdBy: opts.userId,
    })
    .returning();
  return row!;
}

export async function listAssets(workspaceId: string, projectId: string) {
  return db
    .select()
    .from(reportAssets)
    .where(and(eq(reportAssets.workspaceId, workspaceId), or(isNull(reportAssets.projectId), eq(reportAssets.projectId, projectId))))
    .orderBy(desc(reportAssets.createdAt))
    .limit(300);
}

/** Loads an asset visible from a project (workspace-level assets or the project's own). */
export async function getAssetForProject(assetId: string, workspaceId: string, projectId: string): Promise<AssetRow | null> {
  const [row] = await db
    .select()
    .from(reportAssets)
    .where(
      and(
        eq(reportAssets.id, assetId),
        eq(reportAssets.workspaceId, workspaceId),
        or(isNull(reportAssets.projectId), eq(reportAssets.projectId, projectId)),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function readAsset(row: AssetRow): Promise<Buffer> {
  const full = path.resolve(env.dataDir, row.storagePath);
  if (!full.startsWith(path.resolve(env.dataDir) + path.sep)) throw new Error("Invalid asset path");
  return fs.readFile(full);
}

export async function deleteAsset(assetId: string, workspaceId: string, projectId: string) {
  const row = await getAssetForProject(assetId, workspaceId, projectId);
  if (!row) throw new ActionError("Asset not found.", "not_found");
  await db.delete(reportAssets).where(eq(reportAssets.id, row.id));
  try {
    const full = path.resolve(env.dataDir, row.storagePath);
    if (full.startsWith(path.resolve(env.dataDir) + path.sep)) await fs.unlink(full);
  } catch {
    // already gone
  }
}

/** Response for serving an asset (strict headers; SVGs can never run scripts). */
export function assetResponse(row: AssetRow, data: Buffer, cache: string): Response {
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": row.mimeType,
      "Content-Length": String(data.length),
      "Cache-Control": cache,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
      ETag: `"${row.sha256.slice(0, 32)}"`,
    },
  });
}
