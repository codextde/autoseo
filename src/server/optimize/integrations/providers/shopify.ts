import "server-only";
import { fetchJson } from "../../net";
import type { CmsClient, CmsDocument } from "../types";
import { requireField, requireTarget, truncate, type Creds, type Target } from "./common";

const API_VERSION = "2026-07";

type GqlResponse<T> = { data?: T; errors?: { message: string }[] | string };
type UserError = { field?: string[] | null; message: string };

export function normalizeShopDomain(raw: string): string {
  const v = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const host = v.includes(".") ? v : `${v}.myshopify.com`;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(host)) throw new Error("Enter your shop's *.myshopify.com domain.");
  return host;
}

export function createShopifyClient(creds: Creds, target: Target): CmsClient {
  const shop = normalizeShopDomain(requireField(creds, "shopDomain", "Shop domain"));
  const token = requireField(creds, "accessToken", "Admin API access token");
  const gql = async <T>(query: string, variables: Record<string, unknown> = {}): Promise<T> => {
    const res = await fetchJson<GqlResponse<T>>(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": token },
      json: { query, variables },
    });
    if (res.errors) throw new Error(`Shopify: ${typeof res.errors === "string" ? res.errors : res.errors.map((e) => e.message).join("; ")}`);
    if (!res.data) throw new Error("Shopify returned no data.");
    return res.data;
  };
  const info = () =>
    gql<{ shop: { name: string; primaryDomain: { url: string } }; blogs: { nodes: { id: string; title: string; handle: string }[] } }>(
      `query ShopInfo { shop { name primaryDomain { url host } myshopifyDomain } blogs(first: 50) { nodes { id title handle } } }`,
    );
  return {
    async test() {
      const d = await info();
      return { account: `${d.shop.name} (${shop})` };
    },
    async listTargets() {
      const d = await info();
      return d.blogs.nodes.map((b) => ({ id: b.id, name: b.title }));
    },
    async publish(doc: CmsDocument, opts) {
      const blog = requireTarget(target, "Blog");
      const shopInfo = await info();
      const metafields = [
        { namespace: "global", key: "title_tag", type: "single_line_text_field", value: truncate(doc.metaTitle ?? doc.title, 255) },
        { namespace: "global", key: "description_tag", type: "multi_line_text_field", value: truncate(doc.metaDescription ?? doc.excerpt, 320) },
      ];
      const article = {
        title: doc.title,
        body: doc.html,
        handle: doc.slug,
        summary: doc.excerpt ? `<p>${doc.excerpt.replace(/</g, "&lt;")}</p>` : undefined,
        isPublished: !opts.draft,
        metafields,
      };
      const selection = `article { id handle isPublished blog { handle } } userErrors { field message code }`;
      let result: { article: { id: string; handle: string; blog: { handle: string } } | null; userErrors: UserError[] };
      if (opts.existingId) {
        const d = await gql<{ articleUpdate: typeof result }>(
          `mutation ArticleUpdate($id: ID!, $article: ArticleUpdateInput!) { articleUpdate(id: $id, article: $article) { ${selection} } }`,
          { id: opts.existingId, article },
        );
        result = d.articleUpdate;
      } else {
        const d = await gql<{ articleCreate: typeof result }>(
          `mutation ArticleCreate($article: ArticleCreateInput!) { articleCreate(article: $article) { ${selection} } }`,
          { article: { ...article, blogId: blog.id, author: { name: (creds.authorName ?? "").trim() || shopInfo.shop.name } } },
        );
        result = d.articleCreate;
      }
      if (result.userErrors?.length) throw new Error(`Shopify: ${result.userErrors.map((e) => e.message).join("; ")}`);
      if (!result.article) throw new Error("Shopify did not return the article.");
      const base = shopInfo.shop.primaryDomain.url.replace(/\/+$/, "");
      return {
        externalId: result.article.id,
        url: opts.draft ? null : `${base}/blogs/${result.article.blog.handle}/${result.article.handle}`,
      };
    },
  };
}
