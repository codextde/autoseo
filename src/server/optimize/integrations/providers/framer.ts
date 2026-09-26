import "server-only";
import type { CmsClient } from "../types";
import type { Creds } from "./common";

/** Framer has no public CMS write API — the integration only records the site; content is exported. */
export function createFramerClient(creds: Creds): CmsClient {
  return {
    async test() {
      const site = (creds.siteUrl ?? "").trim();
      return { account: site ? site.replace(/^https?:\/\//, "").replace(/\/+$/, "") : "Export only" };
    },
    async publish() {
      throw new Error("Framer has no publishing API — download the export and import it into your Framer CMS collection.");
    },
  };
}
