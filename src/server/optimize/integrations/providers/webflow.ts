import "server-only";
import { fetchJson } from "../../net";
import type { CmsClient, CmsDocument } from "../types";
import { requireField, requireTarget, truncate, type Creds, type Target } from "./common";

const BASE = "https://api.webflow.com/v2";

type WfField = { id: string; slug: string; displayName: string; type: string; isRequired?: boolean };
type WfCollection = { id: string; slug: string; displayName: string; fields: WfField[] };
type WfSite = { id: string; displayName: string; shortName: string; customDomains?: { url: string }[] };

/** Target id format: `<siteId>:<collectionId>` */
export function createWebflowClient(creds: Creds, target: Target): CmsClient {
  const token = requireField(creds, "token", "API token");
  const api = <T>(path: string, init: { method?: string; json?: unknown } = {}) =>
    fetchJson<T>(`${BASE}${path}`, { ...init, headers: { authorization: `Bearer ${token}` } });

  const pickFields = (fields: WfField[]) => {
    const rich = fields.filter((f) => f.type === "RichText");
    const plain = fields.filter((f) => f.type === "PlainText" && f.slug !== "name" && f.slug !== "slug");
    return {
      body: rich.find((f) => /body|content|post|article/i.test(f.slug)) ?? rich[0],
      summary: plain.find((f) => /summary|excerpt|description|meta-desc|intro/i.test(f.slug) && !/title/i.test(f.slug)),
      seoTitle: plain.find((f) => /seo.?title|meta.?title/i.test(f.slug)),
    };
  };

  return {
    async test() {
      const { sites } = await api<{ sites: WfSite[] }>("/sites");
      if (!sites.length) throw new Error("The token has no access to any Webflow site (needs sites:read + cms:write scopes).");
      return { account: sites.map((s) => s.displayName).slice(0, 3).join(", ") };
    },
    async listTargets() {
      const { sites } = await api<{ sites: WfSite[] }>("/sites");
      const out: { id: string; name: string }[] = [];
      for (const site of sites.slice(0, 20)) {
        const { collections } = await api<{ collections: { id: string; displayName: string }[] }>(`/sites/${site.id}/collections`);
        for (const c of collections) out.push({ id: `${site.id}:${c.id}`, name: `${site.displayName} / ${c.displayName}` });
      }
      return out;
    },
    async publish(doc: CmsDocument, opts) {
      const t = requireTarget(target, "Collection");
      const [siteId, collectionId] = t.id.split(":");
      if (!siteId || !collectionId) throw new Error("Invalid Webflow collection — choose it again in the integration settings.");
      const [collection, site] = await Promise.all([api<WfCollection>(`/collections/${collectionId}`), api<WfSite>(`/sites/${siteId}`)]);
      const map = pickFields(collection.fields);
      if (!map.body) throw new Error(`The collection "${collection.displayName}" has no Rich Text field for the article body.`);
      const fieldData: Record<string, unknown> = { name: truncate(doc.title, 256), slug: doc.slug, [map.body.slug]: doc.html };
      if (map.summary) fieldData[map.summary.slug] = truncate(doc.metaDescription ?? doc.excerpt, 256);
      if (map.seoTitle) fieldData[map.seoTitle.slug] = truncate(doc.metaTitle ?? doc.title, 256);
      const missing = collection.fields.filter((f) => f.isRequired && !(f.slug in fieldData));
      if (missing.length)
        throw new Error(`Webflow collection requires fields we can't fill automatically: ${missing.map((f) => f.displayName).join(", ")}.`);

      let item: { id: string; fieldData?: { slug?: string } };
      if (opts.existingId) {
        item = await api(`/collections/${collectionId}/items/${encodeURIComponent(opts.existingId)}`, {
          method: "PATCH",
          json: { isArchived: false, isDraft: opts.draft, fieldData },
        });
      } else {
        item = await api(`/collections/${collectionId}/items`, { method: "POST", json: { isArchived: false, isDraft: opts.draft, fieldData } });
      }
      if (!opts.draft) await api(`/collections/${collectionId}/items/publish`, { method: "POST", json: { itemIds: [item.id] } });
      const host = site.customDomains?.[0]?.url ?? `${site.shortName}.webflow.io`;
      const url = opts.draft ? null : `https://${host.replace(/^https?:\/\//, "")}/${collection.slug}/${item.fieldData?.slug ?? doc.slug}`;
      return { externalId: item.id, url };
    },
  };
}
