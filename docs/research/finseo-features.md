# Finseo feature inventory (explored via Claude in Chrome, 2026-09-25)

## Global shell
- Left sidebar: project switcher (brand logo + name, e.g. "adidas"), App/Agent toggle
- Menu:
  - Prompt Tracking: Prompt Research, Tracker (/ai-tracking), Competitors, Sentiment, Sources, Products, Ads, Model Settings
  - Analytics: Human Traffic, Bot Traffic, Search Console
  - Attribution (New badge) (/attribution)
  - Fact Check (/ground-truth)
  - Optimizations: Tasks, Content, Crawlability
  - Report Builder (/reports)
  - Brand Knowledge (/brand-knowledge)
- Settings: Account (/account), API & MCP (/developer), Integrations (/integrations), Billing (/billing), Workspace (/workspace)
- Footer: "Open Tasks" (/tasks) black button, "Product Tour" (/explore-product)
- Topbar: sidebar toggle, breadcrumbs (Home > Page), bookmark icon, chat/feedback icon, gift icon (referral), theme toggle, "Get Demo", "Docs", user menu (name+email)
- Product tour: 28 steps, Business Tour / Agency Tour, topic list with progress %, step popovers (Back / n of 28 / Next), "Tour neu starten"
- Onboarding (/onboarding): split screen, left form, right animated dotted globe; 7-step progress bar; EN/DE language switch; "Abmelden"; step: "Let's set up your first client" — Website of client (domain), Tracking market (country select) → Weiter. Buttons "Produkttour · 2 Min", "Demo buchen"

## Prompt Research
- Toolbar: "Default List" dropdown (prompt lists), "Import List", "How we get this data", "Export", "Prompt Set Helper" (primary)
- Left filter panel (collapsible groups): Topics (with counts, colored bars), Prompt Length, Funnel Stage, Brand & Competitors, Personas
- Table: search prompts, tree/list view toggle, Expand/Collapse all; "DAILY 20/350" quota meter
- Columns: Data (search icon → detail), Prompt (funnel stage icon TOFU/MOFU/BOFU colored funnel, BRANDED badge, text), Volume (bar meter 10 segments), Added (date or —), Select (+ adds to tracker)
- Grouped by topic (Funnel 60, Careers 8, Running 8, CX 8, Sneaker 8, App 6, Sustainable 6)

## Tracker (/ai-tracking)
- Tabs: Trends, Breakdown, Prompt Flow, Locations
- Trends: 7d/30d/90d + date picker; All Models select; All Tags multi; Compare select; settings icon
- KPI tiles: Visibility 66.2% (+5.8), Mention Rate 92.5% (+8.1), Citation Rate 0.0%, Position (avg)
- Area line chart of selected KPI over time; watermark logo; markers (▲) for events
- "Prompts per Day · click a marker for details" strip; legend Net+ / Net− / Even; "20 prompts · 2.4K answers"
- Prompt table section: Active / Archived toggle; Usage meter "Usage Based 58,400/31,500"; buttons Query Fanouts, Prompt Research, Import CSV, Add Prompt (green)
- Tagging mode: "0 selected", "Choose tags to apply...", Apply Tags, Clear Tags, Exit Tagging
- Filters: All Locations, All Models, Last 7 days, Visibility (metric), All Tags; Select Prompts
- Columns: Prompt (country flag + text), Tags, Model Visibility (per-model icons), Visibility (% + delta), Mentions (count + delta), Sentiment (score + delta), Citations (count+delta), Brands (competitor chips), Actions
- Pagination: Show 50, Previous/1/Next, "Showing 1 to 20 of 20"
- Tracker tabs: Breakdown = stacked bars Visibility = Mentioned+Cited + Mentioned only + Cited only. Prompt Flow = flow between two periods (Improved/Declined/Unchanged counts; categories Mentioned+Cited, Mentioned only, Cited only, Not visible). Locations = Mapbox world map + table per country (flag, "20 prompts", metrics).
- Row expand (chevron): "Full Prompt" row, then per-model sub rows (model icon, runs count, cited count, Visible/Not Visible badge, visibility%, mentions, sentiment, citations, brands, "Show" → response), action buttons: View Response, Archive, Delete. Eye icon = view prompt detail.
- Add Tracking Prompt dialog: Location (country select, "Location to use for AI search"), Tags (add tags), AI Models (icons of all providers; enabled ones highlighted green; "Will run on all enabled models"; "Manage in Settings" link), Prompts textarea (multiple via line breaks) → "N prompts detected"; "Tracked daily — change in Model Settings"; Cancel / "Add Prompt to 5 Models"
- Query Fanouts (/ai-tracking/query-fanouts): back arrow, search fan-out queries, date range (Last 90 days), download; empty: "No fan-out queries yet — Once your tracked prompts are scored, the AI fan-out queries will appear here."
- AI model list (icons): ChatGPT, ChatGPT Search?, Copilot, Google AI Overviews, Perplexity, Claude, Grok, Mistral, DeepSeek, Gemini, Google AI Mode (10-11 providers)

## Competitors (/competitors)
- Metric tabs: Mention Rate, Visibility, Mentions, Sentiment, Citations (+ settings icon); SLICE: Tag | Model
- Chart types toggle: line / bar / heatmap grid; ranked legend on right (rank, logo, name, %; "You" badge)
- "Visibility Ranking" table: All Competitors (11) / My List (11); search competitors; date range; All Tags; All Models; sort; column chooser; Export (11)
- Columns: Ranking (#, logo, name, domain, You badge), Avg Position, Mention Depth (% + delta), Mentions (+delta), Citation Rate, Sentiment (+delta), Mention Rate (+delta), Visibility (+delta), Model Visibility (stacked color bar + model icons), Actions (Analyze → competitor detail page)

## Sentiment (/sentiment)
- Tabs: Overview, Perception, Praise, Criticism, Recommendations; filters: date range, All models, All Tags, Compare "brand vs brand" selector (swap icon)
- Overview: KPI box Sentiment 80/100, Praise 64.2%, Neutral 26.6%, Criticism 9.2%; stacked 100% bar per day (Praise/Neutral/Criticism; solid = you, light = competitor); cards "What AI praises about X" / "What AI criticises about X" (Explore more →); "Brand sentiment" table: #, Brand, Sentiment, Win rate, Sentiment mix (bar), AI praises (chips), Top criticism (chip ×count), Leads on (#1 attribute chips), Action "View Sentiment"
- Perception: "Brand shape" radar chart (Prominence/Association toggle) across themes (Comfort & Fit, Performance, Sustainability, Price & Service); KPI strip: Most associated (43% attr), Best vs competitors (#2 of 6), Biggest gap (#1→#4), Strongest competitor (Ø 38.4); side list "Ø prominence across themes"; "Who leads each attribute" grouped by theme with paired bars (you vs competitor), mentions count, #1 badge, "new" badge; Bars/Grid toggle; pagination 1/2
- Praise / Criticism: tables of mentions: Brand, What AI says (quote), Aspect, Models, Severity (bar+score), Action "View Prompt"; filters Only <brand>, All brands, All Aspects, search. Empty: "Nothing to show yet — Aspect sentiment is extracted on new results going forward"
- Recommendations: "Head-to-head" (when AI compares you with brand X, whom does it favour — "AI favours adidas in 7 of 7 claims" bars); "Who takes your picks" (you mentioned, another brand recommended: N answers, N prompts); "Recommended for…" heatmap: brands × situations (Best for beginners, Best for long runs, Best budget, Most recommended, Top pick), click cell for answer

## Sources (/sources)
- "Top Sources" multi-line chart over time + ranked top-10 list (favicon, URL, citations count)
- "Source Types" donut (Listicle, buying-guide, test, UGC, Article, Reference, Video, retail) with model icons in the center, legend with %
- "Source Analysis" table: search, date range, All Tags, All Models, All Types, Export (29). Columns: # + favicon + Source URL, Content Type (colored badge), Models (icons +N), Citations (+delta), Prompts (+delta), Actions "Analyze" (→ source detail: which prompts cite it, gap analysis)

## Products (/products)
- Tabs: Products, Stores; filters: date range, All models, All Tags
- "Top products" (most-surfaced products across AI answers): ranked bars with product thumbnail, appearances
- "Top brands" (whose products AI recommends most): #, Brand, Products (+delta), Mentions (+delta), Sentiment (+delta), Share (+delta)
- "Products" table (every product across AI answers — mentioned (LLM) and rendered shopping listings, unified): search products or stores, Shopping/source filter, All categories, All brands, sort (Appearances), refresh. Columns: Product (image+name), Source (icons: shopping card / LLM mention), Brand, Price (with strikethrough old price), Rating (★), Engines (icons), Appearances, Action "View Product" → product detail (Overview/Prompts tabs: appearances sparkline, models count bar, last seen, ad creative, recent appearances)
- Stores tab: "Top stores" (sellers AI cites your products from, across shopping blocks) ranked bars (Amazon, Zalando, ...), plus table of stores with share %, appearances

## Ads (/ads)
- Filters: date range, All models, All Tags
- "Top ads" (ad creatives surfaced most across AI answers): ranked with appearances
- "Top advertisers": #, Advertiser, Ads, Appearances, Share
- "Ads" table (paid ads surfaced in AI answers): Ad (image, headline, description), Advertiser (logo+name), Rank (#1..), Rating (★), Engines, Appearances (N×), Action "View Ad" + external link. Ad detail: Appearances sparkline, Models, Last seen, Ad creative (SPONSORED label, landing page), Recent appearances (prompts)

## Model Settings (/models) — (demo crashed) — enable/disable AI models per project, tracking frequency (daily/weekly), location

## Analytics → Human Traffic (/ai-analytics)
- Tabs: Human Traffic, Bot Traffic, Settings
- Toolbar: date picker, Daily/Monthly, GA property selector "adidas (Sample)", settings
- "Human Traffic from AI Platforms — Last 30 days"; KPI: Sessions (+%), Conversions (+%), Revenue (+%); stacked/line chart visitors per AI platform; ranked legend (ChatGPT 4950, Perplexity 2584, Google Gemini 1901, Claude 1547, Copilot 1015)
- "AI Model → Page → Outcome Flow" (Sankey) with Filter by: Sessions, Conversions, Conversion Rate, User Intent; Filter URLs
- "AI Traffic Analytics": tabs URLs / Location / Engagement; sort select (Sessions ↓), AI Models filter; columns Rank, Page, AI Models, Sessions, Conversions, Revenue, Avg. Time; date range + refresh
- Settings: "Analytics Settings — Manage your Google Analytics connection": Connected status, Property, ID, Synced date, Disconnect, Refresh Data

## Bot Traffic (/bot-analytics)
- Tabs: Overview, Crawled Pages, Performance, Sync
- Overview: 7d/30d/90d, calendar, refresh, "Upload Logs"; title "Bot Traffic Analytics — Manual mode"; KPIs Bot Visits, Unique URLs, Response Status; stacked bar chart per day per bot (GPTBot, ChatGPT-User, PerplexityBot, Google-Extended, ClaudeBot); bot cards (logo, bot name, company, trend %, Total Visits, Pages Crawled)
- Crawled Pages: search pages, Filter Bots; columns Page (link), Bots (icons), Visits, Last Visited
- Performance: search, Filter Bots, Filter Status; columns Page URL, Bots, Status Breakdown (200: 3 chips), Errors, Total Visits
- Sync: connector cards — Cloudflare (Worker or Logpush) Connect, Akamai (DataStream 2) Connect, Server Logs / API (Native — push NDJSON from nginx/Apache) Connect, Fastly (Coming Soon), AWS CloudFront (Coming Soon)

## Search Console (/search-console)
- Tabs: Search Queries, Top Pages, Locations, Settings; source switch: Google Console / Bing Webmaster (with connected dot)
- 7d/30d/90d, date range label, brand/project selector, refresh; KPIs CLICKS (delta), IMPRESSIONS (delta); dual-axis line chart Clicks vs Impressions
- "Search Queries — Queries driving traffic to your site": All / AI Prompts (count; long conversational queries flagged with sparkle icon), Word Count filter, All Intent Types (Recommend, Information, Comparison, Action), All Countries; "Found 12 prompts from 15 queries". Columns: #, Query, Intent badge, Countries (flags +N), Words, Impressions (+delta), + (add to tracker)
- Top Pages: #, Page, AI Prompts, Impressions, Actions
- Locations: "Geographic Distribution — AI prompt impressions by country" Mapbox map; All/AI Prompts, All Words, All Intents; table #, Country, AI Prompts, Impressions (+delta), Share
- Settings: connection card (site, Last synced, Disconnect), Data Freshness notice (2-3 day delay)

## Attribution (/attribution) — New
- 7d/30d/90d, date range, "260 responses"; stacked bars AI Search vs Other + AI Revenue line (dual axis)
- KPI cards: Deal Value (€302,100 +€87,246; 62% of total; AI Search vs Other split bar), AI Traffic Revenue (from AI-referred sessions, +%), AI Search Leads (142 +21, of 260 total 54.6%)
- "Responses — 142 attribution responses collected": AI Search / All toggle; buttons Setup, Field Mapping, Integrations; search responses; All sources; Analytics: all; download; column settings. Columns: Form (source icon e.g. Webflow — Lead Form, Typeform — Contact Form, Website Widget), Channel (AI Search / other), Contact (hashed id), Deal (€), Date, Actions (View, dismiss)
- Setup wizard (7 steps): "What do you want to track?" Purchases (e-commerce orders with revenue) / Leads (form submissions, signups, demos) / Both; "Rather have us set it up? Book setup call"

## Fact Check (/ground-truth) "Ground Truth"
- "Label Alignment" (all markets · all test setups · last checked date): gauge "How much matches the label" 91% (136/149 match, 11 deviate, 2 undecided); "How much has been checked" 149/157 collected progress; "Why statements deviate": Off-label, Contradicted, Unsupported, Outdated (count, %, View); Not a deviation: Needs review; stacked bar matched
- "Assets" (answers checked against your reference documents): Findings, Accuracy, New Asset; table Asset, Active ingredient, Markets (DE, US), Status (Active · 4 open), Actions (settings, Findings)
- New Asset dialog: tabs Single product / Paste list / Discover from URL; Asset name*, Aliases (comma-separated spelling variants), Markets* (DE·EMA, US·FDA), Create asset
- Findings (/ground-truth/findings): Export CSV; All findings / Off-Label (4); filters All Markets, All Models, All Types, All Severities, Open (excl. resolved); 7d/30d/90d; KPIs Open, Critical, Major, Minor; backlog curve chart; table Severity (major/minor/critical), Asset, Type (contradicted/outdated/unsupported/off-label), Market, Model, Label Section, Claim, Last Seen (N× · date), Actions

## Optimizations
- Tasks (/tasks): "Connect PM Tool" (Asana/Jira/Linear/ClickUp icons); search tasks; Active; All Categories; All Assignees; empty: "We analyze your prompt visibility, citations, competitors, crawl access and Search Console data — and turn the findings into prioritized, evidence-backed tasks."
- Content (/content) — (demo crashed): AI content generation backed by data (briefs/articles optimized for AI citations)
- Crawlability (/crawlability) — (demo crashed): AI crawler access audit (robots.txt, llms.txt, render/JS, status)

## Report Builder (/reports)
- List "Reports (N) — Create beautiful, branded reports for your clients": columns Report (title+subtitle), Client, Branding (color dots), Content (slides count, charts count), Status (Published/Draft), Updated, Actions (Present ▶, Edit, … menu)
- New Report dialog: Finseo Library / My Templates; templates: Blank (1 slide), Pitch (11), Audit Pitch (11), Monthly Report (7), Competitor Benchmark (5), Citation Analysis (5), Prompt Coverage (5), GEO Audit (5), Baseline Snapshot (5), Executive One-Pager (1), Blank (Classic) v1 widget canvas; Report title; Create Report. My Templates: "Open a report and use Save → Save as template"
- Editor: top bar Back, title, undo/redo, Download (PDF/PPTX), date range (Last 30 days), Brand kit, Share, Present, Save; left rail Design (Layers tree) / Agent (AI assistant designs slides) / Assets / Data (live data fields: Brand name, Reporting period, Date, Client name, Agency name, Visibility score, Citations, Tracked prompts, Browse all metrics…, Live lists, Charts); canvas with slide, element selection handles + size; bottom toolbar Text / Box / Image, zoom %; slide strip thumbnails 1/11; right panel Position (align, X, Y, rotation, Z), Layout (W, H), Live data insert

## Brand Knowledge (/brand-knowledge)
- Tabs: Interest, Sitemap, Personas, Products; "How we get X data"
- Analysis-running states ("Your queries → Knowledge", "Your sitemap → Knowledge", "Your audience → Knowledge"; 30–60 minutes; email when ready; results appear in Prompt Research)
- Interest: clustering queries around the brand + search volumes; Sitemap: walking website structure; Personas: who buys from you; Products: "Connect your product stream" (feed, file or API)

## Settings
- Account (/account): Profile Information (Upload Avatar PNG/JPG max 5MB, Full Name, Email (cannot be changed)); Current Plan; Credits (one unified pool — powers crawlability, content, brand category adds, agent chat; 24,300/30,000; Resets in 9 days; Top Up; View detailed usage); Two-Factor Authentication (authenticator app); Change Password; Update Profile; "Your Projects — N projects • Manage your websites" list (logo, name, Default badge, domain, Settings)
- API & MCP (/developer): API Keys (Manage API keys for the Customer API; Docs; Create Key); keys list: name, live badge, prefix fs_live_9f3a2c..., scopes (read/write/export), project scope (All projects / specific), created date, requests count. MCP Server: URL https://…/v1/mcp copy; clients: Claude (OAuth), ChatGPT (OAuth), Cursor (Bearer API key), VS Code (Bearer API key); Setup guide. API Usage: total requests, "347 today · 280 avg/day", 7d/14d/30d bar chart
- Integrations (/integrations): left category nav (All, Analytics, Search Console, Bot Traffic, Data & Reporting, Project Management, Attribution, CMS) + search; "Installed (N connected)" chips; cards (logo, name, description, Connect/Manage/View setup):
  - Analytics: Google Analytics, Piwik PRO, Matomo
  - Search Console: Google Search Console, Bing Webmaster Tools
  - Bot Traffic: Cloudflare, Akamai
  - Data & Reporting: Looker Studio, Finseo MCP, Finseo API
  - Project Management: ClickUp, Asana, Linear, Jira, Monday.com, Trello, Notion, awork
  - Attribution: HubSpot, Salesforce, Typeform, Zapier/Make, Shopify (Custom Pixel), Stripe (webhook), WooCommerce, Shopware, Fairing, KnoCommerce, Zigpoll, SurveyMonkey, Tally, Custom Webhook, Jotform, Gravity Forms, Formstack, Attio, Pipedrive, Close, Calendly, Intercom, n8n
  - CMS: Shopify (coming soon), WordPress (beta), Webflow (beta), Framer (beta)
- Billing (/billing): payment method card; Billing Period (current period, days left, plan fee, projects fee, AI Tracking Results (count) fee, forecast net/VAT/gross, current usage); AI credits available, View usage, Top Up; "Active Projects — N projects with tracking" cards (status, name, domain, prompts count, frequency Daily); Add Project
- Workspace (/workspace): Team Members (N active • N pending; Invite Member; list name/email/role (Admin/Member)/project access (All projects / N projects); pending invitations); Project Sharing (share projects across accounts; email, status Active/Pending, project; Share Project); Roles & Permissions matrix:
  | Permission | Owner | Admin | Member | Client |
  | Add prompts, run the agent, edit tasks & content | ✓ | ✓ | ✓ | – |
  | See team members | ✓ | ✓ | ✓ | – |
  | See credit balance | ✓ | ✓ | ✓ | – |
  | Access all projects (current & future) | ✓ | ✓ | Selected only | Selected only |
  | Create, configure and delete projects | ✓ | ✓ | – | – |
  | Invite members and change roles | ✓ | ✓ | – | – |
  | Integrations, API keys, model settings | ✓ | ✓ | – | – |
  | Buy credits, view usage and invoices | ✓ | ✓ | – | – |
  | Change or cancel the subscription | ✓ | – | – | – |

## Agent mode (/agent)
- Sidebar: project switcher, App/Agent toggle, New chat, Search chats, Integrations, Recent chats list ("No chats yet"), credits meter at bottom
- Main: animated dotted orb, "Hi, <Name>! How can I help you?", typewriter placeholder, composer "Ask me anything...", model selector (Auto — smart model switching; Thinking & Writing; Allrounder; Quick; credits per msg; "Manage"), Attach, Voice, Send; cards "Browse example prompts" (visibility across every AI engine), "Build a report" (turn data into branded pitch deck)

## Topbar extras
- Project switcher dropdown: list of projects with logo + check, "Manage Projects"
- User menu: Account, Subscription, Workspace, Log out
- Bookmarks sheet (right drawer): "Save any view — filters, tabs and open responses are restored from the URL"; Save current view (name + path) → list; shared bookmarks from teammates
- Feedback/chat icon; Gift ("Get a Gift for Your Review")
