import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { fcDocuments } from "@/server/db/schema";
import { env } from "@/server/env";
import { safeFetch } from "@/server/optimize/net";
import { splitSections } from "./text";

export const MAX_DOC_CHARS = 600_000;
export const MAX_PDF_BYTES = 20 * 1024 * 1024;

/** Relative storage path of an uploaded PDF inside DATA_DIR. */
export function pdfStoragePath(projectId: string, documentId: string) {
  return path.join("fact-check", projectId.replace(/[^a-z0-9_]/gi, ""), `${documentId.replace(/[^a-z0-9_]/gi, "")}.pdf`);
}

export async function storePdf(projectId: string, documentId: string, bytes: Uint8Array): Promise<string> {
  const rel = pdfStoragePath(projectId, documentId);
  const abs = path.join(env.dataDir, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, bytes, { mode: 0o600 });
  return rel;
}

export async function removeStoredFile(rel: string | null | undefined) {
  if (!rel) return;
  const abs = path.resolve(env.dataDir, rel);
  if (!abs.startsWith(path.resolve(env.dataDir) + path.sep)) return;
  await fs.rm(abs, { force: true }).catch(() => {});
}

/** Extracts text from a PDF (pages separated by blank lines). */
export async function pdfToText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).map((p) => p.replace(/[ \t]+\n/g, "\n").trim()).join("\n\n");
}

const BLOCK_TAGS = "p,div,section,article,li,tr,br,ul,ol,table,dd,dt,blockquote,pre,figure,figcaption,caption,td,th,main,aside";

/** HTML → plain text that keeps headings as markdown headings (for section splitting). */
export function htmlToText(html: string): { title: string; text: string } {
  const $ = cheerio.load(html);
  $("script,style,noscript,svg,iframe,nav,footer,form,button,template,select,[aria-hidden=true],[hidden]").remove();
  const title = $("title").first().text().trim() || $("h1").first().text().trim();
  const pick = (sel: string) => {
    const el = $(sel).first();
    return el.length && el.text().replace(/\s+/g, " ").trim().length > 400 ? el : null;
  };
  const root = pick("main") ?? pick("article") ?? $("body");
  root.find("h1,h2,h3,h4,h5,h6").each((_, el) => {
    const level = Number((el as { tagName?: string }).tagName?.slice(1) ?? 2);
    $(el).prepend(`\n\n${"#".repeat(Math.min(6, Math.max(1, level)))} `);
    $(el).append("\n\n");
  });
  root.find("li").each((_, el) => void $(el).prepend("\n- "));
  root.find(BLOCK_TAGS).each((_, el) => void $(el).append("\n"));
  const text = root
    .text()
    .split("\n")
    .map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim())
    .map((l) => (/^[-•*·|\s\d]{0,6}$/.test(l) ? "" : l))
    .filter((l, i, arr) => l || (i > 0 && arr[i - 1]))
    .join("\n")
    .replace(/^(#{1,6}) *\n+/gm, "$1 ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text };
}

export type FetchedDoc = { kind: "pdf" | "html"; title: string; text: string; finalUrl: string; html?: string };

/** SSRF-safe fetch of a reference document URL (HTML page or PDF). */
export async function fetchDocumentUrl(url: string): Promise<FetchedDoc> {
  const res = await safeFetch(url, {
    maxBytes: MAX_PDF_BYTES,
    timeoutMs: 30_000,
    headers: { accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5" },
  });
  if (!res.ok) throw new Error(`The page returned HTTP ${res.status}.`);
  const type = res.headers.get("content-type") ?? "";
  const isPdf = type.includes("pdf") || res.body.subarray(0, 5).toString("latin1") === "%PDF-";
  if (isPdf) {
    const text = await pdfToText(new Uint8Array(res.body));
    const name = decodeURIComponent(new URL(res.url).pathname.split("/").pop() ?? "document.pdf");
    return { kind: "pdf", title: name, text, finalUrl: res.url };
  }
  if (!type.includes("html") && !type.includes("text") && type) throw new Error(`Unsupported content type: ${type}`);
  const html = res.text();
  if (type.includes("text/plain")) return { kind: "html", title: new URL(res.url).hostname, text: html, finalUrl: res.url };
  const { title, text } = htmlToText(html);
  return { kind: "html", title: title || new URL(res.url).hostname, text, finalUrl: res.url, html };
}

/** Marks other documents of the asset with the same title as superseded by the newest one. */
async function supersedeOlderVersions(doc: typeof fcDocuments.$inferSelect) {
  await db
    .update(fcDocuments)
    .set({ superseded: true })
    .where(
      and(
        eq(fcDocuments.assetId, doc.assetId),
        ne(fcDocuments.id, doc.id),
        sql`lower(${fcDocuments.title}) = lower(${doc.title})`,
        sql`coalesce(${fcDocuments.market}, '') = coalesce(${doc.market}, '')`,
      ),
    );
}

/** Stores extracted text + sections on a document row. */
export async function saveDocumentText(documentId: string, text: string, patch: Partial<typeof fcDocuments.$inferInsert> = {}) {
  const clean = text.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim().slice(0, MAX_DOC_CHARS);
  if (clean.length < 20) throw new Error("No readable text found in the document.");
  const sections = splitSections(clean);
  const [doc] = await db
    .update(fcDocuments)
    .set({ ...patch, text: clean, sections, charCount: clean.length, status: "ready", error: null })
    .where(eq(fcDocuments.id, documentId))
    .returning();
  if (doc) await supersedeOlderVersions(doc);
  return doc ?? null;
}

/** Job body: extracts text of a PDF/URL document and splits it into label sections. */
export async function processDocument(documentId: string) {
  const [doc] = await db.select().from(fcDocuments).where(eq(fcDocuments.id, documentId)).limit(1);
  if (!doc) return { skipped: "missing" };
  try {
    if (doc.kind === "pdf") {
      if (!doc.filePath) throw new Error("Uploaded file is missing.");
      const abs = path.resolve(env.dataDir, doc.filePath);
      if (!abs.startsWith(path.resolve(env.dataDir) + path.sep)) throw new Error("Invalid file path.");
      const bytes = await fs.readFile(abs);
      const text = await pdfToText(new Uint8Array(bytes));
      const saved = await saveDocumentText(doc.id, text);
      return { chars: saved?.charCount ?? 0, sections: saved?.sections.length ?? 0 };
    }
    if (doc.kind === "url") {
      if (!doc.sourceUrl) throw new Error("URL is missing.");
      const fetched = await fetchDocumentUrl(doc.sourceUrl);
      const saved = await saveDocumentText(doc.id, fetched.text, {
        sourceUrl: fetched.finalUrl,
        title: doc.title || fetched.title,
      });
      return { chars: saved?.charCount ?? 0, sections: saved?.sections.length ?? 0 };
    }
    const saved = await saveDocumentText(doc.id, doc.text);
    return { chars: saved?.charCount ?? 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(fcDocuments).set({ status: "failed", error: message.slice(0, 500) }).where(eq(fcDocuments.id, doc.id));
    return { failed: message };
  }
}
