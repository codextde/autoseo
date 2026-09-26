/**
 * Free SEO tools registry (open-seo `tool-pages.ts` + marketing copy). Registry order drives the hubs.
 * Copy strings may contain `{app}`, replaced with the instance's app name (Admin → Branding) at render time.
 * Spend ceilings deliberately live in `src/server/free-tools/spend.ts`: a copy edit must not move a spend control.
 */

export const FREE_TOOL_SLUGS = [
  "backlink-checker",
  "competitor-keyword-finder",
  "keyword-generator",
  "website-traffic-checker",
  "competitor-analysis",
  "spam-score-checker",
  "domain-age-checker",
  "serp-simulator",
] as const;

export type FreeToolSlug = (typeof FREE_TOOL_SLUGS)[number];

export type ToolFaq = { question: string; answer: string };
export type ToolHighlight = { title: string; description: string };

export type FreeTool = {
  slug: FreeToolSlug;
  name: string;
  shortDescription: string;
  /** "dataforseo" tools are billed; "rdap" and "client" tools are free to run. */
  source: "dataforseo" | "rdap" | "client";
  /** In-app SEO feature this tool is the free sample of (project-relative path). */
  feature: { href: string; label: string };
  related: FreeToolSlug[];
  seoTitle: string;
  seoDescription: string;
  heading: string;
  subhead: string;
  highlights: ToolHighlight[];
  faqs: ToolFaq[];
  cta: { heading: string; body: string };
  /** Shown under results: what the free run leaves out. */
  upsell?: { body: string; cta: string };
  /** How long results may be cached (shown under the form). */
  cacheDuration?: string;
};

export const FREE_TOOLS: Record<FreeToolSlug, FreeTool> = {
  "backlink-checker": {
    slug: "backlink-checker",
    name: "Backlink Checker",
    shortDescription: "Domain rank, referring domains, and the top backlinks pointing at any site.",
    source: "dataforseo",
    feature: { href: "/seo/backlinks", label: "Backlinks" },
    related: ["spam-score-checker", "website-traffic-checker", "domain-age-checker"],
    seoTitle: "Free Backlink Checker: Check Backlinks to Any Website",
    seoDescription:
      "Check backlinks for any domain: referring domains, top backlinks, anchor text, and follow status. Instant results, no signup, no email.",
    heading: "Free Backlink Checker",
    subhead:
      "Check the backlinks of any website. Enter a domain and get its domain rank, referring domains, and top backlinks with anchor text and follow status.",
    highlights: [
      { title: "Link profile summary", description: "Domain rank, total backlinks, referring domains, and broken backlinks for the domain you check." },
      { title: "Top backlinks", description: "The strongest links pointing at the domain, one per referring domain, with anchor text and follow status." },
      { title: "Competitor visibility", description: "Works on any domain, so you can see who links to competitors and where their authority comes from." },
    ],
    faqs: [
      {
        question: "Where does the backlink data come from?",
        answer:
          "Results come from DataForSEO's link index, the same data source that powers backlink research inside {app}. The index is refreshed continuously, so counts can differ slightly from other tools that crawl the web on their own schedule.",
      },
      {
        question: "How many backlinks can I see for free?",
        answer:
          "The free checker shows a domain's summary metrics and its top 15 backlinks, one per referring domain, ranked by domain strength. Sign in to {app} to page through the full list, see referring domains and anchors, filter out spam, and export the data.",
      },
      {
        question: "Can I check a competitor's backlinks?",
        answer:
          "Yes. Enter your domain, a competitor's, or a site you're evaluating for outreach. Backlink data is public-web data, so no site ownership or verification is needed.",
      },
      {
        question: "What is domain rank?",
        answer:
          "Domain rank is a 0-100 score of a domain's link-profile strength, similar to domain authority metrics in other tools. Higher means the domain has more and stronger links pointing at it.",
      },
    ],
    cta: { heading: "Explore more backlinks", body: "Browse referring domains, review anchor text, and filter backlinks in {app}." },
    upsell: {
      body: "The free checker shows the top 15 backlinks, one per referring domain. {app} lets you page through every backlink, referring domain and top page, filter out spam, and export the data.",
      cta: "Explore every backlink",
    },
  },
  "competitor-keyword-finder": {
    slug: "competitor-keyword-finder",
    name: "Competitor Keyword Finder",
    shortDescription: "Find a competitor's top organic keywords, search volumes, positions, and ranking pages.",
    source: "dataforseo",
    feature: { href: "/seo/domain", label: "Domain overview" },
    related: ["keyword-generator", "competitor-analysis", "website-traffic-checker"],
    seoTitle: "Free Competitor Keyword Finder",
    seoDescription:
      "Find the keywords a competitor ranks for on Google, with search volumes, ranking positions, and the pages that rank. Enter a domain to get started.",
    heading: "Free Competitor Keyword Finder",
    subhead:
      "Find the keywords a competitor ranks for on Google, with search volumes, ranking positions, and the pages that rank. Enter a domain to get started.",
    highlights: [
      { title: "Their top keywords", description: "See up to 20 organic keywords, starting with those estimated to bring the most Google traffic." },
      { title: "Search demand and difficulty", description: "Compare estimated monthly search volume and difficulty where available before choosing what to target." },
      { title: "The pages that rank", description: "Open the ranking URL for each keyword to see the content you would compete with." },
    ],
    faqs: [
      { question: "Can I check my own website?", answer: "Yes. Enter your domain or a competitor's domain. You don't need to know any of its keywords beforehand." },
      {
        question: "How is this different from a rank checker?",
        answer:
          "A rank checker checks the position of a keyword you already know. This tool discovers keywords a domain ranks for, so you can find ideas you haven't considered.",
      },
      {
        question: "Where does the data come from?",
        answer:
          "Results come from DataForSEO's Google keyword database for the selected country. They are a sample of known rankings, not a live Google search or a complete list. Results may be cached for 24 hours.",
      },
      { question: "Can I see their top pages or compare two sites?", answer: "Use the Competitor Analysis tool for top pages and an optional keyword comparison with your own domain." },
      { question: "Is this free?", answer: "Yes. This tool returns up to 20 keywords without signup. Usage limits apply." },
    ],
    cta: { heading: "Choose your next content topic", body: "Continue your research in {app} and save keywords to your project." },
    upsell: {
      body: "The free finder shows 20 keywords. {app}'s domain overview lists every ranking keyword and page with filters, and lets you save keywords for rank tracking.",
      cta: "Open the full domain overview",
    },
  },
  "keyword-generator": {
    slug: "keyword-generator",
    name: "Keyword Generator",
    shortDescription: "Turn a topic into keyword ideas with search volume and difficulty estimates.",
    source: "dataforseo",
    feature: { href: "/seo/keywords", label: "Keyword research" },
    related: ["competitor-keyword-finder", "competitor-analysis", "serp-simulator"],
    seoTitle: "Free Keyword Generator",
    seoDescription:
      "Start with a topic and find keyword ideas people search for. Compare estimated search volume and difficulty in your target country.",
    heading: "Free Keyword Generator",
    subhead:
      "Start with a topic and find keyword ideas people search for. Compare estimated search volume and difficulty in your target country.",
    highlights: [
      { title: "Ideas from a topic", description: "Get up to 20 keyword suggestions from a short phrase, such as email marketing or running shoes." },
      {
        title: "Monthly search volume",
        description: "See estimated Google searches in your selected country. Use volume to compare demand, not to predict visits.",
      },
      {
        title: "Difficulty estimates",
        description: "Use the available 0–100 difficulty scores as an initial check, then review the search results before choosing a keyword.",
      },
    ],
    faqs: [
      {
        question: "Does this use AI to invent keywords?",
        answer:
          "No. Suggestions come from DataForSEO's Google keyword database, with available volume and difficulty metrics. Some topics or countries may return few or no ideas.",
      },
      {
        question: "How should I choose a starting topic?",
        answer:
          "Use a short phrase that describes your product, service, or audience's problem. If the results are too broad, try a more specific phrase; if there are no results, try a broader one.",
      },
      {
        question: "What do missing metrics mean?",
        answer:
          "A dash means the provider has no value for that metric. It does not mean zero searches or zero competition. Volumes are estimates, and close variations can share the same estimate.",
      },
      {
        question: "How current are the results?",
        answer:
          "The tool uses DataForSEO's keyword database, which is updated periodically. Results may be cached for up to 24 hours; they are not a real-time count of searches.",
      },
      { question: "Is this free?", answer: "Yes. You can get up to 20 keyword ideas without signup. Usage limits apply." },
    ],
    cta: { heading: "Choose your next content topic", body: "Continue your research in {app} and save keywords to your project." },
    upsell: {
      body: "The free generator shows 20 ideas. {app}'s keyword research returns hundreds of related keywords with CPC, intent, trends and SERP analysis.",
      cta: "Open keyword research",
    },
  },
  "website-traffic-checker": {
    slug: "website-traffic-checker",
    name: "Website Traffic Checker",
    shortDescription: "Estimated organic traffic, keyword count, top keywords, and top pages for any domain.",
    source: "dataforseo",
    feature: { href: "/seo/domain", label: "Domain overview" },
    related: ["competitor-analysis", "competitor-keyword-finder", "backlink-checker"],
    seoTitle: "Free Website Traffic Checker: Estimate Any Site's Organic Traffic",
    seoDescription:
      "Estimate any website's organic traffic, keyword count, and traffic value, with its top keywords and pages. Compare two domains. No signup, no email.",
    heading: "Free Website Traffic Checker",
    subhead:
      "Estimate how much organic search traffic any website gets, which keywords bring it, and which pages earn it. Add a second domain to compare.",
    highlights: [
      {
        title: "Organic traffic estimate",
        description: "Estimated monthly organic visits, how many keywords the domain ranks for, and what that traffic would cost to buy.",
      },
      {
        title: "Top keywords and pages",
        description: "The five keywords driving the most traffic and the five pages earning it, with volume, position, and ranking URL.",
      },
      {
        title: "Compare two domains",
        description: "Add a second domain to compare traffic and keyword counts, then explore the top keywords and pages for each site.",
      },
    ],
    faqs: [
      {
        question: "How accurate are these traffic numbers?",
        answer: "DataForSEO estimates organic traffic from rankings and search volume. Use these estimates to compare domains; they do not measure actual visits.",
      },
      {
        question: "Why does this differ from Google Analytics?",
        answer:
          "Analytics counts the visits that actually happened, across every channel. This estimates organic search visits only, for one country, from ranking data. Differences are expected.",
      },
      {
        question: "How much do I get for free?",
        answer:
          "The summary metrics plus the top 5 keywords and top 5 pages per domain, for one country at a time. {app} lets you browse more keywords and pages, filter the results, and save keywords for rank tracking.",
      },
      {
        question: "Where does the data come from?",
        answer: "DataForSEO's Labs index — the same source behind {app}'s domain overview. Results are cached for 24 hours per domain and country.",
      },
    ],
    cta: { heading: "Explore more keywords and pages", body: "Explore domain reports, save promising keywords, and track their rankings in {app}." },
    upsell: {
      body: "The free checker shows the top 5 keywords and pages per domain. {app} lets you browse more keywords and pages, filter the results, and save keywords for rank tracking.",
      cta: "Explore more keywords and pages",
    },
  },
  "competitor-analysis": {
    slug: "competitor-analysis",
    name: "Competitor Analysis",
    shortDescription: "A competitor's top keywords and pages, and the keywords they rank for that you don't.",
    source: "dataforseo",
    feature: { href: "/seo/domain", label: "Domain overview" },
    related: ["website-traffic-checker", "competitor-keyword-finder", "backlink-checker"],
    seoTitle: "Free SEO Competitor Analysis Tool",
    seoDescription:
      "See a competitor's top organic keywords and pages, compare their traffic to yours, and find the keywords they rank for that you don't. No signup, no email.",
    heading: "Free SEO Competitor Analysis Tool",
    subhead:
      "Look up any competitor's organic keywords and top pages, compare their search traffic to yours, and find keywords they rank for that you don't.",
    highlights: [
      { title: "Their best keywords", description: "The top 20 keywords a competitor ranks for, with search volume, difficulty, position, and the URL that ranks." },
      { title: "Their best pages", description: "The 10 pages with the highest estimated organic traffic, so you can see which content brings visitors." },
      {
        title: "The gap against you",
        description: "Add your domain to see estimated traffic side by side and the keywords they rank for that you don't show up for at all.",
      },
    ],
    faqs: [
      {
        question: "How many keywords does the free tool show?",
        answer:
          "The competitor's top 20 organic keywords by estimated traffic, their top 10 pages, and up to 20 keywords they rank for that you don't. The report tells you how many keywords are in the index in total.",
      },
      {
        question: "Do I have to enter my own domain?",
        answer:
          "No. Without it you get the competitor's keywords and pages. Add your domain and you also get a side-by-side traffic comparison and the keyword gap between you.",
      },
      {
        question: "Where does the data come from?",
        answer: "DataForSEO's Labs index, the same source behind {app}'s competitor research. Traffic figures are modelled estimates, not the competitor's analytics.",
      },
      {
        question: "Which competitor should I check?",
        answer: "Choose a site that ranks for keywords relevant to your business. It may differ from the competitors you encounter in sales.",
      },
    ],
    cta: { heading: "Turn the gap into a plan", body: "Browse more competitor keywords in {app}, save the relevant ones, and add them to rank tracking." },
    upsell: {
      body: "The free analysis shows 20 keywords, 10 pages and up to 20 gap keywords. {app}'s domain overview lists every keyword and page, with filters and saving.",
      cta: "Open the full domain overview",
    },
  },
  "spam-score-checker": {
    slug: "spam-score-checker",
    name: "Spam Score Checker",
    shortDescription: "A domain's backlink spam score and the spammiest links pointing at it.",
    source: "dataforseo",
    feature: { href: "/seo/backlinks", label: "Backlinks" },
    related: ["backlink-checker", "domain-age-checker"],
    seoTitle: "Free Backlink Spam Score Checker",
    seoDescription: "Check a domain's backlink spam score and see the spammiest links pointing at it. No signup, no email.",
    heading: "Free Backlink Spam Score Checker",
    subhead: "Check how spammy a domain's backlink profile looks, and see which referring domains are dragging the score up.",
    highlights: [
      {
        title: "Two spam scores",
        description: "One for the links pointing at the domain, one for the domain itself. They answer different questions and often disagree.",
      },
      {
        title: "The worst offenders",
        description: "The 10 spammiest referring domains, with the linking page, anchor text, and whether the link is follow or nofollow.",
      },
      {
        title: "Put the score in context",
        description:
          "See spam scores alongside referring domains and domain rank. Use a high score as a reason to review the links, not as proof of a penalty.",
      },
    ],
    faqs: [
      {
        question: "What does the spam score actually measure?",
        answer:
          "DataForSEO scores a link profile from 0 to 100 by looking at signals its index associates with low-quality sites — thin or duplicated content, link networks, unusual outbound link patterns. Higher means more of those signals. It is not a Google penalty score; Google publishes no such number.",
      },
      {
        question: "Should I disavow the links you show?",
        answer:
          "Usually not. Google ignores most low-quality links on its own, and disavowing good links does real damage. Treat a high score as a reason to look, not as a to-do list.",
      },
      {
        question: "How many links does the free check show?",
        answer:
          "The 10 highest-spam referring domains, one link each. {app} lets you filter the full backlink profile by spam score and see how much of the profile is affected.",
      },
      { question: "Where does the data come from?", answer: "DataForSEO's backlink index, cached for 24 hours per domain. It's the same data {app} uses for backlink research." },
    ],
    cta: { heading: "Review more of the backlink profile", body: "Filter backlinks by spam score, rank, and follow status in {app}." },
    upsell: {
      body: "The free check shows the 10 spammiest referring domains. {app} lets you filter the full backlink profile by spam score, rank and follow status.",
      cta: "Review the full link profile",
    },
  },
  "domain-age-checker": {
    slug: "domain-age-checker",
    name: "Domain Age Checker",
    shortDescription: "Find when a domain was registered, when it expires, and which registrar it uses.",
    source: "rdap",
    feature: { href: "/seo/domain", label: "Domain overview" },
    related: ["backlink-checker", "website-traffic-checker"],
    seoTitle: "Free Domain Age Checker: Registration Date and Age",
    seoDescription:
      "Check when a domain was registered, how old it is, when it expires, and who the registrar is — up to 10 domains at once. No signup, no email.",
    heading: "Free Domain Age Checker",
    subhead:
      "See when a domain was registered, how old it is, when it expires, and which registrar it uses. Up to 10 domains at once, straight from the registry.",
    highlights: [
      { title: "Age in years and months", description: "Registration date, age in years and months, last update, and expiry for every domain you paste in." },
      { title: "Registrar on record", description: "Who the domain is registered through, when the registry publishes it." },
      { title: "Ten at a time", description: "Useful when you're sizing up a list of link prospects or expired domains and want the dates in one table." },
    ],
    faqs: [
      {
        question: "Does domain age affect rankings?",
        answer:
          "Barely, on its own. Google has said age isn't a ranking factor. What correlates with age is everything a site accumulates over years — links, content, brand searches — and those do matter. Old and empty ranks worse than new and useful.",
      },
      {
        question: "Where does this data come from?",
        answer:
          "RDAP, the registry protocol that replaced WHOIS. The lookup goes straight to the registry that holds the domain, so there's no third-party data source and nothing to pay for.",
      },
      {
        question: "Why does a domain show no registration data?",
        answer:
          "Some country-code TLDs don't publish RDAP records, and some registries hide dates. The tool says so for that row rather than guessing, and the other domains in your list still return.",
      },
      {
        question: "Is the age the same as when the site launched?",
        answer:
          "No. It's when the domain was first registered. A domain can sit parked for years, or change hands and start over with new content. Check what it ranks for before drawing conclusions.",
      },
    ],
    cta: { heading: "Check the domain's rankings and links", body: "Look up the domain's ranking keywords and backlinks in {app}." },
    upsell: {
      body: "Age alone says very little. What matters is whether the domain has earned links and rankings in those years — {app} shows both.",
      cta: "See ranking keywords",
    },
    cacheDuration: "7 days",
  },
  "serp-simulator": {
    slug: "serp-simulator",
    name: "SERP Simulator",
    shortDescription: "Preview your title and description in desktop and mobile search results.",
    source: "client",
    feature: { href: "/seo/audit", label: "Site audit" },
    related: ["competitor-keyword-finder", "competitor-analysis", "website-traffic-checker"],
    seoTitle: "Free SERP Simulator: Preview Your Google Title and Meta Description",
    seoDescription:
      "Preview your title and meta description in desktop and mobile search results, with pixel measurements and approximate truncation. No signup, no email.",
    heading: "Free SERP Simulator",
    subhead: "Preview your Google title and meta description on desktop and mobile. Check the length and wording before you publish.",
    highlights: [
      { title: "Measure title width", description: "See the width of your title in the preview font, alongside its character count." },
      { title: "Desktop and mobile", description: "Switch between desktop and mobile previews to check how your text wraps." },
      { title: "Nothing leaves the page", description: "Your title and description stay in your browser. No account is needed." },
    ],
    faqs: [
      {
        question: "How long should a title tag be?",
        answer:
          "Keep the main topic near the start. This preview uses a 600-pixel desktop title and a two-line mobile title as guides. Letter widths vary, so character count alone does not tell you whether a title will fit.",
      },
      {
        question: "How long should a meta description be?",
        answer:
          "Put the most useful information first. This preview allows two lines on desktop and three on mobile, including the optional date. Actual snippets vary by query and screen size.",
      },
      {
        question: "Does this guarantee what Google will show?",
        answer:
          "No. Google rewrites titles and descriptions regularly, especially when they don't match the query. This is an approximation; Google may choose different text, fonts, or layout.",
      },
      { question: "Does this tool send my text anywhere?", answer: "No. Your title, description, and URL stay in your browser. The preview updates as you type." },
    ],
    cta: { heading: "Find every page that needs this", body: "Find missing, duplicate, and long titles and descriptions with a {app} site audit." },
  },
};

export const FREE_TOOL_LIST: FreeTool[] = FREE_TOOL_SLUGS.map((s) => FREE_TOOLS[s]);

export function isFreeToolSlug(value: string): value is FreeToolSlug {
  return (FREE_TOOL_SLUGS as readonly string[]).includes(value);
}

export function getFreeTool(slug: string): FreeTool | null {
  return isFreeToolSlug(slug) ? FREE_TOOLS[slug] : null;
}

/** Replaces `{app}` placeholders with the configured app name. */
export function withApp(text: string, appName: string): string {
  return text.replaceAll("{app}", appName);
}
