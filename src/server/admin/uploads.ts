import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { randomToken } from "@/server/crypto";
import { env } from "@/server/env";

/**
 * Image uploads (avatars, project logos, branding assets). Files are validated by their magic
 * bytes (never by the client-provided MIME type), stored under `DATA_DIR/uploads/<kind>/` with a
 * random name and served by `/api/uploads/<kind>/<name>`.
 */
export const UPLOAD_KINDS = ["avatars", "logos", "branding"] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

export type ImageExt = "png" | "jpg" | "gif" | "webp" | "ico" | "svg";

export const IMAGE_CONTENT_TYPES: Record<ImageExt, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
};

export const UPLOAD_NAME_RE = /^[A-Za-z0-9_-]{16,64}\.(png|jpg|gif|webp|ico|svg)$/;

export class UploadError extends Error {}

function sniff(buf: Buffer): ImageExt | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 6 && (buf.subarray(0, 6).toString("ascii") === "GIF87a" || buf.subarray(0, 6).toString("ascii") === "GIF89a")) return "gif";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (buf.length >= 4 && buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return "ico";
  const head = buf.subarray(0, 1024).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "svg";
  return null;
}

/** Rejects SVGs with active content (scripts, event handlers, external references). */
function assertSafeSvg(buf: Buffer) {
  const text = buf.toString("utf8").toLowerCase();
  if (
    /<script|<foreignobject|<iframe|<embed|<object|javascript:|data:text\/html|\son[a-z]+\s*=|<!entity|xlink:href\s*=\s*["']?(?!#)|href\s*=\s*["']?(?!#)/.test(
      text,
    )
  ) {
    throw new UploadError("This SVG contains scripts or external references. Please upload a plain SVG, PNG or JPG.");
  }
}

export function uploadDir(kind: UploadKind) {
  return path.join(env.dataDir, "uploads", kind);
}

export async function saveImageUpload(
  kind: UploadKind,
  file: File,
  opts: { maxBytes?: number; allowSvg?: boolean; allowIco?: boolean } = {},
): Promise<{ url: string; name: string; ext: ImageExt; size: number }> {
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  if (!(file instanceof File)) throw new UploadError("No file received.");
  if (file.size === 0) throw new UploadError("The file is empty.");
  if (file.size > maxBytes) throw new UploadError(`The file is too large (max ${Math.round(maxBytes / 1024 / 1024)} MB).`);
  const buf = Buffer.from(await file.arrayBuffer());
  const ext = sniff(buf);
  if (!ext) throw new UploadError("Unsupported file type. Use PNG, JPG, GIF or WebP.");
  if (ext === "svg") {
    if (!opts.allowSvg) throw new UploadError("SVG files are not allowed here. Use PNG, JPG, GIF or WebP.");
    assertSafeSvg(buf);
  }
  if (ext === "ico" && !opts.allowIco) throw new UploadError("ICO files are only allowed for the favicon.");
  const name = `${randomToken(18).replace(/[^A-Za-z0-9_-]/g, "")}.${ext}`;
  const dir = uploadDir(kind);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), buf, { mode: 0o640 });
  return { url: `/api/uploads/${kind}/${name}`, name, ext, size: buf.length };
}

/**
 * Deletes a previously uploaded file referenced by its public URL. Only files of the expected
 * `kind` are removed, so a URL copied into another field can never delete someone else's file.
 */
export async function deleteUploadByUrl(url: string | null | undefined, expectedKind: UploadKind) {
  if (!url) return;
  const m = url.match(/^\/api\/uploads\/(avatars|logos|branding)\/([^/?#]+)$/);
  if (!m) return;
  const [, kind, name] = m;
  if (kind !== expectedKind || !UPLOAD_NAME_RE.test(name!)) return;
  await fs.rm(path.join(uploadDir(kind as UploadKind), name!), { force: true }).catch(() => {});
}

/** True for URLs we accept in image fields: http(s) URLs or our own uploads (optionally of one kind). */
export function isSafeImageUrl(url: string, kind?: UploadKind): boolean {
  if (!url) return true;
  const local = url.match(/^\/api\/uploads\/(avatars|logos|branding)\/[A-Za-z0-9_-]{16,64}\.(png|jpg|gif|webp|ico|svg)$/);
  if (local) return !kind || local[1] === kind;
  if (url.startsWith("/")) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
