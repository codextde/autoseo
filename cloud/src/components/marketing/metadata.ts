import type { Metadata } from "next";
import { site } from "@/lib/site";

type PageMeta = {
  /** Page title without the site suffix (the root layout template appends "· AutoSEO"). */
  title: string;
  description: string;
  path: string;
  /** Use the title as-is, without the template suffix. */
  absolute?: boolean;
  /** The route has its own opengraph-image file (Next.js then fills og:image and twitter:image). */
  ownImage?: boolean;
};

/** Default social card (src/app/opengraph-image.tsx). Segments with their own opengraph-image file override it. */
const defaultImage = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "AutoSEO — see how AI search talks about your brand. Open source, self-host free, Cloud $50/month.",
};

/**
 * Per-page metadata with canonical URL, Open Graph and Twitter card. A page-level `openGraph` object replaces the
 * parent's, so the default image is set explicitly here.
 */
export function pageMetadata({ title, description, path, absolute, ownImage }: PageMeta): Metadata {
  const fullTitle = absolute ? title : `${title} · ${site.name}`;
  // Leave the key out entirely for routes with their own opengraph-image file; even `images: undefined` suppresses it.
  const images = ownImage ? {} : { images: [defaultImage] };
  return {
    title: absolute ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: site.name,
      locale: "en_US",
      url: path,
      title: fullTitle,
      description,
      ...images,
    },
    twitter: { card: "summary_large_image", title: fullTitle, description, ...images },
  };
}
