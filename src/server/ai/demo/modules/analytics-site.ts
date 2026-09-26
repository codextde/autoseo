/**
 * Static catalog for the analytics demo: the fictional Stridewell site (pages), search queries
 * (classic + AI-prompt-like), countries, AI referral platforms and crawler bots. Pure data.
 */

export type SitePage = {
  path: string;
  /** Relative weight for search impressions / AI referrals / bot crawls. */
  sc: number;
  ai: number;
  bot: number;
  /** Conversion rate of AI-referred sessions landing here. */
  conv: number;
};

export const SITE_PAGES: SitePage[] = [
  { path: "/", sc: 3, ai: 2.2, bot: 3, conv: 0.022 },
  { path: "/products/cloudline-4", sc: 3.2, ai: 3.4, bot: 2.2, conv: 0.052 },
  { path: "/products/swift-2", sc: 1.6, ai: 1.5, bot: 1.4, conv: 0.047 },
  { path: "/trail/terra-gtx", sc: 1.5, ai: 1.6, bot: 1.3, conv: 0.049 },
  { path: "/products/loop-tee", sc: 0.8, ai: 0.6, bot: 0.8, conv: 0.041 },
  { path: "/products/stormshell-jacket", sc: 0.7, ai: 0.5, bot: 0.8, conv: 0.043 },
  { path: "/products/cushion-crew-socks", sc: 0.9, ai: 0.5, bot: 0.7, conv: 0.061 },
  { path: "/collections/running-shoes", sc: 2.4, ai: 1.4, bot: 1.6, conv: 0.034 },
  { path: "/collections/trail-running", sc: 1.3, ai: 0.8, bot: 1.1, conv: 0.031 },
  { path: "/collections/apparel", sc: 0.9, ai: 0.4, bot: 0.9, conv: 0.028 },
  { path: "/sale", sc: 1.1, ai: 0.5, bot: 0.6, conv: 0.045 },
  { path: "/blog/how-to-choose-running-shoes", sc: 2.2, ai: 2.1, bot: 1.8, conv: 0.012 },
  { path: "/blog/best-running-shoes-for-beginners", sc: 2.6, ai: 2.4, bot: 1.9, conv: 0.016 },
  { path: "/blog/marathon-training-plan", sc: 1.4, ai: 0.9, bot: 1.2, conv: 0.008 },
  { path: "/blog/stridewell-vs-velocita", sc: 1.2, ai: 1.7, bot: 1.3, conv: 0.021 },
  { path: "/blog/best-trail-running-shoes", sc: 1.3, ai: 1.1, bot: 1.1, conv: 0.014 },
  { path: "/blog/how-long-do-running-shoes-last", sc: 1.1, ai: 0.9, bot: 1, conv: 0.009 },
  { path: "/sustainability", sc: 0.9, ai: 1.8, bot: 1.4, conv: 0.011 },
  { path: "/size-guide", sc: 1, ai: 1.2, bot: 1.1, conv: 0.018 },
  { path: "/help/returns", sc: 0.6, ai: 0.7, bot: 0.8, conv: 0.006 },
  { path: "/help/shipping", sc: 0.4, ai: 0.3, bot: 0.6, conv: 0.005 },
  { path: "/about", sc: 0.4, ai: 0.4, bot: 0.7, conv: 0.004 },
];

export type SearchQuery = {
  q: string;
  /** Avg daily impressions at the start of the window. */
  imp: number;
  /** Base average position. */
  pos: number;
  pages: string[];
};

/** Classic (short, keyword-style) queries. */
export const CLASSIC_QUERIES: SearchQuery[] = [
  { q: "stridewell", imp: 140, pos: 1.1, pages: ["/"] },
  { q: "stridewell running shoes", imp: 60, pos: 1.4, pages: ["/collections/running-shoes", "/"] },
  { q: "stridewell cloudline 4", imp: 55, pos: 1.2, pages: ["/products/cloudline-4"] },
  { q: "cloudline 4 review", imp: 38, pos: 3.8, pages: ["/products/cloudline-4"] },
  { q: "stridewell sale", imp: 22, pos: 1.6, pages: ["/sale"] },
  { q: "stridewell size guide", imp: 12, pos: 1.3, pages: ["/size-guide"] },
  { q: "stridewell returns", imp: 8, pos: 1.5, pages: ["/help/returns"] },
  { q: "terra gtx", imp: 26, pos: 3.4, pages: ["/trail/terra-gtx"] },
  { q: "stridewell swift 2", imp: 18, pos: 1.5, pages: ["/products/swift-2"] },
  { q: "best running shoes", imp: 420, pos: 18.5, pages: ["/blog/best-running-shoes-for-beginners", "/collections/running-shoes"] },
  { q: "running shoes", imp: 520, pos: 27.2, pages: ["/collections/running-shoes"] },
  { q: "trail running shoes", imp: 210, pos: 16.4, pages: ["/collections/trail-running", "/blog/best-trail-running-shoes"] },
  { q: "waterproof trail shoes", imp: 90, pos: 9.8, pages: ["/trail/terra-gtx"] },
  { q: "recycled running shoes", imp: 48, pos: 4.6, pages: ["/sustainability", "/collections/running-shoes"] },
  { q: "cushioned running shoes", imp: 130, pos: 11.3, pages: ["/products/cloudline-4"] },
  { q: "sustainable running shoes", imp: 75, pos: 6.2, pages: ["/sustainability"] },
  { q: "merino running socks", imp: 40, pos: 7.9, pages: ["/products/cushion-crew-socks"] },
  { q: "running rain jacket", imp: 70, pos: 13.6, pages: ["/products/stormshell-jacket"] },
  { q: "marathon training plan", imp: 160, pos: 14.8, pages: ["/blog/marathon-training-plan"] },
  { q: "running shoe size guide", imp: 45, pos: 8.8, pages: ["/size-guide"] },
  { q: "recycled running shirt", imp: 28, pos: 6.7, pages: ["/products/loop-tee"] },
  { q: "stridewell vs velocita", imp: 20, pos: 2.1, pages: ["/blog/stridewell-vs-velocita"] },
  { q: "cloudline 4 vs glide 5", imp: 16, pos: 3.2, pages: ["/blog/stridewell-vs-velocita"] },
  { q: "buy running shoes online", imp: 55, pos: 19.8, pages: ["/collections/running-shoes"] },
  { q: "running shoes sale", imp: 85, pos: 17.1, pages: ["/sale"] },
];

/** Long, conversational queries that read like AI prompts. */
export const PROMPT_QUERIES: SearchQuery[] = [
  { q: "what are the best running shoes for beginners with flat feet", imp: 14, pos: 7.4, pages: ["/blog/best-running-shoes-for-beginners"] },
  { q: "how do i choose the right running shoes for long distance", imp: 11, pos: 5.9, pages: ["/blog/how-to-choose-running-shoes"] },
  { q: "is stridewell good for marathon training", imp: 6, pos: 2.4, pages: ["/products/cloudline-4", "/blog/marathon-training-plan"] },
  { q: "which running shoes last the longest for heavy runners", imp: 9, pos: 8.6, pages: ["/blog/how-long-do-running-shoes-last"] },
  { q: "how many miles do running shoes last before replacing them", imp: 18, pos: 6.8, pages: ["/blog/how-long-do-running-shoes-last"] },
  { q: "stridewell cloudline 4 vs velocita glide 5 for long runs", imp: 7, pos: 2.9, pages: ["/blog/stridewell-vs-velocita"] },
  { q: "best waterproof trail running shoes for muddy terrain", imp: 12, pos: 7.1, pages: ["/trail/terra-gtx", "/blog/best-trail-running-shoes"] },
  { q: "what is the most sustainable running shoe brand", imp: 8, pos: 4.1, pages: ["/sustainability"] },
  { q: "are recycled running shoes as durable as regular ones", imp: 5, pos: 5.2, pages: ["/sustainability"] },
  { q: "how should running shoes fit in the toe box", imp: 10, pos: 6.3, pages: ["/size-guide"] },
  { q: "do i need different shoes for trail running", imp: 9, pos: 9.4, pages: ["/blog/best-trail-running-shoes"] },
  { q: "what running shoes do physical therapists recommend for knee pain", imp: 7, pos: 12.6, pages: ["/blog/how-to-choose-running-shoes"] },
  { q: "best cushioned running shoes for walking all day", imp: 13, pos: 10.2, pages: ["/products/cloudline-4"] },
  { q: "how to train for your first marathon in 16 weeks", imp: 15, pos: 11.8, pages: ["/blog/marathon-training-plan"] },
  { q: "which running shoes are best for wide feet and high arches", imp: 8, pos: 9.1, pages: ["/blog/best-running-shoes-for-beginners"] },
  { q: "can i return running shoes after running in them", imp: 6, pos: 3.3, pages: ["/help/returns"] },
  { q: "what is the difference between stability and neutral running shoes", imp: 11, pos: 8.2, pages: ["/blog/how-to-choose-running-shoes"] },
  { q: "should i size up in running shoes for a marathon", imp: 7, pos: 5.6, pages: ["/size-guide"] },
  { q: "best running socks to prevent blisters on long runs", imp: 6, pos: 6.9, pages: ["/products/cushion-crew-socks"] },
  { q: "is a carbon plate worth it for a beginner runner", imp: 5, pos: 13.4, pages: ["/blog/best-running-shoes-for-beginners"] },
  { q: "what should i wear running in the rain", imp: 8, pos: 12.1, pages: ["/products/stormshell-jacket"] },
  { q: "how do stridewell shoes compare to kinetiq for tempo runs", imp: 4, pos: 3.8, pages: ["/products/swift-2"] },
];

/** Search country mix (ISO alpha-2 upper case). */
export const SC_COUNTRIES: { code: string; w: number }[] = [
  { code: "US", w: 62 },
  { code: "GB", w: 9 },
  { code: "CA", w: 8 },
  { code: "AU", w: 6 },
  { code: "DE", w: 4 },
  { code: "NL", w: 3 },
  { code: "IE", w: 2 },
  { code: "NZ", w: 2 },
  { code: "SE", w: 2 },
  { code: "IN", w: 2 },
];

/** AI referral platforms (ids from server/analytics/ai-platforms) with traffic share and quality. */
export const AI_REFERRERS: { id: string; share: number; engagement: number; avgTime: number; conv: number }[] = [
  { id: "chatgpt", share: 54, engagement: 0.68, avgTime: 128, conv: 1.1 },
  { id: "perplexity", share: 16, engagement: 0.74, avgTime: 151, conv: 1.25 },
  { id: "gemini", share: 11, engagement: 0.63, avgTime: 112, conv: 0.95 },
  { id: "copilot", share: 8, engagement: 0.6, avgTime: 104, conv: 0.9 },
  { id: "claude", share: 6, engagement: 0.77, avgTime: 164, conv: 1.3 },
  { id: "meta_ai", share: 3, engagement: 0.55, avgTime: 86, conv: 0.7 },
  { id: "deepseek", share: 2, engagement: 0.58, avgTime: 95, conv: 0.8 },
];

export type DemoBot = {
  token: string;
  company: string;
  /** Share of all bot hits at the start → end of the window (lets AI user agents grow). */
  w0: number;
  w1: number;
  ua: string;
  ips: string[];
  /** Has published IP ranges (verified true/false instead of null). */
  verifiable: boolean;
  /** Fetches robots.txt / sitemap / llms.txt. */
  robots: boolean;
  llms: boolean;
};

export const DEMO_BOTS: DemoBot[] = [
  { token: "Googlebot", company: "Google", w0: 30, w1: 26, ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", ips: ["66.249.66.", "66.249.79."], verifiable: true, robots: true, llms: false },
  { token: "GPTBot", company: "OpenAI", w0: 14, w1: 13, ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)", ips: ["20.171.207.", "52.230.152."], verifiable: true, robots: true, llms: true },
  { token: "ChatGPT-User", company: "OpenAI", w0: 6, w1: 12, ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot", ips: ["23.98.142.", "40.84.180."], verifiable: true, robots: false, llms: false },
  { token: "OAI-SearchBot", company: "OpenAI", w0: 5, w1: 7, ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot", ips: ["20.42.10.", "104.210.140."], verifiable: true, robots: true, llms: true },
  { token: "ClaudeBot", company: "Anthropic", w0: 9, w1: 8, ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)", ips: ["160.79.104.", "160.79.105."], verifiable: true, robots: true, llms: true },
  { token: "Claude-User", company: "Anthropic", w0: 1, w1: 3, ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)", ips: ["160.79.104."], verifiable: true, robots: false, llms: false },
  { token: "PerplexityBot", company: "Perplexity", w0: 6, w1: 6, ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)", ips: ["3.224.220.", "44.221.181."], verifiable: true, robots: true, llms: true },
  { token: "Perplexity-User", company: "Perplexity", w0: 2, w1: 4, ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)", ips: ["44.208.221.", "3.211.144."], verifiable: true, robots: false, llms: false },
  { token: "Bingbot", company: "Microsoft", w0: 9, w1: 8, ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36", ips: ["157.55.39.", "40.77.167."], verifiable: true, robots: true, llms: false },
  { token: "Google-Extended", company: "Google", w0: 1, w1: 1, ua: "Mozilla/5.0 (compatible; Google-Extended/1.0; +https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers)", ips: ["66.249.68."], verifiable: true, robots: true, llms: false },
  { token: "Applebot", company: "Apple", w0: 3, w1: 3, ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)", ips: ["17.241.219.", "17.241.75."], verifiable: true, robots: true, llms: false },
  { token: "meta-externalagent", company: "Meta", w0: 3, w1: 4, ua: "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)", ips: ["57.141.0.", "57.141.2."], verifiable: false, robots: true, llms: false },
  { token: "Amazonbot", company: "Amazon", w0: 2, w1: 2, ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot) Chrome/119.0.6045.214 Safari/537.36", ips: ["52.70.240.", "54.166.36."], verifiable: false, robots: true, llms: false },
  { token: "Bytespider", company: "ByteDance", w0: 3, w1: 2, ua: "Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)", ips: ["110.249.201.", "220.243.135."], verifiable: false, robots: false, llms: false },
  { token: "CCBot", company: "Common Crawl", w0: 1, w1: 1, ua: "CCBot/2.0 (https://commoncrawl.org/faq/)", ips: ["18.97.9.", "18.97.14."], verifiable: false, robots: true, llms: false },
  { token: "DuckAssistBot", company: "DuckDuckGo", w0: 1, w1: 1.5, ua: "DuckAssistBot/1.2; (+http://duckduckgo.com/duckassistbot.html)", ips: ["20.191.45."], verifiable: false, robots: false, llms: false },
  { token: "AhrefsBot", company: "Ahrefs", w0: 3, w1: 3, ua: "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)", ips: ["5.39.1.", "54.36.148."], verifiable: false, robots: true, llms: false },
];

/** Paths that answer with a redirect / not-found (typical legacy URLs). */
export const REDIRECT_PATHS = ["/shop", "/products/cloudline-3", "/collections/all", "/blog/best-running-shoes-2025"];
export const NOT_FOUND_PATHS = ["/blog/winter-running-2023", "/products/trailblazer-1", "/collections/outlet-old", "/wp-login.php"];
