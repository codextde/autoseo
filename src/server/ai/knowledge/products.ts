import "server-only";
import { and, count, desc, eq, ilike, notInArray, or, sql } from "drizzle-orm";
import { Parser } from "htmlparser2";
import { db } from "@/server/db/client";
import { catalogProducts, integrations, projects } from "@/server/db/schema";
import { randomToken, sha256 } from "@/server/crypto";
import { parseCsv } from "@/features/ai-research/lib/csv";
import { safeFetch } from "./safe-fetch";
import type { CatalogProduct, ProductStreamConfig } from "@/features/ai-research/types";

export const PRODUCT_STREAM_PROVIDER = "product_stream";
export const MAX_PRODUCTS_PER_PROJECT = 20_000;
export const MAX_PRODUCTS_PER_IMPORT = 10_000;

export type NormalizedProduct = {
  sku: string | null;
  name: string;
  url: string | null;
  imageUrl: string | null;
  price: number | null;
  currency: string | null;
  category: string | null;
  brand: string | null;
  description: string | null;
  gtin: string | null;
  availability: string | null;
};

/* ───────────────────────────── Normalization ───────────────────────────── */

const FIELD_ALIASES: Record<keyof NormalizedProduct, string[]> = {
  sku: ["sku", "id", "g:id", "item_id", "product_id", "article_number", "artikelnummer", "mpn", "g:mpn", "offer_id", "variant_sku"],
  name: ["name", "title", "g:title", "product_name", "produktname", "bezeichnung", "product title"],
  url: ["url", "link", "g:link", "product_url", "produkt_url", "href", "canonical_url", "permalink"],
  imageUrl: ["image", "image_url", "image_link", "g:image_link", "imageurl", "img", "bild", "bild_url", "thumbnail", "featured_image"],
  price: ["price", "g:price", "preis", "sale_price", "g:sale_price", "amount", "current_price"],
  currency: ["currency", "währung", "waehrung", "price_currency", "currency_code"],
  category: ["category", "product_type", "g:product_type", "google_product_category", "g:google_product_category", "kategorie", "categories", "type", "collection"],
  brand: ["brand", "g:brand", "marke", "hersteller", "manufacturer", "vendor"],
  description: ["description", "g:description", "beschreibung", "summary", "body_html", "short_description"],
  gtin: ["gtin", "g:gtin", "ean", "upc", "isbn", "barcode"],
  availability: ["availability", "g:availability", "verfügbarkeit", "stock_status", "in_stock", "status"],
};

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  const lower = new Map(Object.entries(obj).map(([k, v]) => [k.toLowerCase().trim(), v]));
  for (const k of keys) {
    const v = lower.get(k);
    if (v != null && v !== "") return v;
  }
  return undefined;
}

function str(v: unknown, max = 2000): string | null {
  if (v == null) return null;
  if (Array.isArray(v)) return str(v[0], max);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return str(o.src ?? o.url ?? o.name ?? o.title ?? null, max);
  }
  const s = String(v).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

function safeHttpUrl(v: unknown): string | null {
  const s = str(v, 2048);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** "29.99 EUR", "€29,99", "1.299,00" → { price, currency } */
export function parsePrice(v: unknown, fallbackCurrency: string | null = null): { price: number | null; currency: string | null } {
  if (v == null || v === "") return { price: null, currency: fallbackCurrency };
  if (typeof v === "number") return { price: Number.isFinite(v) ? v : null, currency: fallbackCurrency };
  const s = String(v).trim();
  const cur = s.match(/\b([A-Z]{3})\b/)?.[1] ?? (s.includes("€") ? "EUR" : s.includes("$") ? "USD" : s.includes("£") ? "GBP" : fallbackCurrency);
  let num = s.replace(/[^\d.,-]/g, "");
  if (num.includes(",") && num.includes(".")) {
    num = num.lastIndexOf(",") > num.lastIndexOf(".") ? num.replace(/\./g, "").replace(",", ".") : num.replace(/,/g, "");
  } else if (num.includes(",")) {
    num = /,\d{1,2}$/.test(num) ? num.replace(",", ".") : num.replace(/,/g, "");
  }
  const price = Number.parseFloat(num);
  return { price: Number.isFinite(price) ? Math.round(price * 100) / 100 : null, currency: cur };
}

export function normalizeProduct(raw: Record<string, unknown>): NormalizedProduct | null {
  // Shopify products.json shape
  const variants = Array.isArray(raw.variants) ? (raw.variants as Record<string, unknown>[]) : null;
  const images = Array.isArray(raw.images) ? (raw.images as Record<string, unknown>[]) : null;
  const name = str(pick(raw, FIELD_ALIASES.name), 300);
  if (!name) return null;
  const priceRaw = pick(raw, FIELD_ALIASES.price) ?? variants?.[0]?.price;
  const { price, currency } = parsePrice(priceRaw, str(pick(raw, FIELD_ALIASES.currency), 3)?.toUpperCase() ?? str(raw.__currency, 3));
  let url = safeHttpUrl(pick(raw, FIELD_ALIASES.url));
  if (!url && typeof raw.handle === "string" && typeof raw.__origin === "string") url = safeHttpUrl(`${raw.__origin}/products/${raw.handle}`);
  return {
    sku: str(pick(raw, FIELD_ALIASES.sku) ?? variants?.[0]?.sku, 120),
    name,
    url,
    imageUrl: safeHttpUrl(pick(raw, FIELD_ALIASES.imageUrl) ?? images?.[0]?.src),
    price,
    currency,
    category: str(pick(raw, FIELD_ALIASES.category), 300),
    brand: str(pick(raw, FIELD_ALIASES.brand), 160),
    description: str(pick(raw, FIELD_ALIASES.description), 2000),
    gtin: str(pick(raw, FIELD_ALIASES.gtin) ?? variants?.[0]?.barcode, 40),
    availability: str(pick(raw, FIELD_ALIASES.availability) ?? (variants ? (variants.some((v) => v.available !== false) ? "in stock" : "out of stock") : null), 60),
  };
}

/* ───────────────────────────── Parsers ───────────────────────────── */

/** Google Merchant XML (RSS/Atom with g: namespace) or generic RSS items. */
export function parseXmlFeed(xml: string): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  let current: Record<string, unknown> | null = null;
  let field: string | null = null;
  let buf = "";
  let depth = 0;
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        const n = name.toLowerCase();
        if (!current && (n === "item" || n === "entry")) {
          current = {};
          depth = 0;
          return;
        }
        if (current) {
          depth++;
          if (depth === 1) {
            field = n;
            buf = "";
            if (n === "link" && attrs.href) current.link = attrs.href;
          }
        }
      },
      ontext(t) {
        if (current && field && depth >= 1) buf += t;
      },
      onclosetag(name) {
        const n = name.toLowerCase();
        if (current && depth === 0 && (n === "item" || n === "entry")) {
          items.push(current);
          current = null;
          return;
        }
        if (current) {
          if (depth === 1 && field) {
            const v = buf.trim();
            if (v && current[field] == null) current[field] = v;
            field = null;
          }
          depth = Math.max(0, depth - 1);
        }
      },
    },
    { xmlMode: true, decodeEntities: true },
  );
  parser.write(xml);
  parser.end();
  return items;
}

export function parseCsvProducts(text: string): Record<string, unknown>[] {
  const rows = parseCsv(text, { maxRows: MAX_PRODUCTS_PER_IMPORT + 1 });
  if (rows.length < 2) return [];
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

export function parseJsonProducts(text: string, origin?: string): Record<string, unknown>[] {
  const json: unknown = JSON.parse(text);
  const list = Array.isArray(json)
    ? json
    : json && typeof json === "object"
      ? ((json as Record<string, unknown>).products ?? (json as Record<string, unknown>).items ?? (json as Record<string, unknown>).data)
      : null;
  if (!Array.isArray(list)) throw new Error("JSON must be an array of products or an object with a `products` array.");
  return list.filter((x): x is Record<string, unknown> => !!x && typeof x === "object").map((x) => (origin ? { ...x, __origin: origin } : x));
}

export function detectAndParse(text: string, hint?: { contentType?: string; filename?: string; origin?: string }): Record<string, unknown>[] {
  const t = text.replace(/^﻿/, "").trimStart();
  const ct = (hint?.contentType ?? "").toLowerCase();
  const fn = (hint?.filename ?? "").toLowerCase();
  if (t.startsWith("{") || t.startsWith("[") || ct.includes("json") || fn.endsWith(".json")) return parseJsonProducts(t, hint?.origin);
  if (t.startsWith("<") || ct.includes("xml") || fn.endsWith(".xml") || fn.endsWith(".rss")) return parseXmlFeed(t);
  return parseCsvProducts(t);
}

/* ───────────────────────────── Persistence ───────────────────────────── */

function productKey(p: NormalizedProduct) {
  return (p.sku ? `sku:${p.sku}` : p.url ? `url:${p.url}` : `name:${p.name.toLowerCase()}`).slice(0, 500);
}

export async function upsertProducts(
  projectId: string,
  rawItems: Record<string, unknown>[],
  source: "feed" | "file" | "api",
  opts: { replace?: boolean } = {},
): Promise<{ received: number; created: number; updated: number; skipped: number }> {
  const received = rawItems.length;
  if (received > MAX_PRODUCTS_PER_IMPORT) throw new Error(`Too many products in one import (max ${MAX_PRODUCTS_PER_IMPORT.toLocaleString("en-US")}).`);
  const normalized = new Map<string, NormalizedProduct>();
  let skipped = 0;
  for (const raw of rawItems) {
    const p = normalizeProduct(raw);
    if (!p) {
      skipped++;
      continue;
    }
    normalized.set(productKey(p), p);
  }
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(catalogProducts).where(eq(catalogProducts.projectId, projectId));
  if (!opts.replace && n >= MAX_PRODUCTS_PER_PROJECT)
    throw new Error(`Catalog limit of ${MAX_PRODUCTS_PER_PROJECT.toLocaleString("en-US")} products reached. Clear the catalog or import with replace.`);
  const entries = [...normalized.entries()];
  let created = 0;
  let updated = 0;
  const now = new Date();
  for (let i = 0; i < entries.length; i += 500) {
    const chunk = entries.slice(i, i + 500);
    const rows = await db
      .insert(catalogProducts)
      .values(chunk.map(([key, p]) => ({ projectId, productKey: key, source, ...p, updatedAt: now })))
      .onConflictDoUpdate({
        target: [catalogProducts.projectId, catalogProducts.productKey],
        set: {
          sku: sql`excluded.sku`,
          name: sql`excluded.name`,
          url: sql`excluded.url`,
          imageUrl: sql`excluded.image_url`,
          price: sql`excluded.price`,
          currency: sql`excluded.currency`,
          category: sql`excluded.category`,
          brand: sql`excluded.brand`,
          description: sql`excluded.description`,
          gtin: sql`excluded.gtin`,
          availability: sql`excluded.availability`,
          source: sql`excluded.source`,
          updatedAt: now,
        },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    for (const r of rows) {
      if (r.inserted) created++;
      else updated++;
    }
  }
  if (opts.replace && normalized.size) {
    await db
      .delete(catalogProducts)
      .where(and(eq(catalogProducts.projectId, projectId), eq(catalogProducts.source, source), notInArray(catalogProducts.productKey, [...normalized.keys()])));
  }
  return { received, created, updated, skipped };
}

/* ───────────────────────────── Stream connection ───────────────────────────── */

export async function getStreamIntegration(projectId: string) {
  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.projectId, projectId), eq(integrations.provider, PRODUCT_STREAM_PROVIDER)))
    .limit(1);
  return row ?? null;
}

export async function getStreamConfig(projectId: string): Promise<ProductStreamConfig> {
  const row = await getStreamIntegration(projectId);
  const cfg = (row?.config ?? {}) as Record<string, unknown>;
  return {
    source: (cfg.source as ProductStreamConfig["source"]) ?? null,
    feedUrl: (cfg.feedUrl as string) ?? null,
    syncDaily: Boolean(cfg.syncDaily ?? true),
    tokenPrefix: row?.tokenPrefix ?? null,
    lastImport: (cfg.lastImport as ProductStreamConfig["lastImport"]) ?? null,
    lastError: row?.lastError ?? null,
    status: row?.status ?? null,
  };
}

async function upsertStream(projectId: string, patch: { config?: Record<string, unknown>; tokenHash?: string | null; tokenPrefix?: string | null; status?: "connected" | "error" | "pending" | "disconnected"; lastError?: string | null; connectedBy?: string | null; lastSyncAt?: Date }) {
  const existing = await getStreamIntegration(projectId);
  const config = { ...((existing?.config ?? {}) as Record<string, unknown>), ...(patch.config ?? {}) };
  if (existing) {
    await db
      .update(integrations)
      .set({
        config,
        ...(patch.tokenHash !== undefined ? { tokenHash: patch.tokenHash } : {}),
        ...(patch.tokenPrefix !== undefined ? { tokenPrefix: patch.tokenPrefix } : {}),
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.lastError !== undefined ? { lastError: patch.lastError } : {}),
        ...(patch.lastSyncAt ? { lastSyncAt: patch.lastSyncAt } : {}),
      })
      .where(eq(integrations.id, existing.id));
  } else {
    await db.insert(integrations).values({
      projectId,
      provider: PRODUCT_STREAM_PROVIDER,
      status: patch.status ?? "connected",
      config,
      tokenHash: patch.tokenHash ?? null,
      tokenPrefix: patch.tokenPrefix ?? null,
      connectedBy: patch.connectedBy ?? null,
      lastError: patch.lastError ?? null,
      lastSyncAt: patch.lastSyncAt ?? null,
    });
  }
}

export async function recordImport(projectId: string, source: "feed" | "file" | "api", stats: { received: number; created: number; updated: number; skipped: number }) {
  await upsertStream(projectId, {
    config: { source, lastImport: { at: new Date().toISOString(), source, ...stats } },
    status: "connected",
    lastError: null,
    lastSyncAt: new Date(),
  });
}

export async function setFeedUrl(projectId: string, feedUrl: string, syncDaily: boolean, userId: string | null) {
  await upsertStream(projectId, { config: { source: "feed", feedUrl, syncDaily }, status: "pending", connectedBy: userId, lastError: null });
}

export async function recordStreamError(projectId: string, error: string) {
  await upsertStream(projectId, { status: "error", lastError: error.slice(0, 1000) });
}

/** Creates (or rotates) the push API token. Returns the plain token once; only its SHA-256 is stored. */
export async function rotatePushToken(projectId: string, userId: string | null): Promise<string> {
  const token = `aps_${randomToken(24)}`;
  await upsertStream(projectId, {
    config: { source: "api" },
    tokenHash: sha256(token),
    tokenPrefix: token.slice(0, 10),
    status: "connected",
    connectedBy: userId,
    lastError: null,
  });
  return token;
}

export async function disconnectStream(projectId: string) {
  await db.delete(integrations).where(and(eq(integrations.projectId, projectId), eq(integrations.provider, PRODUCT_STREAM_PROVIDER)));
}

export async function verifyPushToken(projectId: string, token: string): Promise<boolean> {
  if (!token.startsWith("aps_") || token.length < 20) return false;
  const row = await getStreamIntegration(projectId);
  if (!row?.tokenHash) return false;
  const a = Buffer.from(row.tokenHash);
  const b = Buffer.from(sha256(token));
  return a.length === b.length && (await import("node:crypto")).timingSafeEqual(a, b);
}

/** Fetches a feed URL (SSRF-safe) and imports its products. */
const EURO = new Set("AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK".split(" "));
const CURRENCIES: Record<string, string> = { US: "USD", UK: "GBP", GB: "GBP", CH: "CHF", CA: "CAD", AU: "AUD", SE: "SEK", NO: "NOK", DK: "DKK", PL: "PLN", CZ: "CZK", JP: "JPY", IN: "INR", BR: "BRL", MX: "MXN" };

/** Default currency of a market (used when a feed has no currency, e.g. Shopify products.json). */
export function currencyForCountry(iso: string): string | null {
  const c = iso.toUpperCase();
  return EURO.has(c) ? "EUR" : (CURRENCIES[c] ?? null);
}

export async function syncFeed(projectId: string, feedUrl: string): Promise<{ received: number; created: number; updated: number; skipped: number }> {
  const [project] = await db.select({ country: projects.country }).from(projects).where(eq(projects.id, projectId)).limit(1);
  const fallbackCurrency = project ? currencyForCountry(project.country) : null;
  // Shopify: request the maximum page size right away and follow ?page=N below.
  const first = new URL(feedUrl);
  if (/\/products\.json$/i.test(first.pathname) && !first.searchParams.has("limit")) first.searchParams.set("limit", "250");
  const res = await safeFetch(first.toString(), { maxBytes: 40 * 1024 * 1024, timeoutMs: 90_000, accept: "application/xml,text/xml,application/json,text/csv,*/*" });
  if (!res.ok) throw new Error(`Feed returned HTTP ${res.status}.`);
  if (res.truncated) throw new Error("Feed is larger than 40 MB — please split it or use the push API.");
  const origin = new URL(res.url).origin;
  let items = detectAndParse(res.body.toString("utf8"), { contentType: res.contentType, filename: new URL(res.url).pathname, origin });
  // Shopify: follow ?page=N for products.json (250 per page) up to the import cap.
  if (/\/products\.json$/i.test(new URL(res.url).pathname) && items.length >= 250) {
    for (let page = 2; page <= 40 && items.length < MAX_PRODUCTS_PER_IMPORT; page++) {
      const u = new URL(res.url);
      u.searchParams.set("limit", "250");
      u.searchParams.set("page", String(page));
      const next = await safeFetch(u.toString(), { maxBytes: 20 * 1024 * 1024, timeoutMs: 60_000 });
      if (!next.ok) break;
      const more = parseJsonProducts(next.body.toString("utf8"), origin);
      if (!more.length) break;
      items = items.concat(more);
    }
  }
  if (!items.length) throw new Error("No products found in the feed. Supported: Google Merchant XML, RSS/Atom, CSV, JSON (incl. Shopify products.json).");
  if (fallbackCurrency) items = items.map((i) => (i.currency || i.__currency ? i : { ...i, __currency: fallbackCurrency }));
  const stats = await upsertProducts(projectId, items.slice(0, MAX_PRODUCTS_PER_IMPORT), "feed");
  await recordImport(projectId, "feed", stats);
  return stats;
}

export async function listProducts(projectId: string, opts: { q?: string; limit?: number; offset?: number } = {}): Promise<{ rows: CatalogProduct[]; total: number; categories: { name: string; count: number }[] }> {
  const where = opts.q
    ? and(
        eq(catalogProducts.projectId, projectId),
        or(
          ilike(catalogProducts.name, `%${opts.q}%`),
          ilike(catalogProducts.sku, `%${opts.q}%`),
          ilike(catalogProducts.category, `%${opts.q}%`),
          ilike(catalogProducts.brand, `%${opts.q}%`),
        ),
      )
    : eq(catalogProducts.projectId, projectId);
  const [rows, [{ total } = { total: 0 }], cats] = await Promise.all([
    db
      .select()
      .from(catalogProducts)
      .where(where)
      .orderBy(desc(catalogProducts.updatedAt), catalogProducts.name)
      .limit(opts.limit ?? 200)
      .offset(opts.offset ?? 0),
    db.select({ total: count() }).from(catalogProducts).where(where),
    db
      .select({ name: catalogProducts.category, count: count() })
      .from(catalogProducts)
      .where(eq(catalogProducts.projectId, projectId))
      .groupBy(catalogProducts.category)
      .orderBy(desc(count()))
      .limit(20),
  ]);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      sku: r.sku,
      name: r.name,
      url: r.url,
      imageUrl: r.imageUrl,
      price: r.price,
      currency: r.currency,
      category: r.category,
      brand: r.brand,
      availability: r.availability,
      source: r.source,
      updatedAt: r.updatedAt.toISOString(),
    })),
    total,
    categories: cats.filter((c) => c.name).map((c) => ({ name: c.name!, count: c.count })),
  };
}

export async function clearCatalog(projectId: string) {
  await db.delete(catalogProducts).where(eq(catalogProducts.projectId, projectId));
}
