import "server-only";
import { HttpError, fetchJson } from "../../net";
import type { CmsClient, CmsDocument } from "../types";
import { normalizeSiteUrl, requireField, type Creds } from "./common";

function jsonLdScript(jsonLd: string | null): string {
  if (!jsonLd?.trim()) return "";
  // Prevent "</script>" inside JSON from closing the tag.
  return `\n<script type="application/ld+json">${jsonLd.replace(/<\//g, "<\\/")}</script>`;
}

export function createWordPressClient(creds: Creds): CmsClient {
  const site = normalizeSiteUrl(requireField(creds, "siteUrl", "Site URL"), true);
  const user = requireField(creds, "username", "Username");
  const password = requireField(creds, "appPassword", "Application password").replace(/\s+/g, " ");
  const auth = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
  let restBase: string | null = null;

  /** Pretty permalinks use /wp-json, plain permalinks need ?rest_route=. */
  const endpoint = async (route: string) => {
    if (!restBase) {
      try {
        await fetchJson(`${site}/wp-json/`, { headers: { authorization: auth }, maxBytes: 2 * 1024 * 1024 });
        restBase = `${site}/wp-json`;
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) restBase = `${site}/?rest_route=`;
        else throw err;
      }
    }
    if (restBase.endsWith("rest_route=")) {
      const [path, qs] = route.split("?");
      return `${restBase}${path}${qs ? `&${qs}` : ""}`;
    }
    return `${restBase}${route}`;
  };
  const api = async <T>(route: string, init: { method?: string; json?: unknown } = {}) =>
    fetchJson<T>(await endpoint(route), { ...init, headers: { authorization: auth }, maxBytes: 4 * 1024 * 1024 });

  return {
    async test() {
      const me = await api<{ name: string; slug: string; capabilities?: Record<string, boolean> }>("/wp/v2/users/me?context=edit");
      if (me.capabilities && me.capabilities.publish_posts === false)
        throw new Error("This WordPress user cannot publish posts (needs the Author, Editor or Administrator role).");
      return { account: `${new URL(site).host} · ${me.name}` };
    },
    async publish(doc: CmsDocument, opts) {
      const body: Record<string, unknown> = {
        title: doc.title,
        content: doc.html + jsonLdScript(doc.jsonLd),
        excerpt: doc.excerpt,
        slug: doc.slug,
        status: opts.draft ? "draft" : "publish",
      };
      const meta = {
        // Yoast SEO / Rank Math fields — only applied when the plugin registers them for the REST API.
        _yoast_wpseo_title: doc.metaTitle ?? doc.title,
        _yoast_wpseo_metadesc: doc.metaDescription ?? doc.excerpt,
        rank_math_title: doc.metaTitle ?? doc.title,
        rank_math_description: doc.metaDescription ?? doc.excerpt,
      };
      const route = opts.existingId ? `/wp/v2/posts/${encodeURIComponent(opts.existingId)}` : "/wp/v2/posts";
      let post: { id: number; link: string; status: string };
      try {
        post = await api(route, { method: "POST", json: { ...body, meta } });
      } catch (err) {
        // Some installs reject unknown meta keys — retry without SEO meta.
        if (err instanceof HttpError && err.status === 400 && /meta/i.test(err.message)) post = await api(route, { method: "POST", json: body });
        else throw err;
      }
      return { externalId: String(post.id), url: post.status === "publish" ? post.link : null };
    },
  };
}
