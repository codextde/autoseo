/**
 * Static libraries for the demo project ("Demo · Stridewell"). All brands are FICTIONAL —
 * the generator fabricates sentiment and head-to-head claims, so no real brand may appear as
 * the own brand, a competitor or an untracked brand. Real, generic publishers/retailers only
 * appear as cited sources, stores or retail advertisers with neutral copy.
 */
import type { SourceContentType } from "@/server/db/schema";

export const DEMO_ENGINES = ["chatgpt", "perplexity", "ai_overview", "gemini", "claude"] as const;
export type DemoEngine = (typeof DEMO_ENGINES)[number];

export const ENGINE_MODELS: Record<DemoEngine, string> = {
  chatgpt: "gpt-5",
  perplexity: "sonar-pro",
  ai_overview: "google-ai-overview",
  gemini: "gemini-2.5-pro",
  claude: "claude-sonnet-4-5",
};

export const ENGINE_COST: Record<DemoEngine, number> = {
  chatgpt: 0.004,
  perplexity: 0.005,
  ai_overview: 0.002,
  gemini: 0.003,
  claude: 0.006,
};

/** Citation count range per engine. */
export const ENGINE_CITATIONS: Record<DemoEngine, [number, number]> = {
  chatgpt: [2, 6],
  perplexity: [3, 6],
  ai_overview: [3, 8],
  gemini: [2, 5],
  claude: [0, 3],
};

/** Engine preference multipliers per source content type. */
export const ENGINE_SOURCE_PREFS: Record<DemoEngine, Partial<Record<SourceContentType, number>>> = {
  chatgpt: { reference: 2.5, news: 2, article: 1.5, "buying-guide": 1.3 },
  perplexity: { ugc: 2.6, video: 2, test: 1.3, forum: 1.8 },
  ai_overview: { listicle: 2.2, retail: 2, "buying-guide": 1.5 },
  gemini: { video: 1.9, listicle: 1.3, reference: 1.3 },
  claude: { reference: 1.6, article: 1.5, test: 1.2 },
};

export type Topic = "Running" | "Trail" | "Sustainability" | "Comparisons" | "Deals" | "Brand" | "Gear";

export const TAGS: { name: Topic; color: string }[] = [
  { name: "Running", color: "#16a34a" },
  { name: "Trail", color: "#a16207" },
  { name: "Sustainability", color: "#0d9488" },
  { name: "Comparisons", color: "#7c3aed" },
  { name: "Deals", color: "#e11d48" },
  { name: "Brand", color: "#0f172a" },
  { name: "Gear", color: "#2563eb" },
];

export type Situation =
  | "Best for beginners"
  | "Best for long runs"
  | "Best budget"
  | "Most recommended"
  | "Top pick"
  | "Best for trail"
  | "Best for wide feet"
  | "Most sustainable";

export const SITUATION_PHRASE: Record<Situation, string> = {
  "Best for beginners": "the best choice for beginners",
  "Best for long runs": "the best choice for long runs",
  "Best budget": "the best budget pick",
  "Most recommended": "the most recommended option overall",
  "Top pick": "the top pick",
  "Best for trail": "the best choice for trail running",
  "Best for wide feet": "the best choice for wide feet",
  "Most sustainable": "the most sustainable option",
};

/* ───────────────────────────── Themes & attributes ───────────────────────────── */

export const THEMES: Record<string, string[]> = {
  "Comfort & Fit": ["Cushioning", "Fit & sizing", "Breathability"],
  Performance: ["Durability", "Grip & traction", "Energy return", "Weight"],
  Sustainability: ["Recycled materials", "Carbon footprint", "Ethical production"],
  "Price & Service": ["Value for money", "Returns & service", "Availability"],
  Design: ["Style", "Color options"],
};

export const ATTRIBUTE_THEME: Record<string, string> = Object.fromEntries(
  Object.entries(THEMES).flatMap(([theme, attrs]) => attrs.map((a) => [a, theme])),
);
export const ATTRIBUTES = Object.keys(ATTRIBUTE_THEME);

export type Polarity = "praise" | "neutral" | "criticism";

/** 3 quote templates per attribute × polarity. `{brand}` is replaced with the brand name. */
export const QUOTES: Record<string, Record<Polarity, [string, string, string]>> = {
  Cushioning: {
    praise: [
      "{brand}'s midsole cushioning stays plush even after 300 miles.",
      "Runners consistently praise {brand} for soft, protective cushioning on long runs.",
      "{brand} delivers some of the most comfortable cushioning in its class.",
    ],
    neutral: [
      "{brand} offers moderate cushioning that suits most daily runs.",
      "{brand}'s cushioning is balanced rather than maximal.",
      "Cushioning on {brand} models is comparable to other mainstream trainers.",
    ],
    criticism: [
      "Some testers find {brand}'s cushioning too firm for recovery runs.",
      "{brand}'s foam can feel flat after a few hundred miles.",
      "{brand} lacks the cushioning heavier runners often need.",
    ],
  },
  "Fit & sizing": {
    praise: [
      "{brand} fits true to size with a secure, locked-in heel.",
      "{brand} offers wide and extra-wide versions that runners love.",
      "Reviewers highlight {brand}'s accommodating toe box.",
    ],
    neutral: [
      "{brand} fits fairly standard, so most runners can order their usual size.",
      "{brand}'s fit is average — trying before buying is advised.",
      "{brand} sizing is consistent across most of its models.",
    ],
    criticism: [
      "{brand} tends to run half a size small according to many buyers.",
      "{brand}'s narrow midfoot can feel tight for wider feet.",
      "Several reviews mention inconsistent sizing across {brand} models.",
    ],
  },
  Breathability: {
    praise: [
      "{brand}'s engineered mesh keeps feet cool on hot days.",
      "{brand} apparel is praised for excellent breathability.",
      "Runners say {brand} uppers breathe better than most rivals.",
    ],
    neutral: [
      "{brand}'s upper offers average ventilation.",
      "Breathability on {brand} is fine for most conditions.",
      "{brand} balances breathability with a bit of weather protection.",
    ],
    criticism: [
      "{brand}'s thicker upper can get warm in summer.",
      "Some runners report sweaty feet in {brand} shoes.",
      "{brand} apparel traps heat on humid runs.",
    ],
  },
  Durability: {
    praise: [
      "{brand} outsoles show minimal wear even past 500 miles.",
      "{brand} is known for shoes that last longer than average.",
      "Testers note {brand}'s upper holds up well to heavy use.",
    ],
    neutral: [
      "{brand}'s durability is in line with other trainers at this price.",
      "Expect around 400–500 miles from a typical {brand} shoe.",
      "{brand} durability is average for the category.",
    ],
    criticism: [
      "{brand}'s outsole rubber wears down faster than expected.",
      "Several owners report {brand} uppers tearing near the toe.",
      "{brand} shoes lose their bounce sooner than competitors.",
    ],
  },
  "Grip & traction": {
    praise: [
      "{brand}'s lugs grip confidently on wet rock and mud.",
      "{brand} offers some of the best traction on technical trails.",
      "Trail runners trust {brand} for sure-footed descents.",
    ],
    neutral: [
      "{brand}'s grip is adequate for groomed trails.",
      "{brand} traction is fine on dry surfaces.",
      "{brand} offers standard outsole grip for mixed terrain.",
    ],
    criticism: [
      "{brand}'s outsole can feel slippery on wet pavement.",
      "{brand} lacks the lug depth needed for deep mud.",
      "Some testers found {brand}'s traction unreliable on wet roots.",
    ],
  },
  "Energy return": {
    praise: [
      "{brand}'s foam feels bouncy and responsive at tempo pace.",
      "{brand} delivers excellent energy return for race day.",
      "Runners describe {brand} as snappy and fast.",
    ],
    neutral: [
      "{brand}'s ride is responsive enough for most workouts.",
      "{brand} offers moderate energy return.",
      "{brand} feels neither especially bouncy nor dead.",
    ],
    criticism: [
      "{brand}'s ride feels flat compared to newer super foams.",
      "{brand} lacks pop for faster sessions.",
      "Some testers describe {brand} as sluggish at speed.",
    ],
  },
  Weight: {
    praise: [
      "{brand} is impressively light for the protection it offers.",
      "{brand}'s lightweight build makes it great for racing.",
      "Reviewers love how featherlight {brand} feels on foot.",
    ],
    neutral: [
      "{brand} sits in the middle of the pack on weight.",
      "{brand}'s weight is typical for a daily trainer.",
      "{brand} is neither heavy nor particularly light.",
    ],
    criticism: [
      "{brand} runs on the heavy side for a neutral trainer.",
      "{brand}'s extra protection comes with a weight penalty.",
      "Some runners find {brand} clunky at faster paces.",
    ],
  },
  "Recycled materials": {
    praise: [
      "{brand} uses recycled polyester in most of its uppers.",
      "{brand} leads the category in recycled content.",
      "{brand} is praised for transparent use of recycled materials.",
    ],
    neutral: [
      "{brand} uses some recycled materials in selected lines.",
      "{brand}'s recycled content is in line with industry averages.",
      "{brand} is gradually adding recycled materials to its range.",
    ],
    criticism: [
      "{brand} still relies heavily on virgin plastics.",
      "{brand}'s recycled claims are vague and hard to verify.",
      "Critics say {brand} lags behind rivals on recycled content.",
    ],
  },
  "Carbon footprint": {
    praise: [
      "{brand} publishes carbon labels for each shoe.",
      "{brand} has cut its product carbon footprint significantly.",
      "{brand} is recognised for ambitious climate targets.",
    ],
    neutral: [
      "{brand} reports its emissions but targets are modest.",
      "{brand}'s carbon footprint is typical for the industry.",
      "{brand} has published a climate plan without detailed milestones.",
    ],
    criticism: [
      "{brand} has been criticised for a lack of emissions transparency.",
      "{brand}'s carbon footprint remains high compared to peers.",
      "{brand} relies on offsets rather than real reductions.",
    ],
  },
  "Ethical production": {
    praise: [
      "{brand} is praised for fair labour audits across its suppliers.",
      "{brand} publishes a full list of its factories.",
      "{brand} is often cited for ethical manufacturing.",
    ],
    neutral: [
      "{brand} has standard supplier codes of conduct.",
      "{brand}'s supply chain transparency is average.",
      "{brand} shares limited information about its factories.",
    ],
    criticism: [
      "{brand} has faced questions about supplier working conditions.",
      "{brand} discloses little about where its products are made.",
      "Watchdogs rate {brand} poorly on supply chain transparency.",
    ],
  },
  "Value for money": {
    praise: [
      "{brand} offers excellent value for money.",
      "{brand} delivers premium features at a mid-range price.",
      "Budget-conscious runners love {brand}'s pricing.",
    ],
    neutral: [
      "{brand} is priced in line with comparable models.",
      "{brand}'s pricing is fair but not a bargain.",
      "{brand} sits in the mid-price segment.",
    ],
    criticism: [
      "{brand} is expensive compared to similar shoes.",
      "Many reviewers feel {brand} is overpriced for what you get.",
      "{brand}'s premium price is hard to justify for casual runners.",
    ],
  },
  "Returns & service": {
    praise: [
      "{brand}'s 60-day trial and free returns make buying risk-free.",
      "Customers praise {brand}'s helpful support team.",
      "{brand} makes exchanges quick and painless.",
    ],
    neutral: [
      "{brand} offers standard 30-day returns.",
      "{brand}'s customer service is adequate.",
      "{brand} handles returns through its retail partners.",
    ],
    criticism: [
      "{brand}'s returns process is slow according to customers.",
      "Some buyers report poor responses from {brand} support.",
      "{brand} charges for return shipping in many markets.",
    ],
  },
  Availability: {
    praise: [
      "{brand} is easy to find at most major retailers.",
      "{brand} keeps popular sizes well stocked.",
      "{brand} ships quickly to most countries.",
    ],
    neutral: [
      "{brand} is available online and at selected stores.",
      "{brand}'s availability varies by region.",
      "{brand} is mostly sold through its own web store.",
    ],
    criticism: [
      "{brand} shoes frequently sell out in popular sizes.",
      "{brand} is hard to find in physical stores.",
      "{brand}'s limited stock makes it hard to try before buying.",
    ],
  },
  Style: {
    praise: [
      "{brand}'s clean design looks good on and off the run.",
      "{brand} is praised for modern, stylish colourways.",
      "Reviewers call {brand} one of the best-looking running brands.",
    ],
    neutral: [
      "{brand} keeps a conventional running-shoe look.",
      "{brand}'s design is understated.",
      "{brand} styling is functional rather than fashionable.",
    ],
    criticism: [
      "{brand}'s bulky look isn't for everyone.",
      "Some runners find {brand}'s design dated.",
      "{brand}'s aesthetics lag behind lifestyle-focused brands.",
    ],
  },
  "Color options": {
    praise: [
      "{brand} offers a huge range of colourways.",
      "{brand} regularly drops bright limited-edition colours.",
      "Runners love {brand}'s bold colour options.",
    ],
    neutral: [
      "{brand} offers a handful of standard colourways.",
      "{brand}'s colour range is typical for the category.",
      "{brand} sticks to classic colours.",
    ],
    criticism: [
      "{brand} offers few colour options in wide sizes.",
      "{brand}'s colourways are limited in many markets.",
      "Some buyers wish {brand} offered more colour choices.",
    ],
  },
};

/** Head-to-head claim templates (winner-first phrasing). */
export const H2H_CLAIMS: { attribute: string; win: string }[] = [
  { attribute: "Cushioning", win: "{W} offers softer cushioning than {L} for long runs" },
  { attribute: "Durability", win: "{W} holds up better than {L} after 500+ miles" },
  { attribute: "Value for money", win: "{W} gives more value for the price than {L}" },
  { attribute: "Energy return", win: "{W} feels more responsive than {L} at tempo pace" },
  { attribute: "Fit & sizing", win: "{W} fits more true to size than {L}" },
  { attribute: "Grip & traction", win: "{W} has better grip on wet surfaces than {L}" },
  { attribute: "Recycled materials", win: "{W} uses more recycled materials than {L}" },
  { attribute: "Weight", win: "{W} is lighter than {L} in comparable models" },
  { attribute: "Returns & service", win: "{W} has an easier returns process than {L}" },
];

/* ───────────────────────────────── Brands ───────────────────────────────── */

export type BrandKind = "own" | "competitor" | "untracked";

export type BrandDef = {
  key: string;
  name: string;
  domain: string | null;
  color: string;
  kind: BrandKind;
  /** competitor only: part of "My List" */
  tracked?: boolean;
  source?: "manual" | "auto";
  aliases: string[];
  /** Base probability to be named in a regular "best …" answer at t=0 and t=1 */
  vis: [number, number];
  /** Ordering strength (higher = named earlier) at t=0 and t=1 */
  strength: [number, number];
  /** Mention sentiment 0–100 at t=0 and t=1 */
  sentiment: [number, number];
  engine: Partial<Record<DemoEngine, number>>;
  topic: Partial<Record<Topic, number>>;
  /** P(own domain cited | brand named) */
  citeRate: number;
  praise: string[];
  criticism: string[];
  /** praise / neutral / criticism shares */
  mix: [number, number, number];
  situations: Partial<Record<Situation, number>>;
  /** Generic, brand-level reason used in brand lists */
  tagline: string;
};

export const BRANDS: BrandDef[] = [
  {
    key: "own",
    name: "Stridewell",
    domain: "stridewell.example",
    color: "#16a34a",
    kind: "own",
    aliases: ["Stridewell Running"],
    vis: [0.33, 0.66],
    strength: [0.5, 0.86],
    sentiment: [70, 76],
    engine: { perplexity: 1.25, chatgpt: 1.05, gemini: 1.0, claude: 0.95, ai_overview: 0.68 },
    topic: { Sustainability: 1.45, Running: 1.05, Trail: 0.75, Deals: 0.8, Gear: 0.9 },
    citeRate: 0.4,
    praise: ["Cushioning", "Recycled materials", "Returns & service"],
    criticism: ["Value for money", "Durability", "Availability"],
    mix: [0.63, 0.27, 0.1],
    situations: { "Most sustainable": 0.9, "Best for long runs": 0.5, "Best for beginners": 0.4, "Best for wide feet": 0.4, "Top pick": 0.2 },
    tagline: "comfortable, sustainably made trainers with a generous trial period",
  },
  {
    key: "velocita",
    name: "Velocita",
    domain: "velocita.example",
    color: "#2563eb",
    kind: "competitor",
    tracked: true,
    source: "manual",
    aliases: ["Velocita Sports"],
    vis: [0.9, 0.82],
    strength: [1.0, 0.9],
    sentiment: [80, 79],
    engine: { ai_overview: 1.15, chatgpt: 1.05, perplexity: 0.95, gemini: 1.0, claude: 1.0 },
    topic: { Trail: 0.8, Sustainability: 0.7, Deals: 0.8, Gear: 0.9 },
    citeRate: 0.25,
    praise: ["Energy return", "Durability", "Style"],
    criticism: ["Value for money", "Carbon footprint"],
    mix: [0.7, 0.22, 0.08],
    situations: { "Most recommended": 0.5, "Top pick": 0.4, "Best for long runs": 0.5 },
    tagline: "a category leader with fast, well-reviewed road shoes",
  },
  {
    key: "kinetiq",
    name: "Kinetiq",
    domain: "kinetiq.example",
    color: "#9333ea",
    kind: "competitor",
    tracked: true,
    source: "manual",
    aliases: [],
    vis: [0.2, 0.5],
    strength: [0.5, 0.72],
    sentiment: [70, 74],
    engine: { gemini: 1.2, chatgpt: 1.1, ai_overview: 0.9, perplexity: 0.95, claude: 0.9 },
    topic: { Running: 1.2, Trail: 0.6, Sustainability: 0.6 },
    citeRate: 0.16,
    praise: ["Energy return", "Weight", "Color options"],
    criticism: ["Durability", "Fit & sizing"],
    mix: [0.58, 0.3, 0.12],
    situations: { "Top pick": 0.2 },
    tagline: "lightweight, bouncy racers that are gaining popularity fast",
  },
  {
    key: "northpeak",
    name: "Northpeak",
    domain: "northpeak.example",
    color: "#b45309",
    kind: "competitor",
    tracked: true,
    source: "manual",
    aliases: ["Northpeak Outdoor"],
    vis: [0.24, 0.25],
    strength: [0.55, 0.57],
    sentiment: [76, 76],
    engine: { perplexity: 1.1, claude: 1.1, ai_overview: 0.95 },
    topic: { Trail: 2.8, Running: 0.6, Gear: 1.3, Deals: 0.6 },
    citeRate: 0.2,
    praise: ["Grip & traction", "Durability"],
    criticism: ["Weight", "Style"],
    mix: [0.66, 0.24, 0.1],
    situations: { "Best for trail": 1.0 },
    tagline: "rugged trail shoes with class-leading grip",
  },
  {
    key: "aerion",
    name: "Aerion",
    domain: "aerion.example",
    color: "#0891b2",
    kind: "competitor",
    tracked: true,
    source: "manual",
    aliases: [],
    vis: [0.36, 0.36],
    strength: [0.6, 0.6],
    sentiment: [74, 73],
    engine: { chatgpt: 1.1, ai_overview: 1.05, claude: 0.9 },
    topic: { Running: 1.1, Gear: 1.2, Trail: 0.5 },
    citeRate: 0.14,
    praise: ["Breathability", "Weight", "Fit & sizing"],
    criticism: ["Durability", "Returns & service"],
    mix: [0.6, 0.28, 0.12],
    situations: { "Best for beginners": 0.5, "Best for wide feet": 0.4, "Best budget": 0.3 },
    tagline: "breathable, beginner-friendly trainers with roomy fits",
  },
  {
    key: "pacefield",
    name: "Pacefield",
    domain: "pacefield.example",
    color: "#e11d48",
    kind: "competitor",
    tracked: true,
    source: "manual",
    aliases: [],
    vis: [0.2, 0.21],
    strength: [0.45, 0.45],
    sentiment: [58, 58],
    engine: { ai_overview: 1.3, gemini: 1.1, claude: 0.8 },
    topic: { Deals: 3.0, Running: 0.9, Sustainability: 0.4 },
    citeRate: 0.12,
    praise: ["Value for money", "Availability"],
    criticism: ["Durability", "Energy return", "Cushioning"],
    mix: [0.42, 0.33, 0.25],
    situations: { "Best budget": 1.3, "Best for beginners": 0.2 },
    tagline: "budget-friendly basics that cover everyday running",
  },
  {
    key: "solestar",
    name: "Solestar",
    domain: "solestar.example",
    color: "#ca8a04",
    kind: "competitor",
    tracked: true,
    source: "manual",
    aliases: [],
    vis: [0.2, 0.2],
    strength: [0.42, 0.42],
    sentiment: [66, 66],
    engine: { gemini: 1.15, perplexity: 0.9 },
    topic: { Running: 1.0, Gear: 1.2, Trail: 0.4 },
    citeRate: 0.12,
    praise: ["Style", "Color options"],
    criticism: ["Fit & sizing", "Grip & traction"],
    mix: [0.5, 0.32, 0.18],
    situations: { "Best for wide feet": 0.7, "Best budget": 0.3 },
    tagline: "stylish trainers with standout colourways",
  },
  {
    key: "trailborn",
    name: "Trailborn",
    domain: "trailborn.example",
    color: "#4d7c0f",
    kind: "competitor",
    tracked: false,
    source: "auto",
    aliases: [],
    vis: [0.1, 0.11],
    strength: [0.4, 0.42],
    sentiment: [71, 71],
    engine: { perplexity: 1.2, claude: 1.1, ai_overview: 0.8 },
    topic: { Trail: 3.2, Running: 0.4, Gear: 1.2 },
    citeRate: 0.12,
    praise: ["Grip & traction", "Ethical production"],
    criticism: ["Availability", "Weight"],
    mix: [0.6, 0.28, 0.12],
    situations: { "Best for trail": 0.9 },
    tagline: "small-batch trail shoes built for ultra distances",
  },
  {
    key: "lumaro",
    name: "Lumaro",
    domain: "lumaro.example",
    color: "#0f766e",
    kind: "competitor",
    tracked: false,
    source: "auto",
    aliases: [],
    vis: [0.1, 0.11],
    strength: [0.35, 0.38],
    sentiment: [63, 64],
    engine: { claude: 1.2, chatgpt: 1.05, ai_overview: 0.8 },
    topic: { Sustainability: 3.5, Running: 0.6, Gear: 1.1 },
    citeRate: 0.12,
    praise: ["Recycled materials", "Carbon footprint"],
    criticism: ["Value for money", "Availability"],
    mix: [0.52, 0.3, 0.18],
    situations: { "Most sustainable": 1.0 },
    tagline: "a sustainability-first label using plant-based materials",
  },
  {
    key: "brisk",
    name: "Brisk & Co",
    domain: null,
    color: "#64748b",
    kind: "untracked",
    aliases: [],
    vis: [0.07, 0.1],
    strength: [0.3, 0.33],
    sentiment: [68, 69],
    engine: { chatgpt: 1.2, gemini: 1.1 },
    topic: { Gear: 2.2, Running: 0.9 },
    citeRate: 0,
    praise: ["Style", "Breathability"],
    criticism: ["Durability"],
    mix: [0.55, 0.33, 0.12],
    situations: {},
    tagline: "affordable running apparel with a fashion edge",
  },
  {
    key: "ridgeline",
    name: "Ridgeline Athletics",
    domain: null,
    color: "#78716c",
    kind: "untracked",
    aliases: [],
    vis: [0.05, 0.06],
    strength: [0.32, 0.32],
    sentiment: [70, 70],
    engine: { perplexity: 1.3 },
    topic: { Trail: 2.6, Running: 0.5 },
    citeRate: 0,
    praise: ["Grip & traction"],
    criticism: ["Weight"],
    mix: [0.55, 0.33, 0.12],
    situations: { "Best for trail": 0.5 },
    tagline: "technical mountain-running gear",
  },
  {
    key: "tempolabs",
    name: "Tempo Labs",
    domain: null,
    color: "#a8a29e",
    kind: "untracked",
    aliases: [],
    vis: [0.03, 0.07],
    strength: [0.3, 0.36],
    sentiment: [66, 68],
    engine: { gemini: 1.3, chatgpt: 1.1 },
    topic: { Running: 1.3 },
    citeRate: 0,
    praise: ["Energy return"],
    criticism: ["Value for money"],
    mix: [0.55, 0.33, 0.12],
    situations: {},
    tagline: "a newcomer focused on carbon-plated racers",
  },
  {
    key: "hollowpine",
    name: "Hollow Pine",
    domain: null,
    color: "#57534e",
    kind: "untracked",
    aliases: [],
    vis: [0.035, 0.04],
    strength: [0.28, 0.28],
    sentiment: [72, 72],
    engine: { claude: 1.3 },
    topic: { Sustainability: 2.4, Gear: 1.2 },
    citeRate: 0,
    praise: ["Ethical production", "Recycled materials"],
    criticism: ["Availability"],
    mix: [0.6, 0.3, 0.1],
    situations: { "Most sustainable": 0.4 },
    tagline: "an eco-conscious outdoor apparel maker",
  },
  {
    key: "quillrun",
    name: "Quillrun",
    domain: null,
    color: "#44403c",
    kind: "untracked",
    aliases: [],
    vis: [0.03, 0.035],
    strength: [0.27, 0.27],
    sentiment: [64, 64],
    engine: { perplexity: 1.2 },
    topic: { Running: 1.1 },
    citeRate: 0,
    praise: ["Weight"],
    criticism: ["Durability"],
    mix: [0.5, 0.35, 0.15],
    situations: {},
    tagline: "minimalist, lightweight road shoes",
  },
];

/* ───────────────────────────────── Products ───────────────────────────────── */

export type ProductCategory = "Running shoes" | "Trail shoes" | "Apparel" | "Accessories";

export type ProductDef = {
  brand: string;
  name: string;
  category: ProductCategory;
  price: number;
  rating: number;
  reviews: number;
  attributes: Record<string, string>;
};

export const PRODUCTS: ProductDef[] = [
  { brand: "own", name: "Stridewell Cloudline 4", category: "Running shoes", price: 160, rating: 4.6, reviews: 2140, attributes: { Drop: "8 mm", Weight: "255 g", Use: "Road", Cushioning: "Max" } },
  { brand: "own", name: "Stridewell Swift 2", category: "Running shoes", price: 135, rating: 4.4, reviews: 860, attributes: { Drop: "6 mm", Weight: "215 g", Use: "Road / tempo", Cushioning: "Medium" } },
  { brand: "own", name: "Stridewell Terra GTX", category: "Trail shoes", price: 175, rating: 4.3, reviews: 540, attributes: { Drop: "6 mm", Weight: "290 g", Use: "Trail", Waterproof: "Yes" } },
  { brand: "own", name: "Stridewell Loop Tee", category: "Apparel", price: 45, rating: 4.5, reviews: 1320, attributes: { Material: "100% recycled polyester", Fit: "Regular" } },
  { brand: "own", name: "Stridewell Stormshell Jacket", category: "Apparel", price: 120, rating: 4.4, reviews: 410, attributes: { Material: "Recycled nylon", Waterproof: "10k mm" } },
  { brand: "own", name: "Stridewell Cushion Crew Socks", category: "Accessories", price: 18, rating: 4.7, reviews: 2890, attributes: { Material: "Merino blend", Pack: "3 pairs" } },
  { brand: "velocita", name: "Velocita Glide 5", category: "Running shoes", price: 150, rating: 4.7, reviews: 5210, attributes: { Drop: "10 mm", Weight: "265 g", Use: "Road", Cushioning: "High" } },
  { brand: "velocita", name: "Velocita Rocket Pro", category: "Running shoes", price: 215, rating: 4.6, reviews: 1980, attributes: { Drop: "8 mm", Weight: "198 g", Use: "Racing", Plate: "Carbon" } },
  { brand: "velocita", name: "Velocita Summit Trail", category: "Trail shoes", price: 160, rating: 4.4, reviews: 870, attributes: { Drop: "6 mm", Weight: "300 g", Use: "Trail" } },
  { brand: "velocita", name: "Velocita Aero Run Shorts", category: "Apparel", price: 55, rating: 4.5, reviews: 1150, attributes: { Inseam: "5 in", Pockets: "3" } },
  { brand: "velocita", name: "Velocita Hydra Vest", category: "Accessories", price: 110, rating: 4.3, reviews: 390, attributes: { Capacity: "8 L", Flasks: "2 × 500 ml" } },
  { brand: "kinetiq", name: "Kinetiq Pulse 3", category: "Running shoes", price: 140, rating: 4.5, reviews: 1740, attributes: { Drop: "8 mm", Weight: "240 g", Use: "Road" } },
  { brand: "kinetiq", name: "Kinetiq Volt Racer", category: "Running shoes", price: 190, rating: 4.5, reviews: 720, attributes: { Drop: "6 mm", Weight: "205 g", Use: "Racing", Plate: "Nylon" } },
  { brand: "kinetiq", name: "Kinetiq Flux Tee", category: "Apparel", price: 40, rating: 4.3, reviews: 640, attributes: { Material: "Polyester mesh", Fit: "Slim" } },
  { brand: "kinetiq", name: "Kinetiq Rainrunner Jacket", category: "Apparel", price: 130, rating: 4.4, reviews: 330, attributes: { Waterproof: "15k mm", Weight: "180 g" } },
  { brand: "northpeak", name: "Northpeak Ridge Runner 6", category: "Trail shoes", price: 155, rating: 4.7, reviews: 2310, attributes: { Drop: "4 mm", Weight: "295 g", Lugs: "5 mm" } },
  { brand: "northpeak", name: "Northpeak Alpine GTX", category: "Trail shoes", price: 185, rating: 4.6, reviews: 940, attributes: { Drop: "6 mm", Weight: "320 g", Waterproof: "Yes" } },
  { brand: "northpeak", name: "Northpeak Trail Vest 12L", category: "Accessories", price: 125, rating: 4.6, reviews: 610, attributes: { Capacity: "12 L", Flasks: "2 × 500 ml" } },
  { brand: "northpeak", name: "Northpeak Road Hybrid", category: "Running shoes", price: 140, rating: 4.2, reviews: 380, attributes: { Drop: "6 mm", Use: "Road-to-trail" } },
  { brand: "aerion", name: "Aerion Breeze 2", category: "Running shoes", price: 125, rating: 4.4, reviews: 1480, attributes: { Drop: "8 mm", Weight: "230 g", Use: "Road" } },
  { brand: "aerion", name: "Aerion Wide Comfort", category: "Running shoes", price: 130, rating: 4.5, reviews: 990, attributes: { Widths: "Regular, Wide, Extra wide", Use: "Road" } },
  { brand: "aerion", name: "Aerion Airknit Shorts", category: "Apparel", price: 45, rating: 4.3, reviews: 520, attributes: { Inseam: "7 in", Pockets: "2" } },
  { brand: "aerion", name: "Aerion Blister Guard Socks", category: "Accessories", price: 16, rating: 4.6, reviews: 2020, attributes: { Pack: "2 pairs", Cushioning: "Targeted" } },
  { brand: "pacefield", name: "Pacefield Daily Trainer", category: "Running shoes", price: 79, rating: 4.1, reviews: 3870, attributes: { Drop: "10 mm", Weight: "275 g", Use: "Road" } },
  { brand: "pacefield", name: "Pacefield Sprint Lite", category: "Running shoes", price: 69, rating: 4.0, reviews: 1650, attributes: { Drop: "8 mm", Weight: "235 g", Use: "Road / gym" } },
  { brand: "pacefield", name: "Pacefield Trail Basic", category: "Trail shoes", price: 85, rating: 3.9, reviews: 720, attributes: { Drop: "8 mm", Use: "Light trail" } },
  { brand: "pacefield", name: "Pacefield Essential Tee", category: "Apparel", price: 22, rating: 4.1, reviews: 2400, attributes: { Material: "Polyester", Fit: "Regular" } },
  { brand: "solestar", name: "Solestar Nova", category: "Running shoes", price: 115, rating: 4.2, reviews: 880, attributes: { Drop: "8 mm", Use: "Road", Colors: "14" } },
  { brand: "solestar", name: "Solestar Wide Fit Plus", category: "Running shoes", price: 120, rating: 4.3, reviews: 610, attributes: { Widths: "Wide, Extra wide", Use: "Road" } },
  { brand: "solestar", name: "Solestar Glow Jacket", category: "Apparel", price: 95, rating: 4.2, reviews: 300, attributes: { Reflective: "360°", Water: "Resistant" } },
  { brand: "trailborn", name: "Trailborn Scree Pro", category: "Trail shoes", price: 165, rating: 4.6, reviews: 420, attributes: { Drop: "4 mm", Lugs: "6 mm", Use: "Technical trail" } },
  { brand: "trailborn", name: "Trailborn Mudline", category: "Trail shoes", price: 150, rating: 4.5, reviews: 310, attributes: { Drop: "6 mm", Lugs: "7 mm", Use: "Mud" } },
  { brand: "trailborn", name: "Trailborn Ultra Vest", category: "Accessories", price: 140, rating: 4.5, reviews: 180, attributes: { Capacity: "10 L", Use: "Ultra" } },
  { brand: "lumaro", name: "Lumaro Re:Run", category: "Running shoes", price: 130, rating: 4.1, reviews: 520, attributes: { Material: "Plant-based foam", Use: "Road" } },
  { brand: "lumaro", name: "Lumaro Hemp Tee", category: "Apparel", price: 38, rating: 4.3, reviews: 450, attributes: { Material: "Hemp / organic cotton" } },
  { brand: "lumaro", name: "Lumaro Eco Crew Socks", category: "Accessories", price: 15, rating: 4.4, reviews: 700, attributes: { Material: "Recycled cotton" } },
  { brand: "brisk", name: "Brisk & Co Runner Shorts", category: "Apparel", price: 35, rating: 4.2, reviews: 940, attributes: { Inseam: "5 in", Pockets: "2" } },
  { brand: "ridgeline", name: "Ridgeline Athletics Crag Trail", category: "Trail shoes", price: 145, rating: 4.4, reviews: 260, attributes: { Drop: "5 mm", Lugs: "5 mm" } },
  { brand: "quillrun", name: "Quillrun Featherlite", category: "Running shoes", price: 110, rating: 4.1, reviews: 210, attributes: { Drop: "4 mm", Weight: "190 g" } },
];

export const STORES: { name: string; domain: string; weight: number; trail?: number }[] = [
  { name: "Amazon", domain: "amazon.com", weight: 3 },
  { name: "Zalando", domain: "zalando.com", weight: 1.4 },
  { name: "Foot Locker", domain: "footlocker.com", weight: 1.5 },
  { name: "Decathlon", domain: "decathlon.com", weight: 1.2 },
  { name: "JD Sports", domain: "jdsports.com", weight: 1 },
  { name: "Dick's Sporting Goods", domain: "dickssportinggoods.com", weight: 1.5 },
  { name: "REI", domain: "rei.com", weight: 1.1, trail: 2.2 },
];

/* ───────────────────────────────── Sources ───────────────────────────────── */

export type SourceDef = {
  url: string;
  title: string;
  type: SourceContentType;
  topics: Topic[];
  pop: number;
  /** "own" or competitor brand key; undefined = third party */
  brand?: string;
};

export const SOURCES: SourceDef[] = [
  { url: "https://www.runnersworld.com/gear/a20865766/best-running-shoes/", title: "The Best Running Shoes of 2026, Tested", type: "listicle", topics: ["Running", "Deals"], pop: 3 },
  { url: "https://www.runnersworld.com/gear/a19663621/best-trail-running-shoes/", title: "Best Trail Running Shoes", type: "listicle", topics: ["Trail"], pop: 2.2 },
  { url: "https://www.runnersworld.com/beginner/a20812270/how-to-choose-running-shoes/", title: "How to Choose Running Shoes", type: "buying-guide", topics: ["Running"], pop: 1.8 },
  { url: "https://www.runnersworld.com/gear/a22687306/best-running-jackets/", title: "The Best Running Jackets for Rain", type: "listicle", topics: ["Gear"], pop: 1.5 },
  { url: "https://runrepeat.com/ranking-rankings-of-running-shoes", title: "Running Shoe Rankings (Lab Tested)", type: "test", topics: ["Running", "Comparisons"], pop: 3 },
  { url: "https://runrepeat.com/guides/best-running-shoes-for-wide-feet", title: "Best Running Shoes for Wide Feet", type: "listicle", topics: ["Running"], pop: 1.6 },
  { url: "https://runrepeat.com/guides/best-trail-running-shoes", title: "Best Trail Running Shoes (Lab Tested)", type: "test", topics: ["Trail", "Comparisons"], pop: 2 },
  { url: "https://runrepeat.com/guides/best-budget-running-shoes", title: "Best Budget Running Shoes", type: "listicle", topics: ["Deals"], pop: 1.6 },
  { url: "https://www.believeintherun.com/shoe-reviews/", title: "Running Shoe Reviews", type: "test", topics: ["Running", "Comparisons"], pop: 1.6 },
  { url: "https://www.outdoorgearlab.com/topics/shoes-and-boots/best-trail-running-shoes", title: "The 10 Best Trail Running Shoes", type: "test", topics: ["Trail"], pop: 1.8 },
  { url: "https://www.outdoorgearlab.com/topics/clothing-mens/best-running-jacket", title: "Best Running Jackets", type: "test", topics: ["Gear"], pop: 1.2 },
  { url: "https://www.irunfar.com/best-trail-running-shoes", title: "Best Trail Running Shoes", type: "listicle", topics: ["Trail"], pop: 1.4 },
  { url: "https://www.trailrunnermag.com/gear/shoes/", title: "Trail Shoe Reviews", type: "article", topics: ["Trail"], pop: 1.1 },
  { url: "https://www.trailrunnermag.com/gear/hydration-vests/", title: "Best Hydration Vests for Trail Running", type: "listicle", topics: ["Gear", "Trail"], pop: 1 },
  { url: "https://www.verywellfit.com/best-running-shoes-4159221", title: "The Best Running Shoes, Tested", type: "listicle", topics: ["Running"], pop: 1.7 },
  { url: "https://www.verywellfit.com/best-running-socks-4160468", title: "The Best Running Socks", type: "listicle", topics: ["Gear"], pop: 1 },
  { url: "https://www.nytimes.com/wirecutter/reviews/best-running-shoes/", title: "The Best Running Shoes", type: "buying-guide", topics: ["Running", "Deals"], pop: 2.4 },
  { url: "https://www.nytimes.com/wirecutter/reviews/best-running-socks/", title: "The Best Running Socks", type: "buying-guide", topics: ["Gear"], pop: 1.1 },
  { url: "https://www.gq.com/story/best-running-shoes", title: "The Best Running Shoes, According to Runners", type: "listicle", topics: ["Running"], pop: 1.2 },
  { url: "https://www.menshealth.com/fitness/g19546282/best-running-shoes/", title: "Best Running Shoes for Men", type: "listicle", topics: ["Running"], pop: 1.3 },
  { url: "https://www.womenshealthmag.com/fitness/g19919290/best-running-shoes-for-women/", title: "Best Running Shoes for Women", type: "listicle", topics: ["Running"], pop: 1.1 },
  { url: "https://www.outsideonline.com/outdoor-gear/run/best-running-shoes/", title: "The Best Running Shoes of the Year", type: "listicle", topics: ["Running", "Trail"], pop: 1.2 },
  { url: "https://www.garagegymreviews.com/best-running-shoes", title: "Best Running Shoes (Expert Tested)", type: "test", topics: ["Running"], pop: 1 },
  { url: "https://www.doctorsofrunning.com/", title: "Doctors of Running — Shoe Reviews", type: "test", topics: ["Running", "Comparisons"], pop: 1 },
  { url: "https://www.consumerreports.org/health/running-shoes/", title: "Running Shoe Ratings", type: "test", topics: ["Running", "Deals"], pop: 1.2 },
  { url: "https://www.reddit.com/r/running/comments/1f3k9x2/best_daily_trainer_for_2026/", title: "Best daily trainer for 2026? : r/running", type: "ugc", topics: ["Running", "Comparisons"], pop: 2.4 },
  { url: "https://www.reddit.com/r/RunningShoeGeeks/comments/1g7b2m4/megathread_shoe_comparisons/", title: "Shoe comparison megathread : r/RunningShoeGeeks", type: "ugc", topics: ["Comparisons", "Running", "Brand"], pop: 2 },
  { url: "https://www.reddit.com/r/trailrunning/comments/1e9x0c1/best_shoes_for_muddy_trails/", title: "Best shoes for muddy trails? : r/trailrunning", type: "ugc", topics: ["Trail"], pop: 1.6 },
  { url: "https://www.reddit.com/r/BuyItForLife/comments/1d2q8r5/most_durable_running_shoes/", title: "Most durable running shoes : r/BuyItForLife", type: "ugc", topics: ["Running", "Sustainability"], pop: 1.1 },
  { url: "https://www.reddit.com/r/Frugal/comments/1c8n4v7/where_to_buy_running_shoes_cheap/", title: "Where to buy running shoes cheap : r/Frugal", type: "ugc", topics: ["Deals"], pop: 1.2 },
  { url: "https://www.reddit.com/r/running/comments/1h1z7p3/what_do_you_think_of_stridewell/", title: "What do you think of Stridewell? : r/running", type: "ugc", topics: ["Brand"], pop: 1.4 },
  { url: "https://www.quora.com/What-are-the-best-running-shoes-for-beginners", title: "What are the best running shoes for beginners?", type: "ugc", topics: ["Running"], pop: 1 },
  { url: "https://www.letsrun.com/forum/flat_read.php?thread=12004871", title: "LetsRun forum: best marathon trainer?", type: "forum", topics: ["Running", "Comparisons"], pop: 1 },
  { url: "https://www.youtube.com/watch?v=q4R2kX9LmN0", title: "Top 10 Running Shoes of 2026", type: "video", topics: ["Running"], pop: 2 },
  { url: "https://www.youtube.com/watch?v=Tr41lM3gAQx", title: "Trail Shoe Mega Test", type: "video", topics: ["Trail"], pop: 1.4 },
  { url: "https://www.youtube.com/watch?v=Ec0Sh03sVb8", title: "Are Sustainable Running Shoes Any Good?", type: "video", topics: ["Sustainability"], pop: 1.2 },
  { url: "https://www.youtube.com/watch?v=HwT0cH00s3r", title: "How to Choose Running Shoes (Beginner Guide)", type: "video", topics: ["Running"], pop: 1.3 },
  { url: "https://www.youtube.com/watch?v=Vs9cMp4rX2d", title: "Head to Head: Daily Trainer Showdown", type: "video", topics: ["Comparisons"], pop: 1.3 },
  { url: "https://en.wikipedia.org/wiki/Sneakers", title: "Sneakers — Wikipedia", type: "reference", topics: ["Running", "Brand"], pop: 1.8 },
  { url: "https://en.wikipedia.org/wiki/Trail_running", title: "Trail running — Wikipedia", type: "reference", topics: ["Trail"], pop: 1.3 },
  { url: "https://en.wikipedia.org/wiki/Sustainable_fashion", title: "Sustainable fashion — Wikipedia", type: "reference", topics: ["Sustainability"], pop: 1.3 },
  { url: "https://en.wikipedia.org/wiki/Barefoot_running", title: "Barefoot running — Wikipedia", type: "reference", topics: ["Running"], pop: 0.9 },
  { url: "https://www.healthline.com/health/fitness/how-often-to-replace-running-shoes", title: "How Often Should You Replace Running Shoes?", type: "article", topics: ["Running"], pop: 1.2 },
  { url: "https://www.mayoclinic.org/diseases-conditions/flatfeet/symptoms-causes/syc-20372604", title: "Flatfeet — Symptoms and causes", type: "reference", topics: ["Running"], pop: 0.9 },
  { url: "https://www.theguardian.com/environment/running-shoes-environmental-cost", title: "The hidden environmental cost of running shoes", type: "news", topics: ["Sustainability"], pop: 1.2 },
  { url: "https://www.bbc.com/future/article/sustainable-trainers", title: "Can trainers ever be sustainable?", type: "news", topics: ["Sustainability"], pop: 1.1 },
  { url: "https://www.reuters.com/business/retail-consumer/running-boom-sportswear-sales/", title: "Running boom lifts sportswear sales", type: "news", topics: ["Brand", "Running"], pop: 0.9 },
  { url: "https://goodonyou.eco/how-ethical-is-your-sportswear/", title: "How ethical is your sportswear?", type: "reference", topics: ["Sustainability"], pop: 1.2 },
  { url: "https://www.treehugger.com/sustainable-running-shoes", title: "Sustainable Running Shoes Worth Buying", type: "article", topics: ["Sustainability"], pop: 1.1 },
  { url: "https://www.amazon.com/s?k=running+shoes", title: "Amazon.com: Running Shoes", type: "retail", topics: ["Deals", "Running"], pop: 1.8 },
  { url: "https://www.amazon.com/Best-Sellers-Running-Shoes/zgbs/fashion/679286011", title: "Amazon Best Sellers: Running Shoes", type: "retail", topics: ["Deals"], pop: 1.4 },
  { url: "https://www.zalando.com/running-shoes/", title: "Running shoes | Zalando", type: "retail", topics: ["Deals", "Running"], pop: 1 },
  { url: "https://www.decathlon.com/collections/running-shoes", title: "Running Shoes | Decathlon", type: "retail", topics: ["Deals"], pop: 1 },
  { url: "https://www.rei.com/c/trail-running-shoes", title: "Trail Running Shoes | REI", type: "retail", topics: ["Trail", "Deals"], pop: 1.2 },
  { url: "https://www.rei.com/learn/expert-advice/trail-running-shoes.html", title: "How to Choose Trail-Running Shoes | REI Expert Advice", type: "buying-guide", topics: ["Trail"], pop: 1.3 },
  { url: "https://www.dickssportinggoods.com/f/running-shoes", title: "Running Shoes | Dick's Sporting Goods", type: "retail", topics: ["Deals"], pop: 0.9 },
  { url: "https://www.footlocker.com/category/shoes/running.html", title: "Running Shoes | Foot Locker", type: "retail", topics: ["Deals"], pop: 0.9 },
  { url: "https://www.runningwarehouse.com/", title: "Running Warehouse", type: "retail", topics: ["Deals", "Gear"], pop: 1 },
  { url: "https://slickdeals.net/deals/running-shoes/", title: "Running Shoe Deals", type: "other", topics: ["Deals"], pop: 0.9 },
  // Own pages
  { url: "https://stridewell.example/", title: "Stridewell — Running shoes made to last", type: "brand", topics: ["Brand", "Running"], pop: 1.4, brand: "own" },
  { url: "https://stridewell.example/products/cloudline-4", title: "Stridewell Cloudline 4", type: "brand", topics: ["Running", "Brand", "Deals"], pop: 1.4, brand: "own" },
  { url: "https://stridewell.example/sustainability", title: "Our sustainability report", type: "brand", topics: ["Sustainability"], pop: 1.3, brand: "own" },
  { url: "https://stridewell.example/blog/how-to-choose-running-shoes", title: "How to choose running shoes", type: "article", topics: ["Running", "Gear"], pop: 1, brand: "own" },
  { url: "https://stridewell.example/size-guide", title: "Size & fit guide", type: "docs", topics: ["Brand"], pop: 0.8, brand: "own" },
  { url: "https://stridewell.example/trail/terra-gtx", title: "Stridewell Terra GTX", type: "brand", topics: ["Trail"], pop: 0.8, brand: "own" },
  // Competitor pages
  { url: "https://velocita.example/", title: "Velocita — Run faster", type: "brand", topics: ["Brand", "Running"], pop: 1.3, brand: "velocita" },
  { url: "https://velocita.example/shoes/glide-5", title: "Velocita Glide 5", type: "brand", topics: ["Running", "Deals"], pop: 1.3, brand: "velocita" },
  { url: "https://kinetiq.example/", title: "Kinetiq Running", type: "brand", topics: ["Brand", "Running"], pop: 1, brand: "kinetiq" },
  { url: "https://kinetiq.example/volt-racer", title: "Kinetiq Volt Racer", type: "brand", topics: ["Running"], pop: 1, brand: "kinetiq" },
  { url: "https://northpeak.example/", title: "Northpeak Outdoor", type: "brand", topics: ["Trail", "Brand"], pop: 1, brand: "northpeak" },
  { url: "https://northpeak.example/trail/ridge-runner-6", title: "Northpeak Ridge Runner 6", type: "brand", topics: ["Trail"], pop: 1, brand: "northpeak" },
  { url: "https://aerion.example/", title: "Aerion — Breathe easy", type: "brand", topics: ["Brand", "Running"], pop: 0.9, brand: "aerion" },
  { url: "https://aerion.example/wide-comfort", title: "Aerion Wide Comfort", type: "brand", topics: ["Running"], pop: 0.9, brand: "aerion" },
  { url: "https://pacefield.example/", title: "Pacefield — Run for less", type: "brand", topics: ["Deals", "Brand"], pop: 0.9, brand: "pacefield" },
  { url: "https://pacefield.example/sale", title: "Pacefield Sale", type: "retail", topics: ["Deals"], pop: 0.9, brand: "pacefield" },
  { url: "https://solestar.example/", title: "Solestar", type: "brand", topics: ["Brand", "Running"], pop: 0.8, brand: "solestar" },
  { url: "https://solestar.example/wide-fit", title: "Solestar Wide Fit", type: "brand", topics: ["Running"], pop: 0.8, brand: "solestar" },
  { url: "https://trailborn.example/", title: "Trailborn", type: "brand", topics: ["Trail"], pop: 0.8, brand: "trailborn" },
  { url: "https://trailborn.example/scree-pro", title: "Trailborn Scree Pro", type: "brand", topics: ["Trail"], pop: 0.8, brand: "trailborn" },
  { url: "https://lumaro.example/", title: "Lumaro — Plant-based running", type: "brand", topics: ["Sustainability"], pop: 0.8, brand: "lumaro" },
  { url: "https://lumaro.example/impact", title: "Lumaro Impact Report", type: "brand", topics: ["Sustainability"], pop: 0.8, brand: "lumaro" },
];

/* ─────────────────────────────────── Ads ─────────────────────────────────── */

export type AdDef = {
  advertiser: string;
  advertiserDomain: string;
  brand?: string;
  headline: string;
  description: string;
  landingUrl: string;
  topics: Topic[];
  weight: number;
  rating?: number;
};

export const ADS: AdDef[] = [
  { advertiser: "Velocita", advertiserDomain: "velocita.example", brand: "velocita", headline: "Velocita Glide 5 — Run Farther, Feel Fresher", description: "Our most cushioned trainer yet. Free shipping & 30-day returns.", landingUrl: "https://velocita.example/shoes/glide-5", topics: ["Running", "Comparisons"], weight: 3, rating: 4.7 },
  { advertiser: "Velocita", advertiserDomain: "velocita.example", brand: "velocita", headline: "Race Day Ready: Velocita Rocket Pro", description: "Carbon-plated speed for your next PR. Shop the new colourways.", landingUrl: "https://velocita.example/shoes/rocket-pro", topics: ["Running"], weight: 2 },
  { advertiser: "Velocita", advertiserDomain: "velocita.example", brand: "velocita", headline: "Up to 30% Off Velocita Running Shoes", description: "Limited-time offer on bestselling road and trail models.", landingUrl: "https://velocita.example/sale", topics: ["Deals"], weight: 2 },
  { advertiser: "Kinetiq", advertiserDomain: "kinetiq.example", brand: "kinetiq", headline: "Kinetiq Volt Racer — Feel the Bounce", description: "Lightweight racer with next-gen foam. Try it risk-free.", landingUrl: "https://kinetiq.example/volt-racer", topics: ["Running", "Comparisons"], weight: 2 },
  { advertiser: "Kinetiq", advertiserDomain: "kinetiq.example", brand: "kinetiq", headline: "Kinetiq Pulse 3: Your New Daily Trainer", description: "Responsive, light and built for every run.", landingUrl: "https://kinetiq.example/pulse-3", topics: ["Running"], weight: 1.5 },
  { advertiser: "Northpeak", advertiserDomain: "northpeak.example", brand: "northpeak", headline: "Northpeak Ridge Runner 6 — Grip That Goes Anywhere", description: "5 mm lugs and a rock plate for technical trails.", landingUrl: "https://northpeak.example/trail/ridge-runner-6", topics: ["Trail"], weight: 2 },
  { advertiser: "Pacefield", advertiserDomain: "pacefield.example", brand: "pacefield", headline: "Running Shoes Under $80 | Pacefield", description: "Quality trainers at honest prices. Free returns.", landingUrl: "https://pacefield.example/sale", topics: ["Deals"], weight: 2.5 },
  { advertiser: "Pacefield", advertiserDomain: "pacefield.example", brand: "pacefield", headline: "Pacefield Daily Trainer — Just $79", description: "Everything you need to start running, for less.", landingUrl: "https://pacefield.example/daily-trainer", topics: ["Deals", "Running"], weight: 1.5 },
  { advertiser: "Aerion", advertiserDomain: "aerion.example", brand: "aerion", headline: "Aerion Wide Comfort — Room to Breathe", description: "Available in regular, wide and extra wide.", landingUrl: "https://aerion.example/wide-comfort", topics: ["Running"], weight: 1.2 },
  { advertiser: "Solestar", advertiserDomain: "solestar.example", brand: "solestar", headline: "Solestar Nova — 14 New Colourways", description: "Stand out on every run. Shop the collection.", landingUrl: "https://solestar.example/nova", topics: ["Running", "Gear"], weight: 1 },
  { advertiser: "Stridewell", advertiserDomain: "stridewell.example", brand: "own", headline: "Stridewell Cloudline 4 — Cushioning That Lasts", description: "Plush, recycled and backed by a 60-day trial.", landingUrl: "https://stridewell.example/products/cloudline-4", topics: ["Running", "Comparisons", "Brand"], weight: 1.8, rating: 4.6 },
  { advertiser: "Stridewell", advertiserDomain: "stridewell.example", brand: "own", headline: "Run Greener with Stridewell", description: "Shoes and apparel made from recycled materials.", landingUrl: "https://stridewell.example/sustainability", topics: ["Sustainability", "Gear"], weight: 1.2 },
  { advertiser: "Amazon", advertiserDomain: "amazon.com", headline: "Running Shoes — Shop Top Brands", description: "Fast, free delivery on eligible orders.", landingUrl: "https://www.amazon.com/s?k=running+shoes", topics: ["Deals", "Running"], weight: 2.5, rating: 4.5 },
  { advertiser: "Zalando", advertiserDomain: "zalando.com", headline: "Running Shoes & Apparel Sale", description: "Free delivery and 100-day returns.", landingUrl: "https://www.zalando.com/running-shoes/", topics: ["Deals", "Gear"], weight: 1.4, rating: 4.3 },
  { advertiser: "Decathlon", advertiserDomain: "decathlon.com", headline: "Trail & Road Running Gear for Every Budget", description: "Shoes, jackets, vests and more.", landingUrl: "https://www.decathlon.com/collections/running-shoes", topics: ["Deals", "Gear", "Trail"], weight: 1.4, rating: 4.4 },
  { advertiser: "REI", advertiserDomain: "rei.com", headline: "Trail Running Shoes at REI", description: "Expert advice and 1-year returns for members.", landingUrl: "https://www.rei.com/c/trail-running-shoes", topics: ["Trail", "Gear"], weight: 1.3, rating: 4.8 },
];

/* ───────────────────────────────── Prompts ───────────────────────────────── */

export type PromptKind = "best" | "brandlist" | "deal" | "info" | "comparison" | "branded";

export type PromptDef = {
  text: string;
  kind: PromptKind;
  tags: Topic[];
  funnel: "tofu" | "mofu" | "bofu";
  intent: string;
  persona: string;
  volume: number;
  /** Short keyword phrase used in answer templates and fan-out queries */
  core: string;
  situations?: Situation[];
  category?: ProductCategory;
  /** Emit product appearances (shopping cards / named products) */
  products?: boolean;
  compare?: [string, string];
  /** Prompt added this many days ago (only answers since then); default = full window */
  startDaysAgo?: number;
  /** info prompts: opening sentence + tips */
  intro?: string;
  tips?: string[];
};

export const PROMPTS: PromptDef[] = [
  { text: "What are the best running shoes for beginners?", kind: "best", tags: ["Running"], funnel: "tofu", intent: "Recommend", persona: "New runner", volume: 12100, core: "running shoes for beginners", situations: ["Best for beginners", "Most recommended", "Top pick"], category: "Running shoes", products: true },
  { text: "Best cushioned running shoes for long runs", kind: "best", tags: ["Running"], funnel: "mofu", intent: "Recommend", persona: "Marathon trainee", volume: 5400, core: "cushioned running shoes for long runs", situations: ["Best for long runs", "Top pick"], category: "Running shoes", products: true },
  { text: "Which running shoes are best for marathon training in 2026?", kind: "best", tags: ["Running"], funnel: "mofu", intent: "Recommend", persona: "Marathon trainee", volume: 4400, core: "marathon training shoes", situations: ["Best for long runs", "Most recommended"], category: "Running shoes", products: true },
  { text: "Best running shoes for wide feet", kind: "best", tags: ["Running"], funnel: "mofu", intent: "Recommend", persona: "Everyday runner", volume: 8100, core: "running shoes for wide feet", situations: ["Best for wide feet", "Top pick"], category: "Running shoes", products: true },
  { text: "Most comfortable running shoes for daily training", kind: "best", tags: ["Running"], funnel: "mofu", intent: "Recommend", persona: "Everyday runner", volume: 3600, core: "comfortable daily training shoes", situations: ["Most recommended", "Best for long runs"], category: "Running shoes", products: true },
  { text: "How do I choose running shoes for flat feet?", kind: "info", tags: ["Running"], funnel: "tofu", intent: "Information", persona: "New runner", volume: 2900, core: "running shoes for flat feet", intro: "Runners with flat feet usually benefit from shoes that offer a stable platform and some arch support.", tips: ["Look for a firm heel counter and a wider base for stability.", "Try shoes on in the afternoon, when your feet are slightly swollen.", "Consider a gait analysis at a specialist running store.", "Replace insoles with supportive orthotics if you still feel discomfort."] },
  { text: "How often should you replace running shoes?", kind: "info", tags: ["Running"], funnel: "tofu", intent: "Information", persona: "Everyday runner", volume: 6600, core: "replacing running shoes", intro: "Most running shoes last between 300 and 500 miles (roughly 500–800 km), depending on your weight, stride and the surfaces you run on.", tips: ["Check the outsole for smooth, worn-through patches.", "Midsole creases and a flat, dead feel are signs the foam is compressed.", "New aches in your knees or shins can indicate worn-out shoes.", "Rotating two pairs can extend the life of both."] },
  { text: "What is heel-to-toe drop and does it matter?", kind: "info", tags: ["Running"], funnel: "tofu", intent: "Information", persona: "New runner", volume: 1900, core: "heel-to-toe drop", intro: "Heel-to-toe drop is the height difference between the heel and the forefoot of a shoe, measured in millimetres.", tips: ["High drops (10–12 mm) can suit heel strikers and runners with tight calves.", "Low drops (0–6 mm) encourage a midfoot strike but load the Achilles more.", "Transition gradually when switching to a much lower drop.", "Comfort matters more than any single spec."] },
  { text: "Best lightweight racing shoes for a 10K", kind: "best", tags: ["Running"], funnel: "mofu", intent: "Recommend", persona: "Competitive runner", volume: 1600, core: "lightweight racing shoes for a 10K", situations: ["Top pick", "Most recommended"], category: "Running shoes", products: true },
  { text: "Best running shoes for heavy runners", kind: "best", tags: ["Running"], funnel: "mofu", intent: "Recommend", persona: "Everyday runner", volume: 2400, core: "running shoes for heavy runners", situations: ["Most recommended", "Best for beginners"], category: "Running shoes", products: true },
  { text: "Best trail running shoes for muddy terrain", kind: "best", tags: ["Trail"], funnel: "mofu", intent: "Recommend", persona: "Trail runner", volume: 2900, core: "trail running shoes for mud", situations: ["Best for trail", "Top pick"], category: "Trail shoes", products: true },
  { text: "What trail running shoes have the best grip?", kind: "best", tags: ["Trail"], funnel: "mofu", intent: "Recommend", persona: "Trail runner", volume: 1600, core: "trail running shoes with the best grip", situations: ["Best for trail"], category: "Trail shoes", products: true },
  { text: "Best waterproof trail shoes for hiking and running", kind: "best", tags: ["Trail"], funnel: "mofu", intent: "Recommend", persona: "Hiker", volume: 3600, core: "waterproof trail shoes", situations: ["Best for trail", "Most recommended"], category: "Trail shoes", products: true },
  { text: "How to transition from road running to trail running", kind: "info", tags: ["Trail"], funnel: "tofu", intent: "Information", persona: "Trail runner", volume: 880, core: "road to trail running", intro: "Moving from road to trail running is mostly about adjusting your effort, footing and gear.", tips: ["Run by effort rather than pace — hills and technical ground slow everyone down.", "Shorten your stride and keep your eyes a few metres ahead.", "Invest in a trail shoe with deeper lugs and a protective toe cap.", "Carry water and tell someone your route on longer runs."] },
  { text: "Best ultramarathon trail shoes", kind: "best", tags: ["Trail"], funnel: "mofu", intent: "Recommend", persona: "Ultra runner", volume: 1300, core: "ultramarathon trail shoes", situations: ["Best for long runs", "Best for trail"], category: "Trail shoes", products: true },
  { text: "Most sustainable running shoe brands", kind: "brandlist", tags: ["Sustainability"], funnel: "tofu", intent: "Recommend", persona: "Eco-conscious runner", volume: 2400, core: "sustainable running shoe brands", situations: ["Most sustainable", "Most recommended"] },
  { text: "Are recycled running shoes as durable as regular ones?", kind: "info", tags: ["Sustainability"], funnel: "tofu", intent: "Information", persona: "Eco-conscious runner", volume: 720, core: "recycled running shoe durability", intro: "Recycled materials have improved a lot, and many recycled uppers now match conventional ones for durability.", tips: ["Recycled polyester uppers typically perform like virgin polyester.", "Midsole foams with bio-based content can compress slightly faster.", "Outsole rubber is where durability differences show most.", "Check lab tests and long-term reviews rather than marketing claims."] },
  { text: "Which sportswear brands use recycled materials?", kind: "brandlist", tags: ["Sustainability"], funnel: "tofu", intent: "Information", persona: "Eco-conscious runner", volume: 1900, core: "sportswear brands using recycled materials", situations: ["Most sustainable"] },
  { text: "Eco-friendly running apparel brands", kind: "best", tags: ["Sustainability", "Gear"], funnel: "mofu", intent: "Recommend", persona: "Eco-conscious runner", volume: 1300, core: "eco-friendly running apparel", situations: ["Most sustainable", "Top pick"], category: "Apparel", products: true },
  { text: "What is the carbon footprint of a pair of running shoes?", kind: "info", tags: ["Sustainability"], funnel: "tofu", intent: "Information", persona: "Eco-conscious runner", volume: 590, core: "running shoe carbon footprint", intro: "Studies estimate that a typical pair of running shoes produces roughly 10–14 kg of CO₂e over its life cycle.", tips: ["Most emissions come from manufacturing and material processing.", "Recycled and bio-based materials can reduce the footprint.", "Some brands now publish carbon labels per product.", "Wearing shoes longer is one of the most effective ways to cut impact."] },
  { text: "Stridewell vs Velocita for marathon training", kind: "comparison", tags: ["Comparisons"], funnel: "mofu", intent: "Comparison", persona: "Marathon trainee", volume: 1000, core: "marathon training", compare: ["own", "velocita"] },
  { text: "Velocita vs Kinetiq: which is better for tempo runs?", kind: "comparison", tags: ["Comparisons"], funnel: "mofu", intent: "Comparison", persona: "Competitive runner", volume: 880, core: "tempo runs", compare: ["velocita", "kinetiq"] },
  { text: "Stridewell vs Kinetiq running shoes", kind: "comparison", tags: ["Comparisons"], funnel: "mofu", intent: "Comparison", persona: "Everyday runner", volume: 590, core: "everyday training", compare: ["own", "kinetiq"] },
  { text: "Northpeak vs Trailborn trail shoes", kind: "comparison", tags: ["Comparisons", "Trail"], funnel: "mofu", intent: "Comparison", persona: "Trail runner", volume: 390, core: "technical trails", compare: ["northpeak", "trailborn"] },
  { text: "Aerion vs Stridewell for beginners", kind: "comparison", tags: ["Comparisons"], funnel: "mofu", intent: "Comparison", persona: "New runner", volume: 480, core: "new runners", compare: ["aerion", "own"] },
  { text: "Pacefield vs Velocita budget comparison", kind: "comparison", tags: ["Comparisons", "Deals"], funnel: "bofu", intent: "Comparison", persona: "Budget shopper", volume: 320, core: "runners on a budget", compare: ["pacefield", "velocita"] },
  { text: "Best running shoes under $150", kind: "deal", tags: ["Deals"], funnel: "bofu", intent: "Transactional", persona: "Budget shopper", volume: 6600, core: "running shoes under $150", situations: ["Best budget", "Top pick"], category: "Running shoes", products: true },
  { text: "Best budget running shoes for beginners", kind: "deal", tags: ["Deals"], funnel: "bofu", intent: "Transactional", persona: "Budget shopper", volume: 3600, core: "budget running shoes for beginners", situations: ["Best budget", "Best for beginners"], category: "Running shoes", products: true },
  { text: "Where to buy running shoes on sale?", kind: "deal", tags: ["Deals"], funnel: "bofu", intent: "Transactional", persona: "Budget shopper", volume: 2400, core: "running shoes on sale", situations: ["Best budget"], category: "Running shoes", products: true },
  { text: "Best running shoe deals this month", kind: "deal", tags: ["Deals"], funnel: "bofu", intent: "Transactional", persona: "Budget shopper", volume: 1900, core: "running shoe deals", situations: ["Best budget"], category: "Running shoes", products: true, startDaysAgo: 25 },
  { text: "Is Stridewell good for marathon training?", kind: "branded", tags: ["Brand"], funnel: "mofu", intent: "Evaluation", persona: "Marathon trainee", volume: 390, core: "marathon training" },
  { text: "Stridewell Cloudline 4 review", kind: "branded", tags: ["Brand"], funnel: "bofu", intent: "Evaluation", persona: "Everyday runner", volume: 720, core: "the Cloudline 4", category: "Running shoes", products: true },
  { text: "Are Stridewell shoes true to size?", kind: "branded", tags: ["Brand"], funnel: "bofu", intent: "Evaluation", persona: "Everyday runner", volume: 260, core: "sizing" },
  { text: "What do runners say about Stridewell?", kind: "branded", tags: ["Brand"], funnel: "mofu", intent: "Evaluation", persona: "Everyday runner", volume: 210, core: "reviews", startDaysAgo: 20 },
  { text: "Best running jackets for rain", kind: "best", tags: ["Gear"], funnel: "mofu", intent: "Recommend", persona: "Everyday runner", volume: 2400, core: "running jackets for rain", situations: ["Top pick", "Most recommended"], category: "Apparel", products: true },
  { text: "Best running socks to prevent blisters", kind: "best", tags: ["Gear"], funnel: "mofu", intent: "Recommend", persona: "Everyday runner", volume: 1600, core: "running socks for blisters", situations: ["Top pick"], category: "Accessories", products: true },
  { text: "Best running shorts with pockets", kind: "best", tags: ["Gear"], funnel: "mofu", intent: "Recommend", persona: "Everyday runner", volume: 2900, core: "running shorts with pockets", situations: ["Top pick"], category: "Apparel", products: true },
  { text: "Best hydration vests for trail running", kind: "best", tags: ["Gear", "Trail"], funnel: "mofu", intent: "Recommend", persona: "Trail runner", volume: 1300, core: "hydration vests for trail running", situations: ["Best for trail", "Top pick"], category: "Accessories", products: true },
  { text: "Best running apparel brands", kind: "brandlist", tags: ["Gear"], funnel: "tofu", intent: "Recommend", persona: "Everyday runner", volume: 1900, core: "running apparel brands", situations: ["Most recommended", "Top pick"] },
  { text: "What gear do I need to start running?", kind: "info", tags: ["Gear"], funnel: "tofu", intent: "Information", persona: "New runner", volume: 1600, core: "running gear for beginners", startDaysAgo: 14, intro: "You don't need much to start running — a good pair of shoes matters far more than anything else.", tips: ["Get fitted for running shoes that match your foot shape.", "Choose moisture-wicking socks to avoid blisters.", "Add a light, breathable top and shorts or tights.", "A simple running watch or phone app helps track progress."] },
];

/** Extra prompt ideas for the research list (not tracked). */
export const RESEARCH_IDEAS: { text: string; topic: Topic; funnel: "tofu" | "mofu" | "bofu"; intent: string; persona: string; volume: number; branded?: boolean; competitor?: string }[] = [
  { text: "Best running shoes for plantar fasciitis", topic: "Running", funnel: "mofu", intent: "Recommend", persona: "Everyday runner", volume: 9900 },
  { text: "Are carbon plated shoes worth it for beginners?", topic: "Running", funnel: "tofu", intent: "Information", persona: "New runner", volume: 1300 },
  { text: "Best trail running shoes for wide feet", topic: "Trail", funnel: "mofu", intent: "Recommend", persona: "Trail runner", volume: 1000 },
  { text: "What is the most durable running shoe?", topic: "Running", funnel: "mofu", intent: "Recommend", persona: "Everyday runner", volume: 1600 },
  { text: "Best running shoes for overpronation", topic: "Running", funnel: "mofu", intent: "Recommend", persona: "Everyday runner", volume: 4400 },
  { text: "Velocita Glide 5 vs Kinetiq Pulse 3", topic: "Comparisons", funnel: "bofu", intent: "Comparison", persona: "Everyday runner", volume: 320, competitor: "Velocita" },
  { text: "Best running shoes for walking all day", topic: "Running", funnel: "mofu", intent: "Recommend", persona: "Everyday runner", volume: 2900 },
  { text: "Best recycled running shoes", topic: "Sustainability", funnel: "mofu", intent: "Recommend", persona: "Eco-conscious runner", volume: 880 },
  { text: "How to clean running shoes", topic: "Gear", funnel: "tofu", intent: "Information", persona: "Everyday runner", volume: 5400 },
  { text: "Best running belt for phone", topic: "Gear", funnel: "mofu", intent: "Recommend", persona: "Everyday runner", volume: 1900 },
  { text: "Best running headlamp for trail", topic: "Trail", funnel: "mofu", intent: "Recommend", persona: "Trail runner", volume: 720 },
  { text: "Is Pacefield a good brand?", topic: "Brand", funnel: "mofu", intent: "Evaluation", persona: "Budget shopper", volume: 390, competitor: "Pacefield" },
  { text: "Best cold weather running gear", topic: "Gear", funnel: "mofu", intent: "Recommend", persona: "Everyday runner", volume: 1600 },
  { text: "How many running shoes do I need?", topic: "Running", funnel: "tofu", intent: "Information", persona: "New runner", volume: 880 },
  { text: "Best shoes for a 5K race", topic: "Running", funnel: "mofu", intent: "Recommend", persona: "Competitive runner", volume: 1300 },
  { text: "Northpeak Ridge Runner 6 review", topic: "Trail", funnel: "bofu", intent: "Evaluation", persona: "Trail runner", volume: 480, competitor: "Northpeak" },
  { text: "Best vegan running shoes", topic: "Sustainability", funnel: "mofu", intent: "Recommend", persona: "Eco-conscious runner", volume: 1000 },
  { text: "Best running shoes for high arches", topic: "Running", funnel: "mofu", intent: "Recommend", persona: "Everyday runner", volume: 2400 },
  { text: "Does Stridewell offer a trial period?", topic: "Brand", funnel: "bofu", intent: "Evaluation", persona: "Everyday runner", volume: 140, branded: true },
  { text: "Best kids running shoes", topic: "Running", funnel: "mofu", intent: "Recommend", persona: "Parent", volume: 1900 },
];

/* ───────────────────────────── Text snippets ───────────────────────────── */

export const LIST_INTROS: Record<"best" | "deal" | "brandlist", string[]> = {
  best: [
    "Here are some of the best {core} right now:",
    "Based on expert reviews and runner feedback, these are the top options for {core}:",
    "If you're looking for {core}, these models consistently stand out:",
    "Reviewers and runners agree on a handful of standouts for {core}:",
  ],
  deal: [
    "Here are strong picks for {core} that won't break the bank:",
    "Good value options for {core} include:",
    "If you're hunting for {core}, these offer the best mix of price and quality:",
  ],
  brandlist: [
    "Several brands stand out for {core}:",
    "These brands are frequently recommended for {core}:",
    "When it comes to {core}, a few names come up again and again:",
  ],
};

export const GENERIC_CLOSINGS = [
  "Try a few pairs in person and pick what feels most comfortable on your first runs.",
  "Your ideal choice depends on your foot shape, weekly mileage and preferred terrain.",
  "Prices and availability change often, so compare a couple of retailers before buying.",
];

export const REASONS: Record<ProductCategory, string[]> = {
  "Running shoes": [
    "a versatile daily trainer with a smooth, stable ride",
    "plenty of cushioning without feeling mushy",
    "a lightweight upper and a responsive midsole",
    "a secure fit that works for most foot shapes",
    "great value for high-mileage training",
    "a rocker geometry that makes easy miles feel effortless",
  ],
  "Trail shoes": [
    "aggressive lugs that bite into mud and loose rock",
    "a protective rock plate and a waterproof upper",
    "stable and confidence-inspiring on technical descents",
    "reliable grip on wet roots and slabs",
  ],
  Apparel: [
    "breathable fabric that dries quickly",
    "reflective details for early-morning runs",
    "a relaxed fit with zippered pockets",
    "made largely from recycled polyester",
  ],
  Accessories: [
    "cushioned zones that reduce friction and blisters",
    "a bounce-free fit with plenty of storage",
    "moisture-wicking and durable",
  ],
};

export const FANOUT_TEMPLATES: Record<PromptKind, string[]> = {
  best: ["best {core} 2026", "{core} reviews", "top rated {core}", "{core} reddit", "{core} buying guide"],
  deal: ["{core}", "{core} discount", "cheap {core} reviews", "{core} sale 2026"],
  brandlist: ["{core}", "{core} ranking", "{core} reviews 2026"],
  info: ["{core}", "{core} guide", "{core} tips", "{core} explained"],
  comparison: ["{A} vs {B}", "{A} review 2026", "{B} review 2026", "{A} vs {B} {core}"],
  branded: ["stridewell reviews", "stridewell {core}", "stridewell cloudline 4 review", "is stridewell a good brand"],
};
