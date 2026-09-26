import "server-only";
import { deterministicAuditRowId, sha256Hex } from "@/server/audit-crawler/ids";
import type { CrawledPageResult, PageLink } from "@/server/audit-crawler/types";
import type { Rng } from "../random";

/**
 * Synthetic site model for the demo Site Audit: a fictional running-shoe store whose SEO defects
 * shrink from audit to audit (fix levels 0 → 3). Produces `CrawledPageResult` records exactly like
 * the crawler, so the audit module's own reporters / cross-page checks / scoring can run on them.
 */

type Kind = "home" | "collection" | "product" | "variant" | "dupe" | "blog" | "archive" | "guide" | "info" | "tag" | "pagination" | "landing" | "print" | "error" | "redirect";

type Spec = {
  path: string;
  kind: Kind;
  status: number;
  redirectTo?: string;
  title: string;
  meta: string;
  h1s: string[];
  headingOrder: number[];
  words: number;
  images: number;
  missingAlt: number;
  links: string[];
  external: string[];
  sitemap: boolean;
  noindex?: boolean;
  canonical?: string | null;
  headerCanonical?: string | null;
  slowMs?: number;
  structured: string[];
  hash?: string;
};

/** Defect counts per fix level [L0, L1, L2, L3] (monotonically decreasing = fixes over time). */
const FAMILIES = {
  missingMeta: [55, 44, 35, 28],
  metaTooLong: [8, 6, 5, 4],
  metaTooShort: [6, 5, 3, 3],
  titleTooLong: [9, 7, 6, 5],
  titleTooShort: [3, 2, 2, 1],
  missingH1: [14, 12, 9, 7],
  multipleH1: [34, 28, 22, 16],
  headingSkip: [10, 8, 7, 6],
  missingAlt: [83, 76, 68, 60],
  thin: [16, 14, 11, 8],
  slow: [9, 6, 4, 3],
  brokenLinkSources: [18, 10, 5, 2],
  serverError: [1, 1, 1, 0],
  redirectLoop: [1, 0, 0, 0],
  extraChain: [1, 1, 0, 0],
  dupePairs: [3, 2, 1, 1],
  orphans: [2, 2, 1, 1],
  archiveDeep: [6, 6, 5, 5],
} as const;

const count = (f: keyof typeof FAMILIES, level: number) => FAMILIES[f][Math.max(0, Math.min(3, level))]!;

const PRODUCTS: { slug: string; name: string; type: "road" | "trail" | "apparel" | "gear"; collections: string[] }[] = [
  { slug: "cloudrun-4", name: "Cloudrun 4", type: "road", collections: ["running-shoes", "max-cushion", "womens-running-shoes", "mens-running-shoes"] },
  { slug: "cloudrun-4-wide", name: "Cloudrun 4 Wide", type: "road", collections: ["wide-fit", "running-shoes"] },
  { slug: "pacejet-carbon", name: "Pacejet Carbon", type: "road", collections: ["race-day", "lightweight"] },
  { slug: "pacejet-trainer", name: "Pacejet Trainer", type: "road", collections: ["race-day", "running-shoes"] },
  { slug: "airloop-knit", name: "Airloop Knit", type: "road", collections: ["lightweight", "recycled", "vegan"] },
  { slug: "tempo-flex", name: "Tempo Flex", type: "road", collections: ["running-shoes", "under-100"] },
  { slug: "driftline", name: "Driftline", type: "road", collections: ["stability", "running-shoes"] },
  { slug: "stride-daily", name: "Stride Daily", type: "road", collections: ["under-100", "sale", "mens-running-shoes"] },
  { slug: "recoil-max", name: "Recoil Max", type: "road", collections: ["max-cushion", "stability"] },
  { slug: "sprint-lite", name: "Sprint Lite", type: "road", collections: ["lightweight", "sale"] },
  { slug: "loop-recycled-runner", name: "Loop Recycled Runner", type: "road", collections: ["recycled", "vegan", "womens-running-shoes"] },
  { slug: "trailhawk-2", name: "Trailhawk 2", type: "trail", collections: ["trail", "womens-trail"] },
  { slug: "trailhawk-gtx", name: "Trailhawk GTX", type: "trail", collections: ["trail", "trail-gtx"] },
  { slug: "summit-trail", name: "Summit Trail", type: "trail", collections: ["trail", "trail-gtx"] },
  { slug: "scree-runner", name: "Scree Runner", type: "trail", collections: ["trail", "sale"] },
  { slug: "canyon-trail", name: "Canyon Trail", type: "trail", collections: ["womens-trail", "trail"] },
  { slug: "loop-recycled-tee", name: "Loop Recycled Tee", type: "apparel", collections: ["recycled"] },
  { slug: "aero-shorts-5", name: "Aero Shorts 5\"", type: "apparel", collections: ["shorts"] },
  { slug: "aero-shorts-7", name: "Aero Shorts 7\"", type: "apparel", collections: ["shorts"] },
  { slug: "storm-shell-jacket", name: "Storm Shell Jacket", type: "apparel", collections: ["jackets"] },
  { slug: "thermal-run-tights", name: "Thermal Run Tights", type: "apparel", collections: ["jackets", "sale"] },
  { slug: "breeze-singlet", name: "Breeze Singlet", type: "apparel", collections: ["shorts", "under-100"] },
  { slug: "reflect-cap", name: "Reflect Cap", type: "gear", collections: ["under-100"] },
  { slug: "flowvest-8l", name: "FlowVest 8L", type: "gear", collections: ["trail"] },
  { slug: "flowvest-12l", name: "FlowVest 12L", type: "gear", collections: ["trail"] },
  { slug: "cushion-crew-socks", name: "Cushion Crew Socks (3-Pack)", type: "gear", collections: ["socks", "under-100"] },
  { slug: "merino-trail-socks", name: "Merino Trail Socks", type: "gear", collections: ["socks", "trail"] },
  { slug: "recovery-slide", name: "Recovery Slide", type: "gear", collections: ["sale", "vegan"] },
  { slug: "race-belt", name: "Race Belt", type: "gear", collections: ["race-day"] },
  { slug: "winter-run-gloves", name: "Winter Run Gloves", type: "gear", collections: ["jackets"] },
];

const COLLECTIONS: [string, string][] = [
  ["running-shoes", "Running Shoes"],
  ["womens-running-shoes", "Women's Running Shoes"],
  ["mens-running-shoes", "Men's Running Shoes"],
  ["trail", "Trail Running Shoes"],
  ["trail-gtx", "Waterproof Trail Shoes"],
  ["womens-trail", "Women's Trail Shoes"],
  ["max-cushion", "Max Cushion Shoes"],
  ["wide-fit", "Wide Fit Running Shoes"],
  ["race-day", "Race Day Shoes"],
  ["lightweight", "Lightweight Running Shoes"],
  ["stability", "Stability Running Shoes"],
  ["recycled", "Recycled Collection"],
  ["vegan", "Vegan Running Shoes"],
  ["sale", "Sale"],
  ["under-100", "Running Gear Under $100"],
  ["socks", "Running Socks"],
  ["shorts", "Running Shorts"],
  ["jackets", "Running Jackets"],
];

const POSTS: [string, string][] = [
  ["best-running-shoes", "The Best Running Shoes of the Year, Tested"],
  ["best-running-shoes-for-beginners", "Best Running Shoes for Beginners"],
  ["running-shoes-for-flat-feet", "Running Shoes for Flat Feet: What Actually Helps"],
  ["running-shoes-for-plantar-fasciitis", "Running Shoes for Plantar Fasciitis"],
  ["zero-drop-running-shoes", "Zero-Drop Running Shoes Explained"],
  ["best-trail-running-shoes", "Best Trail Running Shoes for Every Terrain"],
  ["eco-friendly-sneakers", "Eco-Friendly Sneakers: A Buyer's Guide"],
  ["stridewell-vs-velocita", "Stridewell vs Velocita: Cushioning Compared"],
  ["when-to-replace-running-shoes", "How Often Should You Replace Running Shoes?"],
  ["10k-training-plan", "An 8-Week 10K Training Plan"],
  ["marathon-fueling-guide", "Marathon Fueling: Gels, Carbs and Timing"],
  ["how-we-recycle-foam", "How We Recycle Midsole Foam"],
  ["carbon-plate-shoes-explained", "Carbon Plate Shoes Explained"],
  ["running-in-the-rain", "Running in the Rain Without Blisters"],
  ["trail-running-for-beginners", "Trail Running for Beginners"],
  ["how-to-lace-running-shoes", "How to Lace Running Shoes for a Better Fit"],
  ["recovery-runs-explained", "Recovery Runs Explained"],
  ["choosing-running-socks", "Choosing Running Socks That Don't Slip"],
  ["winter-running-gear", "Winter Running Gear Checklist"],
  ["sustainable-materials-report", "Our Sustainable Materials Report"],
  ["couch-to-5k", "Couch to 5K: A Friendly Start"],
  ["cadence-and-stride", "Cadence and Stride Length, Simplified"],
  ["hydration-on-long-runs", "Hydration on Long Runs"],
  ["race-day-checklist", "The Race Day Checklist"],
];

const ARCHIVE: [string, string][] = [
  ["spring-collection-recap", "Spring Collection Recap"],
  ["marathon-season-diary", "Marathon Season Diary"],
  ["team-stridewell-berlin", "Team Stridewell in Berlin"],
  ["behind-the-foam-lab", "Behind the Foam Lab"],
  ["first-ultra-diary", "My First Ultra: A Diary"],
  ["our-first-store", "Opening Our First Store"],
];

const GUIDES: [string, string][] = [
  ["how-to-choose-running-shoes", "How to Choose Running Shoes"],
  ["heel-to-toe-drop", "Heel-to-Toe Drop, Explained"],
  ["half-marathon-training-plan", "Half Marathon Training Plan"],
  ["trail-safety", "Trail Running Safety Basics"],
  ["running-form-basics", "Running Form Basics"],
];

const INFO: [string, string][] = [
  ["/about", "About Stridewell"],
  ["/sustainability", "Sustainability at Stridewell"],
  ["/returns", "Returns & Exchanges"],
  ["/shipping", "Shipping Information"],
  ["/size-guide", "Running Shoe Size Guide"],
  ["/stores/locator", "Store Locator"],
  ["/contact", "Contact Us"],
  ["/careers", "Careers"],
  ["/press", "Press"],
  ["/faq", "FAQ"],
  ["/pages/black-friday", "Black Friday Running Deals"],
];

const EXTERNAL = [
  "https://www.runnersworld.com/gear/",
  "https://www.strava.com/",
  "https://www.youtube.com/@stridewell",
  "https://www.instagram.com/stridewell",
  "https://www.worldathletics.org/",
  "https://www.reddit.com/r/running/",
];

const NAV = ["/", "/collections/running-shoes", "/collections/trail", "/collections/sale", "/blog", "/sustainability", "/size-guide"];
const FOOTER = ["/about", "/returns", "/shipping", "/faq", "/contact", "/careers", "/press"];

function fit(text: string, min: number, max: number, filler: string): string {
  let t = text;
  while (filler && t.length < min) t = `${t} ${filler}`.trim();
  if (t.length > max) t = t.slice(0, max).replace(/\s+\S*$/, "").replace(/[,;:]$/, "");
  return t;
}

const NORMAL_TITLE = (base: string, brand: string) => fit(`${base} | ${brand}`, 0, 60, "");
const NORMAL_META = (lead: string) =>
  fit(lead, 110, 155, "Free shipping over $75, 60-day returns and expert fit advice from runners who test every pair.");

export type SiteBuild = { pages: CrawledPageResult[]; startUrl: string };

/** Builds the crawled pages of the demo store at a given fix level (0 = oldest audit, 3 = latest). */
export function buildDemoSite(input: { auditId: string; origin: string; brand: string; level: number; rng: Rng }): SiteBuild {
  const { origin, brand, level, rng } = input;
  const specs = new Map<string, Spec>();
  const base = (s: Omit<Spec, "external" | "structured" | "images" | "missingAlt" | "headingOrder" | "h1s" | "status"> & Partial<Spec>): Spec => ({
    status: 200,
    external: [],
    structured: [],
    images: 2,
    missingAlt: 0,
    h1s: [s.title.split(" | ")[0]!],
    headingOrder: [1, 2, 2, 3, 2],
    ...s,
  });
  const add = (s: Spec) => specs.set(s.path, s);

  /* ── home ── */
  add(
    base({
      path: "/",
      kind: "home",
      title: `${brand} — Running Shoes Built to Go the Distance`,
      meta: NORMAL_META(`${brand} makes cushioned, recycled-material running shoes and trail gear for everyday runners. Shop road and trail shoes, apparel and accessories.`),
      words: 780,
      links: [
        ...COLLECTIONS.map(([c]) => `/collections/${c}`),
        ...PRODUCTS.slice(0, 4).map((p) => `/products/stridewell-${p.slug}`),
        ...POSTS.slice(0, 3).map(([p]) => `/blog/${p}`),
        "/pages/black-friday",
      ],
      sitemap: true,
      images: 12,
      structured: ["Organization", "WebSite"],
    }),
  );

  /* ── collections ── */
  for (const [slug, name] of COLLECTIONS) {
    const products = PRODUCTS.filter((p) => p.collections.includes(slug)).map((p) => `/products/stridewell-${p.slug}`);
    add(
      base({
        path: `/collections/${slug}`,
        kind: "collection",
        title: NORMAL_TITLE(`${name} — Shop Now`, brand),
        meta: NORMAL_META(`Shop ${name.toLowerCase()} from ${brand}: cushioned, durable designs tested by real runners.`),
        words: rng.int(320, 620),
        links: products,
        sitemap: true,
        images: products.length + 2,
        structured: ["BreadcrumbList", "ItemList"],
      }),
    );
  }

  /* ── products ── */
  PRODUCTS.forEach((p, i) => {
    const related = [PRODUCTS[(i + 1) % PRODUCTS.length]!, PRODUCTS[(i + 5) % PRODUCTS.length]!].map((r) => `/products/stridewell-${r.slug}`);
    add(
      base({
        path: `/products/stridewell-${p.slug}`,
        kind: "product",
        title: NORMAL_TITLE(`${brand} ${p.name}`, brand),
        meta: NORMAL_META(
          p.type === "trail"
            ? `The ${brand} ${p.name} grips wet rock and loose dirt with a protective, cushioned ride for long trail days.`
            : p.type === "road"
              ? `The ${brand} ${p.name} delivers a soft, stable ride for daily miles, made with recycled uppers.`
              : `The ${brand} ${p.name}: lightweight running ${p.type === "apparel" ? "apparel" : "gear"} designed for comfort on every run.`,
        ),
        words: rng.int(420, 900),
        links: [`/collections/${p.collections[0]}`, ...related, "/size-guide", "/returns"],
        sitemap: true,
        images: rng.int(5, 9),
        structured: ["Product", "BreadcrumbList", "AggregateRating"],
      }),
    );
  });

  /* ── colour variants: canonicalized to the product (intentional, info) ── */
  for (const p of PRODUCTS.slice(0, 6)) {
    const productPath = `/products/stridewell-${p.slug}`;
    const variant = `${productPath}?color=black`;
    specs.get(productPath)!.links.push(variant);
    add(
      base({
        path: variant,
        kind: "variant",
        title: NORMAL_TITLE(`${brand} ${p.name} — Black`, brand),
        meta: specs.get(productPath)!.meta,
        words: rng.int(420, 880),
        links: [productPath],
        sitemap: false,
        canonical: `${origin}${productPath}`,
        images: 6,
        structured: ["Product"],
      }),
    );
  }

  /* ── duplicate colour pages with self canonicals (duplicate title/meta/content) ── */
  for (let i = 0; i < count("dupePairs", level); i++) {
    const p = PRODUCTS[i * 2]!;
    const productPath = `/products/stridewell-${p.slug}`;
    const hash = sha256Hex(`dupe|${p.slug}`);
    for (const color of ["black", "white"]) {
      const path = `${productPath}-${color}`;
      specs.get(productPath)!.links.push(path);
      add(
        base({
          path,
          kind: "dupe",
          title: NORMAL_TITLE(`${brand} ${p.name} Colorway`, brand),
          meta: NORMAL_META(`Choose your colorway of the ${brand} ${p.name}: same cushioned ride, same recycled upper, new look.`),
          words: 460,
          links: [productPath, `/collections/${p.collections[0]}`],
          sitemap: true,
          images: 5,
          structured: ["Product"],
          hash,
        }),
      );
    }
  }

  /* ── blog, pagination, archive (deep), tags (noindex) ── */
  const perPage = 8;
  const postPath = (slug: string) => `/blog/${slug}`;
  const pages = Math.ceil(POSTS.length / perPage);
  for (let pg = 1; pg <= pages + 1; pg++) {
    const path = pg === 1 ? "/blog" : `/blog/page/${pg}`;
    const slice = POSTS.slice((pg - 1) * perPage, pg * perPage).map(([s]) => postPath(s));
    const next = pg <= pages ? [`/blog/page/${pg + 1}`] : [];
    const archive = pg === pages + 1 ? ARCHIVE.slice(0, count("archiveDeep", level)).map(([s]) => `/blog/archive/${s}`) : [];
    add(
      base({
        path,
        kind: "pagination",
        title: NORMAL_TITLE(pg === 1 ? "Running Journal: Training, Gear & Stories" : `Running Journal — Page ${pg}`, brand),
        meta: NORMAL_META(`Training plans, gear reviews and stories from the ${brand} running team${pg > 1 ? ` (page ${pg})` : ""}.`),
        words: 260,
        links: [...slice, ...next, ...archive, ...(pg === 1 ? ["/blog/tag/training", "/blog/tag/gear", "/blog/tag/trail", ...GUIDES.map(([g]) => `/guides/${g}`)] : [])],
        sitemap: pg === 1,
        images: slice.length,
      }),
    );
  }
  POSTS.forEach(([slug, title], i) => {
    const product = PRODUCTS[(i * 3) % PRODUCTS.length]!;
    const product2 = PRODUCTS[(i * 7 + 2) % PRODUCTS.length]!;
    add(
      base({
        path: postPath(slug),
        kind: "blog",
        title: NORMAL_TITLE(title, brand),
        meta: NORMAL_META(`${title}: practical advice from ${brand}'s running coaches, with the shoes and gear we actually use.`),
        words: rng.int(1100, 2400),
        links: [
          `/products/stridewell-${product.slug}`,
          `/products/stridewell-${product2.slug}`,
          `/collections/${product.collections[0]}`,
          postPath(POSTS[(i + 1) % POSTS.length]![0]),
        ],
        external: [EXTERNAL[i % EXTERNAL.length]!, ...(i % 3 === 0 ? [EXTERNAL[(i + 2) % EXTERNAL.length]!] : [])],
        sitemap: true,
        images: rng.int(3, 7),
        structured: ["Article", "BreadcrumbList"],
        headingOrder: [1, 2, 3, 3, 2, 3, 2],
      }),
    );
  });
  for (const [slug, title] of ARCHIVE.slice(0, count("archiveDeep", level))) {
    add(
      base({
        path: `/blog/archive/${slug}`,
        kind: "archive",
        title: NORMAL_TITLE(title, brand),
        meta: NORMAL_META(`${title} — from the ${brand} journal archive.`),
        words: rng.int(700, 1300),
        links: ["/blog", "/collections/running-shoes"],
        sitemap: true,
        images: 4,
        structured: ["Article"],
      }),
    );
  }
  for (const tag of ["training", "gear", "trail"]) {
    add(
      base({
        path: `/blog/tag/${tag}`,
        kind: "tag",
        title: NORMAL_TITLE(`Posts tagged “${tag}”`, brand),
        meta: NORMAL_META(`All ${brand} journal posts about ${tag}.`),
        words: 180,
        links: POSTS.slice(0, 5).map(([s]) => postPath(s)),
        sitemap: false,
        noindex: true,
        images: 5,
      }),
    );
  }

  /* ── guides ── */
  for (const [slug, title] of GUIDES) {
    add(
      base({
        path: `/guides/${slug}`,
        kind: "guide",
        title: NORMAL_TITLE(title, brand),
        meta: NORMAL_META(`${title} — a clear, step-by-step guide from ${brand} with charts, fit tips and training advice.`),
        words: rng.int(1500, 3200),
        links: ["/size-guide", "/collections/running-shoes", postPath(POSTS[1]![0])],
        sitemap: true,
        images: rng.int(3, 6),
        structured: ["Article", "FAQPage"],
      }),
    );
  }
  specs.get("/")!.links.push(...GUIDES.slice(0, 3).map(([s]) => `/guides/${s}`));

  /* ── info pages ── */
  for (const [path, title] of INFO) {
    const serverError = path === "/stores/locator" && count("serverError", level) > 0;
    add(
      base({
        path,
        kind: "info",
        status: serverError ? 500 : 200,
        title: NORMAL_TITLE(title, brand),
        meta: NORMAL_META(`${title} — everything you need to know about shopping and running with ${brand}.`),
        words: rng.int(380, 900),
        links:
          path === "/sustainability"
            ? ["/collections/recycled", postPath("how-we-recycle-foam"), postPath("sustainable-materials-report")]
            : path === "/about" || path === "/contact"
              ? ["/stores/locator"]
              : path === "/size-guide"
                ? ["/guides/how-to-choose-running-shoes"]
                : [],
        sitemap: true,
        images: 2,
        structured: path === "/faq" ? ["FAQPage"] : path === "/about" ? ["Organization"] : [],
      }),
    );
  }
  specs.get("/size-guide")!.links.push("/pages/size-chart-print");

  /* ── print page: missing title, no outgoing links, thin ── */
  add(
    base({
      path: "/pages/size-chart-print",
      kind: "print",
      title: "",
      meta: NORMAL_META(`Printable ${brand} size chart for road and trail shoes.`),
      h1s: ["Size chart"],
      headingOrder: [1],
      words: 95,
      links: [],
      sitemap: false,
      images: 1,
    }),
  );

  /* ── landing pages only in the sitemap (orphans) ── */
  const landings = [
    ["/landing/spring-launch", "Spring Launch: Cloudrun 4"],
    ["/landing/trail-series", "Trail Series Sign-up"],
  ];
  landings.slice(0, count("orphans", level)).forEach(([path, title]) =>
    add(
      base({
        path: path!,
        kind: "landing",
        title: NORMAL_TITLE(title!, brand),
        meta: NORMAL_META(`${title} — limited-time offer from ${brand}.`),
        words: rng.int(240, 420),
        links: ["/collections/running-shoes"],
        sitemap: true,
        images: 3,
      }),
    ),
  );

  /* ── redirects: chain /shop → /collections → /collections/running-shoes, single 301, optional loop ── */
  add(base({ path: "/shop", kind: "redirect", status: 301, redirectTo: "/collections", title: "", meta: "", words: 0, links: [], sitemap: false, images: 0, h1s: [], headingOrder: [] }));
  add(base({ path: "/collections", kind: "redirect", status: 301, redirectTo: "/collections/running-shoes", title: "", meta: "", words: 0, links: [], sitemap: false, images: 0, h1s: [], headingOrder: [] }));
  specs.get("/")!.links.push("/shop");
  add(base({ path: "/collections/womens", kind: "redirect", status: 301, redirectTo: "/collections/womens-running-shoes", title: "", meta: "", words: 0, links: [], sitemap: false, images: 0, h1s: [], headingOrder: [] }));
  specs.get(postPath("best-running-shoes"))!.links.push("/collections/womens");
  if (count("extraChain", level)) {
    add(base({ path: "/sale", kind: "redirect", status: 301, redirectTo: "/collections/sale-2025", title: "", meta: "", words: 0, links: [], sitemap: false, images: 0, h1s: [], headingOrder: [] }));
    add(base({ path: "/collections/sale-2025", kind: "redirect", status: 301, redirectTo: "/collections/sale", title: "", meta: "", words: 0, links: [], sitemap: false, images: 0, h1s: [], headingOrder: [] }));
    specs.get("/pages/black-friday")!.links.push("/sale");
  }
  if (count("redirectLoop", level)) {
    add(base({ path: "/promo", kind: "redirect", status: 301, redirectTo: "/pages/promo", title: "", meta: "", words: 0, links: [], sitemap: false, images: 0, h1s: [], headingOrder: [] }));
    add(base({ path: "/pages/promo", kind: "redirect", status: 301, redirectTo: "/promo", title: "", meta: "", words: 0, links: [], sitemap: false, images: 0, h1s: [], headingOrder: [] }));
    specs.get("/")!.links.push("/promo");
  }

  /* ── broken internal links (404 targets) ── */
  const brokenTargets = ["/blog/old-marathon-guide", "/collections/summer-sale-2025"];
  const brokenSources = POSTS.slice(4, 4 + count("brokenLinkSources", level)).map(([s]) => postPath(s));
  brokenSources.forEach((src, i) => specs.get(src)!.links.push(brokenTargets[i % (level >= 2 ? 1 : 2)]!));
  for (const t of new Set(brokenSources.map((_, i) => brokenTargets[i % (level >= 2 ? 1 : 2)]!))) {
    add(base({ path: t, kind: "error", status: 404, title: "", meta: "", words: 0, links: [], sitemap: false, images: 0, h1s: [], headingOrder: [] }));
  }

  /* ── canonical conflict (HTML vs Link header) on the sale collection ── */
  const sale = specs.get("/collections/sale")!;
  sale.canonical = `${origin}/collections/sale`;
  sale.headerCanonical = `${origin}/collections/deals`;

  /* ── on-page defect families (deterministic candidate order) ── */
  const all = [...specs.values()];
  const byKind = (...kinds: Kind[]) => all.filter((x) => kinds.includes(x.kind) && x.status === 200);
  const blogs = byKind("blog", "guide");
  const products = byKind("product");
  const collections = byKind("collection");
  const infos = byKind("info");
  const pick = <T,>(list: T[], n: number, offset = 0) => list.slice(offset, offset + n);

  for (const s of pick([...blogs, ...products, ...collections, ...infos], count("missingMeta", level))) s.meta = "";
  for (const s of pick(products.filter((x) => x.meta), count("metaTooLong", level)))
    s.meta = `${s.meta} Available in six colorways and half sizes, with a 60-day trial, free exchanges and carbon-neutral shipping on every order.`;
  for (const s of pick(collections.filter((x) => x.meta), count("metaTooShort", level))) s.meta = `Shop ${s.title.split(" — ")[0]} online.`;
  for (const s of pick(blogs, count("titleTooLong", level), 10)) s.title = `${s.title.split(" | ")[0]} — Everything You Need to Know Before Your Next Run | ${brand}`;
  for (const s of pick(infos, count("titleTooShort", level), 6)) s.title = s.title.split(" ")[0]!.slice(0, 8);
  for (const s of pick([...collections, ...infos], count("missingH1", level), 4)) s.h1s = [];
  for (const s of pick([...products, ...blogs], count("multipleH1", level), 2)) s.h1s = [s.h1s[0] ?? "Product", "Reviews"];
  for (const s of pick(blogs, count("headingSkip", level), 2)) s.headingOrder = [1, 3, 3, 2, 4];
  for (const s of pick([...products, ...collections, ...blogs, ...byKind("archive")], count("missingAlt", level)))
    s.missingAlt = Math.min(s.images, 1 + ((s.path.length + level) % 3));
  for (const s of pick([...infos, ...byKind("landing"), ...collections], count("thin", level), 3)) s.words = 90 + (s.path.length % 40);
  const slowCandidates = ["/stores/locator", "/collections/sale", "/collections/running-shoes", "/collections/trail", "/", "/blog", "/collections/under-100", "/faq", "/collections/max-cushion"];
  for (const p of pick(slowCandidates, count("slow", level))) {
    const s = specs.get(p);
    if (s) s.slowMs = 1600 + ((p.length * 97 + level * 131) % 1400);
  }

  return { pages: toCrawled(specs, input.auditId, origin, rng), startUrl: `${origin}/` };
}

/** BFS from the start URL over internal links (redirect targets keep the redirecting depth). */
function toCrawled(specs: Map<string, Spec>, auditId: string, origin: string, rng: Rng): CrawledPageResult[] {
  const depth = new Map<string, number>([["/", 0]]);
  const queue = ["/"];
  while (queue.length) {
    const path = queue.shift()!;
    const s = specs.get(path);
    if (!s) continue;
    const d = depth.get(path)!;
    if (s.redirectTo) {
      if (!depth.has(s.redirectTo)) {
        depth.set(s.redirectTo, d);
        queue.push(s.redirectTo);
      }
      continue;
    }
    if (s.status >= 400) continue;
    const outgoing = s.kind === "print" ? [] : [...NAV, ...s.links, ...FOOTER];
    for (const l of outgoing) {
      if (!specs.has(l) || depth.has(l)) continue;
      depth.set(l, d + 1);
      queue.push(l);
    }
  }
  const crawled = [...specs.values()].filter((s) => depth.has(s.path) || s.sitemap);
  const url = (p: string) => `${origin}${p}`;
  return crawled.map((s) => {
    const u = url(s.path);
    const isOk = s.status >= 200 && s.status < 300;
    const internal = s.kind === "print" || !isOk ? [] : [...new Set([...NAV, ...s.links, ...FOOTER])].filter((l) => l !== s.path);
    const links: PageLink[] = isOk
      ? [
          ...internal.map((l) => ({ targetUrl: url(l), anchor: specs.get(l)?.title.split(" | ")[0]?.slice(0, 80) || l, isInternal: true, isNofollow: false })),
          ...s.external.map((e) => ({ targetUrl: e, anchor: new URL(e).hostname.replace(/^www\./, ""), isInternal: false, isNofollow: e.includes("instagram") })),
        ]
      : [];
    const images = isOk
      ? Array.from({ length: s.images }, (_, i) => ({
          src: `${origin}/cdn/images${s.path.replace(/[?=]/g, "-")}-${i + 1}.webp`,
          alt: i < s.missingAlt ? null : `${s.h1s[0] ?? s.title.split(" | ")[0]} image ${i + 1}`,
        }))
      : [];
    const headingOrder = isOk ? (s.h1s.length ? [1, ...s.headingOrder.filter((h) => h !== 1)] : s.headingOrder.filter((h) => h !== 1)) : [];
    const h = (n: number) => headingOrder.filter((x) => x === n).length + (n === 1 ? Math.max(0, s.h1s.length - 1) : 0);
    const words = isOk ? s.words : 0;
    const bytes = isOk ? 28_000 + words * 9 + s.images * 380 : 0;
    const response = s.slowMs ?? (s.status >= 500 ? 2400 : 140 + ((s.path.length * 37) % 420) + rng.int(0, 60));
    const canonical = isOk ? (s.canonical ?? u) : null;
    return {
      id: deterministicAuditRowId(auditId, u),
      url: u,
      statusCode: s.status,
      fetchClass: "ok",
      redirectUrl: s.redirectTo ? url(s.redirectTo) : null,
      contentType: s.status >= 300 && s.status < 400 ? null : "text/html; charset=utf-8",
      title: isOk ? s.title : "",
      metaDescription: isOk ? s.meta : "",
      canonicalUrl: canonical,
      robotsMeta: s.noindex ? "noindex, follow" : null,
      xRobotsTag: null,
      headerCanonicalUrl: s.headerCanonical ?? null,
      ogTitle: isOk && s.title ? s.title : null,
      ogDescription: isOk && s.meta ? s.meta : null,
      ogImage: isOk ? `${origin}/cdn/og${s.path === "/" ? "/home" : s.path.replace(/[?=]/g, "-")}.jpg` : null,
      h1s: isOk ? s.h1s : [],
      h1Count: isOk ? s.h1s.length : 0,
      h2Count: h(2),
      h3Count: h(3),
      h4Count: h(4),
      h5Count: 0,
      h6Count: 0,
      headingOrder,
      wordCount: words,
      contentHash: isOk ? (s.hash ?? sha256Hex(`page|${s.path}`)) : null,
      isHtml: isOk,
      htmlBytes: bytes,
      rateLimited: false,
      imagesTotal: images.length,
      imagesMissingAlt: images.filter((i) => !i.alt).length,
      images,
      links,
      hasStructuredData: isOk && s.structured.length > 0,
      structuredDataTypes: isOk ? s.structured : [],
      hreflangTags: isOk && s.sitemap ? ["en-us", "en-gb", "x-default"] : [],
      lang: isOk ? "en" : null,
      isIndexable: isOk && !s.noindex,
      responseTimeMs: response,
      crawlDepth: depth.get(s.path) ?? null,
      inSitemap: s.sitemap,
    } satisfies CrawledPageResult;
  });
}
