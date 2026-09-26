# OpenSEO — Implementation-Ready Feature Inventory

> Target: a 1:1 re-implementation of every OpenSEO feature inside a new Next.js app.
> Source analyzed: `every-app/open-seo` at commit `0ffff93` (package version `0.1.9`), TanStack Start on Cloudflare Workers, DataForSEO as the SEO data provider.
> Everything below was extracted from the code (routes, server functions, services, repositories, Drizzle schemas, workflows, MCP tools), specs, docs, skills, release notes and e2e tests. Where specs and code disagree, the **code** is documented and the discrepancy is flagged.

## 0. Overview

### 0.1 What OpenSEO is

An open-source, pay-as-you-go alternative to Semrush/Ahrefs. The user brings a DataForSEO API key (self-host) or buys credits (hosted, DataForSEO cost × 1.28). It is "an SEO tool for you and your AI agent": every core workflow is available both as a web UI and as MCP tools, plus packaged agent skills (Claude Code / Codex / Cursor plugins) and an in-app agent ("Sam").

### 0.2 Top-level feature list

| # | Feature | Where | One-line summary |
|---|---|---|---|
| 1 | Projects & workspaces | `/projects`, project switcher, `/p/$id/settings` | Organization-owned projects with a domain and a default market (country + language). Every tool is project-scoped. |
| 2 | Project Dashboard | `/p/$id` | 6-step onboarding checklist + cards: rank tracking, site audit, backlinks snapshot, GSC, GA4. |
| 3 | Keyword Research | `/p/$id/keywords` | Labs related → suggestions → ideas (auto mode), Google Ads fallback for 49 Ads-only countries, clickstream toggle, client-side filters, SERP panel, save/export. |
| 4 | Saved Keywords | `/p/$id/saved` | Saved keyword list with tags (8 colors), server-side filters/sort/pagination, metrics refresh, export. |
| 5 | Rank Tracking | `/p/$id/rank-tracking[/$configId]` | Per-domain trackers, national or local (city) location, desktop/mobile, daily/weekly/monthly schedules, live manual checks + queued scheduled checks, history matrix and trend charts, cost estimates. |
| 6 | GSC Insights (Search Performance) | `/p/$id/search-performance` | Google Search Console queries/pages, impression-weighted totals, striking-distance opportunities. |
| 7 | Domain Overview (Competitor Insights) | `/p/$id/domain` | Organic traffic + keyword count, Top Keywords and Top Pages for any domain/subdomain/subfolder/URL (research scope), filters, export. |
| 8 | Backlinks | `/p/$id/backlinks` | Summary stats, 1-year trend charts, Backlinks / Referring Domains / Top Pages tabs, spam filter, Ahrefs DR enrichment, export. |
| 9 | Site Audit | `/p/$id/audit` | In-house HTML crawler (robots + sitemaps + links), 29 issue types, optional Lighthouse (DataForSEO) on ≤10 sampled URLs × 2 devices, live progress, exports. |
| 10 | Brand Lookup (AI visibility) | `/p/$id/brand-lookup` | DataForSEO LLM Mentions: mentions/AI search volume on ChatGPT + Google AI Overview, cited pages, prompts, Share of Voice vs competitors. |
| 11 | Prompt Explorer (AI visibility) | `/p/$id/prompt-explorer` | Runs a prompt through ChatGPT/Claude/Gemini/Perplexity (DataForSEO LLM Responses), detects brand mentions and citations. |
| 12 | Reports | `/p/$id/reports`, `/r/$reportId`, `/s/$token` | Agent-authored HTML reports rendered in a CSP sandbox; report templates; public share links with OG image. |
| 13 | Context (project memory) | `/p/$id/context` | Structured project memory (business, audience, competitors, key pages, research log) read/written by agents. |
| 14 | Sam (in-app AI agent, beta) | sidebar Chat tab / `/p/$id/sam` | OpenRouter-backed chat agent with ~50 OpenSEO tools, metered in credits. |
| 15 | MCP server | `/mcp` | 57 tools (projects, keywords, SERP, domain, backlinks, rank tracking, local SEO, GSC, GA4, site audit, reports, templates, context). OAuth 2.1 + API keys. |
| 16 | Agent Skills & Agent setup | `/ai`, `plugins/openseo` | 11 public skills (keyword research, competitor analysis, SEO audit, local SEO, etc.) and setup prompts for agents. |
| 17 | Local SEO | MCP only | Business listings, Maps/Local Finder SERP, local rank grid, GBP profile/reviews/Q&A/updates, categories. |
| 18 | GA4 integration | MCP + dashboard card | 10 read-only GA4 reports incl. GSC × GA4 search-opportunity scoring. |
| 19 | Team / Organizations | `/settings/organization` | Owner/admin/member roles, invitations (hosted). |
| 20 | Billing | `/billing`, `/subscribe` | Autumn: $10/mo base plan with monthly credits, top-ups, usage breakdown by feature (hosted only). |
| 21 | Marketing site + free tools | `web/` (openseo.so) | 8 free tools (keyword generator, backlink checker, competitor analysis, competitor keyword finder, website traffic checker, spam score checker, domain age checker, SERP simulator) with Turnstile + budget protection. |

### 0.3 Current tech stack → suggested Next.js mapping

| Concern | OpenSEO today | Next.js re-implementation suggestion |
|---|---|---|
| Framework / routing | TanStack Start + TanStack Router (file routes), React 19 | Next.js App Router (`app/`), route groups for `(auth)`, `(app)`, `p/[projectId]` |
| Server logic | TanStack server functions (POST, Zod-validated) → service → repository; `requireProjectContext` middleware | Server Actions / Route Handlers with the same Zod schemas; a shared `withProjectContext(projectId)` guard |
| Client data | TanStack Query, TanStack Form, TanStack Table, recharts, daisyUI + Tailwind, lucide icons, sonner toasts | Same libraries work in Next.js (client components) |
| DB | Drizzle ORM on Cloudflare D1 (SQLite) **or** Postgres (Hyperdrive); schemas kept in parity | Drizzle + Postgres (use the `src/db/pg/*.schema.ts` variants) |
| Durable jobs | Cloudflare Workflows: `RankCheckWorkflow`, `SiteAuditWorkflow` (separate `open-seo-audit` worker) | Durable job runner (Inngest / Trigger.dev / pg-boss / BullMQ) with step checkpointing and the same retry/timeout matrix |
| Per-entity state | Durable Objects: `AuditScratchpad` (per-audit SQLite frontier), Sam chat agent (Cloudflare `agents`/Think) | Postgres tables for audit frontier/link edges; DB-backed chat sessions |
| Cron | `*/5 * * * *` (audit watchdog + scheduled rank checks), `17 3 * * *` (MCP OAuth purge + referral sweep) | Vercel Cron / node-cron / job-runner schedules |
| KV / blob | Cloudflare KV (progress feed, caches, OAuth grants), R2 (DataForSEO response cache, Lighthouse payloads) | Redis or a KV table; S3-compatible storage |
| Auth | better-auth (email/password, Google, organizations, API keys), Cloudflare Access mode, Turnstile | better-auth (has Next.js adapter) |
| Billing | Autumn (`autumn-js`), Loops email, Dub referrals, PostHog | Same SDKs |
| MCP | `@modelcontextprotocol/sdk` Streamable HTTP at `/mcp`, `@cloudflare/workers-oauth-provider` for OAuth 2.1 + DCR | MCP SDK streamable HTTP route handler; an OAuth 2.1 authorization server (e.g. better-auth MCP/OIDC plugin) |
| LLM | OpenRouter via `@openrouter/ai-sdk-provider` + Vercel AI SDK (Sam only) | Same |
| HTML parsing | `htmlparser2` (streaming), `fast-xml-parser` (sitemaps), `robots-parser`, `tldts` | Same (Node runtime) |
| OG images | `takumi-js` | `next/og` (`ImageResponse`) |

### 0.4 How this document maps to the requested inventory items

| Requested item | Section(s) |
|---|---|
| 1. Every page/route, UI components, actions | §1 (route map + navigation) and the "UI" parts of §2–§17 |
| 2. Features grouped by workflow | §2 Keywords · §3 Domain · §4 Backlinks · §5 Dashboard · §6 Rank tracking · §7 Site audit · §8 AI visibility · §9 Local SEO · §10 GSC/GA4 · §11 MCP · §12 Skills · §13 Sam/Context · §14 Reports · §15 Projects/Settings/Onboarding · §16 Auth/Team · §17 Billing · §22 Free tools |
| 3. Exact DataForSEO endpoints, payloads, displayed fields, cost logic | Per-area endpoint tables at the end of §2, §5, §7, §9 + the consolidated **§18 DataForSEO Client, Cost Estimation & Master Endpoint Index** |
| 4. Database schema | §19 |
| 5. Site audit crawler, every check, Lighthouse | §7 |
| 6. AI visibility | §8 |
| 7. Rank tracking | §6 |
| 8. MCP server tools | §11 |
| 9. Background jobs / cron / queues | §20 (+ engine details in §6 and §7) |
| 10. Other integrations & settings | §10 (GSC, GA4), §15 (settings), §21 (env vars/deployment), §23 (telemetry, GDPR, email, referrals) |
| Release-notes feature mining | §24 |
| Gotchas / spec-vs-code discrepancies | §25 |

### 0.5 Table of contents

1. Routes & Navigation
2. Keyword Research, Saved Keywords, SERP & Locations
3. Domain Overview / Competitor Insights (incl. Research Scope)
4. Backlinks
5. Project Dashboard & Shared Table Components
6. Rank Tracking
7. Site Audit & Lighthouse
8. AI Visibility (Brand Lookup, Prompt Explorer)
9. Local SEO
10. Google Search Console, Search Performance & Google Analytics 4
11. MCP Server & Tool Catalog
12. Agent Skills, Plugins & Agent Setup Page
13. Sam (in-app agent), Onboarding Agent & Project Context
14. Reports, Templates & Public Share Links
15. Projects, Settings & Onboarding UI
16. Auth, Organizations & Team
17. Billing & Plans
18. DataForSEO Client, Cost Estimation & Master Endpoint Index
19. Database Schema
20. Background Jobs, Cron, Queues & Workflows
21. Environment Variables & Deployment Modes
22. Marketing Website & Free Tools
23. Telemetry, GDPR, Email & Referrals
24. Feature Timeline from Release Notes
25. Cross-Area Gotchas & Re-implementation Notes

---

## 1. Routes & Navigation

Source: `open-seo` (TanStack Start on Cloudflare Workers, Drizzle ORM, better-auth, Autumn billing).
Architecture rule used throughout: **TanStack server function → service → repository**; every
project-scoped server function takes `projectId` in its payload (spec 0001) and the global
middleware authorizes `project.organizationId == context.organizationId` before the handler runs.

### Route Map

#### Layout / guard routes (no URL of their own)

| Layout id | File | Behavior |
|---|---|---|
| `__root` | `src/routes/__root.tsx` | HTML shell. `<html translate="no">` + `<meta name="google" content="notranslate">` (browser auto-translate breaks React). Inline theme-init script (system/light/dark). Wraps app in `ClientOnly` → single `AutumnProvider` → `QueryClientProvider`; mounts `PostHogBootstrap` (hosted only; identifies user+org unless `user.analyticsOptedOut`), global `ExportToSheetsModal`, `sonner` Toaster (bottom-right), TanStack devtools in dev. Favicons + `site.webmanifest`. |
| `/_app` | `src/routes/_app/route.tsx` | App (non-project) pages. `useHostedAuthRouteGuard()` (hosted: no session → `/sign-in?redirect=…`; unverified email → `/verify-email`) + `useOnboardingRedirect()` (hosted & verified & onboarding not completed → `/onboarding?step=0`). Renders `AuthenticatedAppLayout` (sidebar shell) without a projectId. |
| `/_auth` | `src/routes/_auth.tsx` | Sign-in / sign-up shell (`AuthPageShell`). `validateSearch: { redirect? }`. If already signed in → navigate to redirect (full document load when the redirect is `/r/…` or `/s/…`). |
| `/_authenticated` | `src/routes/_authenticated.tsx` | Hosted-only centered card shell (onboarding, subscribe, oauth-consent). Renders nothing in self-host modes. |
| `/_project` | `src/routes/_project/route.tsx` | Plain `<Outlet/>`. |
| `/_project/p/$projectId` | `src/routes/_project/p/$projectId/route.tsx` | `ssr:false` (all data is react-query client-side). Hosted auth guard + onboarding redirect + **project-access redirect** (background `getProjectAccess({projectId})`; `UNAUTHENTICATED` → `/sign-in`, other error → `/`). Stores `lastProjectId` in localStorage (except when on `/settings` sub-pages). Renders `AuthenticatedAppLayout projectId` with `FreePlanBanner` in hosted mode. |

#### Page routes (TanStack file routes)

| URL | File | Purpose | Auth |
|---|---|---|---|
| `/` | `_app/index.tsx` | Redirect-only. Calls `getProjects()` (which auto-creates a "Default" project if the org has none); navigates to remembered `lastProjectId` (validated against the list) else newest project → `/p/$projectId`. Error handling: `AUTH_CONFIG_MISSING` → `AuthConfigErrorCard` (retry), `UNAUTHENTICATED` → `UnauthenticatedErrorCard`, `PAYMENT_REQUIRED` → navigate `/subscribe`. | app guard |
| `/projects` | `_app/projects.tsx` | Project list (name, domain or "No domain set", "Current" badge) linking to `/p/$id/settings`; "New project" button → `CreateProjectModal`; "Archived" section with **Restore** button per archived project. | app guard |
| `/ai` | `_app/ai.tsx` | "Agent setup" page. Tabs: **Set up your agent** (agent list: Claude Code, ChatGPT, Grok Bot, Hermes, OpenClaw "or any MCP client"; "Copy setup prompt" (content = `.agents/skills/setup-openseo/SKILL.md` with `https://app.openseo.so` replaced by current origin); "Update your skills" card with "Copy update prompt"; MCP URL `${origin}/mcp` + copy; warning alert in `cloudflare_access` mode that Managed OAuth must be enabled on the Access app) and **Skills** (list of 10 skills with blurbs linking to `openseo.so/docs/skills/<name>`: seo-coach, seo-project-setup, seo-audit, keyword-research, keyword-clustering, competitive-landscape, competitor-analysis, link-prospecting, local-seo, seo-report). | app guard |
| `/billing` | `_app/billing.tsx` | Hosted only (`notFound()` otherwise). Balance, plan, upgrade/portal, top-up, usage chart, per-feature breakdown. See Billing. | app guard |
| `/settings` (layout) | `_app/settings.tsx` | Tabs: **Personal** (`/settings`), **Organization** (`/settings/organization`, hosted only). | app guard |
| `/settings/` | `_app/settings/index.tsx` | Personal: Theme radio (System/Light/Dark). Hosted: **API keys** section + **Analytics** toggle ("Help improve OpenSEO" → `authClient.updateUser({analyticsOptedOut})`). Self-host: "About → Version vX.Y.Z" (from package.json). | app guard |
| `/settings/organization` | `_app/settings/organization.tsx` | Hosted only. `TeamSettings` (members + invitations). | app guard |
| `/team` | `_app/team.tsx` | Legacy: redirects to `/settings/organization`. | — |
| `/support` | `_app/support.tsx` | "Help & Community": copy support email (`ben@openseo.so`), Discord link, GitHub issues link. | app guard |
| `/help/dataforseo-api-key` | `_app/help/dataforseo-api-key.tsx` | Static how-to: get DataForSEO creds, `printf '%s' 'LOGIN:PASSWORD' \| base64`, save as `DATAFORSEO_API_KEY` (Cloudflare dashboard / wrangler / Docker `.env` instructions). | app guard |
| `/help/openrouter-api-key` | `_app/help/openrouter-api-key.tsx` | Static how-to for `OPENROUTER_API_KEY` (SAM agent). | app guard |
| `/sign-in` | `_auth.sign-in.tsx` | Email+password form (zod email check) + "Continue with Google" (`authClient.signIn.social({provider:"google"})`). Unverified → `/verify-email`. Links to sign-up / forgot password. | public (hosted) |
| `/sign-up` | `_auth.sign-up.tsx` | "Continue with Google" or reveal email form: Name (optional), Email, Password (8–128), Confirm password; Turnstile widget when `TURNSTILE_SITE_KEY` set (token sent as `x-captcha-response` header, reset after failure); Terms + Privacy links. `callbackURL` → verification landing; post-signup redirect defaults to `/onboarding`. | public (hosted) |
| `/forgot-password` | `forgot-password.tsx` | `authClient.requestPasswordReset({email, redirectTo: /reset-password?redirect=…})`. | public |
| `/reset-password` | `reset-password.tsx` | New password + confirm, token from query → `authClient.resetPassword`. Token TTL 1 h; all sessions revoked on reset. | public |
| `/verify-email` | `verify-email.tsx` | "Check your inbox" screen with **Resend** (`authClient.sendVerificationEmail`), auto-redirect once verified. | session |
| `/auth-error` | `auth-error.tsx` | Landing for better-auth OAuth errors (`onAPIError.errorURL`). | public |
| `/accept-invitation/$id` | `accept-invitation.$id.tsx` | Signed-out: CTA to sign up / sign in with redirect back. Signed-in: `organization.getInvitation` → Accept (`acceptInvitation`) / Decline (`rejectInvitation`); wrong-account → sign out & re-sign-in. | public→session |
| `/onboarding/` | `_authenticated.onboarding.index.tsx` | 5-step post-signup questionnaire, `?step=0..4`, `ssr:false`, `beforeLoad` redirects to `/` if already completed. See Onboarding. | hosted session |
| `/subscribe` | `_authenticated.subscribe.tsx` | Paywall/upgrade + post-checkout "Finalizing" poller. Search: `upgrade?`, `redirect?`, `checkout=success?`. See Billing. | hosted session |
| `/oauth-consent` | `_authenticated.oauth-consent.tsx` | MCP OAuth consent screen ("An MCP client is requesting access to your OpenSEO workspace", scope list, Allow/Deny → POST `/api/oauth/consent {accept}`). | hosted session |
| `/p/$projectId/` | `p/$projectId/index.tsx` | Project **Dashboard** (`DashboardPage`: setup checklist, GSC/GA4 cards, backlink snapshot, workspace-merge banner). | project |
| `/p/$projectId/keywords` | `keywords.tsx` | Keyword Research. Search: `q`, `loc`, `kLimit` (default 150), `mode` (`auto` default), `cs` (clickstream bool), `sort` (default `searchVolume`), `order` (`desc`). Legacy params normalized via redirect. | project |
| `/p/$projectId/saved` | `saved.tsx` | Saved Keywords (tags, filters, bulk actions, export). | project |
| `/p/$projectId/rank-tracking` (layout) | `rank-tracking.tsx` | Header "Rank Tracking — Track keyword positions across domains". | project |
| `/p/$projectId/rank-tracking/` | `rank-tracking/index.tsx` | Domain (config) list + "Add domain" → `RankTrackingConfigModal`; on create navigate to config detail. | project |
| `/p/$projectId/rank-tracking/$configId` | `rank-tracking/$configId.tsx` | Tracker detail (`RankTrackingDomainDetail`), edit config modal, back link. | project |
| `/p/$projectId/search-performance` | `search-performance.tsx` | "GSC Insights" (Search Console performance). | project |
| `/p/$projectId/domain` | `domain.tsx` | Domain Overview. Search: `domain`, `sort` (default `traffic`), `order`, `tab` (`keywords`/pages), `page`, `size`, `include`, `exclude`, `minTraffic/maxTraffic`, `minVol/maxVol`, `minCpc/maxCpc`, `minKd/maxKd`, `minRank/maxRank`, page-tab filters `pInclude/pExclude/pMinTraffic/pMaxTraffic/pMinVol/pMaxVol` (defaults stripped from URL). | project |
| `/p/$projectId/backlinks` | `backlinks.tsx` | Backlinks. Search: `target`, `scope` (auto-derived from input: domain/subfolder/page), `tab` (`backlinks` default / `domains` / pages; `domains` disallowed for subfolder scope), `page`, `size`, `sort`, `order`, `view`. | project |
| `/p/$projectId/audit` (layout) + `/audit/` | `audit.tsx`, `audit/index.tsx` | Site Audit launch/results. Search: `auditId?`, `tab` (default `issues`). | project |
| `/p/$projectId/audit/issues/$resultId` | `audit/issues/$resultId.tsx` | Lighthouse issues screen for one result. Search: `auditId`, `category`. | project |
| `/p/$projectId/brand-lookup` | `brand-lookup.tsx` | AI Visibility "Brand Lookup". Search: `q`, `c` (comma-joined competitors), `scope`. | project |
| `/p/$projectId/prompt-explorer` | `prompt-explorer.tsx` | AI "Prompt Explorer". Search: `q` (prompt), `models[]` (default all), `web` (default true), `cc` (web-search country, default `US`), `hb` (highlight brand). | project |
| `/p/$projectId/reports/` | `reports/index.tsx` | Reports list (agent-written HTML reports), delete, link to Templates. `staleTime:0`. | project |
| `/p/$projectId/reports/$reportId` | `reports/$reportId.tsx` | Report viewer (iframe of `/r/$reportId`), `?full` toggle, share modal. | project |
| `/p/$projectId/reports/templates` | `reports/templates.tsx` | Report templates CRUD. | project |
| `/p/$projectId/context` | `context.tsx` | Project memory/context page (`ProjectContextPage`). | project |
| `/p/$projectId/sam` | `sam.tsx` | SAM in-app chat; `?s=<sessionId>`. | project |
| `/p/$projectId/settings` (layout) | `settings.tsx` | "Project settings" with back link to `/projects`; tabs **General**, **Integrations**. | project |
| `/p/$projectId/settings/` | `settings/index.tsx` | `ProjectGeneralSettings`. Hash `#search-console`/`#google-analytics` redirects to integrations. | project |
| `/p/$projectId/settings/integrations` | `settings/integrations.tsx` | Search Console card + Google Analytics card (prefetch both connection queries). | project |
| `/p/$projectId/settings/context` | `settings/context.tsx` | Legacy redirect → `/p/$projectId/context`. | — |

#### Raw server routes (no React component)

| URL | File | Purpose / Auth |
|---|---|---|
| `GET /api/health` | `api/health.ts` | Hosted: `{status:"ok"}`. Self-host: `{status:"ok"|"issues", version, authMode, checks:{auth,dataforseo,gsc,ai,runtime,database}}` (statuses: ok/warn/error with guidance, never secrets). Unauthenticated. Docker HEALTHCHECK probes it. |
| `GET/POST /api/auth/$` | `api/auth/$.ts` | better-auth handler (hosted only; 404 otherwise; 500 if hosted config incomplete). Includes `/api/auth/oauth2/*` MCP OAuth endpoints intercepted by the OAuth provider wrapper. |
| `GET/POST /api/autumn/$` | `api/autumn/$.ts` | Autumn (`autumn-js/fetch` `autumnHandler`) proxy, hosted only. Customer id = organizationId. Member-readable routes: `getOrCreateCustomer, getEntity, listPlans, listEvents, aggregateEvents`; every other route requires `billing:manage` (owner) → 403 `billing_owner_required`. |
| `POST /api/autumn/webhook` | handled in `src/server.ts` | Svix-signed Autumn webhook (hosted). |
| `GET /api/gsc/oauth/callback` | `api/gsc/oauth/callback.ts` | Self-hosted hand-rolled Google OAuth callback for Search Console. |
| `GET /api/ga4/oauth/callback` | `api/ga4/oauth/callback.ts` | Same for GA4. |
| `GET /r/$reportId` | `r/$reportId.ts` | Report document served from app origin with strict `REPORT_CSP`; own auth (session); hosted & signed out → redirect to sign-in with `redirect=/r/<id>`; self-host → 401 text. Uniform 404 body for missing/foreign reports. |
| `GET /s/$token/` | `s/$token/index.ts` | Public share page (server-rendered, no app bundle) for a shared report. |
| `GET /s/$token/raw` | `s/$token/raw.ts` | Shared report document (same CSP), token-authorized; `Cache-Control: public, max-age=0, s-maxage=60`; uniform "This report isn't shared." 404. |
| `GET /s/$token/og.png` | `s/$token/og[.]png.ts` | Generated social image (title + project domain), falls back 302 to `https://openseo.so/social-card.jpg`. |
| `GET /.well-known/openai-apps-challenge` | `[.well-known]/openai-apps-challenge.ts` | Static token for OpenAI Apps verification. |
| `/mcp` | `src/server.ts` → `server/mcp/*` | MCP endpoint. Hosted: `workers-oauth-provider` (`apiRoute:/mcp`, authorize `/api/auth/oauth2/authorize`, token `/api/auth/oauth2/token`, register `/api/auth/oauth2/register`, consent response `/api/oauth/consent`, scopes `offline_access mcp`) plus API-key bearer (`oseo_…`). Self-host (`cloudflare_access`/`local_noauth`): `handleSelfHostedOpenSeoMcpRequest`. |
| `/agents/*` | `src/server.ts` | Agents SDK route to `SAM_CHAT` Durable Object (WebSocket + history fetch); authorized by resolving the SAM session row → project in caller's org; hosted also ensures Autumn customer. |
| `POST /api/internal/gdpr-erasure/storage` | `src/server.ts` → `server/gdpr/storage-erasure.ts` | Operator-only HMAC (`GDPR_ERASURE_SECRET`) endpoint to erase KV/R2/DO/OAuth state for a user; 404 when secret unset. |

Response header: every HTML document without its own CSP gets `Content-Security-Policy: frame-ancestors 'self'` (clickjacking fix, `appFetch` wrapper).

#### App shell & sidebar navigation (`src/client/components/Sidebar.tsx`, `src/client/navigation/items.ts`, `src/client/layout/AppShell.tsx`)

Layout: fixed 240px (`w-60`) left sidebar on md+ (drawer on mobile via hamburger `MobileTopBar` with "OpenSEO" home link); content sits on a raised rounded panel. Banners at top of content: DataForSEO-missing warning / status-error banners, then optional `FreePlanBanner`.

Sidebar top → bottom:
1. "OpenSEO" logo link (`/`), close button in mobile drawer.
2. **ProjectSwitcher** (combobox): current project, gear link to `/p/$id/settings`, filter input, project list (sets `lastProjectId`), "New project" (modal), "Manage projects" (`/projects`).
3. When a project is active: **Browse | Chat** tab strip. Chat shows `SamSidebarPanel` (SAM session list) and navigates to `/p/$id/sam`; Browse returns to the dashboard.
4. Nav groups (project selected):
   - **Overview**: Dashboard (`LayoutDashboard`, `/p/$id`, exact match)
   - **Research**: Keyword Research (`Search`, `/keywords`), Domain Overview (`Globe`, `/domain`), Backlinks (`Link2`, `/backlinks`), Brand Lookup (`Sparkles`, `/brand-lookup`), Prompt Explorer (`MessageSquare`, `/prompt-explorer`)
   - **My Site**: GSC Insights (Google glyph, `/search-performance`), Rank Tracking (`TrendingUp`, `/rank-tracking`), Saved Keywords (`Bookmark`, `/saved`), Site Audit (`ClipboardCheck`, `/audit`)
   - **AI**: Reports (`FileText`, `/reports`), Context (`Brain`, `/context`), Agent setup (`Bot`, `/ai`, project-independent)
   - No project selected: only group **AI** → Agent setup.
   - Project id for the sidebar on non-project pages = URL projectId ?? remembered lastProjectId (validated) ?? newest project.
5. Footer: "Help & Community" (`CircleHelp`, `/support`); account dropdown (user email, masked): organization switcher list (if >1 org; calls `switchOrganization` then hard reload `/`), Settings, Billing (hosted), theme items, Sign out (hosted). Self-host footer shows Settings link.

Global modals in shell: `MissingSeoSetupModal` (shown when `getSeoApiKeyStatus().configured === false`, i.e. `DATAFORSEO_API_KEY` unset; Esc closes; hidden on `/help/dataforseo-api-key` and `/billing`), `GscReEngagementModal` (one-time "connect Search Console" nudge for legacy users; suppressed while the DataForSEO modal shows).

---

## 2. Keyword Research, Saved Keywords, SERP & Locations

### Keyword Research

#### Route & URL state

- Route: `/p/$projectId/keywords` (file `src/routes/_project/p/$projectId/keywords.tsx`). Project-scoped; the project supplies the default market (`project.locationCode`, `project.languageCode`).
- URL search params (Zod `keywordsSearchSchema`, `src/types/schemas/keywords.ts`):

| Param | Type | Default | Meaning |
|---|---|---|---|
| `q` | string | — | Seed keyword of the active tab (one keyword per URL/tab) |
| `loc` | int | project/preferred location | DataForSEO `location_code` (country) |
| `kLimit` | 150 \| 300 \| 500 | 150 | Result limit per seed |
| `mode` | `auto`\|`related`\|`suggestions`\|`ideas` | `auto` | Keyword source |
| `cs` | boolean | false | Clickstream-refined volumes (2× cost) |
| `sort` | `keyword`\|`searchVolume`\|`cpc`\|`competition`\|`keywordDifficulty` | `searchVolume` | Client-side sort |
| `order` | `asc`\|`desc` | `desc` | Sort direction |
| `minVol,maxVol,minCpc,maxCpc,minKd,maxKd,include,exclude` | string | — | LEGACY — `beforeLoad` strips them (and default-valued params) and `redirect({replace:true})` to a normalized URL. Filters now live in localStorage. |

- `normalizeLegacyKeywordSearch`: removes `q=""`, `kLimit=150`, `mode=auto`, `cs=false`, `sort=searchVolume`, `order=desc` and all legacy filter params; redirects if anything changed.
- Sort toggle rule (`getNextSortParams`): clicking a different column → `{sort: field, order: "desc"}`; clicking the active column flips asc/desc. Written to URL with `replace: true`.

#### Page layout (desktop ≥ md)

1. Header: H1 "Keyword Research", subtitle "Discover keyword ideas, search demand, and ranking opportunities."
2. **Search card** (`KeywordResearchSearchBar`, TanStack Form):
   - Auto-growing `<textarea>` "Enter a keyword" (rows = min(5, lines)). Enter submits; Shift+Enter adds a newline. Input is split on newline or comma (`parseKeywordInput`: `split(/[\n,]/)`, trim, drop empty). Validation: ≥1 keyword ("Please enter at least one keyword."), ≤ `MAX_KEYWORDS_PER_SUBMIT = 5` ("Please enter no more than 5 keywords (one per line).").
   - `LocationSelect` — searchable country combobox over `LOCATION_OPTIONS` (143 countries; filters by label or shortLabel; keyboard navigation; outside-click close).
   - Result-limit `<select>`: "150 results" / "300 results" / "500 results".
   - Mode `<select>`: Auto / Related keywords / Suggestions / Ideas.
   - "Search" button.
   - If selected location is a Labs country: toggle "Clickstream-refined volumes" with tooltip "Google reports one combined search volume for similar keywords (e.g. 'seo tool' and 'seo tools'). Turn this on to estimate each keyword's own volume. Costs 2x the credits." Otherwise an info banner: "Keyword data for this country comes from Google Ads — search volume, CPC, and trends are available, but difficulty and intent are not."
   - On submit: each parsed keyword (≤5) opens its own **search tab** (`KeywordSearchTabInput {type:"keyword", keyword, locationCode, resultLimit, mode, clickstream}`); the URL navigates to the last one. The chosen location is stored as the per-project preferred location.
3. When a search is active: "← Recent searches" ghost button (clears `q/loc/kLimit/mode/cs` and deselects the tab) + `SearchTabStrip`.
4. Content state machine (`KeywordResearchContent`):
   - Loading → skeleton (`KeywordResearchLoadingState`: two-column skeleton with 10 table rows).
   - Error → red card with message; if error code `INSUFFICIENT_CREDITS` → "Go to Billing" link (`/billing`), else "Try again" (refetch).
   - No rows + searched → "Not enough keyword data for this query yet — We could not find keyword opportunities for "<kw>" in <LOCATION shortLabel>."
   - No search → **recent searches list** (see History) or empty prompt "Enter a keyword to get started / Search for any keyword to see volume, difficulty, CPC, and related keyword ideas."
   - Rows → results.
5. **Results (desktop)**: flex row on xl: left panel `xl:basis-3/5`, right panel `xl:basis-2/5` (on < xl the right panel renders first/above).
   - Left:
     - Approximate-match warning (only when `mode !== "auto"`, results non-empty and no row equals the seed): "No exact match for "<seed>". Showing closest related keywords instead." + "Source: <source> fallback." when `usedFallback`.
     - `OverviewStats` strip for the "overview keyword": keyword (capitalized) + difficulty ScoreBadge, "Vol", "CPC $x.xx", "Comp 0.00", IntentBadge. Overview keyword = clicked row, else exact seed row, else first row.
     - Table card: toolbar [Filters toggle with active-count badge] ["Showing N keywords" / "Showing X of Y keywords" / "K of N selected"] [Export ▾ → "Export to Sheets", "Export CSV"]; bulk-action bar when rows selected ["Save Keywords", Export ▾ (Sheets / CSV of selection), clear]; collapsible filter panel; table; pagination.
   - Right:
     - "Search Trends <Mon YYYY - Mon YYYY>" card with `AreaTrendChart` (Recharts AreaChart, height 210, last 12 months sorted by `year*100+month`, X=month short label, Y compact-number formatted, gradient fill, dots) — only if overview keyword has trend data.
     - "SERP Analysis: <keyword>" card containing `SerpAnalysisCard` (see SERP Analysis).
6. **Mobile (< md)**: two tabs "Keywords (N)" / "SERP Analysis"; keyword list as cards with the same filters/export/selection/pagination.

#### Keyword table columns (`KeywordResearchDesktopTable`, TanStack Table, row id = keyword)

| # | Column | Header / help text | Cell rendering | Sortable |
|---|---|---|---|---|
| 0 | selection checkbox | select-all | shift-click range select via `useSelectionAnchor` | — |
| 1 | Keyword | "Keyword" | bold, `capitalize`, truncate with title | yes |
| 2 | Volume | "Volume" | `Intl.NumberFormat` or "-" | yes |
| 3 | CPC | "CPC" — "Cost per click in USD." | `toFixed(2)` or "-" | yes |
| 4 | Comp. | "Comp." — "Paid-search competition from Google Ads (0-1): higher means more advertisers bidding." | `toFixed(2)` | yes |
| 5 | Score (KD) | "Score" — "Organic ranking difficulty (0-100): higher means harder to reach Google's top 10." | `DifficultyBadge` round badge with tier color; "—" when null | yes |
| 6 | Intent | "Intent" | `IntentBadge` pill: Info / Comm / Trans / Nav / ? with tooltip descriptions | no |

- Row click → sets overview keyword, loads SERP for that keyword (resets SERP page to 0, depth 20); fires PostHog `keyword_research:serp_open`. Active row highlighted (`bg-primary/5 border-l-2 border-l-primary`).
- Difficulty tier classes (`scoreTierClass`): null→`na`; ≤20 tier1; ≤35 tier2; ≤50 tier3; ≤65 tier4; ≤80 tier5; else tier6.
- Intent colors: informational=info, commercial=warning, transactional=success, navigational=primary, unknown=neutral. Tooltip copy per intent (e.g. commercial: "The searcher is researching options before a purchase...").

#### Client-side filters (no API cost; applied to already-fetched rows)

`KeywordFilterValues` (all strings): `include, exclude, minVol, maxVol, minCpc, maxCpc, minKd, maxKd, intents`. Persisted to `localStorage["keyword-default-filters"]` (removed when all empty) and reused across searches; panel auto-opens if any filter is set. UI: "Refine table results" + "N active" + "Clear all"; "Include Terms" (placeholder "audit, checker, template"), "Exclude Terms" ("jobs, salary, course"), range pairs "Search Volume", "CPC (USD)" (step 0.01), "Difficulty"; "Intent" toggle-button group (Informational, Commercial, Transactional, Navigational, Unknown; stored as comma list in canonical order).

```ts
// applyKeywordFiltersAndSort
include terms = value.toLowerCase().split(/[,+]/).trim  // ALL must be substrings (AND)
exclude terms                                           // ANY substring → drop
intents selected → row.intent must be in set
vol = row.searchVolume ?? 0; cpc = row.cpc ?? 0; kd = row.keywordDifficulty ?? 0  // nulls count as 0
min/max compared with Number(value) when non-empty
sort: keyword (string) | searchVolume/cpc/competition/keywordDifficulty with null → -1
activeFilterCount = number of non-empty filter fields
```

#### Pagination (client-side)

Page sizes 50/100/300/500 (default 50), stored in `localStorage["keyword-research-table-page-size"]`; "a-b of N", "Rows per page", "Page x of y", prev/next. Resets to page 1 when rows change.

#### Export

- Headers `KEYWORD_RESEARCH_HEADERS = ["Keyword","Volume","CPC","Competition","Score","Intent"]`; row = `[keyword, searchVolume??"", cpc??"", competition??"", keywordDifficulty??"", intent]`.
- **Export CSV**: file `keyword-research.csv`; CPC & competition cells `toFixed(2)`; `buildCsv` uses PapaParse with `quotes:true`, numbers rounded to 2 decimals, CSV-injection guard (prefix `'` if value starts with `= + - @ \t \r \n`). Whole filtered set or selection. PostHog `data:export {source_feature:"keyword_research", result_count, scope?:"selection"}`.
- **Export to Sheets**: copies TSV (`text/plain`) + HTML `<table>` (`text/html`, URLs become `<a>`) to clipboard via `navigator.clipboard.write`, then opens a modal whose button opens `https://sheets.new` (no auto-redirect). PostHog `data:export_sheets`.

#### Save keywords

- Select rows → "Save Keywords" → modal "Save N Keywords — These keywords will be saved to your current project." → Save.
- Calls `saveKeywords({projectId, keywords:[...selected], locationCode, metrics:[{keyword, searchVolume, cpc, competition, keywordDifficulty, intent, monthlySearches: row.trend}]})`. Toast "Saved N keywords"; invalidates `["savedKeywords", projectId]`; PostHog `keyword:save {source_feature, keyword_count}`. Error toast "Save failed.".

#### Data fetching (client)

- TanStack Query key `["keywordResearch", projectId, keywords[], locationCode, resultLimit, mode, clickstream]`; `staleTime = gcTime = 24h`; `retry:false`; no refetch on focus/reconnect (every call is billed). URL is the source of truth — the query runs whenever `q` is present.
- On success: PostHog `keyword_research:search_complete {location_code, search_mode, clickstream, result_count}` and adds to search history.

#### Search history (recent searches)

`localStorage["search-history:{projectId}"]`, max 20 items `{keyword, locationCode, locationName (shortLabel), timestamp}`, deduped by keyword+locationCode (newest first). Empty state shows "N recent searches" list, each linking to `?q=<kw>&loc=<code>` with date "Mon D" and hover "×" remove.

#### Search tabs (shared by keyword / domain / backlinks pages)

- `sessionStorage["search-tabs:keyword:{projectId}"]` (domain/backlinks use their own keys). State `{tabs: SearchTab[], activeTabId}`; `SearchTab = {id(uuid), label, input, createdAt, viewedAt|null}`; max **20** tabs, oldest evicted.
- Opening an input identical (JSON-equal) to an existing tab just activates it. Closing the active tab selects the right neighbor, else left, else none (navigates accordingly).
- Tab status dot (each tab observes its own query key without fetching): spinner = fetching; red dot = error; primary dot = result updated since last viewed ("unviewed"); none = idle. Viewing a tab marks `viewedAt = dataUpdatedAt`.
- Tab input types: `keyword {keyword, locationCode?, resultLimit, mode, clickstream}`, `domain {domain, scope, locationCode?}`, `backlinks {target, scope}`. Legacy migration: backlinks `scope:"page"` → `exact_url`; domain `subdomains:boolean` → scope.

#### Location preference (client)

`usePreferredKeywordLocation`: precedence = URL `loc` > `localStorage["keyword-preferred-location:{projectId}"]` > project default location > `DEFAULT_LOCATION_CODE = 2840` (US). Saved on submit (only if the code is a supported location).

#### Server function

```ts
researchKeywords = createServerFn({method:"POST"})
  .middleware(requireProjectContext)             // auth + project scoping (context.project, context.projectId)
  .validator(researchKeywordsSchema)
  .handler(({data, context}) => KeywordResearchService.research(
      {...data, ...resolveMarket(data, context.project), projectId: context.projectId}, context))
// E2E: VITE_E2E_KEYWORD_FIXTURES=1 returns fixture rows instead.

researchKeywordsSchema = z.object({
  projectId: z.string().min(1),
  keywords: z.array(z.string().min(1)).min(1).max(200),   // first unique = seed
  locationCode: z.number().int().positive().optional(),
  languageCode: z.string().min(2).max(8).optional(),
  resultLimit: z.union([z.literal(150), z.literal(300), z.literal(500)]).default(150),
  mode: z.enum(["auto","related","suggestions","ideas"]).optional().default("auto"),
  clickstream: z.boolean().optional().default(false),
})
```

Response: `{ rows: KeywordResearchRow[], source: "related"|"suggestions"|"ideas"|"google_ads", usedFallback: boolean, diagnostics: { requestedMode, threshold, sourceAttempts: [{source,rowCount,nonSeedCount}] } }` where `KeywordResearchRow = {keyword, searchVolume|null, trend: {year,month,searchVolume}[], cpc|null, competition|null (0-1), keywordDifficulty|null (0-100), intent: "informational"|"commercial"|"transactional"|"navigational"|"unknown"}`.

#### Research algorithm (`src/server/features/keywords/services/research/research.ts`)

1. `uniqueKeywords = dedupe(keywords.map(k => k.trim().toLowerCase())).filter(nonEmpty)`; empty → `VALIDATION_ERROR`. `seed = uniqueKeywords[0]`.
2. `provider = getKeywordDataProvider(locationCode)` → `"labs"` or `"google_ads"`. For google_ads force `mode="auto"`, `clickstream=false` (collapses cache entries).
3. Cache key `buildCacheKey("kw:research", {cacheVersion:3, organizationId, projectId, keywords: uniqueKeywords, locationCode, languageCode, resultLimit, mode, depth:3, clickstream})` → `"kw:research:<sha256(json with sorted keys)>"`. R2 read; if a valid cached result with ≥1 row exists, return it.
4. Fetch:
   - **google_ads**: `keywords_for_keywords` for the seed (single source), limit = resultLimit (truncated client-side of the API).
   - **auto (Labs)**: iterate `related → suggestions → ideas`; accumulate unique rows (by normalized keyword) up to `resultLimit`; after each source, stop if non-seed rows ≥ `MIN_NON_SEED_FOR_AUTO = 5`. `usedFallback = source !== "related"`; if all three exhausted → last source, `usedFallback=true`.
   - **manual** mode: only that source.
5. `setCached(key, result, CACHE_TTL.researchResult = 86400 s)` (24h).
6. Fire-and-forget upsert of every row into `keyword_metrics` (project/keyword/location/language unique) with `monthlySearchesJson`.

Row mapping (Labs items; `related_keywords` items are unwrapped from `item.keyword_data`):
```ts
keywordInfo = item.keyword_info_normalized_with_clickstream?.search_volume
  ? item.keyword_info_normalized_with_clickstream : item.keyword_info
row = { keyword: normalize(item.keyword),
  searchVolume: keywordInfo.search_volume, trend: keywordInfo.monthly_searches → {year,month,searchVolume},
  cpc: item.keyword_info.cpc, competition: item.keyword_info.competition,       // 0-1
  keywordDifficulty: item.keyword_properties.keyword_difficulty,
  intent: normalizeIntent(item.search_intent_info.main_intent) }
// dedupe by normalized keyword; skip items with no keyword
```
Google Ads mapping: `searchVolume=search_volume, cpc, competition = competition_index/100, keywordDifficulty=null, intent="unknown", trend=monthly_searches`.

`normalizeIntent(raw)`: lowercase contains `inform`→informational, `commerc`→commercial, `transact`→transactional, `navig`→navigational, else unknown.

### Saved Keywords

#### Route & layout

- Route `/p/$projectId/saved` (`src/routes/_project/p/$projectId/saved.tsx`). Nav label "Saved Keywords".
- Header: H1 "Saved Keywords", subtitle "Save keyword ideas from research, organize them with tags, and revisit when you're ready to act." Right side:
  - "Actions ▾" menu → "Update keyword stats — Volume, difficulty & CPC" (calls `refreshSavedKeywordMetrics`; button shows spinner "Updating..."; toast "Updated stats for N keywords").
  - "Export ▾" → "Export to Sheets" / "Export CSV" (exports ALL rows matching current filters/tags/sort, via `exportSavedKeywords`, not just the page).
- Card: filter toolbar [Filters toggle + count] [Tag filter dropdown]; collapsible filter panel; status line (total count, "refreshing" indicator); table; pagination (50/100/250).
- Floating bulk-action bar when rows selected: "Tag" (opens bulk tag modal), Export ▾ ("Copy keywords" → newline-joined to clipboard, "Export to Sheets", "Export CSV"), "Delete" (danger → confirm modal "DeleteSavedKeywordsModal"), clear selection.

#### Table columns (`SavedKeywordsTable`, server-side sorting, row id = saved keyword id)

| Column | Render | Sort key |
|---|---|---|
| select | checkbox (shift range) | — |
| Keyword | bold text | `keyword` |
| Volume | number/`-` | `searchVolume` |
| CPC | `$x.xx` | `cpc` |
| Competition (help: paid-search 0-1) | `0.00` | `competition` |
| Difficulty (help: 0-100) | DifficultyBadge | `keywordDifficulty` |
| Intent | IntentBadge (unknown if null) | not sortable |
| Tags | TagChip list (xs) or "-" | not sortable |
| Last Fetched | `toLocaleDateString()` of metric `fetchedAt` | `fetchedAt` |

Default UI sort: `fetchedAt desc`. Empty state: "No saved keywords match the current filters." / "No saved keywords yet. Use the Keyword Research page to find and save keywords." Selection is cleared on page/filter/tag/sort change.

#### Filters (server-side, debounced 350 ms, reset to page 1)

- Include / Exclude term chip inputs ("Must contain… e.g. audit", "Must not contain… e.g. jobs"): Enter or comma commits a chip, Backspace removes last, blur commits; terms split on `,`/`+`. Include chips green (+), exclude chips rose (−).
- Ranges: Search Volume (int ≥0), CPC USD (float ≥0), Difficulty (int clamped 0-100).
- Tag filter dropdown: searchable tag list with color dot + keyword count, multi-select (matches ANY selected tag), "Clear all", per-tag "…" manage row: Rename input, 8 color swatches, Delete, Save.
- Server SQL: `lower(keyword) LIKE %term%` per include term (ALL must match), `NOT LIKE` per exclude term, `>=/<=` on joined `keyword_metrics` columns, `EXISTS (assignment with tag_id IN (...))`. LIKE escaping of `\ % _`.

#### Tags

- Tag name normalization: trim, collapse whitespace; `normalizedName = toLocaleLowerCase()`; unique per project on normalizedName; max length 64; ≤20 tags per operation. Tag input parsing splits on newline/comma.
- Colors: palette keys `slate, rose, amber, lime, emerald, sky, violet, fuchsia`. `color` column nullable; null → deterministic color `TAG_COLOR_KEYS[abs(hash31(tag.id)) % 8]` where `hash = (hash*31 + charCode) | 0`.
- **Bulk tags modal** ("Apply or remove tags across N selected keywords"): two modes "Add tags (n)" / "Remove tags (n)". Add mode: chips of pending names, "Search or create…" input (creates new tag if no normalized match), checklist of existing tags. Remove mode: only tags present on selected rows ("The selected keywords don't have any tags to remove."). Apply → `updateSavedKeywordTags({savedKeywordIds, addTags?, removeTagIds?})`; toast "Updated tags for N keywords".
- Delete tag is refused while assigned: repository returns `in_use` → service throws `TagInUseError` (code `TAG_IN_USE`, message "Tag is attached to N keywords. Remove the tag from those keywords first.").
- `tagMode` on save: `append` (default) adds; `replace` adds new tags then deletes assignments not in the provided set (requires ≥1 tag).

#### Server functions (all `POST`, `requireProjectContext`)

| Fn | Schema | Behavior |
|---|---|---|
| `saveKeywords` | `{projectId, keywords: string[1..500], locationCode?, languageCode?, tags?: string(1..64)[≤20], tagMode?: "append"\|"replace", metrics?: savedKeywordMetricSchema[≤500]}` (refine: replace ⇒ tags required) | normalize/dedupe keywords; upsert provided metrics to `keyword_metrics`; batch `INSERT … ON CONFLICT DO NOTHING` into `saved_keywords` (unique project+keyword+location+language); apply tags. Returns `{success, savedKeywordIds}`. No DataForSEO call. |
| `getSavedKeywords` | `{projectId, search?(≤200), includeTerms?[≤20], excludeTerms?[≤20], minVolume?, maxVolume?, minCpc?, maxCpc?, minDifficulty?(0-100), maxDifficulty?, tagIds?[≤50], tagNames?[≤50], page=1, pageSize: 50\|100\|250 = 50, sort: createdAt\|keyword\|searchVolume\|cpc\|competition\|keywordDifficulty\|fetchedAt = createdAt, order = desc}` | LEFT JOIN `keyword_metrics` on (project, keyword, location, language); count + page; tags per row; returns `{rows: SavedKeywordRow[], totalCount, tags: {id,name,normalizedName,color,keywordCount}[]}`. `tagNames` resolved to ids; if names given but none match → empty result. Secondary order by id. |
| `exportSavedKeywords` | same minus page/pageSize | all matching rows `{rows}` |
| `updateSavedKeywordTags` | `{projectId, savedKeywordIds[1..2000], addTags?[≤20], removeTagIds?[≤50]}` (≥1 of add/remove) | returns `{success, taggedCount, addedTags, removedTagIds, removedAssignments}` |
| `updateSavedKeywordTag` | `{projectId, tagId, name?, color?: TagColorKey\|null}` (≥1) | rename/recolor |
| `deleteSavedKeywordTag` | `{projectId, tagId}` | fails if in use |
| `removeSavedKeywords` | `{projectId, savedKeywordIds[1..2000]}` | chunked deletes (90 ids) scoped to project; `{success, deletedCount}` |
| `refreshSavedKeywordMetrics` | `{projectId}` | see below |

`SavedKeywordRow = {id, projectId, keyword, locationCode, languageCode, createdAt, searchVolume, cpc, competition, keywordDifficulty, intent, monthlySearches[], fetchedAt, tags: {id,name,normalizedName,color}[]}`.

D1 parameter-limit chunk sizes (keep behaviour on Postgres too): query chunks 80, delete chunks 90, tag-pair delete 45, assignment insert 40, replace-delete 70.

#### Refresh metrics (`refreshSavedKeywordMetrics`)

Loads ALL saved keywords for the project, groups by `(locationCode, languageCode)`, calls `fetchKeywordMetricsForList(client, {keywords, locationCode, languageCode, creditFeature:"keyword_research"})` per group (batches of 700; Labs `keyword_overview` or Google Ads `search_volume`), then upserts `keyword_metrics` in chunks of 100 (`intent = normalizeIntent(raw)`). Returns `{updated}` = matched keywords count. This is a billed operation.

#### Saved-keyword export

Headers `["Keyword","Volume","CPC","Competition","Score","Intent","Tags","Fetched At"]`; tags joined by ", "; file `saved-keywords.csv` (CPC/competition `toFixed(2)`). PostHog `data:export {source_feature:"saved_keywords"}`.

#### Related MCP tools (cross-reference)

- `save_keywords` — keywords[1..100], metrics[≤100], tags[≤20], tagMode, location/language; no credits; destructiveHint true.
- `list_saved_keywords` — `{projectId, search?, tags?[≤20] (ANY), limit: 50|100|250 = 100}`; sort createdAt desc; returns rows `{id, keyword, searchVolume, keywordDifficulty, cpc, competition, intent, tags: string[]}`, `totalCount`, `tags:{name,keywordCount}`.
- `remove_saved_keywords` — `{projectId, savedKeywordIds}`; returns `{requested, deletedCount}`.
- `research_keywords` — `{projectId, seeds: {seed, locationCode?, languageCode?}[1..5], resultLimit?: 150|300|500, includeClickstreamData?}`; each seed runs `research()` with `mode:"auto"` in parallel; per-seed `{seed, ok, rowCount, source, usedFallback, rows (no trend)}` or `{ok:false, error}`; validates language/location pair first (`assertLanguageForLocation`).
- `get_keyword_metrics` — `{projectId, keywords: string(1..80)[1..700], locationCode?, languageCode?, includeMonthlyTrends? = true, includeClickstreamData? = false, sortBy? = "search_volume"}` → `fetchKeywordMetricsForList` → rows `{keyword, search_volume, keyword_difficulty, main_intent, cpc, competition, competition_level, monthly_searches|null}`.

### SERP Analysis

#### Server function `getSerpAnalysis` (POST, `requireProjectContext`)

```ts
serpAnalysisSchema = z.object({
  projectId, keyword: z.string().min(1),
  locationCode?: int>0, languageCode?: string(2..8),
  depth: z.union([z.literal(20), z.literal(100)]).default(20),
})
```

- Market resolved with `resolveMarket(data, project)`; keyword normalized (trim/lowercase).
- Cache: `buildCacheKey("serp:analysis", {organizationId, projectId, keyword, locationCode, languageCode})` (depth NOT in key). Cached value `{requestedKeyword, items, depth, reason?}` is used if `cached.depth >= requestedDepth`. TTL `12 * 60 * 60` s. Legacy entries without depth are treated as depth 20.
- Live call: `/v3/serp/google/organic/live/advanced` with `device:"desktop", os:"windows", depth = clamp(10..100)`; DataForSEO "No Search Results" (40501 w/ message) → empty list (still billed).
- Mapping keeps only `type === "organic"` items:
  `{rank: rank_group ?? rank_absolute ?? 0, title, url, domain, description, etv, estimatedPaidTrafficCost: estimated_paid_traffic_cost, referringDomains: backlinks_info.referring_domains, backlinks: backlinks_info.backlinks, isNew: false, rankChange: null}`.
- If 0 organic items → `reason: "no_organic_results"`. Guard: an empty re-crawl never overwrites a non-empty cached snapshot (returns the empty result without caching). Cache write via `waitUntil` so it survives response completion.

#### UI (`SerpAnalysisCard`)

- Opens at depth 20 (≈5 credits); 10 rows per page; "N organic results" label; "Export to Sheets" (headers Rank, Title, URL, Domain).
- Table: `#` (rank, mono) | "Page" (title as external link with icon — falls back to URL — and domain under it).
- Pagination "Page x of y" Prev/Next; when on the last loaded page and `depth < 100`, "Next" label becomes **"Load top 100"** → refetch at depth 100 (≈20 more credits; shallow results stay visible as placeholder, "Loading more results…").
- Errors: message + "Retry"; if the failed request was the depth-100 crawl, the button reads "Show top 20" and falls back to the cached shallow snapshot instead of re-buying.
- Query key `["serpAnalysis", projectId, keyword, locationCode, depth]`, `retry:false`, no refetch on focus/reconnect.
- Empty: "No SERP details available for this keyword yet. Try clicking another keyword to load data."
- Auto-load: after a research query succeeds, the SERP panel loads for the seed keyword (only if rows > 0).

#### MCP `get_serp_results`

`{projectId, queries: {keyword, locationCode?, languageCode?}[1..10], depth?: 10..100 step 10 (default 20)}` → parallel `serp.live`; returns ALL item types trimmed to `{type, rank: rank_absolute ?? rank_group, title, url, domain, description}`; per-query errors don't fail the batch. Not cached.

### Locations, Languages & Research Scope

#### Country list (`src/shared/keyword-locations.ts`)

- `LOCATION_OPTIONS`: **143** countries, alphabetical, each `{code: DataForSEO location_code, label, shortLabel (ISO-2 display; UK instead of GB), languageCode (default language), googleAdsOnly?: true}`.
  - **94 Labs countries** (code/default lang): AL 2008/sq, DZ 2012/fr, AO 2024/pt, AR 2032/es, AM 2051/hy, AU 2036/en, AT 2040/de, AZ 2031/az, BH 2048/ar, BD 2050/bn, BE 2056/nl, BO 2068/es, BA 2070/bs, BR 2076/pt, BG 2100/bg, BF 2854/fr, KH 2116/en, CM 2120/fr, CA 2124/en, CL 2152/es, CO 2170/es, CR 2188/es, CI 2384/fr, HR 2191/hr, CY 2196/el, CZ 2203/cs, DK 2208/da, EC 2218/es, EG 2818/ar, SV 2222/es, EE 2233/et, FI 2246/fi, FR 2250/fr, DE 2276/de, GH 2288/en, GR 2300/el, GT 2320/es, HK 2344/zh-TW, HU 2348/hu, IN 2356/en, ID 2360/id, IE 2372/en, IL 2376/he, IT 2380/it, JP 2392/ja, JO 2400/ar, KZ 2398/ru, KE 2404/en, LV 2428/lv, LT 2440/lt, MY 2458/en, MT 2470/en, MX 2484/es, MD 2498/ro, MC 2492/fr, MA 2504/ar, MM 2104/en, NL 2528/nl, NZ 2554/en, NI 2558/es, NG 2566/en, MK 2807/mk, NO 2578/nb, PK 2586/en, PA 2591/es, PY 2600/es, PE 2604/es, PH 2608/en, PL 2616/pl, PT 2620/pt, RO 2642/ro, SA 2682/ar, SN 2686/fr, RS 2688/sr, SG 2702/en, SK 2703/sk, SI 2705/sl, ZA 2710/en, KR 2410/ko, ES 2724/es, LK 2144/en, SE 2752/sv, CH 2756/de, TW 2158/zh-TW, TH 2764/th, TN 2788/ar, TR 2792/tr, UA 2804/uk, AE 2784/en, UK 2826/en, US 2840/en, UY 2858/es, VE 2862/es, VN 2704/vi.
  - **49 Google-Ads-only** (`googleAdsOnly: true`): Andorra 2020/ca, Bahamas 2044, Barbados 2052, Belize 2084, Botswana 2072, Brunei 2096/ms, Dominican Republic 2214/es, Ethiopia 2231, Fiji 2242, Georgia 2268, Guernsey 2831, Guyana 2328, Haiti 2332/fr, Honduras 2340/es, Iceland 2352/is, Iraq 2368/ar, Isle of Man 2833, Jamaica 2388, Jersey 2832, Kuwait 2414/ar, Kyrgyzstan 2417/ru, Laos 2418, Lebanon 2422/ar, Liechtenstein 2438/de, Luxembourg 2442/fr, Madagascar 2450/fr, Malawi 2454, Maldives 2462, Mauritius 2480, Mongolia 2496, Montenegro 2499/sr, Mozambique 2508/pt, Namibia 2516, Nepal 2524, Oman 2512/ar, Palestine 2275/ar, Papua New Guinea 2598, Qatar 2634/ar, Rwanda 2646, San Marino 2674/it, Suriname 2740/nl, Tajikistan 2762/ru, Tanzania 2834, Trinidad and Tobago 2780, Turkmenistan 2795/ru, Uganda 2800, Uzbekistan 2860/ru, Zambia 2894, Zimbabwe 2716 (unlisted lang = en). China intentionally excluded.
- `DEFAULT_LOCATION_CODE = 2840` (United States, "en").
- `SERP_LANGUAGE_OPTIONS`: **128** languages `{code, label}` (the SERP API master list, e.g. `en, es, de, fr, zh-CN, zh-TW, pt-BR, pt-PT, es-419, sr-Latn, nb, fil, …`; `iw` and `no` dropped). Rank tracking offers all of them for any country.
- `MULTI_LANGUAGE_LOCATIONS` (Labs per-country language lists): DZ [ar,fr], BE [de,fr,nl], CA [en,fr], CY [el,en], GR [el,en], HK [en,zh-TW], IN [en,hi], ID [en,id], IL [ar,he], MY [en,ms], MA [ar,fr], PK [en,ur], PH [en,tl], SG [en,zh-CN], CH [de,fr,it], AE [ar,en], UA [ru,uk], EG [ar,en], US [en,es], VN [en,vi]. All other countries: only their default language.
- Helpers:
  - `getKeywordDataProvider(code)`: known code & not Labs → `"google_ads"`; else `"labs"` (unknown codes fall through to Labs).
  - `resolveMarket(args, project)`: `locationCode = args.locationCode ?? project.locationCode`; `languageCode = args.languageCode ?? (location === project.location ? project.languageCode : defaultLanguage(location))`.
  - `resolveLabsMarket`: same, but if the project's market isn't Labs-served it falls back to US/en.
  - `resolveKeywordDataLanguage(loc, lang)`: keep lang if in the country's language options else default.
  - `isLanguageServedForLocation`, `isSupportedLanguageCode`, `getLanguageOptions(loc)`, `getIsoCountryCode(loc)` (lowercase ISO-2, UK→gb), `formatLocationLabel(name, maxSegments?)` (normalizes comma spacing), `LABS_LOCATION_OPTIONS` (used for domain-overview pickers).
  - `assertLabsLocationCode(loc)` → VALIDATION_ERROR "Domain analytics is not available for this country…" for Google-Ads countries. `assertLanguageForLocation(loc, lang)` → VALIDATION_ERROR "Language 'x' is not available for this location. Available: …" (prevents charged "Invalid Field" failures).

#### Sub-country SERP locations (local rank tracking picker)

- Server fns (`requireAuthenticatedContext`): `searchSerpLocations({query: string(1..100), countryCode: /^[a-z]{2}$/i})` → top 10 ranked matches; `prewarmSerpLocations({countryCode})` (fired when the user switches targeting to "Local").
- Source: `GET /v3/serp/google/locations/{iso2}` (free). Keep only `location_type ∈ {City, County, Municipality, DMA Region, Region}` → `{locationCode, locationName, locationType, displayLabel}`. Cached in Cloudflare KV key `serp-locations:{iso}` for **30 days**, with 24 h edge `cacheTtl`; concurrent cold fills coalesced per isolate.
- Ranking (`rankSerpLocations`): fold text (NFD strip accents, lowercase, collapse spaces); tokenize on spaces/commas; expand region abbreviations (US states incl. DC, CA provinces, AU states) for tokens after the first; candidate must contain every token; score 0 exact place-phrase, 1 place == first token, 2 place startsWith first token, 3 otherwise; tie-break by type rank (City 0, Municipality 1, City Region/Borough 2, County 3, State/Province/Region 4, Country 5, DMA Region 6, Neighborhood/District 7, other 9), then alphabetical; return 10. MCP `search_serp_locations` uses the same.
- Save-time validation for rank trackers with `location_name`: probe `https://sandbox.dataforseo.com/v3/serp/google/organic/live/advanced` (`keyword:"pizza", location_name, language_code, depth:10`, 10 s timeout, free). 20000 → OK; 4xxxx with `Invalid Field: 'location_name'` → VALIDATION_ERROR telling the caller to use `search_serp_locations`; other 4xxxx → "DataForSEO rejected this tracker: …"; sandbox outage/5xxxx → fail open.

#### Research scope (`src/shared/researchScope.ts`) — used by Domain overview / Backlinks / AI (documented here as a shared primitive)

- Scopes: `exact_url` ("Exact URL — One page only", `example.com/path`), `subfolder` ("Subfolder — The path and everything under it", `example.com/path/*`), `domain` ("Domain — The hostname, without subdomains", `example.com/*`), `subdomains` ("Subdomains — The domain plus all its subdomains", `*.example.com/*`).
- `parseResearchTarget(input, requestedScope?)`: add `https://` if no scheme; reject embedded credentials; `hostname` = lowercase minus leading `www.`; must contain a dot, match `/^[a-z\d.-]+$/`, and be a real registrable domain via `tldts` (no IPs/fake TLDs); path normalized (`/`→`""`, trailing slashes stripped, query/fragment ignored, case preserved). `subfolder` requires a non-root path ("Add a path to use Subfolder (e.g. example.com/blog)"). Default scope: root input → `subdomains`, input with path → `subfolder`. `display` = hostname (+path for url scopes). Scope is omitted from URLs/history when equal to the default.
- Provider filters (DataForSEO allows max **8** filter conditions; scope consumes slots): `RESEARCH_SCOPE_FILTER_SLOTS = {keywords: {exact_url:4, subfolder:4, domain:1, subdomains:0}, pages: {exact_url:4, subfolder:4, domain:2, subdomains:0}}`; backlinks subfolder consumes 4.
  - ranked_keywords: `domain` → `["ranked_serp_element.serp_item.domain","in",[host,"www."+host]]`; `subfolder` → host pin AND (`relative_url = path` OR `like path/%` OR `like path?%`); `exact_url` → host pin AND (`relative_url in [path, path+"/"]` OR `like path?%` OR `like path/?%`).
  - relevant_pages: `domain` → `page_address like %://host/%` OR www variant; `subfolder` → 4 `like` patterns (`%://{host|www.host}{path}` and `…{path}/%`); `exact_url` → `%://host{path}` / `%://host{path}/` × 2 hosts.
  - backlinks (`url_to` or `url`): only subfolder needs the 4-pattern group.
  - Filter helpers: `escapeLikeTerm` (escape `\ % _`), include terms → OR group of `ilike %term%`, numeric ranges `>=`/`<=`, `assertFilterConditionBudget` throws VALIDATION_ERROR "Too many filter conditions (n of 8 max)."
- `urlMatchesResearchTarget(url, target)`: post-filter for providers without scoping (subfolder `/blog` matches `/blog/x`, not `/blogging`).
- `detectTarget(raw)` (AI/brand lookup): no whitespace + contains dot + normalizes to hostname → `{type:"domain"}` else `{type:"keyword"}`.

### DataForSEO Endpoints (Keyword Research, Saved Keywords, SERP, Locations)

| Feature | Endpoint (full path) | Request payload sent | Response fields consumed / displayed |
|---|---|---|---|
| Keyword research — Related (auto step 1 / mode `related`) | `POST /v3/dataforseo_labs/google/related_keywords/live` | `[{keyword: seed, location_code, language_code, limit: resultLimit(150/300/500), depth: 3, include_clickstream_data: cs (default false), include_serp_info: false}]` | `result[0].items[].keyword_data.{keyword, keyword_info.{search_volume, cpc, competition, monthly_searches[{year,month,search_volume}]}, keyword_info_normalized_with_clickstream.{search_volume, monthly_searches}, keyword_properties.keyword_difficulty, search_intent_info.main_intent}`; `cost`, `path` |
| Keyword research — Suggestions | `POST /v3/dataforseo_labs/google/keyword_suggestions/live` | `[{keyword, location_code, language_code, limit, include_clickstream_data, include_serp_info: false, include_seed_keyword: true, ignore_synonyms: false, exact_match: false}]` | `items[].{keyword, keyword_info.*, keyword_info_normalized_with_clickstream.*, keyword_properties.keyword_difficulty, search_intent_info.main_intent}` |
| Keyword research — Ideas | `POST /v3/dataforseo_labs/google/keyword_ideas/live` | `[{keywords: [seed], location_code, language_code, limit, include_clickstream_data, include_serp_info: false, ignore_synonyms: false, closely_variants: false}]` | same as suggestions |
| Keyword research (Google-Ads-only countries) | `POST /v3/keywords_data/google_ads/keywords_for_keywords/live` | `[{keywords: [seed], location_code, language_code, sort_by: "search_volume"}]` (no limit param → truncated to resultLimit after response) | `result[].{keyword, search_volume, cpc, competition_index (→/100), monthly_searches}` (result is the item list directly) |
| Keyword metrics (saved-keyword refresh, `get_keyword_metrics`, rank-tracking metrics) — Labs | `POST /v3/dataforseo_labs/google/keyword_overview/live` | `[{keywords: batch(≤700), location_code, language_code, include_clickstream_data (default false)}]` | `items[].{keyword, keyword_info.{search_volume, cpc, competition, competition_level, monthly_searches}, keyword_info_normalized_with_clickstream.{search_volume, monthly_searches}, keyword_properties.keyword_difficulty, search_intent_info.main_intent}` |
| Keyword metrics — Google Ads / local (city) volume | `POST /v3/keywords_data/google_ads/search_volume/live` | `[{keywords: batch(≤700), location_code OR location_name (canonical city string), language_code}]` | `result[].{keyword, search_volume, cpc, competition (LOW/MEDIUM/HIGH → competitionLevel), competition_index, monthly_searches}` |
| SERP analysis panel / `get_serp_results` | `POST /v3/serp/google/organic/live/advanced` | `[{keyword, location_code, language_code, device: "desktop", os: "windows", depth: 20 or 100 (clamped 10-100; MCP any multiple of 10)}]` | `items[].{type, rank_group, rank_absolute, domain, title, url, description, breadcrumb, etv, estimated_paid_traffic_cost, backlinks_info.{referring_domains, backlinks}, rank_changes.*}`; UI shows organic rank/title/url/domain |
| SERP location list (local targeting picker, `search_serp_locations`) | `GET /v3/serp/google/locations/{iso2}` (free) | — | `result[].{location_code, location_name, location_type}` filtered to City/County/Municipality/DMA Region/Region |
| Location-name validation (tracker save) | `POST https://sandbox.dataforseo.com/v3/serp/google/organic/live/advanced` (free sandbox) | `[{keyword: "pizza", location_name, language_code, depth: 10}]` | `tasks[0].{status_code, status_message}` |
| Account usage (maintainer script only) | `GET /v3/appendix/user_data` (free) | — | `result[0].money.{total, balance, statistics.day, statistics.minute}` |

Endpoints defined in the same client but belonging to other areas (documented by their sections): `/v3/dataforseo_labs/google/{domain_rank_overview, ranked_keywords, relevant_pages, serp_competitors}/live` (domain overview / MCP `find_serp_competitors` with `item_types` default `["organic","local_pack"]`, limit 50), `/v3/serp/google/organic/task_post` + `/v3/serp/google/organic/task_get/advanced/{id}` + live `rankCheck` with `stop_crawl_on_match` (rank tracking), `/v3/serp/google/maps/live/advanced`, `/v3/serp/google/local_finder/live/advanced` and `business_data/*` (local SEO), `backlinks/*`, `ai_optimization/*`, Lighthouse (`on_page`).

---

## 3. Domain Overview / Competitor Insights (incl. Research Scope)

Source files (read-only reference): `src/client/features/{domain,backlinks,dashboard}/**`, `src/client/components/table/**`,
`src/server/features/{domain,backlinks,dashboard,activation}/**`, `src/serverFunctions/{domain,backlinks,ahrefs,dashboard}.ts`,
`src/server/lib/dataforseo/{labs,backlinks,filters,researchScopeFilters,client}.ts`, `src/server/lib/dataforseoBacklinksTarget.ts`,
`src/shared/researchScope.ts`, `src/types/schemas/{domain,backlinks,dashboard}.ts`, `e2e/domain-overview*.ts`.

### Research Scope (shared by Domain Overview, Backlinks, Brand Lookup)

Every domain/URL research input is paired with a **Research Scope** selector (`ResearchScopeSelect`, a custom dropdown — not native select — showing label, one-line description and wildcard example per option).

| Scope id | Label | Description | Example |
|---|---|---|---|
| `exact_url` | Exact URL | One page only | `example.com/path` |
| `subfolder` | Subfolder | The path and everything under it | `example.com/path/*` |
| `domain` | Domain | The hostname, without subdomains | `example.com/*` |
| `subdomains` | Subdomains | The domain plus all its subdomains | `*.example.com/*` |

**Target parsing** — `parseResearchTarget(input, requestedScope?)` (`src/shared/researchScope.ts`):
1. Trim; empty -> `"Enter a domain or URL"`.
2. Prepend `https://` if no scheme; parse with `new URL`. Reject embedded credentials.
3. `urlHostname` = lowercased host (www kept); `hostname` = host with leading `www.` stripped.
4. Validate: hostname contains `.`, matches `/^[a-z\d.-]+$/`, and is a real registrable domain via `tldts` public-suffix list (`!isIp && publicSuffix && (isIcann || isPrivate)`). Else `"Enter a valid domain like example.com"`.
5. `path` = pathname with trailing slashes stripped; `/` -> `""`. Query string/fragment ignored.
6. `subfolder` with empty path -> error `"Add a path to use Subfolder (e.g. example.com/blog)"`.
7. Default scope: `path === "" ? "subdomains" : "subfolder"`.
8. `display` = `hostname + path` for exact_url/subfolder, else `hostname`.

`toScopeSearchParam(input, scope)` omits scope from URLs when it equals the input's implied default. User-picked scope sticks while typing; otherwise scope auto-follows the input's default as the user types.

**DataForSEO filter budget:** max **8 filter conditions** per request (`MAX_DATAFORSEO_FILTER_CONDITIONS = 8`). Scope filters consume slots:
```ts
RESEARCH_SCOPE_FILTER_SLOTS = {
  keywords: { exact_url: 4, subfolder: 4, domain: 1, subdomains: 0 },
  pages:    { exact_url: 4, subfolder: 4, domain: 2, subdomains: 0 },
};
BACKLINKS_SUBFOLDER_FILTER_CONDITIONS = 4;
```
Client shows `N / max conditions`, disables Apply when over budget; server throws `VALIDATION_ERROR "Too many filter conditions (N of 8 max)."` rather than truncating.

**Filter-expression helpers** (`src/server/lib/dataforseo/filters.ts`):
- `escapeLikeTerm(t)` = escape `\`, `%`, `_` with backslash.
- `parseFilterTerms(s)` = lowercase, split on `,` or `+`, trim, drop empties.
- `collectNumericRange(out, field, min, max)` pushes `[field, ">=", min]` / `[field, "<=", max]` for finite values.
- `buildIncludeOrGroup(field, include)` = one `ilike %term%` per term, OR-joined into a nested group (single term = bare clause).
- `joinClauses(clauses, "and"|"or")` interleaves the operator string: `[c1, "and", c2, "and", c3]`.

**Scope filters for Labs endpoints** (`researchScopeFilters.ts`). Labs domain targets always roll up hostname + all subdomains, so narrower scopes need filters:
```ts
// ranked_keywords
hostPin = ["ranked_serp_element.serp_item.domain", "in", [hostname, `www.${hostname}`]]
subdomains: none
domain:     [hostPin]
subfolder:  [hostPin, [[rel,"=",path],"or",[rel,"like",`${path}/%`],"or",[rel,"like",`${path}?%`]]]
exact_url:  [hostPin, [[rel,"in",[path,`${path}/`]],"or",[rel,"like",`${path}?%`],"or",[rel,"like",`${path}/?%`]]]
   // rel = "ranked_serp_element.serp_item.relative_url"
// relevant_pages (only page_address available; `regex` unusable because API rejects "/")
domain:    [["page_address","like","%://host/%"], "or", ["page_address","like","%://www.host/%"]]
subfolder: OR of 4: %://{host|www.host}{path}  and  %://{host|www.host}{path}/%
exact_url: OR of 4: %://{host|www.host}{path}  and  %://{host|www.host}{path}/
// backlinks (only subfolder needs filter; field "url_to" for rows, "url" for domain pages)
subfolder: OR of 4 like-patterns on field, same shape as relevant_pages subfolder
```
`countExpressionConditions` counts leaf tuples recursively (skips "and"/"or").

### Domain Overview / Competitor Insights

#### Route
`/p/$projectId/domain` (sidebar label **"Domain Overview"**, Globe icon). Page header: "Domain Overview — Analyze any domain's SEO profile: traffic, keywords, and backlinks."

#### URL search params (`domainSearchSchema`; defaults stripped from URL)
| Param | Type / values | Default | Meaning |
|---|---|---|---|
| `domain` | string | "" | Research target (domain or URL) |
| `scope` | research scope | derived from input | invalid scope for input falls back to default |
| `subdomains` | bool (legacy) | — | pre-scope URLs: true->`subdomains`, false->`domain` |
| `sort` | `rank|traffic|volume|score|cpc` | `traffic` | sort mode (shared by both tabs) |
| `order` | `asc|desc` | `asc` for rank, else `desc` | |
| `tab` | `keywords|pages` | `keywords` | |
| `loc` | positive int (DataForSEO location code) | project's location if Labs-supported, else `DEFAULT_LOCATION_CODE` (2840 US) | non-Labs codes ignored |
| `page` | positive int | 1 | |
| `size` | 50/100/200 | 100 | page size |
| `include`,`exclude`,`minTraffic`,`maxTraffic`,`minVol`,`maxVol`,`minCpc`,`maxCpc`,`minKd`,`maxKd`,`minRank`,`maxRank` | keyword-tab filters | — | |
| `pInclude`,`pExclude`,`pMinTraffic`,`pMaxTraffic`,`pMinVol`,`pMaxVol` | pages-tab filters (`pMinVol/pMaxVol` = keyword count) | — | |

Location/language: server resolves with `resolveLabsMarket(data, project)` — explicit args win; else project market if the project's location is a Labs location and the language is served there; else US/en. The location dropdown uses `LABS_LOCATION_OPTIONS` only (Google-Ads-only countries excluded).

#### Layout / UI
1. **Search card** (`DomainSearchCard`, TanStack Form): text input "Enter a domain or URL" (search icon) · ResearchScopeSelect · LocationSelect (Labs countries) · sort select ("By Rank / By Traffic / By Volume / By Score / By CPC") · **Search** button ("Loading..." while busy). Inline field error and form-level error box (overview query error message shown as form error "Lookup failed.").
   - On submit: re-parse target, normalize input to `target.display`, write URL params, **clear all keyword+page filters**, reset page/size, keep current tab/order.
   - Changing sort or location in the card immediately updates URL (page reset).
2. **No domain** -> Recent searches section (`DomainHistorySection`): empty state "Enter a domain to get started" (Globe icon) or list "N recent searches": each row = clock icon, domain, scope label, date (Mon D), hover X to remove. Click restores domain/scope/sort/tab/loc and clears filters.
3. **Search tabs strip** (`SearchTabStrip`) + "← Recent searches" button (clears URL). Browser-tab-like strip of up to **20** open searches, persisted in localStorage key `search-tabs:domain:{projectId}`; label = domain (+ location name if non-default). Each tab shows status dot: spinner (loading), red (error), primary dot (result arrived but unviewed), none. Close button (`aria-label="Close {label} tab"`); closing active tab selects neighbor; closing inactive tab keeps selection.
4. **Target badges**: displayTarget badge + scope label badge.
5. **Stat cards** (2, `StatCard`): "Estimated Organic Traffic" (= `round(metrics.organic.etv)`), "Organic Keywords" (= `round(metrics.organic.count)`). If `!hasData` value shows "Not enough data". When scope ≠ subdomains, hint "Whole domain incl. subdomains" (domain_rank_overview can't be narrowed).
   - If `!hasData`: info alert "Not enough data for this scope yet. Try another domain or a broader scope." and a toast "Not enough data for this domain".
   - Note: the overview result also has `backlinks` / `referringDomains` fields, always `null` (legacy; not displayed in UI; MCP prints "?").
6. **Results card with tabs**: "Top Keywords" | "Top Pages". There is **no competitors tab** in the UI (competitor discovery is MCP-only: `find_serp_competitors`, `get_ranked_keywords` — see MCP section). Switching to Pages when sort is a keywords-only sort (`rank|score|cpc`) resets sort to `traffic desc`.

#### Top Keywords tab (`KeywordsTab` + `DomainKeywordsTable`)
Toolbar: **Filters** toggle (badge = active filter count) · "`{totalCount}` keywords" · Export menu. Filter panel inline under toolbar. Pagination footer.

Columns (TanStack table, server-side sorting via header click; clicking the active column toggles order, a new column uses its default order):
| # | Column | Source field | Render | Sort mode |
|---|---|---|---|---|
| 0 | selection checkbox | — | shift-click range select | — |
| 1 | Keyword | `keyword_data.keyword` | bold | — |
| 2 | Rank | `serp_item.rank_absolute` (rounded) | number or "-" | `rank` (default asc) |
| 3 | Volume | `keyword_info.search_volume` (rounded) | Intl format | `volume` |
| 4 | Traffic | `serp_item.etv` | rounded | `traffic` |
| 5 | CPC | `keyword_info.cpc` | `$x.xx` (help "Cost per click in USD.") | `cpc` |
| 6 | URL | `serp_item.url` / `relative_url` | external link (label = relative URL), resolves relative against hostname | — |
| 7 | Score | `keyword_properties.keyword_difficulty` (fallback `keyword_info.keyword_difficulty`, rounded) | `DifficultyBadge` circle colored by tier | `score` |

Difficulty tiers (`scoreTierClass`): null->`na`; ≤20 tier1; ≤35 tier2; ≤50 tier3; ≤65 tier4; ≤80 tier5; else tier6. Help: "Organic ranking difficulty (0-100): higher means harder to reach Google's top 10."

Mapper (`mapKeywordItem`): keyword = `keyword_data.keyword ?? item.keyword` (row dropped if missing); url = `serp_item.url ?? ranked_serp_element.url`; relativeUrl = `serp_item.relative_url ?? ranked_serp_element.relative_url ?? toRelativePath(url)`.

Row selection: selection pruned to visible rows when page changes. Floating **bulk action bar** (bottom-center, "N selected", clear X): **Save Keywords** (disabled unless the location in the search card equals the applied location and overview hasData) · Export menu (Export to Sheets / Download CSV of selection). Save calls `saveKeywords({projectId, keywords, locationCode, metrics:[{keyword, searchVolume, cpc, keywordDifficulty}]})`, toast "Saved N keywords", invalidates `["savedKeywords", projectId]`, PostHog `keyword:save {source_feature:"domain_overview"}`. Above table: "N selected" or "Select keywords to save".

Keyword filters panel (`DomainFilterPanel`, generic):
- Text: "Include Terms" (placeholder `audit, checker, template`), "Exclude Terms" (`jobs, salary, course`) — comma/plus separated.
- Ranges (Min/Max): Traffic, Volume, CPC (USD, step 0.01), Score (KD), Rank.
- Header: "Refine table results", "N active" badge, "N unapplied" badge, **Clear all**. Footer: "N / max conditions", **Cancel** (revert draft), **Apply filters** (badge = dirty count; disabled when not dirty or over limit). Enter key applies. Over-limit warning: "Too many filter conditions (N of M max). Remove some terms or ranges before applying."
- Client condition count: each include/exclude term = 1; each non-empty range bound = 1. Max = 8 − scope slots.
- Applying writes filters to URL (page reset) **and** saves them as "filter defaults" in localStorage `domain-overview-filter-defaults:{projectId}:{target}:keywords`. When the URL has no filter params, saved defaults are applied. If restored filters exceed the scope's budget, they are not sent and a warning shows: "Saved filters exceed this scope's N-condition limit and were not applied. Open Filters to trim them."

Server translation (`buildKeywordFilters`, order: scope clauses, include, exclude, ranges, search OR-group; all AND-joined):
```ts
include term -> ["keyword_data.keyword", "ilike", `%${esc(term)}%`]      // each ANDed (all must match)
exclude term -> ["keyword_data.keyword", "not_ilike", `%${esc(term)}%`]
minVol/maxVol     -> "keyword_data.keyword_info.search_volume" >= / <=
minTraffic/max    -> "ranked_serp_element.serp_item.etv"
minCpc/maxCpc     -> "keyword_data.keyword_info.cpc"
minKd/maxKd       -> "keyword_data.keyword_properties.keyword_difficulty"
minRank/maxRank   -> "ranked_serp_element.serp_item.rank_absolute"
search (API only) -> [["keyword_data.keyword","ilike","%s%"],"or",["ranked_serp_element.serp_item.url","ilike","%s%"]]  // costs 2 slots
```
Sort mapping (`order_by: ["<field>,<asc|desc>"]`):
`rank->ranked_serp_element.serp_item.rank_absolute`, `traffic->ranked_serp_element.serp_item.etv`, `volume->keyword_data.keyword_info.search_volume`, `score->keyword_data.keyword_properties.keyword_difficulty`, `cpc->keyword_data.keyword_info.cpc`.

#### Top Pages tab (`PagesTab` + `DomainPagesTable`)
Columns: **Page** (external link, label = relative path; max-width 420) · **Organic Traffic** (`metrics.organic.etv`, rounded; sort `traffic`) · **Keywords** (`metrics.organic.count`; clicking sorts with mode `volume` which maps to pages sort `keywords`). No selection column. Quirk: the table renders at most the first 100 rows of the page (`rows.slice(0,100)`).
Filters: "Include Page Terms" (`pricing, tools, guides`), "Exclude Page Terms" (`blog, tag, archive`), ranges Traffic, Keywords. Server:
```ts
include -> ["page_address","ilike","%t%"] (ANDed)   exclude -> ["page_address","not_ilike","%t%"]
traffic range -> "metrics.organic.etv"   keywords range -> "metrics.organic.count"
search -> ["page_address","ilike","%s%"]
order_by: traffic -> "metrics.organic.etv,<o>"; keywords -> "metrics.organic.count,<o>"
```
Page filter defaults persisted under `domain-overview-filter-defaults:{projectId}:{target}:pages`. Clearing pages filters does not clear keyword filters (e2e-tested).

#### Exports (both tabs, toolbar Export menu)
- **Export to Sheets**: copies table as TSV + HTML to clipboard, opens modal prompting to open `sheets.new` (see Shared Tables).
- **Copy data (JSON)**: `JSON.stringify(rows, null, 2)` to clipboard, toast "Copied data".
- **Download CSV** -> `{target with / replaced by -}-keywords.csv` / `-pages.csv`.
- **Download Excel** -> same CSV content with `.xls` extension.
- Keyword export headers: `Keyword, Rank, Volume, Traffic, CPC, URL, Score`. Pages: `Page, Organic Traffic, Keywords`.
- PostHog events: `data:export {source_feature:"domain_overview", result_count}`, `data:export_sheets`.

#### Pagination (`DomainKeywordsPagination`)
Shows "start–end of total" (or "start–end" if total unknown), spinner while fetching, "Rows per page" select (50/100/200), "Page X of Y", prev/next. `hasMore = totalCount != null ? offset + fetched < totalCount : fetched === pageSize`.

#### Search history
localStorage `domain-search-history:{projectId}`, max **20** items `{domain, scope, sort, tab, locationCode?, timestamp}`, deduped on (domain, scope, sort, tab, locationCode), newest first. Added after a successful overview load (also fires PostHog `domain_overview:search_complete {sort_mode, scope, result_count, location_code}`).

#### Server functions (TanStack server fns, all POST, `requireProjectContext` middleware)
| Fn | Input | Output |
|---|---|---|
| `getDomainOverview` | `{projectId, domain, scope?, locationCode?, languageCode?}` | `{domain, organicTraffic, organicKeywords, backlinks:null, referringDomains:null, hasData, fetchedAt, scope, displayTarget}` |
| `getDomainKeywordSuggestions` | same | top 100 keywords `[{keyword, position, searchVolume, traffic, cpc, keywordDifficulty}]` (used by MCP + rank-tracking keyword suggestions) |
| `getDomainKeywordsPage` | `{projectId, domain, scope?, loc/lang?, page=1, pageSize∈{50,100,200}=100, sortMode=traffic, sortOrder=desc, filters={}, search?}` | `{domain, page, pageSize, totalCount, hasMore, keywords[], fetchedAt}` |
| `getDomainPagesPage` | same but `sortMode ∈ {traffic, keywords}` | `{..., pages:[{page, relativePath, organicTraffic, keywords}]}` |

Env flag `VITE_E2E_DOMAIN_FIXTURES=1` returns deterministic fixtures (`e2e/fixtures/domain-overview-fixtures.ts`) instead of calling DataForSEO.

#### Caching (server, R2)
All cache in R2 bucket under `dataforseo-cache/{prefix}:{sha256(JSON of sorted params)}`, soft TTL in object custom metadata `expiresAt`. Writes via `waitUntil` (fire after response).
- `domain:overview` key {organizationId, projectId, domain(hostname), locationCode, languageCode} — **12h**; only cached when `hasData` (organicKeywords > 0). Shared by all scopes.
- `domain:keyword-suggestions` {org, project, hostname, scope, path, loc, lang} — 12h; only when non-empty.
- `domain:keywords-page` / `domain:pages-page` {org, project, hostname, scope, path, loc, lang, page, pageSize, sortMode, sortOrder, filters, search} — 12h.
Client React Query stale times: overview 5 min, keyword/pages pages 60 s.

#### Billing
Every DataForSEO call goes through `meter()` in `createDataforseoClient`; in hosted mode it asserts credits available, executes, and tracks `costUsd` from the task envelope under credit feature derived from path: `dataforseo_labs` endpoints `domain_*`, `ranked_keywords`, `relevant_pages` -> **`domain_overview`**. Callers (e.g., SAM agent) can override `creditFeature`. Self-host: no metering.

---

## 4. Backlinks

### Backlinks

#### Route
`/p/$projectId/backlinks` (sidebar "Backlinks", Link2 icon). Header: "Backlinks — Understand who links to a site, what changed recently, and which pages attract links."

#### URL search params (`backlinksSearchSchema`)
| Param | Values | Default |
|---|---|---|
| `target` | string | "" |
| `scope` | research scope or legacy `page` (= exact_url) | `defaultScopeForInput(target)` |
| `tab` | `backlinks|domains|pages` | `backlinks` (if scope=subfolder and tab=domains -> forced to backlinks) |
| `page` | int | 1 |
| `size` | 50/100/200 | 100 |
| `sort` | column id of active tab | tab default |
| `order` | asc/desc | tab default (desc if sort given w/o order) |
| `view` | `all` | absent = one-per-domain |

Default sorts: backlinks `firstSeen desc` (newest first), domains `backlinks desc`, pages `backlinks desc`. Changing tab resets page/sort/order; changing sort resets page.

#### Target normalization (`normalizeBacklinksTarget`)
- Non-exact scopes: `apiTarget = hostname` (www stripped); `includeSubdomains = scope === "subdomains"`; `path` kept only for subfolder; displayTarget = `display` for subfolder else hostname.
- `exact_url`: rejects `?` or `#` ("Page URLs with query strings or fragments are not supported"); `apiTarget = {http|https}://{urlHostname}{path||"/"}` (keeps explicit `http://`, www preserved); includeSubdomains=true (ignored by API).

#### Page structure
1. **Search card**: target input ("Enter a domain or URL") · ResearchScopeSelect · Search. Validation "Enter a domain or URL to analyze." + parse errors. Submit opens a search tab, navigates, and adds to history. Overview error shown below card (VALIDATION_ERROR -> "Enter a valid domain or page URL.").
2. **No target** -> history (`backlinks-search-history:{projectId}`, max 20, `{target, scope, timestamp, scopeVersion:2}`, dedupe on target+scope; legacy scopes translated `domain->subdomains`, `page->exact_url`). Empty state "Enter a domain or URL to get started".
3. **Search tabs strip** (localStorage `search-tabs:backlinks:{projectId}`), label = target.
4. Loading skeleton (8 stat cards + 2 charts + table) / error state "Could not load backlinks" + Retry.
5. **Overview panels** (`BacklinksOverviewPanels`):
   - "← Recent searches" link; line: scope badge · "Target: X" · "Updated {Mon D, h:mm}" · for `domain` scope: "- Trends include subdomains".
   - **Summary stats grid** (2 cols, each with help tooltip):
     | Label | Field | Format | Help |
     |---|---|---|---|
     | Backlinks | `summary.backlinks` | int | Total links pointing to this site or page. |
     | Referring Domains | `referring_domains` | int | Unique domains linking to this site or page. |
     | Referring Pages | `referring_pages` | int | Unique pages linking to this site or page. |
     | Rank | `rank` | int | DataForSEO's 0-100 authority score. |
     | Backlink Spam Score | `backlinks_spam_score` | 1 decimal | Estimated spam risk of links pointing here. |
     | Broken Backlinks | `broken_backlinks` | int | Links pointing to broken pages here. |
     | Broken Pages | `broken_pages` | int | Broken pages here that still have backlinks. |
     | Target Spam Score | `info.target_spam_score` | 1 decimal | Estimated spam risk of this site or page. |
   - **Trend charts** (only for scope domain/subdomains; Recharts LineChart, h=224):
     - "Backlink growth — Backlinks and referring domains over the last year": dual Y-axes; lines `backlinks` (#2563eb, left) and `referringDomains` (#14b8a6, right). X ticks "Mon 'YY"; tooltip label "Mon D, YYYY"; axis values compacted (K/M).
     - "New vs lost — Backlink acquisition and attrition": lines `lostBacklinks` (#ef4444) and `newBacklinks` (#16a34a).
     - Empty: "Not enough historical data yet."
   - Info alerts: exact_url "Showing backlinks for this exact page. Switch the scope to Domain or Subdomains for site-wide results — trend charts need one of those."; subfolder "Showing backlinks pointing into this subfolder. Counts come from filtered backlink totals; rank, trends, and the referring-domains breakdown need Domain or Subdomains scope."
6. **Results card** with tabs **Backlinks | Referring Domains | Top Pages** (Referring Domains hidden for subfolder). Each tab has a description:
   - backlinks: "See the individual links pointing to your target, including source page, anchor text, and link quality signals."
   - domains: "View the unique domains linking to your target, grouped at the site level instead of by individual link."
   - pages: "See which pages on the target site attract the most backlinks and referring domains."
   Toolbar: Export menu · "…" actions menu (only backlinks/domains tabs) containing **Ahrefs DR** · Filters toggle · (backlinks tab) view toggle **One per domain** / **All links**.

#### Backlinks tab table (`BacklinksTable`, fixed layout; server-side sort)
| Column id | Header (help) | Content | Sortable -> DataForSEO field |
|---|---|---|---|
| source | Source ("Page linking to you") | domain (www stripped, bold) + source URL (middle-truncated to 48) ; expand chevron in one-per-domain view | no |
| target | Target ("Destination on your site") | url_to (truncate 40) | no |
| anchor | Anchor ("Text or format of the link") | anchor or "No anchor text" + `item_type` subtext | no |
| flags | Flags | badges: **Lost** (is_lost), **Broken** (is_broken), **Nofollow** (dofollow===false), **N links** (links_count>1) | no |
| rank | Link ("Authority of the linking page") | `rank` | `rank` |
| domainRank | DA ("Authority of the linking domain") | `domain_from_rank` | `domain_from_rank` |
| ahrefsDr | Ahrefs DR (only after opt-in) | DR or "—" | no (client-side) |
| spamScore | Spam | `backlink_spam_score` rounded, blank if 0/null | `backlink_spam_score` |
| firstSeen | First Seen | `first_seen` date + "Last {lost_date ?? last_visited}" | `first_seen` |

Row mapping (`mapBacklinksRows`): `relAttributes = rel_attributes ?? attributes ?? []`; `spamScore = backlink_spam_score ?? backlinks_spam_score`; `lastSeen = lost_date ?? last_visited`; `isLost = is_lost ?? Boolean(lost_date)`; `isBroken = is_broken ?? false`.

**One-per-domain view & domain expansion**: default request `mode: "one_per_domain"` (DataForSEO returns each referring domain's strongest link). Each row has a chevron; expanding a domain lazily fires `getBacklinksRows({target, scope, page:1, pageSize:100, sortField:"rank", sortOrder:"desc", filters:{domainFrom: domain}, mode:"as_is"})` (one billed request per expansion, React Query stale 5 min, R2 cached). Child rows (depth 1, indented, muted background) exclude the parent's identical link (same urlFrom+urlTo+anchor); status rows "Loading links…", "Couldn't load this domain's links.", "No other links from this domain.". Expansions collapse on target/scope change. `view=all` uses `mode:"as_is"` and no expansion.

#### Referring Domains tab (`ReferringDomainsTable`, server sort)
Columns: **Domain** (external link https://domain) sort `domain` · **Backlinks** sort `backlinks` · **Referring Pages** sort `referring_pages` · **Rank** sort `rank` · [Ahrefs DR after Rank when enabled] · **Spam** (`backlinks_spam_score`, 1 decimal) sort `backlinks_spam_score` · **First Seen** sort `first_seen` · **Issues** ("Broken links: N / Broken pages: N") sort `broken_backlinks`.
Not available for subfolder scope (server throws VALIDATION_ERROR "Referring domains can't be broken down for a subfolder — use the Backlinks tab, or switch to Domain or Subdomains scope.").

#### Top Pages tab (`TopPagesTable`, server sort)
Columns: **Page** (external link; not sortable) · **Backlinks** (`backlinks`) · **Referring Domains** (`referring_domains`) · **Rank** (`rank`) · **Broken Backlinks** (`broken_backlinks`). Row page = `page ?? url`.

#### Filters (per tab, applied explicitly; persisted per tab in localStorage `backlinks-filters:{backlinks|domains|pages}`; values over the budget at load are discarded)
Uses the same `DomainFilterPanel` UI. Applying/clearing resets to page 1.
- **Backlinks tab**: "Source URL Contains" (`example.com, blog`), "Source URL Excludes" (`spam, forum`); ranges Domain Authority (`minDomainRank/maxDomainRank`), Link Authority (`minLinkAuthority/max`), Spam Score (step 0.1); extra controls: Link Type segmented **All / Dofollow / Nofollow**; Visibility checkboxes **Hide lost**, **Hide broken**.
- **Referring Domains**: "Domain Contains/Excludes"; ranges Backlinks, Rank, Spam Score.
- **Top Pages**: "Page URL Contains" (`/blog, /products`) / "Page URL Excludes" (`/tag, /author`); ranges Backlinks, Referring Domains, Rank.
- Budget: default 8; subfolder scope: `8 − 4 − (tab === "pages" ? 0 : 1)`.

Server translation (`backlinksApiFilters.ts`) — include terms OR-grouped (match any) and placed first; everything else ANDed:
```ts
// Backlinks rows
include -> OR group of ["url_from","ilike","%t%"]; exclude -> ["url_from","not_ilike","%t%"]
minDomainRank/max -> "domain_from_rank" >=/<=     minLinkAuthority/max -> "rank"
minSpamScore/max  -> "backlink_spam_score"
linkType          -> ["dofollow","=", linkType === "dofollow"]
hideLost          -> ["is_lost","=",false]         hideBroken -> ["is_broken","=",false]
domainFrom        -> ["domain_from","=",domain]    // used by row expansion
// Referring domains: include/exclude on "domain"; ranges "backlinks", "rank", "backlinks_spam_score"
// Top pages: include/exclude on "url"; ranges "backlinks", "referring_domains", "rank"
```
Scope clauses (subfolder only) are prepended with AND via `prependScopeClauses`.

**Spam filtering**: `normalizeBacklinksSpamFilterOptions` — default `hideSpam = true`, threshold 40 (clamped 0–100). When hideSpam: backlinks rows append `["backlink_spam_score","<=",40]`; referring domains append `["backlinks_spam_score","<=",40]` (counts 1 toward budget). **The web UI passes `hideSpam:false`** (spam is a user filter there); MCP tools default `hideSpam:true`.

#### Ahrefs DR enrichment (opt-in, free)
- Trigger: "…" menu -> **Ahrefs DR** ("Look up Ahrefs Domain Rating for each domain in the table"). Collects unique domains from loaded backlinks rows (`domainFrom` without www) and referring-domain rows.
- Client (`useAhrefsDomainRatings`) chunks 100 domains/call, sequential; skips known/pending; errors toast "Could not load Ahrefs DR." with partial results kept. After opt-in, newly loaded pages/tabs auto-enrich missing domains.
- Server fn `getAhrefsDomainRatings({projectId, domains≤100})`:
  - Endpoint: `GET https://api.ahrefs.com/v3/public/domain-rating-free?target={domain}` (no key), timeout 5 s, 20 concurrent per batch.
  - Normalize via `normalizeDomainInput(original, true)` (lowercase, strip www, validate); duplicates fan out to all originals.
  - Response `{domain_rating:{domain_rating: 0..100}}`; DR 0 -> `null` ("no rating").
  - Cache in Cloudflare **KV** `ahrefs-dr:{domain}` for 24h (stores `null` as "null" so negatives are cached). Per-domain failure -> null. Not billed, not stored in DB.
- Adds "Ahrefs DR" column (after DA in backlinks; after Rank in referring domains) and export column.

#### Exports
Export menu (disabled when no rows): **Export to Sheets** (feature `backlinks_{tab}`) and **Export CSV** -> filename `backlinks-{backlinks|referring-domains|top-pages}-{normalized target ≤80 chars}.csv`.
- Backlinks headers: `Domain, Source URL, Target URL, Anchor, Type, Dofollow, Rel Attributes, Domain Rank, [Ahrefs DR], Source Page Rank, Target Rank, Spam Score, First Seen, Last Seen, Lost, Broken, Links Count` (Source Page Rank = `page_from_rank`, Target Rank = `rank`).
- Referring domains: `Domain, Backlinks, Referring Pages, Rank, [Ahrefs DR], Spam Score, First Seen, Broken Backlinks, Broken Pages`.
- Top pages: `Page, Backlinks, Referring Domains, Rank, Broken Backlinks`.

#### Server functions
| Fn | Input | Service |
|---|---|---|
| `getBacklinksOverview` | `{projectId, target, scope?}` | `BacklinksService.profileOverview` -> `overview` |
| `getBacklinksRows` | `{projectId, target, scope?, page, pageSize, sortOrder, sortField∈{rank,domainRank,spamScore,firstSeen}, filters, mode∈{one_per_domain,as_is}}` | `profileBacklinksPage(..., {hideSpam:false})` |
| `getBacklinksReferringDomains` | `{..., sortField∈{domain,backlinks,referringPages,rank,spamScore,firstSeen,brokenBacklinks}, filters}` | `profileReferringDomainsPage(..., {hideSpam:false})` |
| `getBacklinksTopPages` | `{..., sortField∈{backlinks,referringDomains,rank,brokenBacklinks}, filters}` | `profileTopPagesPage` |
| `getAhrefsDomainRatings` | `{projectId, domains[]}` | Ahrefs free API + KV |

Page results: `{rows, totalCount, hasMore, page, pageSize, fetchedAt}`.

Overview result:
```ts
{ target, displayTarget, scope,
  summary: { rank, backlinks, referringPages, referringDomains, brokenBacklinks, brokenPages,
             backlinksSpamScore, targetSpamScore, newBacklinks, lostBacklinks,
             newReferringDomains, lostReferringDomains },
  trends: [{date, backlinks, referringDomains, rank}],
  newLostTrends: [{date, newBacklinks, lostBacklinks, newReferringDomains, lostReferringDomains}],
  fetchedAt }
```
Overview logic:
- **subfolder**: two sequential `backlinks/backlinks/live` calls with `limit:1` and the subfolder url_to filter: `mode:"as_is"` -> `totalCount` = backlinks; `mode:"one_per_domain"` -> `totalCount` = referringDomains; everything else null, no trends.
- **exact_url**: `summary/live` only (history skipped).
- **domain / subdomains**: `summary/live` + `history/live` in parallel. History date range: `date_to` = yesterday UTC, `date_from` = date_to − 1 year (YYYY-MM-DD). History dates sliced to `YYYY-MM-DD`; rows without date dropped. Both misspelled (`*_reffering_*`) and correct keys accepted.

#### Caching
R2 (same mechanism as above), **6h** TTL:
- `backlinks:overview` key {organizationId, target(apiTarget), scope, path, includeSubdomains}.
- `backlinks:rows-page`, `backlinks:referring-domains-page`, `backlinks:top-pages-page` key = target key + {page, pageSize, sortField, sortOrder, filters, mode?, hideSpam, spamThreshold?}.
Client React Query staleTime 5 min for all backlinks queries. Credit feature: `backlinks`.

#### Cost profiling script
`scripts/backlinks-cost-profile.ts` (`pnpm billing:backlinks --target=example.com --confirmLive=true [--scope=domain|subdomains|exact_url] [--repeat=1] [--includeTabs=true|false] [--allowCi=true]`): refuses in CI without `--allowCi`, requires `DATAFORSEO_API_KEY`; uses an in-memory cache; runs overview + (optionally) rows (`as_is`, sort rank), referring domains, top pages (page 1, size 100) N times and prints row counts per run to measure live billing. (Release note: switching trends to `history/live` reduced backlinks cost ~25%.)

---

## 5. Project Dashboard & Shared Table Components

### Project Dashboard

#### Route
`/p/$projectId/` (index; sidebar "Dashboard", exact match). `/_app/` index redirects to last-used project (localStorage, validated against org's project list) or first project; `PAYMENT_REQUIRED` -> subscribe route; shows auth-config / unauthenticated error cards.

#### Data loading
- `getDashboardActivation({projectId})` -> `DashboardActivation`:
  ```ts
  { domain, ga4:{connected, propertyDisplayName, cardDismissedAt},
    gsc:{connected, siteUrl},
    mcp:{authorizedAt, firstToolCallAt, cardDismissedAt},
    competitorClickedAt, hasMultipleProjects, hasTeammate, dismissedSteps: string[] }
  ```
  Sources: GA4/GSC connection tables by project, `organization_activation_state` (first MCP OAuth authorization / first external MCP tool call, COALESCE-first-write), `project_activation_state` (competitor click, MCP card dismissed, GA4 card dismissed), project count > 1, teammate = >1 member OR a pending unexpired invitation, `dashboard_step_dismissals` (per user+project).
- `getDashboardOverview({projectId})` -> `{rank, audit, backlinks}`:
  - **rank** (null if no configs): over first 5 rank-tracking configs, `getLatestResults(configId, projectId, "7d")`; trackedKeywords = total rows; for each row and each device (desktop, mobile): top10 += position ≤10; improved if position < previousPosition; declined if >; lastCheckedAt = max `run.lastCheckedAt`. (Computed but not currently rendered by a card.)
  - **audit**: latest audit for project; issue-type page counts, sorted by severity (critical<warning<info) then count desc; returns `{status, pagesCrawled, startedAt, topIssues: top 3, totalIssueTypes}`.
  - **backlinks**: latest `backlink_snapshots` row (by id desc) for the project if its domain matches the project domain; `stale` = older than 24h.
- **Visit-triggered snapshot refresh**: if project has a domain and overview.backlinks is null or stale, the client fires `refreshDashboardBacklinkSnapshot` once per page view. Server `ensureBacklinkSnapshot`: no-op if fresh (<24h, same domain); else calls `POST /v3/backlinks/summary/live` for the domain with scope `subdomains` (include_subdomains true), inserts a snapshot row (rank, backlinks, referring_domains, broken_backlinks, new/lost backlinks, new/lost referring domains, captured_at). On failure with an existing matching snapshot, returns stale data (logs info for expected refusals like out-of-credits, error otherwise). Metered as `backlinks`. Rows accumulate (history).

#### Layout
Title "Dashboard", max-w-5xl. Order: `WorkspaceMergeBanner` · onboarding checklist · 2-col card grid (cards with data sorted before empty/pitch cards).

**WorkspaceMergeBanner** (self-hosted Cloudflare Access only): if `getWorkspaceMergeStatus().legacyWorkspaceCount > 0`, warning box explaining per-user-workspace bug with button **Migrate organizations** -> `mergeLegacyWorkspaces()`, toast "Migrated N organizations into the shared organization.", invalidate all queries.

**Onboarding checklist** ("Set up your workspace — Add your website, connect your tools, and invite your team."), hidden when no todo steps remain. Accordion rows (icon, label, detail; "Start here" on domain). Status per step: done / skipped / todo.
| Step | Label | Detail | Done when | Expanded action |
|---|---|---|---|---|
| domain | Add your website | Set the website and country for this project. | project.domain != null | WebsiteForm: Website input (validated with parseResearchTarget, max 255) + ProjectMarketFields (country/language) -> `setProjectWebsite`; toast "Website saved" |
| project | Working on multiple websites? | Create another project, or let your AI agent set up a list of sites. | >1 project | "Create another project" (CreateProjectModal) + collapsible agent prompt with Copy button (prompt text below) |
| competitor | Explore a competitor | Find topics and links worth learning from. | competitorClickedAt set | "Open domain lookup" -> `markDashboardCompetitorClicked` then navigate to `/p/$projectId/domain` |
| mcp | Connect your AI agent | Use OpenSEO inside Claude or your favorite agent. | MCP authorized or first tool call | AgentSetupPanel with generated setup prompt (origin-based) |
| gsc | Connect Search Console | Bring your real clicks and queries into view. | GSC connected | SearchConsoleConnectionCard (returnTo `#connect-gsc`) |
| team | Invite a teammate (hosted only) | Share the work, or keep things solo for now. | hasTeammate | InviteTeammateModal |
Permission gating: project -> `project:create`, team -> `invitation:create`, gsc -> `integration:manage`; otherwise "Ask a workspace owner or admin to help with this step." Each open step has **Skip for now** ("I only need one project" for project) -> `setDashboardStepDismissed(step, true)`. Collapsible "N saved for later" list with **Restore** (dismissed=false; for mcp also clears `mcpCardDismissedAt`), and "N completed" list. Opening `#connect-gsc` hash or a Google link error auto-opens the gsc step. PostHog: `dashboard:next_move_click`, `dashboard:setup_step_defer`, `onboarding:setup_prompt_copy`.

Project prompt text:
```
Use OpenSEO to set up a separate project for each website below. List my existing projects first and reuse matches so you don't create duplicates. Set the country and language for each site, and ask me about anything missing.

Replace this list with my websites:
- Project name — website — country — language
```

**Cards** (`CardShell`: title, optional action link, body, footer stamp):
1. **Search performance** (only when GSC connected; if the report says not connected, shows the connect card instead): `getSearchPerformanceReport({projectId, dateRange:"last_28_days"})`; stats Clicks (+% delta vs previous period), Impressions (+% delta), CTR, Avg position. Stamp "Google Search Console · last 28 days"; action "More details" -> `/p/$projectId/search-performance`.
2. **Organic traffic (GA4)** — shown if connected or not dismissed. Not connected -> `GoogleAnalyticsConnectionCard` with dismiss (`dismissDashboardGa4Card`, PostHog `dashboard:ga4_dismiss`). Connected -> `getGa4DashboardReport({projectId})`: stats Sessions, Active users, Engagement rate, Key events (with % deltas vs previous equal period), plus a sessions AreaChart sparkline (h=96px) of `report.trend` with tooltip "N sessions". Zero sessions -> "No organic search traffic recorded in the last 28 days yet." Stamp "Google Analytics · last 28 days"; action "Manage" -> project settings `#google-analytics`.
3. **Site audit** — none: "Crawl your site for broken links, missing tags and indexability problems." + **Run an audit** button. Else list top 3 issues (severity dot: critical red, warning amber, info grey; title from `AUDIT_ISSUE_TYPES`; "N pages"), "+ N more issues", or "No issues found — your site looks healthy." Stamp "Site audit · crawled N pages · {date}" / "crawl in progress" / "last crawl failed"; action "More details" -> `/p/$projectId/audit`.
4. **Backlink pulse** (only if project has a domain): refreshing w/o data -> skeleton + stamp "Taking your first snapshot…"; none -> "We'll snapshot who links to your domain — nothing to set up."; else stats Ref. domains, Backlinks, New links (▲ n, green if >0), Lost links (▼ n, red if >0); stamp "Backlinks · snapshot {date}[ · refreshing…]"; action "More details" -> `/p/$projectId/backlinks?target={domain}&scope=domain`.

`PercentDelta(current, previous)`: hidden if previous ≤ 0; `round((current−previous)/previous*100)` %. `formatDay` treats SQLite `YYYY-MM-DD HH:MM:SS` timestamps as UTC.

#### Server functions (dashboard)
`getDashboardActivation`, `getDashboardOverview`, `refreshDashboardBacklinkSnapshot`, `markDashboardCompetitorClicked` (upsert `competitor_step_clicked_at` COALESCE), `dismissDashboardGa4Card` (upsert `ga4_card_dismissed_at`), `setDashboardStepDismissed({projectId, step∈{domain,project,competitor,mcp,gsc,team}, dismissed})` (insert-or-ignore / delete).

#### DB tables used (SQLite + Postgres mirrors)
- `backlink_snapshots`: `id` int PK autoinc, `project_id` FK projects cascade, `domain` text, `rank`, `backlinks`, `referring_domains`, `broken_backlinks`, `new_backlinks`, `lost_backlinks`, `new_referring_domains`, `lost_referring_domains` (ints, nullable), `captured_at` text default current_timestamp; index (project_id, captured_at).
- `dashboard_step_dismissals`: `user_id` FK user, `project_id` FK projects, `step` text; PK (user_id, project_id, step); index project_id.
- `project_activation_state`: `project_id` PK FK, `competitor_step_clicked_at`, `mcp_card_dismissed_at`, `ga4_card_dismissed_at`, `updated_at`.
- `organization_activation_state`: `organization_id` PK, `first_mcp_authorized_at`, `first_mcp_tool_call_at`, `updated_at` (written by `recordMcpAuthorized` / `recordExternalMcpToolCall`, memoized per isolate, errors swallowed).

### Shared Table Components

`src/client/components/table/*` built on **TanStack Table v8** + DaisyUI classes.

- **`useAppTable(options)`**: wraps `useReactTable` with core row model; opt-in `withSorting` (client-side sorted model), `withExpanded`, `withPagination`. Server-driven tables use `manualSorting: true` and pass `state.sorting` + `onSortingChange` (sort state lives in URL).
- **`AppDataTable`**: renders `<table class="table table-sm">` in an `overflow-x-auto` wrapper; props `empty` (node shown when zero rows), `isLoading/loading`, `getRowClassName`, `getRowProps` (row onClick), `getCellClassName`, `fixedLayout` (colgroup widths from column `size`), `stickyHeader`. Column meta supports `headerClassName`, `cellClassName` (string or fn(row)).
- **Selection**: `makeSelectionColumn(anchorRef)` adds header "select all" + per-row checkbox; **shift-click range selection** via `applyShiftRangeSelection` (anchor remembers last clicked row + desired state and applies to the index range).
- **`SortableHeader`** (column-based): label + optional help tooltip, sort indicator, toggles via `column.getToggleSortingHandler()`, `align` right option; columns set `sortDescFirst: true` for numeric metrics. Domain Overview uses its own `SortableHeader(label, isActive, order, onClick)` bound to URL sort mode.
- **`numericNullsLast`** sortingFn: nulls always at the bottom regardless of direction (for client-sorted tables).
- **`TablePagination`**: range text, spinner, "Rows per page" select from `pageSizes`, "Page X of Y", prev/next; next enabled by `page < totalPages` or `hasNextPage` when total unknown.
- **`TableBulkActionBar`**: floating bottom-center toolbar when selection > 0 ("N selected", clear X, action buttons); `TableBulkActionButton` (default/danger variants); `TableBulkExportMenu` (drop-up). `TableExportMenu`: "Export" dropdown button with arbitrary actions.
- **`ExternalUrlCell` / url helpers**: `resolveUrlHref(value, baseDomain)` (absolute http(s) only; relative paths resolved as `https://{baseDomain}{path}`), `formatUrlForDisplay` (decodeURI, strips text-fragment hashes `#:~:`), link opens in new tab with external-link icon; empty -> "-".
- **CSV** (`src/client/lib/csv.ts`): Papa.unparse with all fields quoted, `\n` newlines; numbers rounded to 2 decimals; **CSV-injection guard** prefixes values starting with `= + - @ \t \r \n` with `'`. `downloadCsv(filename, content)` via Blob `text/csv;charset=utf-8`.
- **Export to Sheets** (`exportTableToSheets`): writes clipboard item with `text/plain` TSV and `text/html` table (same sanitization), fires PostHog `data:export_sheets`, opens `ExportToSheetsModal` ("paste into a new Google Sheet"; button opens `sheets.new` in a new tab; modal auto-closes on route change). Empty -> toast "No data to export".
- **Search tabs** (`useSearchTabs` / `useSearchTabNavigation` / `SearchTabStrip`): shared by Keyword Research, Domain Overview, Backlinks; localStorage `search-tabs:{feature}:{projectId}`, cap 20 (oldest evicted), cross-component sync via custom `search-tabs-change` event; tab `{id, label, input, createdAt, viewedAt}`; URL <-> active tab sync; status dot uses the tab's cached React Query state (`backlinksOverview`/`domain-overview`/keyword query keys).
- **Recent searches** (`useLocalHistoryStore`): generic localStorage list (zod-validated parse, dedupe predicate, max N, newest first, remove by timestamp key, clear).
- Debug: `localStorage["debug:domain-overview"]="1"` or `?debugDomain=1` logs render timings/events for the domain page.

### DataForSEO Endpoints (Domain Overview, Backlinks, Dashboard)

Base: `https://api.dataforseo.com`, `POST` with JSON array body `[ { ...task } ]`, header `Authorization: Basic {DATAFORSEO_API_KEY}` (key is the base64 `email:password`). Responses parsed from `tasks[0]`; `tasks[0].cost` (USD) + `path` feed billing (`costUsd`). Request timeout 60 s; transient 5xx on idempotent reads retried up to 2 times (250 ms backoff). `Invalid Field` errors that were not billed become `VALIDATION_ERROR` and are not charged.

| Feature | Endpoint | Request payload | Response fields used |
|---|---|---|---|
| Domain Overview stat cards; MCP `get_domain_overview` | `/v3/dataforseo_labs/google/domain_rank_overview/live` | `target` (hostname, www stripped), `location_code`, `language_code`, `limit: 1` | `result[0].items[0].metrics.organic.etv` -> organic traffic (rounded); `.metrics.organic.count` -> organic keywords; hasData = count > 0 |
| Domain Top Keywords table (paged) | `/v3/dataforseo_labs/google/ranked_keywords/live` | `target` (hostname), `location_code`, `language_code`, `limit` (50/100/200), `offset` ((page−1)·size), `order_by` (e.g. `["ranked_serp_element.serp_item.etv,desc"]`), `filters` (scope + user filters, ≤8 conditions), `item_types` (MCP only). No include_subdomains param exists. | `result[0].total_count`; per item `keyword_data.keyword`, `keyword_data.keyword_info.{search_volume,cpc,keyword_difficulty}`, `keyword_data.keyword_properties.keyword_difficulty`, `ranked_serp_element.serp_item.{url,relative_url,rank_absolute,etv,domain}` (fallback `ranked_serp_element.{url,relative_url,rank_absolute,etv}`) |
| Domain keyword suggestions (top 100; MCP `get_domain_keyword_suggestions`; rank-tracker keyword suggestions) | `/v3/dataforseo_labs/google/ranked_keywords/live` | same, `limit: 100`, `order_by: ["ranked_serp_element.serp_item.etv,desc"]`, scope filters only | keyword, position, searchVolume, traffic, cpc, keywordDifficulty |
| Domain Top Pages table | `/v3/dataforseo_labs/google/relevant_pages/live` | `target`, `location_code`, `language_code`, `limit`, `offset`, `order_by` (`metrics.organic.etv` or `metrics.organic.count`), `filters` (page_address like/ilike, metrics ranges) | `total_count`; items `page_address`, `metrics.organic.etv`, `metrics.organic.count` |
| MCP `find_serp_competitors` (competitor discovery; no UI) | `/v3/dataforseo_labs/google/serp_competitors/live` | `keywords[]`, `location_code`, `language_code`, `item_types` (default `["organic","local_pack"]`), `include_subdomains`, `limit` (default 50), `offset` | `domain`, `avg_position`, `median_position`, `visibility`, `etv`, `keywords_count` (client-side exclude-domains + sort) |
| Backlinks overview summary; Dashboard backlink snapshot | `/v3/backlinks/summary/live` | common: `target`, `include_subdomains` (default true; false for `domain` scope), `include_indirect_links: true`, `exclude_internal_backlinks: true`, `backlinks_status_type: "live"`, `rank_scale: "one_hundred"` | `rank`, `backlinks`, `referring_pages`, `referring_domains`, `broken_backlinks`, `broken_pages`, `backlinks_spam_score`, `info.target_spam_score`, `new_backlinks`, `lost_backlinks`, `new_referring_domains`/`new_reffering_domains`, `lost_referring_domains`/`lost_reffering_domains` |
| Backlinks trend charts (domain/subdomains scope only) | `/v3/backlinks/history/live` | `target` (hostname), `date_from` (yesterday−1y), `date_to` (yesterday UTC), `rank_scale: "one_hundred"` (no include_subdomains field — always subdomain-inclusive) | per item `date`, `backlinks`, `referring_domains`, `rank`, `new_backlinks`, `lost_backlinks`, `new_/lost_ referring(reffering)_domains` |
| Backlinks tab rows; domain expansion; subfolder overview counts | `/v3/backlinks/backlinks/live` | common payload + `limit` (default 100; 1 for subfolder counts), `offset`, `order_by` (default `["rank,desc"]`; UI default `first_seen,desc`), `mode` (`one_per_domain` / `as_is`), `filters` (user + scope + optional `["backlink_spam_score","<=",40]`) | `total_count`; items `domain_from`, `url_from`, `url_to`, `anchor`, `item_type`, `dofollow`, `rel_attributes`/`attributes`, `rank`, `domain_from_rank`, `page_from_rank`, `backlink_spam_score`/`backlinks_spam_score`, `first_seen`, `last_visited`, `lost_date`, `is_lost`, `is_broken`, `links_count` |
| Referring Domains tab; MCP `get_backlinks_overview` top domains (100 by backlinks) | `/v3/backlinks/referring_domains/live` | common payload + `limit`, `offset`, `order_by` (default `["backlinks,desc"]`), `filters` (+ optional `["backlinks_spam_score","<=",40]`) | `total_count`; `domain`, `backlinks`, `referring_pages`, `rank`, `backlinks_spam_score`, `first_seen`, `broken_backlinks`, `broken_pages` |
| Top Pages tab | `/v3/backlinks/domain_pages_summary/live` | common payload + `limit`, `offset`, `order_by` (default `["backlinks,desc"]`), `filters` (url include/exclude, ranges, subfolder `url` scope) — no spam condition | `total_count`; `page`/`url`, `backlinks`, `referring_domains`, `rank`, `broken_backlinks` |

Non-DataForSEO: `GET https://api.ahrefs.com/v3/public/domain-rating-free?target={domain}` -> `domain_rating.domain_rating` (free, KV-cached 24h).

**Cost / credit attribution** (`mapDataforseoPathToCreditFeature`): `backlinks/*` -> `backlinks`; `dataforseo_labs/google/{domain_*|ranked_keywords|relevant_pages}` -> `domain_overview`; other Labs -> `keyword_research`. MCP tool descriptions quote typical credits: domain overview / keyword suggestions ~100–300, backlinks overview ~50 (domain) / ~25 (page), backlinks profile ~30 per page. Hosted adds a markup over raw DataForSEO cost (see billing section). Cost-saving design: R2 caching (12h Labs, 6h backlinks), explicit Apply for filters, lazy per-domain expansion, dashboard snapshot at most once per project per 24h (visit-triggered), trends only for whole-host scopes, subfolder overview uses two `limit:1` list calls instead of summary+history.

**Cross-area notes:** MCP tools `get_domain_overview`, `get_domain_keyword_suggestions`, `get_ranked_keywords`, `find_serp_competitors`, `get_backlinks_overview`, `get_backlinks_profile` reuse these services (MCP defaults `hideSpam:true`; MCP responses link back to `/p/{id}/domain` or `/p/{id}/backlinks`). GSC/GA4 dashboard reports, audit issue registry, and rank-tracking `getLatestResults` are documented in their own sections.

---

## 6. Rank Tracking

Source files (open-seo repo): `src/shared/rank-tracking.ts`, `src/types/schemas/rank-tracking.ts`,
`src/server/features/rank-tracking/**`, `src/server/workflows/{RankCheckWorkflow,rankCheckPaths}.ts`,
`src/serverFunctions/rank-tracking.ts`, `src/client/features/rank-tracking/**`,
`src/server/lib/dataforseo/{serp,serp-locations,serp-location-validate,keyword-metrics,ai,business}.ts`,
`src/shared/serp-location-search.ts`, `src/server/features/ai-search/**`, `src/client/features/ai-search/**`,
`src/types/schemas/ai-search.ts`, `src/server/lib/dataforseoLlmSchemas.ts`,
`src/server/mcp/tools/{local-seo-tools,local-seo-shared,dataforseo-research-tools,*rank*}.ts`,
`specs/0008-local-rank-tracking-locations.md`, `.agents/skills/local-seo/SKILL.md`.

### Rank Tracking — UI

#### Routes

| Route | Component | Purpose |
|---|---|---|
| `/p/$projectId/rank-tracking` | layout (`rank-tracking.tsx`) | H1 "Rank Tracking", subtitle "Track keyword positions across domains", `<Outlet/>` |
| `/p/$projectId/rank-tracking/` (index) | `RankTrackingDomainList` + `RankTrackingConfigModal` (create) | List of tracked domains ("trackers"/"configs"); after create → navigate to detail |
| `/p/$projectId/rank-tracking/$configId` | `RankTrackingDomainDetail` + `RankTrackingConfigModal` (edit) | Detail page for one tracker. Loads `getRankTrackingConfigs` and finds by id; "Domain configuration not found" + back button if missing |

React-Query keys used (invalidate together): `["rankTrackingConfigs", projectId]`, `["rankTrackingConfigSummaries", projectId]`, `["rankTrackingResults", projectId, configId, comparePeriod]`, `["rankTrackingLatestRun", projectId, configId]`, `["rankTrackingCostEstimate", projectId, configId]`, `["rankPositionMatrix", projectId, configId, device]`, `["rankConfigTrend", projectId, configId, device, sinceDays]`.

#### Domain list (`RankTrackingDomainList`)

- Card header "Tracked Domains" + primary button **Add Domain** (opens config modal).
- Data: `getRankTrackingConfigSummaries` → active configs + `keywordCount`, `lastRunStatus`, `lastRunCompletedAt` (latest run by `max(startedAt)`).
- **Filter bar** shown only when `>= 6` domains (`FILTER_BAR_MIN_DOMAINS`) or filters active: text query (domain substring, case-insensitive), device select (`both`/`desktop`/`mobile`, only values present), location select (country code options built from configs, sorted by label). Reset button + active count.
- Row (whole row links to detail): domain (bold); subline `"<City, Region> | <Country label>" · "Desktop + Mobile"|"Desktop"|"Mobile" · "Daily|Weekly|Monthly|Manual" · "Last: <date>"`. Local configs show `formatLocationLabel(locationName, 2)` (first 2 comma segments).
- Warnings on row: `lastSkipReason === "insufficient_credits"` → "Scheduled check skipped — insufficient credits"; `"plan_required"` → "Scheduled check skipped — paid plan required".
- Right side: "KEYWORDS <count>" (if > 0), **Archive** icon button → confirm modal "Archive {domain}? Scheduled checks will stop and this domain will be hidden from the list. Ranking history is preserved." → `updateRankTrackingConfig({isActive:false})`.
- Empty states: "No tracked domains yet" / "No matching tracked domains" + Clear filters. Skeletons while loading.

#### Config modal (`RankTrackingConfigModal`) — create/edit

Step 1 "config" form (title "Add Domain" / "Edit Domain Config"):

| Field | Control | Default | Notes |
|---|---|---|---|
| Target Domain | text input, placeholder `example.com` | existing or "" | normalized on blur (`normalizeDomain`), validated by `domainField` zod |
| Country | `LocationSelect` (searchable country picker) | project market `locationCode` | changing country resets language to country default and **clears locationName** |
| Search Targeting | radio National / Local | National unless config has `locationName` | Local help: *Best for: "near me" queries, city/county keywords, service-area pages.* National help: *Local targeting can understate rankings for non-geo-modified terms.* Local shows `SerpLocationCombobox` ("Search cities...", 350 ms debounce, calls `searchSerpLocations`). Selecting Local fires `prewarmSerpLocations` (useQuery, `staleTime: Infinity`, `retry:false`). Local requires a selection ("Please select a city or region for local targeting") |
| Language | select of `SERP_LANGUAGE_OPTIONS` (~100+ languages) | project/country language | "Defaults to the country's language. Any language can be tracked in any country" |
| Devices | select `both` ("Desktop + Mobile"), `desktop` ("Desktop only"), `mobile` ("Mobile only") | **mobile** (UI); server default `both` | info when both: "Tracking both devices uses 2x credits per keyword check" |
| Schedule | select `daily`, `weekly`, `monthly` ("Monthly (end of month)"), `manual` ("Manual only") | weekly | warning on daily: "Daily checks use 7x more credits than weekly" |
| Search Depth | select 1..10 pages ("N pages (top N*10 results)") → `serpDepth = pages*10` | 40 (4 pages) | "10 pages is ~8x more expensive than 1 page" |
| Cost box | computed live | — | `~$X per keyword per check` using `estimateRankCheckCredits(1, devices, depth, schedule==="manual" ? "live" : "queued").costUsd`; if scheduled: "50 keywords would cost ~$(cost*50*checksPerMonth)/month" where checksPerMonth = daily 30 / weekly 4 / monthly 1 |

Submit → `createRankTrackingConfig` (toast "Domain added for rank tracking") or `updateRankTrackingConfig` (toast "Configuration updated"; on edit, national mode sends `locationName: null` to clear). On create success → step 2.

Step 2 "keywords" — `KeywordSuggestionStep` (modal max-w-3xl):
- Only if `isLabsLocationCode(locationCode)` else shows "Add keywords manually … Ranked-keyword suggestions aren't available for this country" + Continue.
- Calls `getDomainKeywordSuggestions({projectId, domain, locationCode})` → server `DomainService.getSuggestedKeywords` → DataForSEO Labs **`/v3/dataforseo_labs/google/ranked_keywords/live`** with `target=hostname, location_code, language_code (Labs-resolved), limit: 100, order_by: ["ranked_serp_element.serp_item.etv,desc"]` (+ research-scope filters). Cached (R2) with `DOMAIN_OVERVIEW_TTL_SECONDS`.
- Table (selectable, shift-range select, sortable): Keyword, Position, Volume, Traffic (default sort traffic desc). **Pre-selects top 20 by traffic** (`PRE_SELECT_COUNT = 20`).
- States: loading "Finding your top keywords... This usually takes a few seconds"; error "Couldn't fetch keywords" + Skip; empty "No rankings found … You can add keywords manually." + Skip.
- Footer "N of M selected", **Skip**, **Save Keywords** → `addTrackingKeywords` (toast "Added N keywords for tracking") → navigate to detail.

#### Detail page (`RankTrackingDomainDetail`)

Top to bottom:
1. "← Back to domains".
2. Alerts: insufficient credits ("Last scheduled check was skipped due to insufficient credits. Top up your balance to resume automatic tracking."); stale run ("This run may be unresponsive and will be cleaned up automatically."); failed run ("Last check failed. {errorMessage}"); **FreePlanAlert** (hosted free plan): "We only start to track keyword positions once you upgrade to the paid plan." (link to `/subscribe?upgrade=true`).
3. **Header** (`RankTrackingDetailHeader`): domain; subline location · devices · schedule · "Last: <date>" · "~$X.XX/check" (live estimate). Controls: Desktop/Mobile `SegmentedToggle` (only when devices=both); comparison select `1d` "vs yesterday", `7d` "vs last week", `30d` "vs last month", `90d` "vs 90 days ago" (default: daily→1d, monthly→30d, else 7d); **Configure** (opens edit modal); **Add Keywords** (toggles panel).
4. **AddKeywordsPanel**: textarea "Enter keywords, one per line", checkbox **Match case** (tooltip: "Track these keywords exactly as typed instead of lowercasing them…"), Add/Cancel. Client rejects any line > 200 chars. After add: invalidate cost/results/run, toast "N keywords added"; if no auto-check triggered: "Use 'Check Now' to check these keywords".
5. **Overview chart** (`RankTrackingOverview`, only when rows exist): "Position distribution" stacked **AreaChart** (recharts) per completed full (non-subset) run for the active device; buckets & colors: Top 3 `#16a34a`, 4–10 `#2563eb`, 11–20 `#f59e0b`, Not in top 20 `#6b7280`. Range toggle 30d / 90d / All (All = 730 days, default). Empty: "No history yet — run a check…" / "Only 1 check so far…".
6. **Toolbar** (`RankTrackingTableToolbar`): Latest/History toggle (only when ≥ 2 completed runs in matrix), Filters toggle (badge count), progress ("Preparing..." when pending; "Getting rankings for N keywords... checked/total" + `<progress>`), "{n} keywords"; **Export** menu (Export to Sheets, Export CSV, Copy keywords); **More** menu: "Check rankings — Fetch current Google positions" (hidden on free plan) and "Update keyword stats — Volume, difficulty & CPC — not rankings".
7. **Filter panel** (`FilterPanel`): Include terms (comma list, any-match substring, "e.g. seo, tool"), Exclude terms ("e.g. free, cheap"), Desktop position min/max, Mobile position min/max, Volume min/max, KD min/max, CPC min/max.
8. **Table** (Latest view) or **History matrix**.
9. `CheckConfirmModal` when check count ≥ 50.

##### Scorecards formula (`rankTrackingScorecards.ts`, computed client-side per device)

```ts
const CTR_BY_POSITION = [0, .28,.15,.10,.07,.05,.04,.033,.028,.024,.021,.018,.016,.014,.012,.011,.01,.009,.008,.007,.006];
ctr(pos) = pos==null||pos<1 ? 0 : (CTR_BY_POSITION[pos] ?? 0.005)
visibility = Σ(volume × ctr(position)) / (Σ volume × 0.28) × 100   // only rows with volume>0; null if Σvolume==0
visibilityDelta = visibility − same formula using previousPosition
ranking = count(position != null);  rankingDelta = ranking − count(previousPosition != null)
top3 = count(pos<=3); top10 = count(pos<=10)
improved/declined 4-case: both null → none; pos null & prev → declined ("lost");
  prev null & pos → improved ("new"); prev−pos>0 → improved; <0 → declined
```

##### Table columns (`RankTrackingColumns.tsx`, TanStack Table)

Order: selection checkbox · **Keyword** (clickable → KeywordTrendModal; "Aa" badge if matchCase) · per visible device: **Position** (`DeviceRankCell`) + **URL** (path shown, link to full URL) · **Volume** (header "Local volume" for local configs, tooltip "Estimated monthly searches in {City} from Google Ads"; compact format) · **KD** (badge green ≤30, warning 31–60, red >60) · **CPC** ($x.xx) · per device **SERP Features** badges.

- `DeviceRankCell`: both null → "-"; lost → `prev → lost` (red); no prev → plain number; else `prev → pos` badge green (improved) / warning (declined) / neutral.
- SERP feature short labels: featured_snippet FS, people_also_ask PAA, ai_overview AI (sparkle icon), local_pack Local, knowledge_panel KP, video Video, images Img, shopping Shop, top_stories News (others hidden).
- Visible devices: if devices=both, only the active toggle device; else the configured device. Default sort = position of shown device, nulls last.
- Bulk action bar (selection): **Remove** (confirm "Remove keywords? This will stop tracking N keywords. Historical ranking data is preserved but won't appear in the table.") → `removeTrackingKeywords`; Export to Sheets / Export CSV of selection (`rank-tracking-{domain}-selected.csv`).
- Footer: "{rows} of {total} keywords". Empty: 'No rank data yet. Click "Check Now" to run your first check.' / "No keywords match your search."

CSV/Sheets export headers: `Keyword, Volume | "Local volume (City, Region)", KD, CPC, [Desktop Position, Desktop Change, Desktop URL, Desktop SERP Features], [Mobile …]`. Change = `prev−current` number, or `"new"` / `"lost"`; empty cells for unranked (numeric column).

##### History matrix (`RankTrackingHistoryMatrix`)

"By date" pivot: rows = (filtered) keywords, columns = last `runLimit` (default 12, max 26) completed **full** runs (dates = run `startedAt`), cell = position with `▲n` (green) / `▼n` (warning) vs previous column; null → "—". Sticky keyword column. Data: `getRankPositionMatrix({device, runLimit})`.

##### Keyword trend modal (`KeywordTrendModal`)

Title = keyword; subline `domain · location · Position over time`; range 30d/90d/All. `getRankKeywordHistory({trackingKeywordId, sinceDays})` returns flat `{device, checkedAt, position}` from completed runs. Inverted-Y `LineChart` (`RankTrendChart`, y domain `[1, serpDepth]`, reversed; Desktop `#2563eb`, Mobile `#14b8a6`); null positions are plotted at `serpDepth` inside a muted "Not in top {serpDepth}" `ReferenceArea` band. Copy + Export CSV buttons. Table: Date, [Device], Position ("Not in top N"), "Δ vs previous check".

##### Check trigger + polling

- `requestCheck(count)`: if `count < 50` → start immediately; else open `CheckConfirmModal`: "Check N keywords — N keywords × D devices = T SERP checks", big "Run Now" button with "Results in ~Xs/min" where `liveTime = ceil(T / 10) * 6` seconds and "~$cost" (live estimate).
- `useRankCheckTrigger` → `triggerRankCheck`; result `{ok:false, reason:"already_running"}` → toast "A rank check is already running"; success toast "Rank check started".
- `useRankRunPolling`: `getLatestRankRun` refetches every **3000 ms** while status pending/running (including maybe-stale); on transition to completed/failed invalidates results.
- `useMetricsRefresh` → `refreshTrackingKeywordMetrics` → toast "Metrics updated for N keywords".

### Rank Tracking — Engine

#### Data model (SQLite/D1 + Postgres mirror)

`rank_tracking_configs` — id (text uuid PK), project_id (FK projects, cascade), domain (normalized: lowercase, no protocol/path/`www.`), location_code int default 2840, language_code default "en", devices enum `both|desktop|mobile` default both, serp_depth int (10–100 step 10), schedule_interval enum `daily|weekly|monthly|manual` default weekly, location_name text NULL (canonical DataForSEO name e.g. `Enid,Oklahoma,United States`), is_active bool default true (archive = false), last_checked_at, next_check_at (ISO), last_skip_reason (`plan_required|no_keywords|insufficient_credits`), created_at.
Indexes: (project_id,is_active,created_at); **partial unique** `(project_id,domain,location_code) WHERE location_name IS NULL` and `(project_id,domain,location_code,location_name) WHERE location_name IS NOT NULL`.

`rank_tracking_keywords` — id, config_id (FK cascade), keyword, match_case bool default false, search_volume int, keyword_difficulty int, cpc real, metrics_fetched_at, created_at. Unique (config_id, keyword).

`rank_check_runs` — id (= workflow instance id), config_id (FK cascade), project_id, status `pending|running|completed|failed`, keywords_total, keywords_checked, is_subset_run bool, error_message, started_at, completed_at. Indexes (config_id,started_at), (project_id,started_at), **partial unique `(config_id) WHERE status IN ('pending','running')`** = one active run per config (a failed INSERT is the "already running" lock).

`rank_snapshots` — id autoincrement, run_id (FK cascade), tracking_keyword_id (intentionally **no FK**, history survives keyword removal), keyword, device `desktop|mobile`, position int NULL (= not found within depth), url, serp_features (JSON array text of SERP item types), checked_at. Index (tracking_keyword_id, device, checked_at); unique (run_id, tracking_keyword_id, device); inserts `onConflictDoNothing`.

#### Limits / constants (`src/shared/rank-tracking.ts`)

```ts
KEYWORDS_PER_BATCH = 10; SECONDS_PER_BATCH = 6;
MAX_KEYWORDS_PER_CONFIG = 1000; MAX_TRACKED_KEYWORD_LENGTH = 200;
MAX_CONFIGS_PER_PROJECT = 500; MAX_TASKS_PER_POST = 100;
serpDepth: int 10..100 multipleOf 10; add/remove payload max 2000 ids/keywords
```

#### Server functions (`src/serverFunctions/rank-tracking.ts`, all POST + `requireProjectContext`)

`getRankTrackingConfigs`, `getRankTrackingConfigSummaries`, `createRankTrackingConfig`, `updateRankTrackingConfig`, `triggerRankCheck({keywordIds?})`, `getLatestRankResults({comparePeriod})`, `getLatestRankRun`, `estimateRankCheckCost`, `addTrackingKeywords({keywords, matchCase})`, `removeTrackingKeywords({keywordIds})`, `refreshTrackingKeywordMetrics`, `getRankKeywordHistory({trackingKeywordId, sinceDays=365 max 730})`, `getRankConfigTrend({device, sinceDays})`, `getRankPositionMatrix({device, runLimit=12 max 26})`. Plus `searchSerpLocations({query, countryCode})` / `prewarmSerpLocations({countryCode})` in `serverFunctions/serp-locations.ts`. PostHog events: `rank_tracking:config_create|check_trigger|metrics_refresh|check_complete`.

#### Create / update config

- `createConfig`: normalize domain; `resolveMarket` (fallback to project market; language = project language if same country else country default); schedule default **weekly**; `nextCheckAt = computeNextCheckAt(interval)` unless manual. If `locationName`: **validate against DataForSEO sandbox** (below). Duplicate check by (project, domain, location_code, location_name|NULL): active duplicate → error "This domain + country/city combination is already being tracked"; archived duplicate → **reactivate** same row (keeps history) with new devices/depth/schedule, clears `lastSkipReason`. Cap: 500 configs/project → "Maximum 500 tracked domains per project".
- `updateConfig`: re-validate location name whenever name/country/language changes; schedule change recomputes `nextCheckAt` (manual → null).

#### Location handling (national vs local)

- National: SERP requests send `location_code` (+ `language_code`).
- Local: requests send `location_name` instead (verbatim canonical string). SERP pricing is location-independent.
- **Location registry**: `GET /v3/serp/google/locations/{iso2}` (free, ~9.5 MB for US, no search param). Filter to types `City, County, Municipality, DMA Region, Region`; store slim list in Cloudflare **KV** key `serp-locations:{iso}` (TTL 30 d, `cacheTtl` 24 h); concurrent cold fills coalesced per isolate.
- **Search ranking** (`rankSerpLocations`, top 10): fold (NFD strip accents, lowercase, collapse ws); tokenize on spaces/commas; expand region abbreviations (US states, CA provinces, AU states) for tokens after the first; every token must be a substring of the folded name; score 0 = place (text before first comma) equals whole phrase, 1 = place equals first token, 2 = place startsWith first token, 3 = other; tiebreak by type rank `City 0, Municipality 1, City Region/Borough 2, County 3, State/Province/Region 4, Country 5, DMA Region 6, Neighborhood/District 7`, then alphabetical.
- **Save-time validation** (`assertSerpLocationNameAccepted`): POST to **sandbox** `https://sandbox.dataforseo.com/v3/serp/google/organic/live/advanced` with `{keyword:"pizza", location_name, language_code, depth:10}` (free), 10 s timeout. 20000 → ok; 4xxxx with invalid field `location_name` → error telling user/agent to call `search_serp_locations`; other 4xxxx → "DataForSEO rejected this tracker: …"; sandbox outage / 5xxxx → fail open.
- Maintenance script `scripts/repair-rank-tracking-locations.ts` (+ `serp-location-match.ts`) fuzzy-maps legacy free-form names ("Catonsville, MD") to canonical names, dry-run/verify/apply.

#### Keyword add / remove (`RankTrackingKeywordService`)

- Normalization: trim; lowercase unless `matchCase`; dedupe within request and against existing; truncate to remaining capacity (1000 − existing); error if already at 1000.
- Insert in chunks of 25 with `onConflictDoNothing().returning(id)`; delete in chunks of 90.
- Approval modes: `direct_user_action` (UI) or `credit_ceiling` (MCP): for scheduled trackers, estimate `estimateScheduledRankCheckCredits(existing+new)`; if `maxEstimatedScheduledCheckCredits` missing or exceeded → throw VALIDATION_ERROR explaining the recurring cost; re-checks after insert using persisted count and rolls back inserted rows if over.
- UI server fn `addTrackingKeywords` afterwards: (a) if rows added → `triggerCheck({keywordIds: addedIds})` (a **subset run**, live), errors logged not thrown; (b) awaits `refreshKeywordMetrics` so metrics are in DB before refetch. Returns `{added, addedIds, scheduledEstimate, checkTriggered}`.

#### Keyword metrics refresh (volume / KD / CPC)

`refreshKeywordMetrics`: requires paid plan (hosted). Unique lowercase keywords → `fetchKeywordMetricsForList` (batches of 700), `creditFeature: "rank_tracking"`, language via `resolveKeywordDataLanguage` (fallback to country default if tracker language isn't served for country):
- Labs country, national → `POST /v3/dataforseo_labs/google/keyword_overview/live` `{keywords, location_code, language_code, include_clickstream_data:false}` → `keyword_info.search_volume` (or clickstream-normalized), `keyword_info.cpc`, `keyword_properties.keyword_difficulty`, `search_intent_info.main_intent`.
- Google-Ads-only country (e.g. Iceland; `getKeywordDataProvider === "google_ads"`) → `POST /v3/keywords_data/google_ads/search_volume/live` `{keywords, location_code|location_name, language_code}` → `search_volume, cpc, competition_index/100, competition`; KD null.
- Local config (locationName set) in Labs country → **both** calls in parallel: local volume/CPC from Google Ads (with `location_name`) + national KD/intent from Labs; keywords Ads collapses away get null volume/CPC (never national numbers).
Stored per keyword: `searchVolume, keywordDifficulty, cpc, metricsFetchedAt`.

#### Triggering a check (`triggerCheck`)

1. Load config (project-scoped). 2. `requireRankCheckAccess` — hosted mode requires paid plan (`PAYMENT_REQUIRED` "Upgrade to the paid plan to run rank checks"); self-host always allowed. 3. Error if no keywords. 4. If `maxCostCredits` (MCP) → live estimate must be ≤ it. 5. `beginRankCheckRun({trigger:"manual"})`.

`beginRankCheckRun` (coordination, max 2 attempts): insert run row (`status pending`, `keywordsTotal`, `isSubsetRun = keywordIds.length>0`). If insert blocked by the partial unique index → load active blocker; on first attempt check staleness via Workflow instance status (`env.RANK_CHECK_WORKFLOW.get(runId).status()`): active statuses `queued|running|waiting|waitingForPause|paused` = not stale; 60 s startup grace (`RANK_CHECK_STARTUP_GRACE_MS`) for missing/unknown; otherwise mark blocker failed with reason and retry. Else return `{ok:false, reason:"already_running", blockingRunId}`. On insert success → `workflow.create({id: runId, params:{runId, configId, billingCustomer, projectId, domain, locationCode, languageCode, locationName, devices, serpDepth, trigger, keywordIds, maxCostCredits}})`; if create throws → mark run failed and terminate instance.

`getLatestRun` reports `maybeStale/staleReason` without mutating (mutation happens on next begin).

#### Workflow `RankCheckWorkflow` (Cloudflare Workflows; equivalent = durable job)

Steps (each via `pgStep` = step.do with pg client scope; single attempt, 2 min timeout unless noted):
1. `check-active`: config still `isActive`? else fail run "Config has been archived".
2. `prepare` (`prepareRankCheckKeywords`): abort (NonRetryable) if run already failed/completed; set status `running`; load keywords (filter to `keywordIds` for subset); compute credits with method `queued` if scheduled else `live`; enforce `maxCostCredits`; hosted: `autumn.check` both `usage_credits` and `topup_credits` balances, sum remaining; if `< costCredits` → `INSUFFICIENT_CREDITS`; set `keywordsTotal`.
3. Check path:
   - **Manual → live** (`runLiveCheck`): batches of 10 keywords (× devices); step `live-batch-{i}`: `Promise.allSettled` of per-(keyword,device) `serp.rankCheck` calls; failures logged (`UPSTREAM_UNAVAILABLE` as warn), first error stored via `setRunErrorIfEmpty`; insert snapshots; update `keywordsChecked = i + batch.length` (progress).
   - **Scheduled → queued** (`runQueuedCheck`, ~30% of live cost): expand to (keyword, device) tasks; post in chunks of ≤100 (`post-tasks-{i}`); rejected entries/failed chunk → fallback list. Poll with `step.sleep` intervals `4,2,2,2,2,3` minutes (cumulative 4/6/8/10/12/15 min); each `collect-{round}` step (retries 2 × 10 s, 5 min timeout) fetches up to 500 tasks, 25 concurrent `task_get`s (free); completed → snapshots + progress; pending → next round; failed → fallback. After window: all stragglers (fallback + still pending) → live endpoint in batches of 10 (`fallback-batch-{i}`, double-billed). Stats `queueTasks, queueCollected, fallbackTasks, fallbackChecked`.
   - Batch errors are caught; partial snapshots persist.
4. `finalize`: skip if already terminal; `keywordsChecked` = distinct keyword ids in run snapshots; status `failed` if 0 checked & total>0 else `completed`; error message "Checked X of Y keyword(s): <first error>" when partial. On completed → config `lastCheckedAt=now`, `lastSkipReason=null` (**nextCheckAt is not touched here**). Log + PostHog `rank_tracking:check_complete`.
5. On thrown error → `mark-failed`: fail run; if `INSUFFICIENT_CREDITS` → config `lastSkipReason="insufficient_credits"`.

#### SERP endpoint & ranking match

Live: `POST /v3/serp/google/organic/live/advanced` payload per task:
```json
[{ "keyword": "...", "location_code": 2840 | "location_name": "City,Region,Country",
   "language_code": "en", "device": "desktop|mobile", "os": "windows|android",
   "depth": 10..100,
   "stop_crawl_on_match": [{ "match_value": "<domain>", "match_type": "with_subdomains" }],
   "find_targets_in": ["organic"] }]
```
Queued: `POST /v3/serp/google/organic/task_post` (array of ≤100 tasks, same fields + `tag: "<keywordId>:<device>"` to map back); accepted entries have status `20100`; cost summed over all entries. Collect: `GET /v3/serp/google/organic/task_get/advanced/{taskId}` (free; in-progress → pending; "No Search Results" 40501 → completed with empty result).

Match (`buildRankCheckResult`): first item with `type === "organic"` whose `domain` (lowercased) `=== target` or `endsWith("." + target)` (subdomains count). `position = rank_group ?? rank_absolute` (organic-only rank, not absolute). `url = item.url`. `serpFeatures = unique item.type values across all items`. 40501 treated as empty (position null). Depth clamped 10–100.

#### Scheduling

Frequencies: `daily`, `weekly`, `monthly` (end of month), `manual`.

```ts
computeNextCheckAt(interval, previousNextCheckAt?):
 monthly: with anchor → last day of month (anchor time-of-day) advanced month by month until > now;
          first time → end of current month at random hour 04–09 UTC, random minute (next month if past)
 daily/weekly (1 or 7 days): with anchor → anchor + (floor((now−anchor)/interval)+1)*interval  (no drift);
          first time → now + days at random 04–09 UTC hour, random minute
```

Cron (`wrangler.jsonc` triggers `["*/5 * * * *", "17 3 * * *"]`; `src/server.ts scheduled()`): every 5 min runs `reconcileStaleAudits()` then `runScheduledRankChecks(env)`; the daily `17 3 * * *` purges MCP OAuth KV + Dub referral sweep.

`runScheduledRankChecks`:
- Due query: active configs, `schedule_interval != 'manual'`, `next_check_at <= now`, project not archived; order `next_check_at ASC, id ASC`; limit 500; join `projects.organizationId`.
- Budget: `SCHEDULED_TASK_UNIT_BUDGET = 1000` task units (keywords × devices) per tick (first start always admitted); `TICK_DEADLINE_MS = 3 min`.
- Per config: `nextCheckAt = computeNextCheckAt(interval, observed)`; **CAS claim** `UPDATE … SET next_check_at=new WHERE id=? AND is_active AND next_check_at = observed` (returns false if changed concurrently).
  - 0 keywords → claim with `lastSkipReason:"no_keywords"`.
  - Hosted: paid-plan check per org (memoized per tick, `retryDenied:true`); error → skip without advancing; free → claim with `"plan_required"`.
  - Paid → claim with `lastSkipReason:null`, then `beginRankCheckRun({trigger:"scheduled", billingCustomer:{userId:"system", userEmail:"system@openseo.so", organizationId, projectId}})`. Workflow start error → leave schedule advanced. `already_running` → restore previous `nextCheckAt` via reverse CAS (retry next tick).
- Summary log `rank_tracking_scheduler_summary` with counters.

#### Reads (`getLatestResults`, comparison)

Parallel: config, keywords, latest snapshot per keyword+device (max checked_at among completed runs, incl. subset runs), snapshots before `now − period` (1/7/30/90 d), latest run. Previous position = latest snapshot before target date; fallback = **earliest** snapshot if none before target. Rows returned for all active keywords (empty device results if never checked). `run.lastCheckedAt` = newest snapshot time.

Trend (`getConfigTrend`): per completed non-subset run for one device: `total`, `top3` (1–3), `top4to10`, `top11to20`, `notRanking = total − others` (null or >20). Matrix and history as described in UI.

#### Cost estimation

```ts
LIVE:   base page (10 results) $0.002,  each extra page $0.0015
QUEUED: base page $0.0006, each extra page $0.00045
costPerSerp(depth) = base + (depth/10 − 1) × extra
estimateRankCheckCredits(keywords, devices, depth, method):
  totalChecks = keywords × (devices=="both" ? 2 : 1)
  per metered call (live: 1 check; queued: ≤100 checks):
     callUsd = roundUsd(checks × costPerSerp × 1.28 /*SEO_DATA_COST_MARKUP*/)   // round to 5 decimals
     credits += ceil(callUsd × 1000 /*credits per USD*/)
estimateScheduledRankCheckCredits: queued estimate × checksPerMonth (daily 30, weekly 4, monthly 1)
```
`estimateCost(configId, additionalKeywordCount=0)` (UI header & MCP) returns `{costUsd, costCredits, keywordCount, devicesCount, totalChecks, method:"live", existingKeywordCount, additionalKeywordCount, scheduledEstimate?}`. Note: UI displays the marked-up USD; self-host pays raw.

#### MCP tools (rank tracking)

| Tool | Input | Behavior / output |
|---|---|---|
| `get_rank_tracker` | `projectId`, `trackerId?` | No id → list configs (`id domain loc schedule`); with id → config + latest results table (keyword, desktop, prev, mobile, prev) + latest run line |
| `create_rank_tracker` | `projectId`, `domain?` (defaults project domain), `locationCode?`, `languageCode?`, `locationName?` (must come from `search_serp_locations`), `devices?` (default **mobile**), `serpDepth?` (default 40), `scheduleInterval?` (default **manual**) | `{trackerId, config}` |
| `add_rank_tracking_keywords` | `projectId, trackerId, keywords[1..2000], matchCase?, maxEstimatedScheduledCheckCredits?` (required for scheduled) | `credit_ceiling` approval; `{trackerId, requested, added, addedIds, scheduledEstimate?}`; no auto-check |
| `remove_rank_tracking_keywords` | `projectId, trackerId, keywordIds[]` | `{trackerId, requested, removed, removedIds}` |
| `estimate_rank_tracker_cost` | `projectId, trackerId, additionalKeywordCount? (0..1000)` | estimate object above |
| `run_rank_tracker` | `projectId, trackerId, maxCostCredits` (required) | live full run; `{trackerId, started, runId?, blockingRunId?}`; tells agent to poll `get_rank_tracker` |
| `search_serp_locations` | `query` (1–100), `countryCode` (ISO2) | top-10 `{locationName, locationCode, locationType, displayLabel}` |

Cross-area: Dashboard (`DashboardService`) reads rank summary via `getLatestResults`; reports/SAM may read trackers.

---

## 7. Site Audit & Lighthouse

Source of truth for this section: `src/server/lib/audit/**`, `src/server/features/audit/**`, `src/server/workflows/{SiteAuditWorkflow,siteAuditWorkflowPhases,siteAuditWorkflowCrawl,site-audit-workflow-helpers,auditStepConfigs,pgStep}.ts`, `src/audit-worker.ts`, `wrangler.audit.jsonc`, `src/client/features/audit/**`, `src/client/features/lighthouse/**`, `src/shared/{audit-issues,audit-limits,audit-fetch-class,lighthouse}.ts`, `src/server/lib/{lighthouse*.ts,dataforseoLighthousePayload.ts}`, `src/server/lib/dataforseo/lighthouse.ts`, `specs/0009-site-audit-crawl-architecture.md`, `badseo/**`.

Key design facts in one paragraph: the crawler is an **in-house plain-HTTP crawler** (no JS rendering, no DataForSEO On-Page crawl). It runs as a **Cloudflare Workflow** (`SiteAuditWorkflow`) inside a separate auxiliary worker (`open-seo-audit`), with transient crawl state (frontier, link edges, slim page mirror) in a **per-audit SQLite Durable Object** (`AuditScratchpad`). Pages, issues and Lighthouse summaries are persisted to the app DB (D1 or Postgres) **incrementally per sub-batch**. HTML is parsed with **htmlparser2's streaming tokenizer** (no DOM). Crawling itself is **not credit-metered**; only Lighthouse calls (DataForSEO `on_page/lighthouse/live`) are billed. Issue detection = 29 issue types (per-page reporters + cross-page checks). Live progress feed via KV.

### Site Audit — UI

#### Routes

| Route | Component | Purpose |
|---|---|---|
| `/p/$projectId/audit` | `SiteAuditLayout` (just `<Outlet/>`) | layout |
| `/p/$projectId/audit/` (search: `auditId?`, `tab` = `issues`\|`pages`\|`performance`, default `issues`) | `SiteAuditPage` | No `auditId` → **LaunchView** (form + history). With `auditId` → **AuditDetail** (progress or results). Search params updated with `navigate({replace:true})`. |
| `/p/$projectId/audit/issues/$resultId` (search: `auditId?`, `category` = `all`\|`performance`\|`accessibility`\|`best-practices`\|`seo`, default `all`) | `LighthouseIssuesScreen` | Lighthouse issue drill-down for one Lighthouse result row (one URL × one device). Back button → `/p/$projectId/audit?auditId=…`. |

#### Launch view (`LaunchView` → `LaunchFormCard` + `AuditHistorySection`)

Heading "Site Audit". Card "Start New Audit" with a TanStack Form:

| Field | Control | Default | Rules |
|---|---|---|---|
| `url` | text input, placeholder `https://example.com` | `""` | required ("Please enter a URL."); server normalizes (adds `https://` if missing) |
| `maxPagesInput` | number input (digits only, regex `/^\d*$/`), label "Crawl limit / Max pages" | `"50"` | clamped on blur/submit to `[MIN_PAGES=10, maxPagesLimit]`; `maxPagesLimit` = 50 on hosted free plan, 10,000 otherwise. Helper text "Enter any value from 10 to N." plus an **Upgrade** link (`SUBSCRIBE_ROUTE?upgrade=true`) "to crawl up to 10,000 pages" when free-limited. |
| `runLighthouse` | toggle "Include Lighthouse" (tooltip: "Lighthouse measures the performance of your pages and identifies issues.") | **false** | when on, shows copy "We choose a sample of 20 pages to audit, removing pages from duplicate templates." (actually ≤10 URLs × 2 devices = ≤20 checks). Maps to `lighthouseStrategy: runLighthouse ? "auto" : "none"`. |

- Submit button "Start Audit" (spinner "Starting...").
- If effective max pages > 500 → `window.confirm("You are about to crawl N pages. This is okay, but it may take a while. Continue?")`.
- On success: toast "Audit started!", sets `?auditId=`.
- Errors shown in an alert below; friendly copy per error code (`src/client/lib/error-messages.ts`):
  - `AUDIT_CAPACITY_REACHED`: "You've reached audit capacity for your account. Delete old audits from your projects to start a new one."
  - `AUDIT_PAGE_LIMIT_EXCEEDED`: "Free plan audits are limited to 50 pages. Upgrade to run larger audits."
  - `AUDIT_ALREADY_RUNNING`: "You've reached the limit of audits running at once. Wait for one to finish or delete it before starting another."
  - `CRAWL_TARGET_BLOCKED` (SSRF block) / `VALIDATION_ERROR` / `PAYMENT_REQUIRED` ("Subscribe to run site audits").
- Plan detection: hosted mode uses Autumn `useCustomer()`; until loaded, the form is unrestricted (server enforces anyway). Self-hosted → never free-limited.

**Previous Audits** table (`getAuditHistory`, newest first). Empty state: icon + "No audits yet".

| Column | Value |
|---|---|
| Date | `startedAt` formatted "Mon D, YYYY" |
| URL | `startUrl` (truncate 220px) |
| Status | `StatusBadge`: running (info, spinner "Running"), completed ("Done", green outline), failed ("Failed", red) |
| Pages | `pagesTotal || pagesCrawled` |
| Lighthouse | badge "Yes" if config.lighthouseStrategy ≠ none |
| actions (hover) | **View** → `?auditId=…&tab=pages`; kebab menu (`PortalMenu`) → **Delete audit** (red) → `deleteAudit` → toast "Audit deleted", refetch history |

#### Audit detail (`AuditDetail`)

- Header: "← All audits" back button, H1 = hostname of `startUrl`, status badge (when not running), subtitle "Site audit · Started {Mon D, h:mm}".
- **Status polling**: `getAuditStatus` every **3000 ms** while `status === "running"`.
- **Results fetch**: `getAuditResults` when status is `completed` **or** `failed` (failed audits show partial results).
- Error state: "We could not load this audit. It may have been deleted."

**Progress card** (while running):
- Title "Crawling pages" or "Running Lighthouse checks" (phase `lighthouse`), phase badge: Discovery / Crawling / Lighthouse / Finalizing.
- Progress bar: crawl % = `round(pagesCrawled / pagesTotal * 100)`; in lighthouse phase = `round((lighthouseCompleted+lighthouseFailed)/lighthouseTotal*100)`.
- Text "X / Y pages" or "X / Y checks (N failed)".
- **Live crawl feed**: `getCrawlProgress` polled every **1500 ms**; card "Crawled Pages (N)", "Updated {time}", scrollable list (max-h 400px) of rows: HTTP status badge (2xx green, 3xx yellow, 4xx/5xx red, none "-"), pathname, title (md+ only). Newest first, top row highlighted/animated. Backed by KV (max 300 entries).

**Banners**:
- Support CTA (error alert if failed with zero pages, warning if completed with ≤1 page): "Site audit couldn't fully crawl this website. Sorry! This site's bot protection blocked our crawler…" with links to LibreCrawl (github.com/PhialsBasement/LibreCrawl) and Screaming Frog.
- Failed with results: "This audit stopped early after N pages. The results below cover everything crawled before it stopped. Run a new audit to try again, or email ben@openseo.so…"
- In results: "We were blocked on N pages." (count of `fetchClass=blocked`) — same desktop-crawler advice.
- Rate-limit banner if any `fetchClass=rate_limited` pages or a `crawl-rate-limited` issue exists: "The crawl stopped early because of the site's rate limit." / "The site rate limited us on N pages." + advice to allowlist "OpenSEO-Audit".

#### Results view (`ResultsView`)

**Stats strip** (grid of tiles):
- Pages crawled (`audit.pagesCrawled`)
- Issues found (total issue rows; green if 0) + sub-line with colored dots: critical / warning / info counts (severity resolved from registry)
- Avg response (`round(mean(page.responseTimeMs ?? 0))` ms)
- If Lighthouse rows exist: Lighthouse tests (count), Avg Lighthouse perf, Avg Lighthouse SEO, Avg Lighthouse a11y (averages over **non-failed** rows, rounded; color ≥90 green, ≥50 yellow, else red), Lighthouse failures (count; red if >0).

**Tabs** (`tabs-border`): `Issues (n)`, `Pages (n)`, `Performance (n)` (Performance tab only if lighthouse rows exist; otherwise falls back to issues). **Export dropdown** (acts on the active tab): "Export to Sheets", "CSV", "JSON".

**Issues tab (`IssuesView`)**
- Groups issue rows by `issueType`; sections Critical → Warning → Info (dot colors: error / warning / muted). Section header shows total rows.
- Within a section, groups sorted by severity order then by row count desc.
- Each group row: dot, title, "N pages", chevron; expands to: explanation paragraph, "How to fix: …", and affected URL list (max **100** rendered, scroll max-h 320px; "…and N more — export the issues CSV for the full list."). Each URL is an external link + details line rendering `detailsJson` as `key: value · key: value` (arrays joined with " → ", e.g. redirect hops).
- Empty: "No issues recorded for this audit." + note about audits run before issue checks existed.

**Pages tab (`PagesTable`)** — TanStack Table, default sort URL asc; collapsible filter panel ("filters" toggle with active count and "x of y" result count; Reset button).

| Column | Rendering |
|---|---|
| URL | link (external icon); shows path only when host equals the site's *predominant host* (host with most 2xx pages; fallback start URL host), else host+path |
| Status | HTTP status badge |
| Title | title; for 3xx → "→ {redirect target path}"; empty → red "missing" only if a `missing-title` issue exists for that page, else "-" |
| H1 | `h1Count` (only for ok, non-redirect pages; else "-") |
| Words | `wordCount` (same gating) |
| Images | `imagesMissingAlt/imagesTotal` in warning color if any missing, else `imagesTotal`; sort by missing then total |
| Speed | `responseTimeMs` ms |

Pages filters: Search (URL/title/meta substring), Status (All / 2xx / 3xx / 4xx/5xx / Missing[null]), Alt text (All / Missing alt / No missing alt), Words min/max, Speed ms min/max.

**Performance tab (`PerformanceTable`)** — default sort `performanceScore` asc.

| Column | Rendering |
|---|---|
| URL | pathname |
| Device | mobile/desktop |
| Status | "failed" badge (tooltip = errorMessage or "Lighthouse returned no category scores") or "ok". Failure = `errorMessage` set OR all four scores null |
| Perf / A11y / SEO | score badge, colored ≥90/≥50/else |
| LCP | `(lcpMs/1000).toFixed(1)s` |
| CLS | `toFixed(3)` |
| INP | `round(inpMs)ms` |
| TTFB | `round(ttfbMs)ms` |
| Issues | "View issues" button → `/p/$projectId/audit/issues/$resultId?auditId=…&category=performance` (only when `r2Key` present and not failed) |

Performance filters: Search (URL), Device (all/desktop/mobile), Status (all/ok/failed), Perf min/max, SEO min/max, Max LCP s (placeholder 2.5).

**Exports** (`src/client/features/audit/results/export.ts`; CSV via `buildCsv`, Sheets via `exportTableToSheets({headers, rows, feature})`):
- Issues: headers `Severity, Issue, URL, Details, How To Fix` → file `audit-issues.csv`; JSON `audit-issues.json` = `[{severity, issueType, issue, url, details(parsed), howToFix}]`; Sheets feature `audit_issues`.
- Pages: `URL, Status, Title, H1, Words, Images, Missing Alt, Response Time (ms)` → `audit-pages.csv/json`; feature `audit_pages`.
- Performance: `URL, Device, Performance, Accessibility, SEO, LCP (ms), CLS, INP (ms), TTFB (ms)` → `audit-performance.csv/json`; feature `audit_performance`.

#### Lighthouse issue detail page (`LighthouseIssuesScreen`)

- Data: server fn `getAuditLighthouseIssues({projectId, resultId})` → reads the result row, fetches the compact payload JSON from **R2** (`r2Key`), returns `{id, finalUrl, strategy, createdAt(=audit.startedAt), hasIssueDetails, scores, metrics, issues}` (issues sorted by impact desc, then score asc).
- Header: back link ("Site Audit"), H1 "Lighthouse Issues", final URL, scanned date, severity count badges (critical/warning/info for visible issues).
- Summary: 4 circular **score gauges** (SVG ring, r=28): Performance, Accessibility, Best Practices, SEO (≥90 green, ≥50 amber, else red). Metrics grid (display values): FCP, LCP, TBT, SI, TTI, CLS, INP, TTFB.
- Category tabs with counts: All / Performance / Accessibility / Best practices / SEO (URL param `category`).
- Issue table columns: expand chevron, Severity (icon+label), Title (+displayValue), Impact (hidden on mobile; "`N ms / N KB`" from impactMs/impactBytes), Score. Expanded row: description rendered with inline markdown links, `<details>` "Affected items (n)" with `<pre>` JSON snippets (≤10 items).
- **Export menu**: Export to Sheets (current category / all actionable), Copy (current category issues / all actionable issues / saved Lighthouse payload → clipboard), Download JSON (current category / all actionable / saved payload), Download CSV (current / all). CSV headers: `Category, Severity, Score, Title, Display Value, Description, Impact (ms), Impact (bytes), Affected Items`. Server export fn `exportAuditLighthouseIssues({resultId, mode: "full"|"issues"|"category", category?})` returns `{filename, content}`: `full` → `lighthouse-{strategy}-{date}-payload.json` (raw stored payload); `issues` → `lighthouse-{strategy}-{date}-issues.json`; `category` → `…-{category}-issues.json`, content `{resultId, finalUrl, strategy, createdAt, category, issues}`.
- Legacy notice if `!hasIssueDetails`: "This Lighthouse run was stored before issue details were preserved. Re-run the audit…".

#### Dashboard card (project dashboard)

`DashboardService.getAuditSummary(projectId)` → latest audit: `{status, pagesCrawled, startedAt, topIssues (top 3 by severity then distinct-page count), totalIssueTypes}`. Counts come from `SELECT issue_type, severity, COUNT(DISTINCT page_url) … GROUP BY issue_type, severity`.

#### Server functions (`src/serverFunctions/audit.ts`, all POST, `requireProjectContext` middleware)

| Function | Input | Behavior |
|---|---|---|
| `startAudit` | `{projectId, startUrl (1..2048), maxPages (10..10000, default 50), lighthouseStrategy ("auto"\|"none", default "auto")}` | resolves limit tier, starts audit, PostHog `site_audit:start` {project_id, max_pages, run_lighthouse, plan_tier}. Returns `{auditId}`. (UI default for Lighthouse is off, schema default is `auto`.) |
| `getAuditStatus` | `{projectId, auditId}` | returns `{id,startUrl,status,pagesCrawled,pagesTotal,lighthouseTotal,lighthouseCompleted,lighthouseFailed,currentPhase,errorCode,startedAt,completedAt}`; lazily reconciles dead workflows |
| `getAuditResults` | `{projectId, auditId}` | `{audit:{id,startUrl,status,pagesCrawled,pagesTotal,startedAt,completedAt,config}, pages[] (all columns), lighthouse[] (all columns), issues[] (all columns)}` |
| `getAuditHistory` | `{projectId}` | list `{id,startUrl,status,pagesCrawled,pagesTotal,ranLighthouse,startedAt,completedAt}` newest first |
| `getCrawlProgress` | `{projectId, auditId}` | KV live feed `[{url,statusCode,title,crawledAt}]` newest first |
| `deleteAudit` | `{projectId, auditId}` | requires org permission `project:delete` (owner/admin); terminates running workflow, deletes row (cascade), destroys scratchpad DO |
| `getAuditLighthouseIssues` / `exportAuditLighthouseIssues` | see above | Lighthouse drill-down |

### Site Audit — Crawler

#### Lifecycle overview

```
startAudit (app worker)
  ├─ tier gate (hosted: Autumn managed access + paid?) ─ free/paid/self_hosted limits
  ├─ normalizeAndValidateStartUrl → resolveStartUrlRedirects (≤5 HEAD hops, each re-validated)
  ├─ INSERT audits(status=running, currentPhase=discovery, config JSON, pagesTotal/lighthouseTotal reservation)
  ├─ post-insert org usage check (running count, capacity units) → rollback on violation
  └─ env.SITE_AUDIT_WORKFLOW.create({id: auditId, params})   (cross-script binding to open-seo-audit)

SiteAuditWorkflow.run (open-seo-audit worker)
  1. validate-context            (DB_STEP)
  2. discover-urls-v2            (DISCOVERY_STEP)  robots.txt + sitemaps → seed scratchpad frontier
  3. crawl-chunk-1..N            (CRAWL_CHUNK_STEP) + optional crawl-cooldown-N sleepUntil
  4. select-lighthouse-sample    (DB_STEP)          [if strategy=auto]
     lighthouse-fetch-K          (LIGHTHOUSE_FETCH_STEP, per URL: mobile+desktop)
     lighthouse-persist-chunk-M  (LIGHTHOUSE_PERSIST_STEP)
  5. multipage-checks            (MULTIPAGE_CHECKS_STEP) duplicates, redirects, DO link checks
  6. finalize                    (DB_STEP) complete audit, clear KV, destroy DO
  on error → mark-failed (DB_STEP): classify error, failAudit(), PostHog event, rethrow
```

`currentPhase` values: `discovery` → `crawling` → `lighthouse` → `finalizing` → `completed` | `failed`.

#### Step configs (`auditStepConfigs.ts`)

| Config | Retries | Timeout |
|---|---|---|
| `DISCOVERY_STEP` | limit 2, 5 s exponential | 4 min |
| `CRAWL_CHUNK_STEP` | limit 1, 10 s constant | 5 min |
| `LIGHTHOUSE_FETCH_STEP` | **limit 0** (paid call must never replay) | 5 min |
| `LIGHTHOUSE_PERSIST_STEP` | limit 3, 5 s exponential | 5 min |
| `DB_STEP` | limit 3, 5 s exponential | 2 min |
| `MULTIPAGE_CHECKS_STEP` | limit 2, 5 s exponential | 5 min |

`pgStep()` wraps `step.do` so each step opens its own request-scoped Postgres client (no-op in D1 mode).

#### Limits & tiers (`shared/audit-limits.ts`, `audit-capacity.ts`)

```ts
MIN_AUDIT_PAGES = 10; DEFAULT_AUDIT_PAGES = 50;
FREE_MAX_AUDIT_PAGES = 50; PAID_MAX_AUDIT_PAGES = 10_000;

AUDIT_LIMITS = {
  free:        { maxPagesPerAudit: 50,     maxCapacityUnits: 2_000,   maxRunningAudits: 5 },
  paid:        { maxPagesPerAudit: 10_000, maxCapacityUnits: 100_000, maxRunningAudits: ∞ },
  self_hosted: { maxPagesPerAudit: 10_000, maxCapacityUnits: ∞,       maxRunningAudits: ∞ },
}
clampAuditMaxPages(n) = min(max(n ?? 50, 10), 10_000)
getEstimatedAuditCapacity = { pagesTotal: clamp(maxPages), lighthouseTotal: strategy==="auto" ? 20 : 0 }
```
- Tier resolution (hosted only): ensure Autumn customer exists; `customerHasManagedAccess` false → `PAYMENT_REQUIRED` ("Subscribe to run site audits"); `customerHasPaidPlan` → paid else free. Self-hosted → `self_hosted`.
- `maxPages > tier.maxPagesPerAudit` → `AUDIT_PAGE_LIMIT_EXCEEDED`.
- **Org-level** usage (all audits of all projects in the org): `capacityUnits = Σ(pagesTotal + lighthouseTotal)` over every existing audit row (deleting audits frees capacity); `runningCount` = rows with status running. Checked **after insert** (race-safe): `runningCount > maxRunningAudits` → `AUDIT_ALREADY_RUNNING`; `capacityUnits > maxCapacityUnits` → `AUDIT_CAPACITY_REACHED`. On failure: terminate workflow if created, delete row.
- On completion `pagesTotal` is rewritten to actual `pagesCrawled`, so capacity settles to real usage.

#### Start URL validation & SSRF policy (`url-policy.ts`)

- Trim; prepend `https://` if no scheme; must be http/https; strip hash.
- Blocked hosts: `localhost, metadata.google.internal, metadata, 169.254.169.254, 100.100.100.200`; blocked suffixes `.localhost, .local, .localdomain, .internal, .home.arpa`.
- Private IPv4: `10/8, 127/8, 0/8, 169.254/16, 172.16-31, 192.168/16, 100.64-127 (CGNAT), 198.18-19, ≥224 (multicast/reserved)`. Private IPv6: `::1, ::, fc*/fd* (ULA), fe8*-feb* (link-local)`, IPv4-mapped `::ffff:` of a private v4.
- Start URL only: DNS-over-HTTPS check (`https://cloudflare-dns.com/dns-query?name=…&type=A|AAAA`, 2.5 s timeout) — any A/AAAA record in a private range → `CRAWL_TARGET_BLOCKED`.
- Discovered URLs (links, redirect targets, sitemap entries): synchronous `isCrawlableUrl` (scheme + host blocklist + IP literal check; no DNS).
- `resolveStartUrlRedirects`: up to **5** hops via `HEAD` with `redirect:"manual"`, UA `OpenSEO-Audit/1.0`, 10 s timeout; each `Location` re-validated with the full start-URL validation; any probe failure returns the last validated URL. Anchors the audit origin to the real site (apex→www, .net→.com).

#### URL normalization & scope (`url-utils.ts`)

- `normalizeUrl(url, base?)`: resolve relative; only http(s) (else null); strip `#fragment`; **sort query params**; lowercase hostname; **trailing slashes preserved** (so `/docs` and `/docs/` are distinct — avoids 301 ↔ strip loops).
- `isSameOrigin(url, origin)`: hostnames equal or differ only by a leading `www.` (either direction); same protocol requires same effective port; cross-protocol only allowed for `http:80 → https:443` upgrade.
- `canonicalUrlKey(url)`: force https, drop `www.`, lowercase host, sort params, drop hash (used only to find the homepage for Lighthouse sampling).
- `detectUrlTemplate(pathname)`: per segment → `:id` (`/^\d+$/`), `:uuid` (UUID regex), `:date` (`/^\d{4}-\d{2}-\d{2}$/`), `:slug` (contains `-` and >2 hyphen-parts), else literal.

#### Discovery (`discovery.ts`)

- robots.txt: `GET {origin}/robots.txt`, UA `OpenSEO-Audit/1.0`, 10 s timeout, non-2xx/failure → null (= allow all). Body capped at **500 KiB** (RFC 9309). Parsed with `robots-parser`; `isAllowed(url) ?? true`; sitemap URLs from `Sitemap:` lines. The raw text is **checkpointed** in step state and re-parsed deterministically on replay.
- Sitemap sources = robots sitemaps ∪ `{origin}/sitemap.xml`, filtered to same-origin.
- Constants: `SITEMAP_FETCH_TIMEOUT_MS=15_000`, `MAX_SITEMAP_DEPTH=3` (sitemap-index nesting), `MAX_SITEMAP_DOCS=300`, `SITEMAP_CONCURRENCY=5`, `SITEMAP_RETRIES=1` (retry only on timeout), `MAX_SITEMAP_BYTES=10 MiB` (larger shards skipped whole; streamed read with cancel).
- `maxDiscoveredUrls = min(max(maxPages*20, 500), 50_000)`; the final list is sliced to **`maxPages`** (seeds can never exceed budget).
- Sitemap doc accepted if content-type contains `xml` or body starts with `<?xml`, `<urlset`, `<sitemapindex`. Parsed via `fast-xml-parser` (`isArray` for `sitemap`/`url`); `<loc>` values normalized against the sitemap's final URL; redirects to another origin → ignored.
- Seeding (`discover-urls-v2` step): start URL (normalized) seeded at depth 0 with source `link` if robots-allowed and same-origin; sitemap URLs deduped, filtered (same-origin, crawlable, robots-allowed), upserted in batches of **2,000** per DO RPC with `depth=NULL, source='sitemap', in_sitemap=1` (upsert sets `in_sitemap=1` on an existing start URL). Then `pagesTotal = min(seededCount, maxPages)`, `currentPhase = crawling`.

#### Frontier / scratchpad Durable Object (`AuditScratchpad`, SQLite, `idFromName(auditId)`)

Schema:
```sql
CREATE TABLE frontier (url TEXT PRIMARY KEY, depth INTEGER, source TEXT NOT NULL,   -- 'link' | 'sitemap'
  in_sitemap INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'pending',        -- pending|leased|crawled
  chunk_no INTEGER);
CREATE INDEX frontier_claim_idx ON frontier (state, source);
CREATE TABLE page_links (page_id TEXT PRIMARY KEY, url TEXT NOT NULL, targets_json TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE links (source_page_id, source_url, target_url, PRIMARY KEY(source_page_id,target_url)); -- legacy
CREATE TABLE page_mirror (page_id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, status_code INTEGER,
  fetch_class TEXT NOT NULL, redirect_url TEXT);
CREATE INDEX page_mirror_redirect_idx ON page_mirror (redirect_url);
```
RPC methods: `seedStart(url)`, `seedSitemapUrls(urls)`, `claimChunk(chunkNo, limit)` (idempotent per chunk: returns existing leases with `isRetry=true`; if chunk already crawled returns `[]`; else leases `pending` ordered **link-discovered first, then sitemap-only, FIFO by rowid**), `recordBatch({crawledUrls, pages, links, discovered})` (mark crawled; upsert mirror; store link JSON while DB size < **500 MiB** budget; `INSERT OR IGNORE` discovered URLs = global dedup), `releaseUrls(urls)` (leased→pending), `getStats()` → `{attempted (crawled), pending, seen}`, `get/saveCrawlThrottle(state)` (KV-style storage key `crawl-throttle`), `runFinalizeChecks({startUrl, crawlCompleted})`, `destroy()` (delete alarm + deleteAll), `destroyForErasure()`, `alarm()` → destroy. Every construction ensures a **7-day self-cleanup alarm**. `BROKEN_LINK_ISSUE_CAP = 2_000`.

The DO is private to the audit worker; the app worker calls `env.AUDIT_ENGINE.destroyScratchpad(auditId)` (a `WorkerEntrypoint` RPC) for delete/GDPR.

#### Crawl phase (`siteAuditWorkflowCrawl.ts`)

Loop: while `pending > 0 && attemptedTotal < maxPages`: run step `crawl-chunk-{n}`. Constants:
```ts
CHUNK_TARGET_PAGES = 200            // leases per chunk (min with remaining budget)
CHUNK_SOFT_DEADLINE_MS = 90_000     // stop launching new fetches; unfetched leases released
PERSIST_BATCH_SIZE = 25; FIRST_PERSIST_BATCH_SIZE = 5
MAX_QUEUED_PERSIST_BATCHES = 2      // backpressure on DB writes
MAX_STORED_LINKS_PER_PAGE = 500     // internal link targets stored for link checks
MAX_DISCOVERED_PER_BATCH = 20_000   // new URLs per sub-batch (RPC 32 MiB limit)
MAX_PROGRESS_TITLE_CHARS = 300
```
- Rolling concurrency: launch while `inFlight < windowSize` and before deadline; `Promise.race(inFlight)`; persistence pipelined but serialized (`persistChain`).
- Returns only counters `{attemptedInChunk, attempted, pending, endWindow, rateLimited?, throttleState?, resumeAt?}`; `endWindow` carried to next chunk (`windowHint`).
- If throttle has a pause beyond now → `step.sleepUntil("crawl-cooldown-{n}", resumeAt)`.
- If the throttle stopped (rate-limit budget exhausted) → phase returns `{rateLimited: true, completed: false}` → a single `crawl-rate-limited` issue is added at finalize.
- Two consecutive zero-attempt chunks → stop (frontier unservable).
- `completed = pending === 0` (used to gate orphan detection).
- Link queueing rule (`shouldQueueCrawlLink`): same-origin AND `isCrawlableUrl` AND robots-allowed. Child depth = parent depth + 1 (null stays null for sitemap-only pages). **Redirect targets are queued at the same depth** as the redirecting page.
- Per sub-batch persist: deterministic page id = `sha256(auditId|url)[0:36]`; run per-page reporters; `insertCrawledBatch` (page upsert + issues insert-or-ignore); DO `recordBatch`; update `audits.pagesCrawled = stats.attempted`, `pagesTotal = min(stats.seen, maxPages)`; push `{url,statusCode,title≤300,crawledAt}` entries to KV progress.

#### Adaptive crawl window (`crawl-window.ts`)

```ts
CRAWL_WINDOW       = { initial: 2, min: 1, max: 2, budgetBytes: 8 MiB }  // normal chunk
RETRY_CRAWL_WINDOW = { initial: 1, min: 1, max: 1, budgetBytes: 4 MiB }  // retried chunk (after OOM)
SLOW_RESPONSE_MS = 10_000; FAST_RESPONSE_MS = 1_500; MIN_ASSUMED_PAGE_BYTES = 64 KiB; GROWTH_MIN_SAMPLE = 25
```
Adjust after each persisted sub-batch: `troubled` = pages with fetchClass≠ok, or rateLimited, or response ≥10 s. If `troubled*3 >= n` → halve (floor, ≥min). Else if troubled==0 and ≥50% fast (≤1.5 s) and n ≥25 → `+5` (≤max). Then cap by bytes: `min(next, max(min, floor(budgetBytes / max(avgHtmlBytes, 64 KiB))))`. (Spec 0009 describes a 5–40 window; current constants cap it at **2**.)

#### Politeness / 429 throttle (`crawl-throttle.ts`)

Shared per-audit pacing state `{intervalMs (start 1000), nextRequestAt, pausedUntil, consecutiveRateLimits, cooldownMs}`, checkpointed to the DO after each change and carried across chunks.
```ts
MAX_RETRIES = 3; FIRST_DELAY_MS = 30_000; MAX_INTERVAL_MS = 30_000; MAX_COOLDOWN_MS = 30 min
```
- `ready()`: waits until `max(pausedUntil, nextRequestAt)`; reserves slot `nextRequestAt = now + intervalMs` (so ≥1 s between request starts by default); returns false past the chunk deadline or when stopped.
- On a 429: `consecutiveRateLimits++`, `intervalMs = min(30 s, intervalMs*2)`, delay = `max(intervalMs, Retry-After (seconds or HTTP-date) ?? 30 s * 2^(consecutive-1))`; pause the whole origin; accumulate `cooldownMs`. URL retried while `attempt <= 3`.
- Any non-429 response resets `consecutiveRateLimits`.
- Stopped when `consecutiveRateLimits > 3` or `cooldownMs > 30 min` or a checkpoint write failed (→ `NonRetryableError`).

#### Page fetch (`site-audit-workflow-helpers.ts: crawlPage`)

- `fetch(url, {headers: {"User-Agent": "OpenSEO-Audit/1.0", Accept: "text/html,application/xhtml+xml"}, redirect: "manual", signal: AbortSignal.timeout(15_000)})`.
- `responseTimeMs` = time to headers of the last attempt (backoff waits excluded).
- Captures headers: `x-robots-tag`, `link` (parses `<url>; rel="canonical"` → `headerCanonicalUrl`, regex `/<([^>]+)>\s*;([^]*)/` + `/rel\s*=\s*"?canonical"?/i`), `location`.
- **3xx** → empty result with `redirectUrl = normalizeUrl(location, url)`, `fetchClass=ok` (each hop its own page row; chains/loops detected later).
- Non-HTML (content-type lacks `text/html`) → empty result, `isHtml=false`, no content checks.
- HTML body read up to **1 MiB** (`MAX_HTML_BYTES`), streaming decode.
- **Fetch classification** (`classifyFetch`, first 4,000 chars of body):
  - status 0 (network error/timeout) → `error`
  - 429 → `rate_limited` (after retries)
  - header `cf-mitigated` present → `blocked`
  - 401 / 403 → `blocked`
  - 503 whose body contains any of `"just a moment..."`, `"challenge-platform"`, `"cf-browser-verification"`, `"attention required! | cloudflare"`, `"verifying you are human"` → `blocked`
  - else `ok`
- Blocked/error/≥400/non-HTML pages → empty page result (content fields blank), `htmlBytes` still reported.
- Exceptions → `statusCode 0`, `fetchClass error` (unless throttle checkpoint failed → rethrow).
- Indexability: `robotsDirectives = [robotsMeta, xRobotsTag].join(",").toLowerCase()`; `isIndexable = !includes("noindex")`.
- `contentHash = sha256(bodyText)` if body text non-empty (duplicate-content key).
- `h1Count` = count of **non-empty** H1 texts (empty `<h1></h1>` counts as missing); `h2..h6Count` from heading order.
- `imagesMissingAlt` = images whose `alt` attribute is **absent** (`alt=""` is fine/decorative).
- Result is `structuredClone`d to detach parser string slices from the body.

#### Page analyzer (`page-analyzer.ts`, htmlparser2 streaming)

Extracted fields (`PageAnalysis`):
| Field | Rule |
|---|---|
| `title` | text of first document `<title>` (ignores `<title>` inside `svg`/non-content), trimmed |
| `metaDescription` | first `<meta name="description" content>`, trimmed |
| `robotsMeta` | first `<meta name="robots" content>` |
| `ogTitle/ogDescription/ogImage` | first `<meta property="og:title|og:description|og:image">` |
| `canonical` | first `<link rel="canonical" href>` (resolved/normalized later against page URL) |
| `hreflangTags[]` | `hreflang` of every `<link rel="alternate" hreflang>` |
| `h1s[]` | trimmed text of each H1 |
| `headingOrder[]` | sequence of heading levels (1–6) in document order |
| `images[]` | `{src, alt}` per `<img>` (alt null when attribute absent); cap **1,000** |
| `links[]` | per `<a href>` (skips `javascript:`, `mailto:`, `tel:`, `#`): `{targetUrl (normalized), anchor (whitespace-collapsed, ≤200 chars), isInternal (same-origin), isNofollow (rel contains nofollow)}`, deduped by target, cap **1,000**; nested `<a>` closes previous |
| `hasStructuredData` | any `<script type="application/ld+json">` |
| `bodyText` / `wordCount` | visible text inside `<body>` (fallback: all non-`<head>` text for fragments), excluding `script, style, noscript, svg` subtrees; whitespace collapsed; words = split on `\s+` |
- Content inside `<noscript>` is ignored for element extraction (parse5 parity).

Persisted per page (`audit_pages`): url, statusCode, redirectUrl, title, metaDescription, canonicalUrl, robotsMeta, xRobotsTag, headerCanonicalUrl, ogTitle/ogDescription/ogImage, h1–h6 counts, headingOrderJson, wordCount, contentHash, imagesTotal, imagesMissingAlt, imagesJson, internalLinkCount, externalLinkCount, hasStructuredData, hreflangTagsJson, isIndexable, fetchClass, crawlDepth, inSitemap, responseTimeMs. (Link edges are never written to the app DB.)

#### Live progress (`progress-kv.ts`)

KV key `audit-progress:{auditId}`, JSON array of `{url, statusCode, title, crawledAt(ms)}`, newest first, capped at **300** entries, TTL **30 min**, deleted at finalize.

#### Finalize

1. `multipage-checks` step: set phase `finalizing`; integrity guard (crawl reported pages but none persisted → throw); `runMultipageChecks` (duplicates + redirect chains/loops over app-DB page rows); DO `runFinalizeChecks` (broken internal links + orphans); add `crawl-rate-limited` issue (pageId null, pageUrl = startUrl) if the crawl stopped on rate limits; `insertIssues`.
2. `finalize` step: count blocked / rate-limited pages; `completeAudit` (status completed, completedAt, currentPhase completed, `pagesCrawled = pagesTotal = crawl.pagesCrawled`); PostHog `site_audit:complete` {status, pages_crawled, crawl_completed, pages_blocked, pages_rate_limited, run_lighthouse}; clear KV progress; `destroy()` the scratchpad.

Issue row id = `sha256(auditId|pageUrl|issueType|dedupeKey)[0:36]` (idempotent insert-or-ignore). Lighthouse row id = `sha256(auditId|pageId|strategy)[0:36]` (upsert).

#### Failure handling & reconciler

- Error classification (`audit-errors.ts`, stored in `audits.error_code`, `error_detail` ≤500 chars, `failed_phase`):
  - `"exceeded memory limit"` → `oom`; `"exceeded CPU time limit"` → `cpu_limit`; `WorkflowTimeoutError`/`Execution timed out` → `step_timeout`; `"output is too large"` → `step_output_too_large`; `WorkflowInternalError` → `workflow_internal`; `Failed query:`/`D1_ERROR`/`Postgres database accessed outside a request scope` → `db_error`; instance missing → `instance_lost`; else `unknown`.
- `failAudit` only transitions rows still `running` (guards race with finalize).
- `reconcileRunningAudit(audit)`: fetch workflow instance status; `errored`/`terminated` → classify `status.error` → fail row. Instance-not-found (`/not[ _]?found/i`) counts only after a **10-min grace** → `instance_lost`. Transient API errors never fail an audit.
- Callers: lazily in `getStatus` (UI polling / MCP), and the **cron watchdog** `reconcileStaleAudits()` — runs on every `*/5 * * * *` cron tick (before scheduled rank checks) over up to **100** audits `running` for >**15 min**, oldest first; emits PostHog `site_audit:complete` with `reconciled_by: "watchdog"`.
- Deletion of a running audit: `instance.terminate()`; if terminate throws, re-check status and only error ("Unable to stop the running audit.") if still `queued|running|paused|waiting|waitingForPause`.
- GDPR erasure: terminates active audit workflows, destroys each audit's scratchpad, deletes `audit-progress:*` KV keys (R2 Lighthouse blobs are under `site-audit/{projectId}/…`).

#### Deployment topology

- Aux worker `open-seo-audit` (`src/audit-worker.ts`, `wrangler.audit.jsonc`): exports `SiteAuditWorkflow` (workflow name `site-audit-workflow`, binding `SITE_AUDIT_WORKFLOW`), DO class `AuditScratchpad` (binding `AUDIT_SCRATCHPAD`, sqlite migration `v1`), default `AuditEngine extends WorkerEntrypoint` with `destroyScratchpad(auditId)`; shares `DB` (D1) / Hyperdrive, `KV`, `R2` with the app worker; compat flags `nodejs_compat`, `global_fetch_strictly_public`.
- App worker binds `SITE_AUDIT_WORKFLOW` cross-script (`script_name: "open-seo-audit"`) and `AUDIT_ENGINE` service binding.
- Re-implementation note for Next.js: replace Workflow+DO with a durable job runner (e.g. a queue worker with checkpointed chunks) plus a per-audit frontier table; keep the same idempotency keys and chunking semantics.

### Site Audit — Issue Catalog

Registry: `src/shared/audit-issues.ts` (`AUDIT_ISSUE_TYPES`, each with `severity`, `title`, `explanation`, `howToFix`). Severity order: critical=0, warning=1, info=2. Per-page thresholds (`page-reporters.ts`):
```ts
TITLE_MAX_CHARS = 60; TITLE_MIN_CHARS = 10;
META_DESCRIPTION_MAX_CHARS = 160; META_DESCRIPTION_MIN_CHARS = 70;
THIN_CONTENT_WORDS = 150; SLOW_RESPONSE_MS = 1500; DEEP_PAGE_DEPTH = 5;
```
Per-page reporter evaluation order (early returns matter):
1. `fetchClass=blocked` → only `blocked-page`; `rate_limited` → only `rate-limited-page`; `error` → nothing.
2. status ≥500 → only `server-error`; ≥400 → only `broken-page`; ≥300 → nothing (redirects handled cross-page).
3. `responseTimeMs > 1500` → `slow-response`.
4. If not HTML → stop.
5. Title / meta / headings / indexability / canonical / content / structure checks below.

| # | id | Title (UI) | Severity | Category | Exact rule | Scope | `details` payload |
|---|---|---|---|---|---|---|---|
| 1 | `blocked-page` | Crawler was blocked | critical | Crawl access | `fetchClass === "blocked"` (401/403, `cf-mitigated` header, or 503 with challenge markers) | per-page | `{statusCode}` |
| 2 | `rate-limited-page` | Rate limited (429) | warning | Crawl access | final response 429 after ≤3 retries (`fetchClass === "rate_limited"`) | per-page | `{statusCode}` |
| 3 | `crawl-rate-limited` | Crawl stopped early: rate limit | warning | Crawl access | throttle stopped (>3 consecutive 429s or cumulative cooldown >30 min or checkpoint failure); one row, pageId null, url = start URL | audit-level | – |
| 4 | `server-error` | Server error (5xx) | critical | HTTP status | `statusCode >= 500` (ok fetch class) | per-page | `{statusCode}` |
| 5 | `broken-internal-link` | Broken internal link | critical | Links | internal link (stored target ≤500/page) whose target was **crawled** with `status_code >= 400` AND `fetch_class = 'ok'` (blocked targets excluded); one row per (source page, target); cap 2,000 rows; SQL in DO | multi-page | `{targetUrl, targetStatus}`; dedupeKey = targetUrl |
| 6 | `missing-title` | Missing title tag | critical | Head | HTML page, `title === ""` (after trim) | per-page | – |
| 7 | `broken-page` | Page returns an error (4xx) | warning | HTTP status | `400 <= statusCode < 500` (ok fetch class; 401/403 are classified blocked instead, 429 rate-limited) | per-page | `{statusCode}` |
| 8 | `duplicate-title` | Duplicate title | warning | Duplicates | ≥2 *duplicate-candidate* pages share identical non-empty `title` | multi-page | `{groupSize, otherUrls (≤3)}` |
| 9 | `duplicate-meta-description` | Duplicate meta description | warning | Duplicates | ≥2 candidates share identical non-empty `metaDescription` | multi-page | same |
| 10 | `duplicate-content` | Duplicate page content | warning | Duplicates | ≥2 candidates with `wordCount > 0` share `contentHash` (SHA-256 of visible body text) | multi-page | same |
| 11 | `missing-meta-description` | Missing meta description | warning | Head | `metaDescription === ""` | per-page | – |
| 12 | `missing-h1` | Missing H1 heading | warning | Headings | `h1Count === 0` (empty H1s don't count) | per-page | – |
| 13 | `multiple-h1` | Multiple H1 headings | warning | Headings | `h1Count > 1` | per-page | `{h1Count}` |
| 14 | `redirect-chain` | Redirect chain | warning | Redirects | walking from a chain *head* (a 3xx page no other redirect points to) yields `hops.length > 2` (≥2 redirects before content); one issue per chain on the head | multi-page | `{hops[], finalUrl}` |
| 15 | `redirect-loop` | Redirect loop | warning | Redirects | walk revisits a URL (incl. self-redirect); headless cycles (every member is a target, e.g. a↔b) emit one loop per cycle | multi-page | `{hops[]}` |
| 16 | `canonical-conflict` | Conflicting canonical signals | warning | Canonical | HTML `<link rel=canonical>` and HTTP `Link: rel=canonical` both present and differ (normalized) | per-page | `{htmlCanonical, headerCanonical}` |
| 17 | `thin-content` | Thin content | warning | Content | `isIndexable && wordCount < 150` | per-page | `{wordCount}` |
| 18 | `images-missing-alt` | Images missing alt text | warning | Content/a11y | `imagesMissingAlt > 0` (alt attribute absent) | per-page | `{imagesMissingAlt, imagesTotal}` |
| 19 | `orphan-page` | Orphan page | warning | Structure | live page (`fetch_class='ok'`, 2xx), ≠ start URL, no inbound link from any **other** crawled page, and no crawled redirect targets it. Only when crawl **completed** (frontier exhausted) and link storage under 500 MiB budget | multi-page | – |
| 20 | `no-outgoing-links` | Page has no outgoing links | warning | Structure | `isIndexable && links.length === 0` (internal+external) | per-page | – |
| 21 | `title-too-long` | Title too long | info | Head | `title.length > 60` | per-page | `{length}` |
| 22 | `title-too-short` | Title too short | info | Head | `title.length < 10` | per-page | `{length}` |
| 23 | `meta-description-too-long` | Meta description too long | info | Head | `length > 160` | per-page | `{length}` |
| 24 | `meta-description-too-short` | Meta description too short | info | Head | `length < 70` | per-page | `{length}` |
| 25 | `heading-order-skip` | Heading levels skip | info | Headings | any `headingOrder[i] > headingOrder[i-1] + 1` (e.g. H2→H4); decreasing is fine | per-page | – |
| 26 | `slow-response` | Slow server response | info | Performance | `responseTimeMs > 1500` (time to response headers) for 2xx pages (checked before HTML gating) | per-page | `{responseTimeMs}` |
| 27 | `noindex-page` | Page is noindex | info | Indexability | `!isIndexable` — `noindex` in robots meta or `X-Robots-Tag` | per-page | `{robotsMeta, xRobotsTag}` |
| 28 | `canonicalized-page` | Canonicalized to another URL | info | Canonical | effective canonical (`canonicalUrl ?? headerCanonicalUrl`) exists and `!== page.url` (exact normalized string) | per-page | `{canonicalUrl}` |
| 29 | `deep-page` | Page is deep in the site structure | info | Structure | `crawlDepth !== null && crawlDepth >= 5` (clicks from start URL; sitemap-only pages have null depth) | per-page | `{crawlDepth}` |

(29 ids total; `crawl-rate-limited` is the only audit-level one.)

**Duplicate-candidate definition** (`isDuplicateCandidate`): `fetchClass==="ok"`, 2xx status, `isIndexable`, and effective canonical absent or equal to its own URL (pages already noindexed/canonicalized elsewhere are excluded).

**Broken-link SQL** (DO): expands `page_links.targets_json` via `json_each`, `CROSS JOIN page_mirror m ON m.url = j.value WHERE m.status_code >= 400 AND m.fetch_class = 'ok'`, `ORDER BY source_page_id, target_url LIMIT 2000`.

**Orphan SQL** (DO): anti-join of `page_mirror` against the distinct set of link targets excluding self-links, `WHERE m.url != :startUrl AND m.fetch_class='ok' AND 200<=status<300 AND inbound IS NULL AND NOT EXISTS (redirect_url = m.url)`.

Each issue row stored in `audit_issues` with `severity` copied from the registry. Full explanation / how-to-fix text (verbatim) lives in `AUDIT_ISSUE_TYPES`; copy it as-is. Examples: `missing-title.howToFix` = "Add a unique, descriptive <title> of roughly 50–60 characters that includes the page's primary topic."; `blocked-page.howToFix` tells owners to allowlist the `OpenSEO-Audit` user agent in WAF/bot protection.

### Site Audit — Scoring

There is **no composite health score** for crawl issues. What exists:
- **Counts**: total issue rows; rows per severity (critical/warning/info) in the stats strip; per-issue-type counts (UI groups show row count as "N pages"; dashboard/MCP use `COUNT(DISTINCT page_url)` per type).
- **Sorting/priority**: severity order (critical → warning → info), then affected count desc.
- **Averages**: avg response time over all pages; avg Lighthouse Performance / SEO / Accessibility over successful Lighthouse rows (rounded ints).
- **Lighthouse category scores** (0–100) = `Math.round(category.score * 100)`; color bands ≥90 good, 50–89 needs improvement, <50 poor.
- **Lighthouse per-audit issue severity** (see below).
- Dashboard summary: top 3 issue types + total issue-type count for the latest audit.

### Lighthouse / PageSpeed

#### How it runs
- Provider: **DataForSEO On-Page Lighthouse** — `POST https://api.dataforseo.com/v3/on_page/lighthouse/live/json` (Basic auth). No Google PSI API is used.
- Request body: `[{ url, for_mobile: strategy === "mobile", categories: ["performance","accessibility","best_practices","seo"] }]`.
- 60 s abort timeout until headers arrive; **no 5xx retries** (billed, non-idempotent). Response body parsing serialized per isolate via a parse lock (payloads 1–10 MB).
- Billing: metered through `createDataforseoClient(customer).lighthouse.live` → credit feature `site_audit` (path module `on_page`). A charged task whose payload is malformed still reports billing (`DataforseoChargedTaskError`).
- Only during a site audit (no standalone Lighthouse page). Strategy config values: `auto` (run) | `none` (skip). Legacy stored values `all`→auto, `manual`→none.

#### Sampling (`selectLighthouseSample`, strategy `auto`)
1. Consider only crawled pages with 2xx status.
2. Always include the homepage/start URL (match by `canonicalUrlKey`, fallback ignoring trailing slash).
3. Group remaining pages by `detectUrlTemplate(pathname)`; take the first page of each template.
4. Cap at **10 URLs** → each run on **mobile + desktop** = up to **20 checks** (`lighthouseTotal = sample*2`).
- Executed in waves of `LIGHTHOUSE_URL_CONCURRENCY = 5` URLs (≤10 paid calls in flight): step `lighthouse-fetch-{i}` per URL (Promise.all mobile+desktop, `Promise.allSettled` across the wave), then `lighthouse-persist-chunk-{j}` writes R2 + DB + progress (`lighthouseCompleted`, `lighthouseFailed`).
- Provider errors become `errorMessage` rows (scores null); Lighthouse runtime errors like `ERRORED_DOCUMENT_REQUEST`, `NOT_HTML`, `NO_FCP` logged as warnings.

#### Parsing & storage
Response validated (`status_code === 20000` at envelope and task; result[0] required); the multi-MB report is reduced to a compact **StoredLighthousePayload v2**:
```ts
{ version: 2, source: "dataforseo-lighthouse", hasIssueDetails,
  metadata: { requestedUrl, finalUrl, strategy, fetchedAt, lighthouseVersion, taskId, cost },
  scores: { performance, accessibility, "best-practices", seo },        // round(score*100) | null
  metrics: { firstContentfulPaint, largestContentfulPaint, totalBlockingTime, cumulativeLayoutShift,
             speedIndex, timeToInteractive, interactionToNextPaint, serverResponseTime }, // {score, displayValue, numericValue}
  issues: StoredLighthouseIssue[] }
```
Metric → Lighthouse audit keys: `first-contentful-paint`, `largest-contentful-paint`, `total-blocking-time`, `cumulative-layout-shift`, `speed-index`, `interactive`, `interaction-to-next-paint`, `server-response-time`. All scores null → error "returned no category scores".

- Payload stored in **R2** at `site-audit/{projectId}/{auditId}/{pageId}-{strategy}.json` (content-type application/json); DB row `audit_lighthouse_results` stores: strategy, performanceScore, accessibilityScore, bestPracticesScore, seoScore, `lcpMs` (= LCP numericValue), `cls`, `inpMs` (INP numericValue), `ttfbMs` (server-response-time numericValue), errorMessage, r2Key, payloadSizeBytes.

#### Issue extraction (`buildStoredLighthouseIssues`)
For each category in `[performance, accessibility, best-practices, seo]`, for each `auditRefs[].id`:
- skip if audit missing, `scoreDisplayMode === "numeric"`, or key in diagnostics set `{largest-contentful-paint-element, layout-shifts, diagnostics, metrics, network-requests, network-rtt, network-server-latency, main-thread-tasks, screenshot-thumbnails, final-screenshot, script-treemap-data, resource-summary}`.
- skip as "pass" if score null, score ≥90, or display mode `notApplicable|informative|manual|error`.
- else record `{category, auditKey, title, description, score, scoreDisplayMode, displayValue, impactMs = details.overallSavingsMs, impactBytes = details.overallSavingsBytes, severity, items}`; `items` = first 10 `details.items` (object or array) compacted to JSON of preferred keys `url, source, nodeLabel, snippet, totalBytes, wastedBytes, wastedMs, label, value` (fallback: first 6 keys).
- Severity:
```ts
if (impactMs >= 300 || impactBytes >= 150_000) return "critical";
if (score != null && score < 50) return "critical";
if (impactMs >= 100 || impactBytes >= 50_000) return "warning";
if (score != null && score < 90) return "warning";
return "info";
```
- Display sort: `impactMs*1000 + impactBytes` desc, then score asc (null → 100).
- `hasIssueDetails` = any category has `auditRefs`.

#### Where Lighthouse shows up
Performance tab table, stats strip averages, `/audit/issues/$resultId` detail screen (gauges, metrics, categorized issue list, exports). MCP `run_site_audit` has `runLighthouse` (default **false** for agents).

### DataForSEO / External Endpoints (Site Audit)

| Purpose | Method + endpoint | Payload | Response fields used | Billing |
|---|---|---|---|---|
| Lighthouse per URL × device | `POST https://api.dataforseo.com/v3/on_page/lighthouse/live/json` | `[{url, for_mobile, categories:["performance","accessibility","best_practices","seo"]}]` | `tasks[0].{id,cost,status_code,status_message}`, `result[0].{requestedUrl,finalUrl,lighthouseVersion,categories.*.score/auditRefs,audits.*}` | metered, credit feature `site_audit`, ≤20 calls per audit |
| robots.txt | `GET {origin}/robots.txt` | UA `OpenSEO-Audit/1.0`, 10 s | text ≤500 KiB | free |
| Sitemaps | `GET {origin}/sitemap.xml` + robots `Sitemap:` URLs (+ nested index docs) | UA `OpenSEO-Audit/1.0`, 15 s, 1 retry on timeout | `<urlset><url><loc>`, `<sitemapindex><sitemap><loc>` | free |
| Start URL redirect probe | `HEAD {startUrl}` (manual redirects, ≤5 hops) | UA `OpenSEO-Audit/1.0`, 10 s | status, `Location` | free |
| SSRF DNS check (start URL only) | `GET https://cloudflare-dns.com/dns-query?name={host}&type=A|AAAA` (`Accept: application/dns-json`) | 2.5 s | `Status`, `Answer[].{type,data}` | free |
| Page crawl | `GET {url}` (manual redirects) | UA `OpenSEO-Audit/1.0`, `Accept: text/html,application/xhtml+xml`, 15 s | status, `content-type`, `location`, `x-robots-tag`, `link`, `retry-after`, `cf-mitigated`, body ≤1 MiB | free (not metered) |
| Payload storage | Cloudflare R2 `put/get` | key `site-audit/{projectId}/{auditId}/{pageId}-{strategy}.json` | – | – |
| Live progress | Cloudflare KV | key `audit-progress:{auditId}`, TTL 30 min | – | – |

Related non-audit helper: `src/server/lib/scrape.ts` (used by chat agents, not the audit) — UA `OpenSEO-Onboarding/1.0 (+https://openseo.so)`, reads homepage + `/sitemap.xml` `<loc>` URLs (≤5 pages, ≤4,000 chars text each, 2 MB cap, 10 s timeout, one validated redirect hop).

#### MCP tools (site audit)

| Tool | Input | Output |
|---|---|---|
| `run_site_audit` | `projectId`, `url` (1..2048), `maxPages?` (10..10000, default 50), `runLighthouse?` (default **false**) | `{auditId}`; capacity/concurrency refusals returned as readable text without auditId; PostHog `site_audit:start` source mcp |
| `get_audit_status` | `projectId`, `auditId?` (default latest) | `{status: {...getStatus fields}}`; text "Audit X (url): status — phase P, a/b pages, lighthouse c/d." + next-step hint (partial results on failure) |
| `get_audit_issues` | `projectId`, `auditId?`, `severity?`, `issueType?` (enum of registry ids), `limit?` (1..1000, default 200) | `{summary: [{issueType,title,severity,count}], issues: [{severity,issueType,title,url,details,howToFix}]}` sorted severity then type (truncation drops info first) |
| `get_audit_pages` | `projectId`, `auditId?`, `fetchClass?` (ok/blocked/rate_limited/error), `statusCode?`, `urlContains?`, `limit?` (1..1000, default 100) | `{pages: [{id,url,statusCode,fetchClass,redirectUrl,title,metaDescription,wordCount,isIndexable,crawlDepth,inSitemap,internalLinkCount,responseTimeMs}], total}` |
| `list_site_audits` | `projectId` | `{audits: getHistory()}` |
| `delete_site_audit` | `projectId`, `auditId` (required) | `{auditId, deleted: true}`; requires owner/admin (`project:delete`) |

#### Agent skill `seo-audit` (`.agents/skills/seo-audit/SKILL.md`, also in `plugins/openseo/skills`)
Workflow skill (not code): `whoami` → resolve/create project → `get_project_context` (needs `business_overview`) → `run_site_audit` (Lighthouse off) and poll `get_audit_status` → `get_audit_issues`/`get_audit_pages`; parallel orientation with `get_backlinks_overview`, `get_domain_overview`, `get_ranked_keywords` (`resultTypes:["organic"]`, `scope:"exact_url"`), live checks with `get_serp_results` (depth 20, count organic spots, "#10 (page 1)" convention), optional `get_search_console_performance`, `get_keyword_metrics`/`research_keywords`. Writes an `opportunities.md` shortlist (5–10 rows, ≥3 opportunity kinds), chooses 1–3 recommendations, sizes benefit honestly, reviewer pass, then delivers via the `seo-report` skill (saved with `skill: "seo-audit"`), and writes back `update_project_context` (`addKeyPages`, `appendResearchLog`). Output sections: "Your next SEO move", "Recommendations" (Do this / Why / evidence table), "What else we checked" table, "How this report was made" with `<details>` evidence.

### badseo Test Site (deliberately broken fixture site)

`badseo/` = **badseo.dev**, a TanStack Start Cloudflare Worker whose pages each break one SEO rule; it is the end-to-end fixture for the audit engine. `badseo/scripts/run-audit.ts` (run `pnpm --dir badseo run audit http://localhost:8787`) imports the **real** `crawlPage`, `createCrawlThrottle`, `discoverUrls/parseRobotsTxt`, `runPageReporters`, `findDuplicates`, `findRedirectChainsAndLoops` (reimplements only the frontier so it can crawl localhost; MAX_PAGES 200, concurrency 10) and asserts each fixture triggers exactly its `expectedIssues` (type-checked against the registry) and that `/`, `/privacy`, support pages are clean; it also enforces every issue type is covered. robots.txt allows all and lists `/sitemap.xml`; unknown URLs return a styled 404. Shared page chrome emits no headings/images so fixtures are isolated.

| Path | Defect | Expected issues |
|---|---|---|
| `/head/missing-title` | no `<title>` | missing-title |
| `/head/title-too-long` | title > 60 chars | title-too-long |
| `/head/title-too-short` | title < 10 chars | title-too-short |
| `/head/missing-meta-description` | no meta description | missing-meta-description |
| `/head/meta-description-too-long` | > 160 chars | meta-description-too-long |
| `/head/meta-description-too-short` | < 70 chars | meta-description-too-short |
| `/head/missing-h1` | no H1 | missing-h1 |
| `/head/empty-h1` | `<h1></h1>` | missing-h1 |
| `/head/multiple-h1` | two H1s | multiple-h1 |
| `/head/heading-order-skip` | H2 → H4 | heading-order-skip |
| `/content/thin-content` | < 150 words | thin-content |
| `/content/images-missing-alt` | `<img>` without alt | images-missing-alt |
| `/content/duplicate-a` + `/content/duplicate-b` | identical title, meta, body | duplicate-content, duplicate-title, duplicate-meta-description |
| `/content/duplicate-title-a`/`-b` | only titles shared | duplicate-title |
| `/content/duplicate-meta-a`/`-b` | only meta shared | duplicate-meta-description |
| `/index/noindex-meta` | `<meta name=robots content=noindex>` | noindex-page |
| `/index/noindex-header` | `X-Robots-Tag: noindex` | noindex-page |
| `/index/canonicalized` | canonical → another URL | canonicalized-page |
| `/index/canonical-conflict` | HTML canonical ≠ `Link` header canonical | canonical-conflict, canonicalized-page |
| `/status/not-found` | 404 | broken-page |
| `/status/server-error` | 500 | server-error |
| `/status/blocked` | 403 | blocked-page |
| `/links/broken-internal-link` | links to `/status/not-found` | broken-internal-link |
| `/status/rate-limited` | 429 + `Retry-After: 1` for first N requests, then 200 | none (crawler must back off & succeed) |
| `/status/rate-limited-always` | 429 always, no Retry-After (sitemap-only) | rate-limited-page |
| `/redirect/chain-1` → `/redirect/chain-2` → `/` | 2 hops | redirect-chain (on head only) |
| `/redirect/loop` | 302 to itself | redirect-loop |
| `/redirect/trailing-slash` → `/redirect/trailing-slash/` | CMS-style slash canonical (trap) | none (must not report a loop) |
| `/perf/slow-response` | ~1.7 s delay | slow-response |
| `/structure/orphan` | only in sitemap, nothing links to it | orphan-page |
| `/structure/no-outgoing-links` | no `<a>` at all | no-outgoing-links |
| `/structure/deep/{1..}` → `/structure/deep/treasure` | ≥5 clicks from home | deep-page (treasure only) |
| `/kitchen-sink` | long title, no meta, 2×H1, H1→H4 skip, img w/o alt, slow | title-too-long, missing-meta-description, multiple-h1, heading-order-skip, images-missing-alt, slow-response |

---

## 8. AI Visibility (Brand Lookup, Prompt Explorer)

### AI Visibility — Brand Lookup

Route `/p/$projectId/brand-lookup` — URL search params: `q` (query), `c` (comma-joined competitors, max 5), `scope` (research scope, only when differs from derived default). Page title "Brand Lookup", subtitle "See how AI search cites any brand name or domain."

**Gating**: hosted free plan → `AiSearchPaidPlanGate` (feature pitch bullets: Track AI visibility / See the prompts / Map the competition); server `lookupBrand` → `assertPaidPlan` (`PAYMENT_REQUIRED` "Upgrade to the paid plan to use AI Visibility"); self-host ungated.

#### Search card
- Input "Enter a brand name or domain" (max 250 chars) + `ResearchScopeSelect` (domain / subdomains / subfolder / exact_url; disabled with "Scopes apply to domain lookups" when input is a brand keyword) + submit.
- Competitors input "Add competitors (comma-separated)" — "Add up to 5 competitor brands or domains to see your Share of Voice." Client validation: per-item ≤250, competitor equal to target rejected, Subfolder requires a path.
- **Cost estimate** text: `Est. $X` where raw base = **$0.85** per lookup (6 DataForSEO calls), + "plus ~$Y to compare competitors" raw **$0.20** (2 cross_aggregated calls); hosted displays `raw × 1.28` (rounded 5dp), self-host shows raw.
- Recent searches (localStorage `brand-lookup-search-history:{projectId}`, max 20; identity = query+competitors+scope) shown when no active query.
- Query runs via React Query `["brand-lookup", projectId, q, c, scope]`, `staleTime 5 min`, `retry:false`, `locationCode: 2840, languageCode: "en"` (hardcoded; no locale selector).

#### Target detection
`detectTarget(raw)`: no whitespace + contains "." + `normalizeDomain` yields hostname with "." → `{type:"domain", value: hostname}` else `{type:"keyword", value: trimmed}`. For domains, `parseResearchTarget(query, scope)` → scope; `include_subdomains = (scope null or "subdomains")`; exact_url/subfolder narrow only page rows by post-filtering.

#### Server flow (`getBrandLookup`)
1. Cache key (R2 cache, TTL **24 h**) over org, project, target type/value (lowercased), sorted competitors, location, language, scope, path (for URL scopes). Cache hit returns stored result.
2. For platforms `["chat_gpt", "google"]` **sequentially** (hosted billing checks balance per call): ChatGPT forced to **location 2840 / "en"** (DataForSEO only has US/en ChatGPT data). Per platform, sequentially: aggregated_metrics (`internal_list_limit: 20`), top_pages (`items_list_limit: 10`), mentions search (`limit: 100`). Each settled independently; `INSUFFICIENT_CREDITS`/`AI_SEARCH_BILLING_ISSUE` rethrown; all three failing → platform error.
3. If competitors: per platform one cross_aggregated_metrics call with groups `[target, ...competitors]` (`aggregation_key` = label).
4. `shapeResult` → result; cached only if every call succeeded and `hasData`.

LLM target object (`buildLlmTarget`):
```ts
domain:  { domain, include_subdomains, search_filter:"include", search_scope:["any"] }
keyword: { keyword, search_filter:"include", search_scope:["any","brand_entities"], match_type:"word_match" }
```

Competitor resolution (`resolveCompetitorGroups`): detect each, dedupe case-insensitively, drop ones equal to target.

#### Shaping (`brandLookupShaping.ts`)
- `perPlatform[]`: `{platform, status, mentions, aiSearchVolume}` from `aggregated.platform[key==platform].mentions / .ai_search_volume` (rounded).
- `totalMentions`, `totalAiSearchVolume` = nullable sums; ChatGPT excluded unless user locale is 2840/en.
- `topPages` (Cited sources) via `deriveCitedSources`: rows from each platform's top_pages items (`key` = URL; must be http(s), ≤2048 chars, no user:pass; filtered by URL scope first); `mentions`, `capturedVolume` = platform group's mentions/ai_search_volume; `keywords` = prompt examples from the mentions sample whose `sources[].url` equals the page URL (≤50, sorted by volume). Cap **10 per platform**, then sort by capturedVolume desc, mentions desc.
- `topQueries`: mentions with non-empty `question` (under URL scope only those citing an in-scope source); per platform sorted by `ai_search_volume` desc, top **25**, merged & resorted; fields `question (≤500), platform, aiSearchVolume, firstSeenAt (first_response_at), lastSeenAt (last_response_at), citedSources (≤10 {url, domain, title≤300}), brandsMentioned (brand_entities[].title, ≤20)`.
- `monthlyVolume`: sum of `monthly_searches[].search_volume` across all mention items by year-month, sorted, last **12**.
- `aggregatesAreDomainLevel = true` under exact_url/subfolder (UI shows "Domain-level" badges).
- `hasData` = any mentions>0 or pages/queries/monthly or SoV data.

#### Share of Voice formula (`computeShareOfVoice`)
```
null if no competitors or all cross calls failed
for each requested key (target + competitors): mentions = Σ over successful platforms of Σ item.platform[].mentions (null if no data)
  (ChatGPT platform excluded unless user locale US/en)
denominator = Σ non-null mentions
sharePct = mentions==null || denominator<=0 ? null : mentions/denominator*100
entries sorted by mentions desc (null last); isTarget flag; platforms[] = successful platforms
```
UI (`BrandLookupShareOfVoice`): ranked list with label, "You" badge for target, mentions count, bar width `sharePct/maxPct*100%` (target bar primary color), rounded %; caption lists summed platforms; tooltip "Share of Voice compares whole domains — it is not narrowed to the page or folder you searched."

#### Results UI (`BrandLookupResults`)
- Header: resolved target (large), badge `domain|keyword`, scope badge, "Updated Xm ago".
- Grid (2 cols lg): **Stats card** — "Mentions" and "AI search volume" big numbers with per-platform rows (ChatGPT / Google AI Overview dots emerald/sky; "unavailable" on error; ChatGPT info tooltip US-English-only); **Mention trend (last 12 months)** LineChart of `monthlyVolume`; **Share of Voice** card.
- **Citation tabs card**: tabs **Queries** (default) and **Cited sources**; Export dropdown (Google Sheets / CSV); Filters toggle.
  - Queries columns: Query (with "Brands: …" subline), Platform (only if >1 platform present), AI search vol. (sortable, nulls last), action link "Run this prompt in Prompt Explorer" → `/p/$projectId/prompt-explorer?q=<question>&hb=<brand>`.
  - Cited sources columns: Source (URL; "You" badge if domain is target), Platform, Cited for (prompt examples), Source vol. (sortable).
  - Filters: Queries — include/exclude terms (question + brands), platform, min/max volume; Pages — include/exclude (url, domain, prompts), platform, min/max mentions.
  - CSV: pages `URL, Domain, Platform, Source mentions, Source AI search volume, Fetched-sample prompt examples` → `ai-brand-lookup-pages-{slug}.csv`; queries `Query, Platform, AI search volume, First seen, Last seen` → `ai-brand-lookup-queries-{slug}.csv`.
- Empty/error states: all platforms errored → "AI mention data is temporarily unavailable…"; no data → "No AI mentions found for X" + note on unavailable platforms.

### AI Visibility — Prompt Explorer

Route `/p/$projectId/prompt-explorer` — URL params `q` (prompt), `models` (repeatable; default all 4), `web` (only `false` stored), `cc` (country, default US omitted), `hb` (highlight brand). Page pitch bullets (free-plan gate): "Four models side-by-side", "See what the models cite", "Check brand mentions".

#### Form (`PromptExplorerForm`)
Prompt textarea (≤500 chars with counter), "Highlight brand (optional)", model checkboxes ChatGPT / Claude / Gemini / Perplexity (≥1 required), "Web search" checkbox (default on) + web search location select (24 ISO codes: US, GB, CA, AU, IE, DE, FR, ES, IT, NL, PT, PL, SE, NO, DK, BR, MX, IN, JP, KR, SG, HK, TW, ZA), submit. History: localStorage `prompt-explorer-search-history:{projectId}` (20 items; identity = prompt+brand+sorted models+web+cc).

#### Providers — all via DataForSEO AI Optimization LLM Responses (no direct OpenAI/Anthropic calls)

`POST /v3/ai_optimization/{model_slug}/llm_responses/live`, slugs `chat_gpt | claude | gemini | perplexity`:
```ts
MODEL_NAMES = { chat_gpt:"gpt-5", claude:"claude-sonnet-4-5", gemini:"gemini-2.5-pro", perplexity:"sonar-reasoning-pro" }
ACCEPTED (validated before dispatch, since invalid model_name is billed):
  chat_gpt:{gpt-5}, claude:{claude-sonnet-4-5, claude-sonnet-4-6}, gemini:{gemini-2.5-pro},
  perplexity:{sonar-reasoning-pro, sonar-pro, sonar}
payload: { user_prompt, model_name, web_search (default true),
           max_output_tokens: 4096 (clamped 256..4096),
           web_search_country_iso_code? }   // omitted for gemini (API rejects it)
```
No system prompt is sent; the user prompt is sent verbatim. Unique models run in parallel (`Promise.allSettled`).

#### Caching & parsing
- R2 cache per (org, project, model, whitespace-normalized prompt (case preserved), webSearch, country, `systemPromptV: 5`), TTL **7 days**; `highlightBrand` not in key (re-applied on read).
- `text` = join of `items[type=="message"].sections[].text` with blank lines.
- `citations` = `sections[].annotations[] {url,title}`, http(s)-only, deduped by URL, max **25**, each `{url, domain (hostname minus www), title, matchedBrand}`.
- `fanOutQueries` = `fan_out_queries` (≤20); `outputTokens`, `modelName`, `webSearch` echoed.

#### Brand scoring (per model)
```
matchedBrand(citation) = (url + " " + title).toLowerCase().includes(brand.toLowerCase())
brandMentioned = null if no brand; true if any citation matched;
                 else regex on answer text: case-insensitive, \b guards if brand starts/ends with word char,
                 else negative lookbehind/lookahead of the same boundary char (handles "C++", "AT&T")
```
Errors: `INSUFFICIENT_CREDITS` / `AI_SEARCH_BILLING_ISSUE` abort whole request; other per-model errors → `{status:"error", errorCode:"UPSTREAM_ERROR", message:"This model is temporarily unavailable. Please try again."}`.

#### Results UI (`PromptExplorerResults`)
One card per model (left border accent: ChatGPT emerald, Claude orange, Gemini sky, Perplexity violet). Header: model label, returned model name, "web search" badge, token count, brand badge (Mentioned ✓ / Not mentioned ✗ when highlight brand set). Body: `MarkdownAnswer` (react-markdown + remark-gfm, http(s)-only links, `<think>` blocks extracted into collapsible "thinking", collapses to ~12 lines with "Read more"). Citations list (matched-brand highlighted). "Related queries the model considered" chips (fan-out queries). Error card per failed model.

Credit features: `llm_mentions/*` → `ai_citations`; `*/llm_responses` → `ai_prompt_responses`.

Note: OpenRouter (`src/server/lib/openrouter.ts`, default model `openai/gpt-5.6-luna`) is used only by the SAM in-app chat agent, **not** by AI Visibility. There are **no MCP tools** for Brand Lookup / Prompt Explorer.

---

## 9. Local SEO

### Local SEO

No dedicated UI page — Local SEO is exposed via **MCP tools** (and the `local-seo` agent skill). All metered under credit feature `local_seo`.

#### Coordinate helpers
- Business data radius in **meters** clamped 200..199,999; default 10 km: `"lat,lng,radiusMeters"` (7-decimal coords).
- Business Listings search radius in **whole km** (≥1): `"lat,lng,radiusKm"`.
- Maps SERP: `"lat,lng"` or `"lat,lng,{zoom}z"`.
- Business location input: `near {latitude, longitude, radiusKm 0.2..199}` OR `locationCode` (default project market) + `languageCode`.
- Business identifier: exactly one of `businessName` / `cid` / `placeId`. For `my_business_info` & `my_business_updates` identifiers go through `keyword` as `cid:<cid>` / `place_id:<id>`.

#### MCP tools

| Tool | Endpoint | Input | Output |
|---|---|---|---|
| `search_local_businesses` | `POST /v3/business_data/business_listings/search/live` | `query?` (→`title`), `near {lat,lng,radiusKm 1..100000}` (required), `categories?[≤10]`, `minRating?` (filter `["rating.value", ">=", n]`), `minReviews?` (`["rating.votes_count", ">=", n]`), `isClaimed?` (`is_claimed`), `sortBy relevance|rating|reviews` (`order_by rating.value,desc` / `rating.votes_count,desc`), `limit 1..50 (20)`, `offset 0..1000` | rows trimmed to `title, description, category, additional_categories, address, phone, url, domain, rating, is_claimed, cid, place_id, latitude, longitude, total_photos, check_url`; table title/category/rating/reviews/phone/address |
| `get_local_serp_results` | `POST /v3/serp/google/maps/live/advanced` or `/v3/serp/google/local_finder/live/advanced` | `keyword`, `near {lat,lng,zoom? 4..18}`, `searchType maps|local_finder (maps)`, `device (mobile)`, `depth 1..100 (20)`, `languageCode?`; payload `{keyword, location_coordinate, language_code, device, os windows|android, depth, search_places:false (maps only)}` | rows trimmed to `rank_group, rank_absolute, title, domain, url, contact_url, address, address_info, phone, category, additional_categories, rating, rating_distribution, price_level, is_claimed, cid, place_id, latitude, longitude, total_photos, work_hours, local_justifications` |
| `get_google_business_questions` | `POST /v3/business_data/google/questions_and_answers/live` | identifier + `near` + `depth 1..100 (20)` | flattened `items` + `items_without_answers`: `question_id, question_text, original_question_text, profile_name, time_ago, timestamp`, answers `answer_id, answer_text, …` |
| `get_business_profile` | `POST /v3/business_data/google/my_business_info/live` | identifier + location | full profile record (+`check_url`); text: title, category (+additional), rating/votes, rating breakdown 5★..1★, address, phone, website, domain, claimed, status now, hours timetable, photos, cid, place_id |
| `get_business_reviews` | `POST /v3/business_data/google/reviews/task_post` (or `extended_reviews/task_post` when `includeOtherSources`) + free `GET …/{endpoint}/task_get/{id}` | identifier + location, `depth 10..200 (20)` (billed per 10 reviews; per 20 extended), `sortBy newest|highest_rating|lowest_rating|relevant` (regular only), `includeOtherSources?`, `taskId?` (resume, format `google:<id>`/`extended:<id>`); task `priority: 2` (high); posts never retried on 5xx | polls 6× every 4 s; `{status: completed|processing, taskId, reviews[], totals{title, reviews_count, rating, cid, place_id}}`; review fields `rank_absolute, time_ago, timestamp, rating, review_text, original_review_text, original_language, profile_name, local_guide, reviews_count, photos_count, review_highlights, source, owner_answer, owner_time_ago, owner_timestamp, review_id` |
| `get_business_updates` | `POST /v3/business_data/google/my_business_updates/task_post` + free task_get | identifier + location, `depth 10..100 (10)`, `taskId?` | posts `rank_absolute, author, post_date, timestamp, post_text, snippet, url, links` |
| `list_business_categories` | `GET /v3/business_data/business_listings/categories` (free) | `query?` substring, `limit 1..200 (50)` | `{category, businessCount}`; full list cached 7 days (R2 namespace `local:business-categories`) |
| `get_local_rank_grid` | `POST /v3/serp/google/maps/live/advanced` per grid point | `keyword`, `target {cid?, placeId?, name?}` (≥1), `center {lat,lng}`, `gridSize 3|5 (3)`, `spacingKm 0.25..10 (2)`, `device (mobile)`, `zoom? 4..18`, `languageCode?` | `grid[{row,col,latitude,longitude,rank,resultsCount,topResult{title,cid},error?}]`, `summary{pointsSearched, pointsFound, averageRank (2dp), top3Count, top10Count}`, `matchedBusiness` + ASCII grid text (north on top, "–" not found, "x" failed) |

Rank grid math:
```ts
latStep = spacingKm / 110.574;  lngStep = spacingKm / (111.32 * max(|cos(lat)|, 0.01))
point(row,col): lat = center.lat + (middle-row)*latStep; lng = center.lng + (col-middle)*lngStep   // middle=(n-1)/2
zoom default = clamp(floor(log2(24045 * max(|cos(lat)|,0.01) / spacingKm)), 4, 18)
depth 20; concurrency 3 points; match by cid → place_id → title contains name (case-insens.)
rank = rank_absolute ?? rank_group; abort on INSUFFICIENT_CREDITS / DATAFORSEO_AUTH_FAILED; all points failed → throw
```

Agent skill `local-seo` (`.agents/skills/local-seo/SKILL.md`): workflow find business → local SERP → compare vs top 2 competitors → website-link check → reviews → rank grid (3×3 default, warn before 5×5) → Q&A/posts; reads/writes project context (`get_project_context`, `update_project_context` with `addCompetitors`, `appendResearchLog`, reuse research < 30 days); delivers via `seo-report` skill with sections Snapshot / The one fix / Head to head / Maps coverage / Q&A and posting / What to do next / How this report was made.

### DataForSEO / LLM Endpoints (Rank Tracking, AI Visibility, Local SEO)

| Feature | Exact path | Payload fields sent | Response fields used |
|---|---|---|---|
| Rank check (manual, live; also queued fallback) | `POST /v3/serp/google/organic/live/advanced` | `keyword, location_code` **or** `location_name, language_code, device, os (windows/android), depth (10–100), stop_crawl_on_match:[{match_value:domain, match_type:"with_subdomains"}], find_targets_in:["organic"]` | `items[].type, domain, rank_group, rank_absolute, url`; status 40501 = empty |
| Rank check (scheduled) post | `POST /v3/serp/google/organic/task_post` | array ≤100 of above + `tag:"<kwId>:<device>"` | `tasks[].id, status_code (20100), cost, data.tag` |
| Rank check collect | `GET /v3/serp/google/organic/task_get/advanced/{id}` | — (free, unmetered) | same items as live |
| SERP location registry | `GET /v3/serp/google/locations/{iso2}` | — (free) | `location_code, location_name, location_type` |
| Location name validation | `POST https://sandbox.dataforseo.com/v3/serp/google/organic/live/advanced` | `{keyword:"pizza", location_name, language_code, depth:10}` (free) | `tasks[0].status_code, status_message` |
| Tracker keyword suggestions | `POST /v3/dataforseo_labs/google/ranked_keywords/live` | `target, location_code, language_code, limit:100, order_by:["ranked_serp_element.serp_item.etv,desc"], filters?` | keyword, position, search volume, etv (traffic), cpc, KD |
| Tracker metrics (Labs) | `POST /v3/dataforseo_labs/google/keyword_overview/live` | `keywords[≤700], location_code, language_code, include_clickstream_data:false` | `keyword_info.search_volume, cpc, competition; keyword_properties.keyword_difficulty; search_intent_info.main_intent` |
| Tracker metrics (Ads / local) | `POST /v3/keywords_data/google_ads/search_volume/live` | `keywords[≤700], location_code` or `location_name, language_code` | `search_volume, cpc, competition_index, competition, monthly_searches` |
| Brand Lookup — totals | `POST /v3/ai_optimization/llm_mentions/aggregated_metrics/live` | `target:[LlmTarget], platform (chat_gpt|google), location_code, language_code, internal_list_limit:20` | `result[0].total.platform[{key, mentions, ai_search_volume}]` |
| Brand Lookup — cited pages | `POST /v3/ai_optimization/llm_mentions/top_pages/live` | `target, platform, location_code, language_code, links_scope:"sources", items_list_limit:10, internal_list_limit:5` | `items[].key (URL), platform[{key, mentions, ai_search_volume}]` |
| Brand Lookup — prompts | `POST /v3/ai_optimization/llm_mentions/search/live` | `target, platform, location_code, language_code, limit:100` | `items[].question, sources[{url,title,domain}], ai_search_volume, monthly_searches[], first_response_at, last_response_at, brand_entities[].title` |
| Share of Voice | `POST /v3/ai_optimization/llm_mentions/cross_aggregated_metrics/live` | `targets:[{aggregation_key, target:[LlmTarget]}] (2–10), platform, location_code, language_code, internal_list_limit:5` | `items[].key, platform[].mentions` |
| Prompt Explorer | `POST /v3/ai_optimization/{chat_gpt|claude|gemini|perplexity}/llm_responses/live` | `user_prompt, model_name, web_search, max_output_tokens:4096, web_search_country_iso_code?` (not gemini) | `model_name, output_tokens, web_search, items[type=message].sections[].text/annotations[{url,title}], fan_out_queries[]` |
| Local business search | `POST /v3/business_data/business_listings/search/live` | `categories, title, location_coordinate "lat,lng,km", is_claimed, filters, order_by, limit, offset` | listing fields (see table) |
| Local SERP / grid | `POST /v3/serp/google/maps/live/advanced` | `keyword, location_coordinate "lat,lng[,zoomz]", language_code, device, os, depth, search_places:false` | `items[] rank_absolute, rank_group, title, cid, place_id, rating…` |
| Local Finder SERP | `POST /v3/serp/google/local_finder/live/advanced` | `keyword, location_coordinate, language_code, device, os, depth` | same |
| GBP Q&A | `POST /v3/business_data/google/questions_and_answers/live` | `keyword, location_coordinate "lat,lng,meters", language_code, depth` | `items`, `items_without_answers` |
| GBP profile | `POST /v3/business_data/google/my_business_info/live` | `keyword (name | cid:X | place_id:Y), location_coordinate | location_code, language_code` | `result[0].items[0]` + `check_url` |
| GBP reviews | `POST /v3/business_data/google/reviews/task_post` → `GET …/reviews/task_get/{id}` | `keyword|cid|place_id, location, language_code, depth, sort_by, priority:2` | review rows + `title, reviews_count, rating, cid, place_id` |
| GBP extended reviews | `POST /v3/business_data/google/extended_reviews/task_post` → `GET …/extended_reviews/task_get/{id}` | same minus `sort_by` | same + `source` |
| GBP posts | `POST /v3/business_data/google/my_business_updates/task_post` → `GET …/my_business_updates/task_get/{id}` | `keyword, location, language_code, depth, priority:2` | post rows |
| Business categories | `GET /v3/business_data/business_listings/categories` (free) | — | `category_name, business_count` |

#### Metering / cost logic (all DataForSEO calls in hosted mode)

- `meterDataforseoCall`: self-host → call directly, no metering. Hosted → ensure Autumn customer; `assertUsageCreditsAvailable`; execute; `trackUsageCreditSpend(costUsd = task.cost from DataForSEO, creditFeature)`. A charged "Invalid Field" task with cost 0 → VALIDATION_ERROR, not billed. Credits = USD × 1.28 markup × 1000 credits/USD (see billing section for rounding). `task_get` collections are never metered.
- Rank check: formula in "Cost estimation" above (live vs queued per-page prices, 1.28 markup, per-call ceil to credits).
- Brand Lookup displayed estimate: `$0.85` raw base (+`$0.20` raw with competitors), ×1.28 in hosted UI.
- Prompt Explorer: no pre-estimate shown; actual DataForSEO cost metered per model call.
- Credit feature attribution: `serp/google/organic` rank checks → `rank_tracking` (explicit), maps/local_finder → `local_seo`, `business_data` → `local_seo`, `ai_optimization/llm_mentions` → `ai_citations`, other `ai_optimization` → `ai_prompt_responses`, Labs keyword_overview default `rank_tracking`.

---

## 10. Google Search Console, Search Performance & Google Analytics 4

### Google Search Console Integration

Sources: `specs/0003-google-search-console-integration.md`, `src/shared/gsc.ts`, `src/lib/auth-config.ts`, `src/server/features/google/*`, `src/server/lib/gscClient.ts`, `src/server/lib/gscErrors.ts`, `src/server/features/gsc/**`, `src/serverFunctions/gsc.ts`, `src/client/features/gsc/**`, `src/client/features/integrations/**`, `src/routes/api/gsc/oauth/callback.ts`, `docs/SELF_HOSTING_GOOGLE_SEARCH_CONSOLE.md`.

#### Purpose / principles
- Pull first-party GSC data (clicks, impressions, CTR, position, URL inspection) for a project. **Free**: GSC calls are never credit-metered (unlike DataForSEO).
- One verified GSC property per project (`gsc_connections`, unique on `project_id`). Re-selecting replaces it. No history, **no caching** — every query hits Google live.
- Connection belongs to the project/workspace; any member can read it; requests are executed with the **connecting member's** OAuth grant.
- Property selection happens only in the UI (Integrations / onboarding / dashboard card), never via MCP.

#### OAuth: provider + scopes
- Better Auth `genericOAuth` provider, **separate from Google sign-in**:
  - `providerId = "google-search-console"`
  - scopes: `openid`, `email`, `profile`, `https://www.googleapis.com/auth/webmasters.readonly`
  - `discoveryUrl: https://accounts.google.com/.well-known/openid-configuration`, `accessType: "offline"` (refresh token), `prompt: "select_account consent"`, `pkce: true`
  - Uses the same `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` env as hosted Google sign-in.
- Better Auth account options: `encryptOAuthTokens: true` (tokens encrypted at rest; key derived from `BETTER_AUTH_SECRET`), `accountLinking.allowDifferentEmails: true` (agency can link a client's Google account whose email differs from the OpenSEO login).
- Better Auth state cookie `maxAge` raised to 600s (default 300 broke the two-screen `select_account consent` flow → "state_mismatch").
- Tokens live only in Better Auth's `account` table (`providerId`, `accountId` = Google `sub`, `accessToken`, `refreshToken`, `idToken`, `accessTokenExpiresAt`, `scope`). Feature tables never copy tokens.
- Token minting: `getAuth().api.getAccessToken({ body: { providerId, userId, accountId } })` (headerless call; auto-refreshes). Failure → `GscTokenError` → "reconnect" UX.

#### Hosted vs self-hosted OAuth flow
- **Hosted** (`AUTH_MODE` hosted): client calls `authClient.oauth2.link({ providerId, callbackURL, errorCallbackURL })`. Better Auth handles redirect and callback (its generic OAuth callback under `/api/auth/oauth2/callback/{providerId}`). `errorCallbackURL` = callbackURL + `?google_link_error=gsc`.
- **Self-hosted** (Cloudflare Access / `local_noauth`): custom flow in `src/server/features/google/selfHostedOAuth.ts` (because Better Auth sessions don't exist there):
  1. Server fn `startSelfHostedGscLink({ callbackURL })` → `createSelfHostedGoogleAuthorizationUrl()`; requires `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `BETTER_AUTH_SECRET` (≥32 chars), else `AUTH_CONFIG_MISSING`.
  2. Redirect to `https://accounts.google.com/o/oauth2/v2/auth` with `client_id`, `redirect_uri = {publicOrigin}/api/gsc/oauth/callback`, `response_type=code`, `scope` (space-joined), `access_type=offline`, `prompt=select_account consent`, `state`.
  3. `state` = `base64url(JSON{userId, callbackPath (same-origin path only), exp: now+10min}) + "." + HMAC-SHA256(payload)` with key `openseo:{stateNamespace}:{clientSecret}` (namespace `gsc` / `ga4`).
  4. GET `/api/gsc/oauth/callback` (404 in hosted mode): resolves current user (Cloudflare Access headers or local no-auth user), verifies HMAC + expiry + `state.userId === currentUser`, on `?error=` just 303 back; exchanges `code` at `https://oauth2.googleapis.com/token` (`grant_type=authorization_code`), decodes `id_token.sub` as account id, upserts `account` row (encrypting with Better Auth's `symmetricEncrypt` when enabled; preserves old refresh token if Google omits a new one; `accessTokenExpiresAt = now + expires_in (default 3600)`; scope stored comma-joined), then 303 → `state.callbackPath`.
- Self-host docs: enable "Google Search Console API"; OAuth consent screen External + test users; redirect URI exactly `https://<domain>/api/gsc/oauth/callback` (local Docker `http://localhost:3001/api/gsc/oauth/callback`); set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BETTER_AUTH_SECRET` (`openssl rand -base64 32`).
- `getGscConnection` returns `googleOAuthConfigured = hosted || hasSelfHostedGoogleOAuthConfig()`; if false in self-host, UI shows `SelfHostedSetupWarning` linking to setup docs; MCP tools return `reason: "gsc_oauth_not_configured"`.

#### Client link flow (`startGoogleLink(provider, callbackURL)`)
- Single-flight guard (module-level `linkRedirectPending`) prevents double-click overwriting the state cookie; auto-release after 15s if navigation cancelled.
- `useGooglePickerResume(provider, projectId)` writes `sessionStorage["google-property-picker:{provider}:{projectId}"]="open"` before redirect so the property picker re-opens after returning.
- `googleLinkError.ts`: at module init (`__root.tsx`) reads & scrubs `?google_link_error=gsc|ga4&error=CODE` (also from hash fragment) via `history.replaceState`; `GoogleLinkErrorAlert` shows copy from `googleAuthErrorCopy(code, providerLabel)`:
  - `state_mismatch` → "connection didn't finish… finish within 10 minutes, allow cookies"
  - `access_denied` → "was canceled"
  - `account_already_linked_to_different_user` → instructs to sign into the other OpenSEO user and "Remove account" there
  - default → generic retry. Emits `gsc:connect_error` / `ga4:connect_error` once.

#### GSC REST client (`createGscClient({ userId, gscAccountId? })`)
Base `https://www.googleapis.com/webmasters/v3`. All calls Bearer token.
| Method | Endpoint | Notes |
|---|---|---|
| `getUserInfoEmail()` | GET `https://openidconnect.googleapis.com/v1/userinfo` | connected account email |
| `listSites()` | GET `/sites` → `siteEntry[] {siteUrl, permissionLevel}` | `siteUrl` stored verbatim (`sc-domain:example.com` or `https://example.com/`) |
| `querySearchAnalytics(siteUrl, body)` | POST `/sites/{encodeURIComponent(siteUrl)}/searchAnalytics/query` → `rows[] {keys[], clicks, impressions, ctr, position}` | |
| `inspectUrl(siteUrl, inspectionUrl, languageCode?)` | POST `https://searchconsole.googleapis.com/v1/urlInspection/index:inspect` body `{siteUrl, inspectionUrl, languageCode?}` | returns `inspectionResult` subset: `indexStatusResult{verdict, coverageState, robotsTxtState, indexingState, lastCrawlTime, pageFetchState, googleCanonical, userCanonical, crawledAs, sitemap[], referringUrls[]}`, `mobileUsabilityResult.verdict`, `richResultsResult.verdict`, `inspectionResultLink` |

Error mapping (`GscApiError(status)`): 401/403 → "denied access (no verified permission, or revoked)"; 429 → "rate limit reached"; 404 → "property not found"; other → `Search Console API error ({status}): {body[0..300]}`. `isExpectedGrantFailure` = `GscTokenError` or 401/403 → show connect/reconnect card, not an error.

#### Search Analytics request builder (`src/server/features/gsc/searchAnalytics.ts`)
- Enums (shared with MCP Zod schemas):
  - `GSC_DIMENSIONS = query | page | country | device | date | searchAppearance`
  - `GSC_FILTER_OPERATORS = equals | notEquals | contains | notContains`
  - `GSC_SEARCH_TYPES = web | image | video | news | googleNews | discover`
  - `GSC_DATE_RANGES = last_7_days | last_28_days | last_3_months | last_6_months | last_12_months | last_16_months`
- `GSC_DEFAULT_ROW_LIMIT = 250`, `GSC_MAX_ROW_LIMIT = 1000` (API allows 25000; capped for MCP context), `GSC_DATA_LAG_DAYS = 3`.
- `resolveDateRange`: explicit start+end → start clamped to 16-month floor (UTC month subtraction with day clamping). Otherwise `end = today - 3 days`; `start = end - range` (7/28 days, or 3/6/12/16 calendar months); clamped to 16-month floor.
- Body: `{ startDate, endDate, dimensions (default ["query"]), rowLimit clamp(1..1000, default 250), type (default "web"), dataState (default "all"), startRow? (if >0), dimensionFilterGroups: [{ groupType: "and", filters }] }` — flat filters MUST be wrapped in `dimensionFilterGroups` (GSC ignores top-level `filters`).

#### Service layer (`GscService`)
- `getConnection(projectId)`, `userHasGrant(userId)` (any `account` row with providerId `google-search-console`).
- `listSitesForUserWithGrantStatus(userId)`: for **every** GSC grant of the user (multiple Google accounts supported), call `listSites` + userinfo; per account returns `{accountId, email, requiresReconnect, propertiesUnavailable, sites[]}` (expected grant failure → `requiresReconnect`, other error → `propertiesUnavailable`).
- `setSite({projectId, organizationId, siteUrl, accountId, userId})`: verify the account belongs to the user, the site appears in a fresh `sites.list`, and `permissionLevel !== "siteUnverifiedUser"` (FORBIDDEN otherwise); fetch email; upsert `gsc_connections` (on conflict project_id; keeps existing email only if same user+account and new email null).
- `disconnect({projectId})`: delete the project mapping only (grant untouched).
- `getPerformance(input)`: build request, query with connector's grant → `{siteUrl, connectedBy, request, rows}`; throws `GscNotConnectedError`.
- `inspectUrls({projectId, urls, languageCode})`: sequential per URL; per-URL errors captured inline; `GscTokenError` aborts batch.

#### Server functions (`src/serverFunctions/gsc.ts`)
| Fn | Auth | Behavior |
|---|---|---|
| `getGscGrantStatus` (GET) | authenticated | `{connected: userHasGrant}` (used by onboarding + nudge) |
| `getGscConnection` | project | `{connected, canManage (org perm integration:manage), currentUserHasGrant, googleOAuthConfigured, siteUrl, connectedByEmail, connectedAt}` |
| `listGscSites` | project | accounts + sites with `selectable = permissionLevel !== "siteUnverifiedUser"`, `isSelected` (legacy rows without `gsc_account_id` matched when unambiguous) |
| `setGscSite({projectId, accountId, siteUrl})` | project + `integration:manage` | upsert; PostHog `gsc:property_select` |
| `disconnectGsc` | project + `integration:manage` | delete mapping; PostHog `gsc:disconnect` |
| `startSelfHostedGscLink({callbackURL})` | authenticated | returns Google auth URL |

#### UI surfaces
- **Project Settings → Integrations** (`/p/$projectId/settings/integrations`): tabs "General" / "Integrations"; sections `#search-console` (SearchConsoleConnectionCard) and `#google-analytics` (GoogleAnalyticsConnectionCard). Loader prefetches both connection queries.
- **`SearchConsoleConnectionCard`** (reused on Search Performance page, dashboard, onboarding): `IntegrationConnectionCard` with status badge `connected | disconnected | setup_required`; states:
  - loading skeleton / error with "Try again"
  - self-host not configured → setup warning
  - connected → `GoogleConnectedState`: property (siteUrl), connected email, buttons "Change property or account" / "Disconnect project" (or "Manage Google accounts" for non-managers who own a grant)
  - picker → `SitePicker` (wraps `GooglePropertyPicker`)
  - empty → "Connect Search Console to see this project's data." [Connect] or "Choose a Search Console property to finish connecting this project." [Choose property]
  - On save/disconnect invalidates `gscConnection`, `gscSites`, `gscGrantStatus`, `searchPerformance`, `searchPerformanceTable`, `dashboardActivation`, `dashboardGscReport`.
- **`GooglePropertyPicker`** (shared GSC/GA4): dropdown "Select a property…", search box "Search properties or accounts…" (matches email, property name, detail, id), grouped by Google account (label = email or `Google account · {last 6 of id}`), per-account "Remove account" button, "Connection expired" + "Reconnect", "Couldn't load properties" + "Try again", "No properties available", non-selectable property shows "No verified access"; footer "Add Google account" (starts a new OAuth link → multiple accounts); "Save property" button (enabled only if selectable & account healthy).
- **`GscReEngagementModal`** (hosted only): one-time modal "New: Connect Google Search Console" for users whose onboarding `completedAt` is set but `gscNudgeDismissedAt` is null and who have no GSC grant; buttons "Maybe later" / "Connect with Google" (redirect back to `/p/{projectId}/settings/integrations`); dismissal persisted server-side (`dismissGscNudge` → `gsc_nudge_dismissed_at` on onboarding answers). Suppressed when another modal (missing DataForSEO key) shows. Events `gsc:nudge_shown|nudge_dismissed|nudge_connect_clicked`.
- **Onboarding** `SearchConsoleOnboardingStep`: "Connect with Google" + picker with "Save and continue".
- **Dashboard `GscCard`**: title "Search performance", stamp "Google Search Console · last 28 days", stats Clicks (±% vs previous period), Impressions (±%), CTR, Avg position; "More details" → Search Performance page. If not connected → embedded connection card (anchor `#connect-gsc`). Uses `getSearchPerformanceReport({dateRange:"last_28_days"})`.

#### GSC MCP tools (read-only, free)
- `get_search_console_performance` inputs: `projectId`, `dimensions?` (1–4 of GSC_DIMENSIONS, default `["query"]`), `dateRange?` (GSC_DATE_RANGES, default last_28_days), `startDate?`/`endDate?` (YYYY-MM-DD, Pacific Time), `filters?` (≤5 `{dimension, operator (default equals), expression}` AND-combined), `rowLimit?` (1–1000, default 250), `startRow?`, `minPosition?`, `maxPosition?`, `minImpressions?` (applied **server-side** after fetch over the top rows — tool fetches up to 1000 when filtering; rows without position (discover/googleNews) never match a position bound), `type?` (search type), `dataState?` (`all|final`). Output: `{ok, reason?, connectUrl?, setupDocsUrl?, siteUrl, startDate, endDate, dimensions, rowCount, rows[{keys, clicks, impressions, ctr (4 decimals), position (1 decimal, omitted for discover/googleNews)}], hasMore, nextStartRow}`; text is a table (key/clicks/impressions/CTR/position). Not-connected → `connectUrl = {app}/p/{projectId}/search-performance`.
- `inspect_urls` inputs: `projectId`, `urls` (1–10 absolute URLs), `languageCode?` (BCP-47). Output per URL `{url, result|null, error?}`.

#### Google account removal (see "Google Accounts management").

### Search Performance Page

Route: `/p/$projectId/search-performance` → `SearchPerformancePage`. Nav label typically "Search Performance" / "GSC Insights". All data first-party GSC (free).

#### Layout
- Header "Search Performance" + subtitle "See your site's clicks, impressions, CTR, and position from Google Search Console." + link "Change property" (→ integrations) when connected.
- Not connected (or dead grant 401/403/token error) → `SearchConsoleConnectionCard` (report returns `{connected:false}` instead of throwing).
- Connected:
  1. **Totals cards** (4): Clicks, Impressions, CTR, Avg position. Each shows delta vs previous equal-length period (tooltip "vs {prevStart} to {prevEnd}"):
     - `percentDelta(cur, prev) = (cur-prev)/prev` shown `+x.x%` (null if prev ≤ 0); green if ≥0.
     - `positionDelta = prev - cur` (inverted; positive = improvement), shown `+x.x`.
  2. **Tab card** with tabs: `Striking distance (N)`, `Queries`, `Pages`; filter toolbar: Device select (All devices / Desktop / Mobile / Tablet → `DESKTOP|MOBILE|TABLET`), Country select (All countries + codes from the country breakdown, displayed uppercase ISO-3166 alpha-3), Date range select (`last_7_days` "Last 7 days", `last_28_days` (default), `last_3_months`), Export menu ("Export to Sheets", "Download CSV"). Any filter/tab/page-size change resets to page 1.

#### Server functions (`src/serverFunctions/searchPerformance.ts`)
Filter shape: `{ projectId, dateRange (default last_28_days), device?, country? (3-char, lowercased) }`. Filters: device → `{dimension:"device", operator:"equals"}`; country → `{dimension:"country", operator:"equals"}` (country filter applied everywhere except the country breakdown itself).
- `getSearchPerformanceReport` — 4 parallel GSC queries:
  1. current period `dimensions:["date"]`, rowLimit 200 → totals
  2. previous period (same length immediately before: `prevEnd = start-1d`, `prevStart = prevEnd - (end-start)`) `["date"]` → prevTotals
  3. `["query","page"]`, rowLimit 1000 → striking distance
  4. `["country"]` with device-only filter, rowLimit 25 → country dropdown options
  - Returns `{connected:true, range{startDate,endDate,prevStartDate,prevEndDate}, totals, prevTotals, strikingDistance[], countries[]}`.
  - `sumSearchTotals`: `clicks=Σ`, `impressions=Σ`, `ctr = clicks/impressions`, `position = Σ(position·impressions)/Σimpressions` (impression-weighted).
  - `buildStrikingDistanceRows`: collapse `query×page` rows to each query's **best** page (lowest position; ties → more impressions); keep only if best position ∈ [5, 20]; sort by impressions desc; limit 100.
- `getSearchPerformanceTable({..., dimension: "query"|"page", page (≥1), pageSize ∈ {25,50,100} default 25})` — server-side pagination via `startRow = (page-1)*pageSize`, `rowLimit = pageSize+1` (extra row detects `hasNextPage`; GSC gives no total). Returns `{connected, dimension, page, pageSize, hasNextPage, rows[{key, clicks, impressions, ctr, position}]}`.
- `exportSearchPerformanceTable({..., dimension})` — full dimension up to 1000 rows for CSV/Sheets.

#### Tables
- **Striking distance**: selectable rows (checkbox col, shift-click range), columns Query, Page (link if http(s)), Impressions, Clicks, Position (sortable; default impressions desc); client-side pagination 50/page; helper text "Queries ranking at positions 5 to 20, sorted by impressions. Improve the listed page to move them into the top results." Bulk bar: "Copy keywords" (deduped queries, sanitized against CSV formula injection) and "Save as keywords" (→ `saveKeywords({projectId, keywords})`, event `keyword:save` source `search_performance`).
- **Queries / Pages**: columns Query|Page, Clicks, Impressions, CTR (`x.x%`), Position (`x.x`); sortable (default clicks desc); server pagination (`TablePagination` with unknown total). Empty: "No data for this period yet. Search Console data trails by a few days."
- The Queries tab first page is prefetched as soon as the report connects.

#### Export
- CSV file names: `search-performance-striking-distance-{start}-to-{end}.csv` (Query, Page, Impressions, Clicks, Position), `search-performance-{queries|pages}-{start}-to-{end}.csv` (Query|Page, Clicks, Impressions, CTR, Position). "Export to Sheets" via `exportTableToSheets` (feature `search_performance`). Event `data:export`.

### Google Analytics 4 Integration

Sources: `specs/0007-google-analytics-mcp-integration.md`, `src/shared/ga4.ts`, `src/server/lib/ga4Client.ts`, `src/server/lib/ga4Errors.ts`, `src/server/features/ga4/**`, `src/serverFunctions/ga4.ts`, `src/client/features/ga4/**`, `src/client/features/dashboard/Ga4Card.tsx|Ga4ConnectCard.tsx`, `src/server/mcp/tools/google-analytics-tools.ts`, `docs/SELF_HOSTING_GOOGLE_ANALYTICS.md`.

#### OAuth
- Separate Better Auth genericOAuth provider `providerId = "google-analytics"`, scopes `openid email profile https://www.googleapis.com/auth/analytics.readonly` (never added to the GSC grant; different Google accounts allowed for GSC vs GA4). Same PKCE/offline/`select_account consent` config.
- Self-hosted: same custom flow as GSC with namespace `ga4`, callback `GET /api/ga4/oauth/callback`, server fn `startSelfHostedGa4Link`. Operator must enable **Google Analytics Admin API** and **Google Analytics Data API** and register `/api/ga4/oauth/callback`. No new secret.

#### Data model
`ga4_connections`: `id`, `project_id` (unique, FK cascade), `organization_id` (FK cascade), `property_id` (canonical `properties/{id}`), `property_display_name`, `property_time_zone` (IANA), `property_currency_code`, `connected_by_user_id`, `ga4_account_id` (Google sub), `connected_account_email`, `created_at`, `updated_at`; indexes `(project_id)` unique, `(organization_id)`, `(connected_by_user_id, ga4_account_id)`. Plus `project_activation.ga4_card_dismissed_at` (dashboard card dismissal).

#### Admin API client (`createGa4AdminClient`)
Base `https://analyticsadmin.googleapis.com/v1beta` (v1alpha for streams). Token memoized per client.
| Call | Endpoint |
|---|---|
| userinfo email | GET `https://openidconnect.googleapis.com/v1/userinfo` |
| `listProperties()` | GET `/v1beta/accountSummaries?pageSize=200&pageToken=…` (paginates up to 100 pages) → flatten `{propertyId: "properties/N", displayName, accountDisplayName}` |
| `getProperty(id)` | GET `/v1beta/properties/{N}` → `{name, displayName, timeZone, currencyCode}` |
| `listDataStreams(id)` | GET `/v1alpha/properties/{N}/dataStreams?pageSize=200` |
| `getEnhancedMeasurementSettings(stream)` | GET `/v1alpha/properties/{N}/dataStreams/{S}/enhancedMeasurementSettings` → `streamEnabled, scrollsEnabled, outboundClicksEnabled, siteSearchEnabled, videoEngagementEnabled, fileDownloadsEnabled, pageChangesEnabled, formInteractionsEnabled, searchQueryParameter, uriQueryParameter` |
| `listKeyEvents(id)` | GET `/v1beta/properties/{N}/keyEvents?pageSize=200` |
| `listCustomDimensions(id)` / `listCustomMetrics(id)` | GET `/v1beta/properties/{N}/customDimensions|customMetrics?pageSize=200` |

#### Data API client
`POST https://analyticsdata.googleapis.com/v1beta/properties/{N}:runReport` with body:
```ts
{ dateRanges:[{startDate,endDate}], dimensions:[{name}], metrics:[{name}],
  dimensionFilter?, metricFilter?, offset:"N", limit:"N",
  orderBys:[{metric:{metricName}, desc:true}] | [{dimension:{dimensionName}}],
  keepEmptyRows:false, returnPropertyQuota:true }
```
Response validated with Zod (`dimensionHeaders, metricHeaders, rows[{dimensionValues[],metricValues[]}], rowCount, metadata{dataLossFromOtherRow, samplingMetadatas[{samplesReadCount,samplingSpaceSize}], schemaRestrictionResponse.activeMetricRestrictions[{metricName,restrictedMetricTypes}], currencyCode, timeZone, emptyReason, subjectToThresholding}, propertyQuota{tokensPerDay, tokensPerHour, concurrentRequests, serverErrorsPerProjectPerHour, potentiallyThresholdedRequestsPerHour, tokensPerProjectPerHour: {consumed, remaining}}`). Retry-After header parsed (≤86400s); upstream reason extracted from Google error details.

#### Normalization (`normalizeGa4Response`)
- Header names must exactly equal the requested dims/metrics, else `ga4_malformed_response` (exception: headerless empty response = legitimately empty, e.g. comparison window before property creation).
- Row → `Record<name, string | number | null>`; restricted metrics → `null` (never 0); other metrics parsed to finite numbers.
- `reportMetadata = {dataLossFromOtherRow, subjectToThresholding, sampling[], restrictedMetrics[], emptyReason, hasLimitedData = any of those}`; `totalRowCount = rowCount ?? rows.length`; `quota`.

#### Date resolution (`resolveGa4DateRange`)
- Both or neither of start/end (`validation_error`); YYYY-MM-DD real dates, start ≤ end.
- `lastCompleteDay = today(in property TZ) - 1`. Default: `end = lastCompleteDay`, `start = end - 27` (28 complete days). If explicit end > lastCompleteDay → clamp + warning `end_date_clamped`. No max range.
- `previousPeriod(range)`: same inclusive length ending the day before start.

#### Report definitions (`Ga4ReportDefinitions.ts`) — all fixed; callers can't pass arbitrary dims/metrics
Organic filter: `dimensionFilter = {filter:{fieldName:"sessionDefaultChannelGroup", stringFilter:{matchType:"EXACT", value:"Organic Search"}}}` applied when `channel = organic_search` (default).
| kind | dimensions | metrics | order by (desc) | extra filters |
|---|---|---|---|---|
| `landing_pages` | hostName, landingPage | sessions, activeUsers, engagedSessions, engagementRate, keyEvents, sessionKeyEventRate, transactions, purchaseRevenue | sessions | organic |
| `page_performance` | hostName, pagePath (+ `date` if includeDate) | screenPageViews, activeUsers, userEngagementDuration, keyEvents | screenPageViews | organic unless channel=all |
| `key_events` | eventName (+ hostName, landingPage if breakdown=event_and_landing_page) | keyEvents, totalUsers | keyEvents | metricFilter `keyEvents > 0`; organic unless all |
| `traffic_acquisition` | one of sessionDefaultChannelGroup / sessionSourceMedium / sessionCampaignName (breakdown channel_group/source_medium/campaign) | sessions, activeUsers, engagedSessions, engagementRate, keyEvents, transactions, purchaseRevenue | sessions | channel forced `all` by MCP tool |
| `ecommerce_performance` (item) | itemName, itemId | itemsViewed, itemsAddedToCart, itemsPurchased, itemRevenue | itemRevenue | organic unless all |
| `ecommerce_performance` (landing_page) | hostName, landingPage | sessions, transactions, purchaseRevenue | purchaseRevenue | optional metricFilter `transactions > 0` (onlyWithTransactions) |
| `site_search` | searchTerm | eventCount, activeUsers, sessions, engagedSessions, engagementRate | eventCount | andGroup: `eventName EXACT view_search_results` AND NOT `searchTerm EXACT "(not set)"`; channel forced all |
| `audience_breakdown` | one of deviceCategory / country / newVsReturning | activeUsers, sessions, engagementRate, keyEvents | activeUsers | organic unless all |
| overview (summary) | none (or `date` / `yearWeek` for trend) | sessions, activeUsers, engagedSessions, engagementRate, keyEvents, transactions, purchaseRevenue | trend ordered by dimension asc | organic; limit 1 (summary) or 1000 (trend) |

- Limits: `limit` 1–1000 default 100, `offset ≥ 0`. Some reports need a **complete fetch** (limit 1000 from offset 0, then slice): when `comparePreviousPeriod`, `traffic_acquisition/source_medium`, `ecommerce_performance`, `site_search`; if requested page is beyond the buffered 1000 rows, a second paged request is made.
- `comparePreviousPeriod` allowed only for: key_events (event breakdown), traffic_acquisition (channel_group), audience_breakdown (device / new_vs_returning). Comparison output: rows keyed by dimension tuple (union of current+previous), per metric `{current, previous, absoluteChange, percentChange (null if previous 0/null)}`, coverage `{complete, current/previous {fetchedRowCount,totalRowCount}}`; warning `comparison_incomplete` if not complete.
- Success envelope: `{status:"ok", source{provider:"google_analytics", propertyId, propertyDisplayName}, request{requestedDateRange, resolvedDateRange, propertyTimeZone, currencyCode, channel, reportKind, breakdown, dimensions, metrics, flags{includeDate, onlyWithTransactions}, limit, offset}, rowCount, totalRowCount, rows, pageInfo{offset, limit, hasMore = offset+rowCount < total, nextOffset}, reportMetadata, quota, warnings, diagnostics?, ecommerceActivity?, siteSearchActivity?, comparison?}`.

#### Diagnostics / enhancements (`Ga4ReportEnhancements.ts`)
- Traffic acquisition by source/medium (only when complete and not limited):
  - `attribution_not_set_share_high` (warning) if sessions with `sessionSourceMedium == "(not set)"` ≥ 5% of total.
  - `internal_referral_traffic_detected` (warning) if any source is localhost / `127.*` / `::1` / private IPv4 (10.x, 172.16–31.x, 192.168.x).
  - `source_medium_case_variants_detected` (info) if values differ only in case.
- Ecommerce: `ecommerceActivity {status: detected|none|unknown, evidence totals, reason}`; `no_ecommerce_activity` (info) when none. `unknown` when incomplete or limited.
- Site search: `siteSearchActivity {status, searchTermCount, searchEventCount}`; `no_site_search_activity` (info).
- Organic overview: `key_events_sharp_decline` (warning) when previous keyEvents ≥ 5 and change ≤ −50%, skipped if data limited.

#### Organic overview service
3 parallel runReports: current summary, previous-period summary, trend (`daily` → `date`, or `weekly` → `yearWeek`, limit 1000). Returns `{current, previous, comparison per OVERVIEW_METRIC, trend rows, diagnostics, reportMetadata{hasLimitedData, reports[]}, quota, warnings (+ trend_truncated)}`.

#### Measurement health service
Admin API: list data streams; for each `WEB_DATA_STREAM` fetch enhanced-measurement settings; list key events, custom dimensions, custom metrics. Issues: `no_web_stream`; `enhanced_measurement_disabled` (all web streams have streamEnabled=false); `site_search_measurement_disabled` (no stream with both streamEnabled & siteSearchEnabled); `no_key_events_configured`. Output `{summary{dataStreamCount, webStreamCount, keyEventCount, customDimensionCount, customMetricCount, issueCount}, issues[], webStreams[{streamId, displayName, measurementId, defaultUri, createTime, updateTime, enhancedMeasurement}], otherStreams[], keyEvents[], customDefinitions{dimensions, metrics}}`.

#### Search Opportunity service (GSC × GA4 join) — `get_search_opportunities`
1. Require both connections (`ga4_not_connected` / `GscNotConnectedError`); `limit` 1–100 default 50.
2. Dates: default = 28 days ending **3 days ago** in the GA4 property TZ (`end = todayTZ - 3`, `start = end - 27`); explicit dates via `resolveGa4DateRange`.
3. GSC: `dimensions:["page"]`, rowLimit 1000, startRow 0, type `web`, dataState `final`.
4. GA4: `landing_pages` report, limit 1000, offset 0, organic.
5. Join key `normalizePageKey`: trim; reject empty/`(not set)`; parse as URL (prefix `https://` if no scheme); lowercase host; keep non-default port; path (default `/`), strip trailing slashes except root; ignore scheme, query, fragment; preserve path case and subdomains (www ≠ apex). GA4 key built from `hostName + landingPage`.
6. Candidates = GSC rows with `4 ≤ position ≤ 20`; `joinStatus: "joined" | "gsc_only"`; gsc_only rows get `ga4:null, score:null`.
7. Scoring over joined rows only, using percentile ranks (`rank = count(values < v) / (n-1)`; single value → 1; ties share rank):
   - `demand = pct(log1p(impressions))`
   - `businessValue = pct(sessionKeyEventRate)`; if **all** joined rows have keyEvents == 0 → use `engagementRate` (`engagementFallback: true`)
   - `reachability = pct(20 - position)`
   - components rounded to 4 decimals; `score = round(100 * (0.5*demand + 0.3*businessValue + 0.2*reachability))`
8. Sort: scored first by score desc, then impressions desc; slice `limit`.
9. Output: `{source{searchConsoleSiteUrl, googleAnalyticsPropertyId, googleAnalyticsPropertyDisplayName}, request{dateRange, limit, searchConsoleTimeZone:"America/Los_Angeles", googleAnalyticsTimeZone}, rowCount, totalCandidateRows, rows[{page, normalizedPage, clicks, impressions, ctr, position, joinStatus, ga4{sessions, activeUsers, engagedSessions, engagementRate, keyEvents, sessionKeyEventRate, transactions, purchaseRevenue|null}, score, scoreComponents}], scoring{formula, businessValueMetric, engagementFallback, scoreDataLimited}, coverage{gscRowsConsidered, ga4RowsConsidered, matchedRows, unmatchedGscRows, unmatchedGa4Rows}, truncated{gsc: rows≥1000, ga4: total>fetched, candidates}, warnings (+ source_time_zones_differ if GA4 TZ ≠ America/Los_Angeles), reportMetadata, quota}`.

#### Error contract (`Ga4ReportError.code`)
`validation_error`, `ga4_not_connected`, `ga4_reconnect_required` (token mint failure or 401), `ga4_property_inaccessible` (403 or 404; 403 with upstream reason `SERVICE_DISABLED` → `ga4_upstream_unavailable` "Data API not enabled"), `ga4_report_incompatible` (400), `ga4_quota_exhausted` (429, retryAfterSeconds), `ga4_upstream_unavailable` (5xx/network), `ga4_malformed_response` (schema/header mismatch). MCP error output `{status:"error", error{code, message, retryAfterSeconds?, actionUrl?}}`.

#### Server functions (`src/serverFunctions/ga4.ts`)
- `getGa4Connection` → `{connected, canManage, currentUserHasGrant, googleOAuthConfigured, propertyId, propertyDisplayName, propertyTimeZone, propertyCurrencyCode, connectedByEmail, connectedAt}`.
- `listGa4Properties` → accounts (all GA4 grants of user) with properties `{propertyId, displayName, accountDisplayName, isSelected}` + reconnect/unavailable flags.
- `setGa4Property({projectId, accountId, propertyId /^properties\/\d+$/})` (needs `integration:manage`): verifies grant ownership + property in fresh discovery; fetches `properties.get` for TZ/currency; upsert. Event `ga4:property_select`.
- `disconnectGa4` (manage) → delete mapping; event `ga4:disconnect`.
- `startSelfHostedGa4Link`.
- `getGa4DashboardReport` → organic overview (default range) mapped to `{connected:true, totals{sessions, activeUsers, engagementRate, keyEvents}, prevTotals, trend[{date, sessions}]}`; trend zero-filled for every day (GA4 `date` is `YYYYMMDD`). `ga4_not_connected|reconnect_required|property_inaccessible` → `{connected:false}`; quota → `AppError("RATE_LIMITED")`.

#### UI
- `GoogleAnalyticsConnectionCard` (Integrations + dashboard): same states as GSC card; connected state shows property display name + "ID {number}" + email; optional "Dismiss" button on dashboard (→ `dismissDashboardGa4Card` sets `project_activation.ga4_card_dismissed_at`; event `dashboard:ga4_dismiss`).
- Dashboard `Ga4Card`: title "Organic traffic", stamp "Google Analytics · last 28 days", action "Manage" (→ settings `#google-analytics`); stats Sessions (±%), Active users (±%), Engagement rate (%), Key events (±%); Recharts `AreaChart` of daily organic sessions (hidden axes, tooltip "{date}: N sessions"). Empty: "No organic search traffic recorded in the last 28 days yet." Error: "Couldn't load Google Analytics data. Try again shortly."

#### GA4 MCP tools (all read-only, `readOnlyHint:true`, no credits, strict input objects)
Common input: `projectId`, `startDate?`, `endDate?` (both or neither), `limit` (1–1000, def 100), `offset` (def 0).
| Tool | Extra inputs | Maps to |
|---|---|---|
| `get_google_analytics_organic_landing_pages` | — | `landing_pages`, organic |
| `get_google_analytics_page_performance` | `includeDate` (def false), `channel` organic_search\|all | `page_performance` |
| `get_google_analytics_key_events` | `breakdown` event\|event_and_landing_page, `channel`, `comparePreviousPeriod` | `key_events` |
| `get_search_opportunities` | `projectId, startDate?, endDate?, limit` (1–100, def 50) | SearchOpportunityService |
| `get_google_analytics_organic_overview` | `projectId, startDate?, endDate?, trend` daily\|weekly | overview service |
| `get_google_analytics_traffic_acquisition` | `breakdown` channel_group\|source_medium\|campaign, `comparePreviousPeriod` | `traffic_acquisition`, channel=all |
| `get_google_analytics_ecommerce_performance` | `breakdown` item\|landing_page, `onlyWithTransactions`, `channel` | `ecommerce_performance` |
| `get_google_analytics_site_search` | common only | `site_search`, channel=all |
| `get_google_analytics_audience_breakdown` | `breakdown` device\|country\|new_vs_returning, `channel`, `comparePreviousPeriod` | `audience_breakdown` |
| `get_google_analytics_measurement_health` | `projectId` | measurement health |

No report rows are persisted (no cache). Instrumentation logs tool name/ids/duration/outcome only.

### Google Accounts Management

- A user can link **multiple Google accounts** per provider (GSC grants and GA4 grants are independent `account` rows keyed by `(userId, providerId, accountId=Google sub)`). "Add Google account" in the picker starts another OAuth link.
- Picker lists every grant with its email (from userinfo), reconnect state, and properties.
- **Remove account** (`GoogleAccountRemovalDialog`):
  - `getGoogleAccountRemovalImpact({provider: "gsc"|"ga4", accountId})` → `{projectCount}` = number of connection rows using that grant (`connected_by_user_id = me` AND account id matches; for GSC also legacy rows with null `gsc_account_id`).
  - Dialog: "Remove Google account?", label, "This removes the account's {Search Console|Google Analytics} connection from OpenSEO. You can reconnect it anytime.", then either "This will also disconnect {name} from N project(s)." or "No projects will be affected."
  - `removeGoogleAccount({provider, accountId, confirmed: true})` → atomic batch: delete matching `gsc_connections`/`ga4_connections` rows + delete the `account` grant row (scoped to owner). Does not affect Google sign-in or the other product's grant. Invalidates all related queries.
- Project disconnect only deletes the mapping; a member can remove the project mapping but cannot unlink another user's grant.
- Permissions: `integration:manage` org permission required to select/disconnect properties; non-managers see "Manage Google accounts" (only their own grants).

---

## 11. MCP Server & Tool Catalog

> Cross-references: full input/output tables for the site-audit MCP tools are in §7 ("DataForSEO / External Endpoints (Site Audit)" → MCP tools), for the local-SEO tools in §9, for GSC/GA4 tools in §10, and for rank-tracking tools in §6. Endpoint-level details are in §18.

### MCP Server

#### Endpoint, transport, server identity

- **Single route: `POST|GET|DELETE|OPTIONS /mcp`** (`MCP_ROUTE = "/mcp"`, `src/server/mcp/context.ts`). Any other path under the MCP handler → 404 with CORS headers.
- **Transport: MCP Streamable HTTP, strictly stateless.** Built on `createMcpHandler` from `agents/mcp/server` (Cloudflare Agents SDK) + `@modelcontextprotocol/server`.
  - `legacy: "reject"` on the modern handler; *legacy* requests (older protocol) are detected with `isLegacyRequest()` and answered by a hand-rolled path: new `McpServer` per request + `WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })` → JSON response (no SSE), server + transport closed in `finally`. Non-POST legacy → JSON-RPC error `-32000 "Method not allowed."` with 405.
  - `maxSubscriptions: 0` → `subscriptions/listen` refused (no SSE streams held open). Server capability `tools: { listChanged: false }`.
  - A fresh `McpServer` is built per request (`createOpenSeoMcpServer(authProps)`), all tools registered each time.
- **Server info**: `name: "OpenSEO MCP"`, `title: "OpenSEO"`, `version: "0.0.12"`, description "SEO research tools for AI agents: keyword research and metrics, SERP and local SERP results, domain and backlink analysis, rank tracking, and Google Search Console performance.", `websiteUrl: https://openseo.so`, icon `https://openseo.so/android-chrome-512x512.png`.
- **Server `instructions`**: "OpenSEO research tools use credits. Proceed with normal focused research, but ask the user for confirmation before planned batches over 2,000 credits."
- **CORS** on every MCP response: `Access-Control-Allow-Origin: *`, `Allow-Headers: Content-Type, Accept, Authorization, mcp-session-id, MCP-Protocol-Version, Mcp-Method, Mcp-Name`, `Allow-Methods: GET, POST, DELETE, OPTIONS`, `Expose-Headers: mcp-session-id`, `Max-Age: 86400`. `OPTIONS` answered directly.
- **Origin validation**: hosted mode accepts only `Origin` absent, equal to the hosted app origin, or the SurfMind Chrome extension (`chrome-extension://pghallcbnfabbgfijhbcldaapmgidnaa`) — otherwise 403 "Invalid Origin". Self-hosted uses the SDK's localhost-class defaults (DNS-rebinding protection). Legacy path re-implements host/origin checks (localhost, `*.workers.dev`).
- **Public origin**: `getPublicOrigin(request)` honors `x-forwarded-proto`/`x-forwarded-host` when request isn't HTTPS (Docker/proxy); used for `baseUrl` deep links and OAuth CSRF.

#### Auth modes (three)

| Mode (`AUTH_MODE`) | How `/mcp` authenticates | Org binding |
|---|---|---|
| `hosted` (Better Auth) | OAuth 2.1 access token (Cloudflare `@cloudflare/workers-oauth-provider`) **or** API key `oseo_…` | `orgScope: "user"` — credential is user-scoped; org derived per project |
| `cloudflare_access` (self-host behind CF Access) | CF Access JWT headers → `resolveCloudflareAccessContext` | `orgScope: "pinned"`, role implicitly `owner` |
| `local_noauth` (Docker/local) | none → `resolveLocalNoAuthContext()` (single implicit user/org) | `pinned`, `owner` |

Self-hosted requests go straight to `handleSelfHostedOpenSeoMcpRequest` (no OAuth provider). The `/ai` page warns that CF-Access instances need "Managed OAuth" enabled on the Access app for MCP clients to connect.

#### OAuth 2.1 provider (hosted only)

File `src/server/mcp/oauth-provider.ts`. The whole Worker `fetch` is wrapped by `OAuthProvider` (`apiRoute: "/mcp"`, `apiHandler` → `handleAuthenticatedOpenSeoMcpRequest`, `defaultHandler` → the TanStack app).

- **Endpoints**
  - Authorize: `GET /api/auth/oauth2/authorize` → parses the auth request (`oauth.parseAuthRequest`), requires a Better-Auth session (else `302 /sign-in?redirect=<original authorize URL>`), then `302 /oauth-consent?<same params>` (params forwarded: `response_type, client_id, redirect_uri, scope, state, code_challenge, code_challenge_method, resource`).
  - Token: `POST /api/auth/oauth2/token` (provider-handled; PKCE).
  - Dynamic Client Registration: `POST /api/auth/oauth2/register`. A shim (`oauth-registration.ts`) normalizes metadata: if `token_endpoint_auth_method` omitted → `"none"` (public client), except Perplexity (`redirect_uris` contains `https://www.perplexity.ai/api/mcp/oauth/callback`) → `"client_secret_post"`. Body cap 1 MiB.
  - Consent response: `POST /api/oauth/consent` with JSON `{ accept: boolean, query: string }`; CSRF check `Origin === public origin`; re-parses the original authorize query; deny → `{ redirectTo: <redirect_uri>?error=access_denied&error_description=The user denied access&state&iss }`; accept → `oauth.completeAuthorization({ request, userId, metadata:{clientId, organizationId}, scope, props })` → `{ redirectTo }`.
  - Protected-resource metadata auto-served by the provider: `resource = <BETTER_AUTH_URL>/mcp`, `scopes_supported: ["mcp"]`, `resource_name: "OpenSEO MCP"`. `.well-known` discovery is provider-managed.
- **Scopes**: `MCP_OAUTH_SCOPES = ["offline_access", "mcp"]`; `mcp` required (empty request → both granted; else intersection must include `mcp`, otherwise 400). Token exchange callback rejects tokens without `mcp` (`invalid_scope`).
- **TTLs**: access token 24h; refresh token 30 days (rolling); DCR client registration 365 days.
- **Token/grant storage**: Cloudflare KV namespace `OAUTH_KV` (provider-managed). Daily cron `17 3 * * *` runs `purgeExpiredData(env, { batchSize: 200 })` to GC orphaned grants.
- **Grant props** (`openSeoAuth`): `{ userId, userEmail, organizationId, baseUrl, clientId, scopes }` — role and `orgScope` are NOT baked into tokens; stamped per request.
- **Per-request re-resolution**: transport checks membership of `organizationId`; if gone, falls back to the user's current active org; if the user belongs to no org → `401` with `WWW-Authenticate: Bearer error="invalid_token"`.
- **Consent page** `/oauth-consent` (`_authenticated.oauth-consent.tsx`): heading "Authorize MCP access", two scope rows ("Read your OpenSEO data — Projects, keyword reports, and audit results." / "Act on your behalf via MCP — Run tools and write results back to your organization."), Allow + Cancel, POSTs to `/api/oauth/consent` then `window.location = redirectTo`.
- Telemetry on success: PostHog `mcp:authorize_success { client_id, scopes }`; activation milestone `recordMcpAuthorized(orgId)`.
- OAuth errors logged: 401 at debug, 5xx at error, else warn.

#### API keys (hosted)

- Better Auth `@better-auth/api-key` plugin, prefix **`oseo_`**, stored display prefix = first 9 chars; plugin rate limit disabled.
- Sent as `x-api-key: oseo_…` or `Authorization: Bearer oseo_…` (only `oseo_`-prefixed values are consumed; others fall through to OAuth).
- Handled before the OAuth provider (`handleMcpApiKeyRequest`): `auth.api.verifyApiKey({ body:{ key } })` → user = `key.referenceId`; per-user rate limit via Cloudflare rate-limit binding `MCP_RATE_LIMIT` (hosted prod): **5000 requests/minute**, 429 with `Retry-After`.
- User must belong to ≥1 org (never auto-creates one) else 403 `account_access_revoked`. Props: `clientId: "api_key"`, scopes = all MCP scopes.
- Error codes: `invalid_api_key` (401), `rate_limited`/`usage_exceeded` (429), `account_access_revoked` (403), `internal_error` (500).
- UI: Settings → API keys (`ApiKeySettings.tsx`): list (name, created), "Create API key" modal (name → show key once), "Revoke key" confirm ("Clients using it will stop working.").

#### Project scoping / authorization

- Every data tool takes `projectId` (`projectIdSchema`: "Required. The OpenSEO project ID to scope this call to. Get one from list_projects.").
- `withMcpProjectAuth(handler)` (`project-auth.ts`):
  - `orgScope: "user"` (hosted OAuth/API key): load project → its org → require caller membership in that org; rebinds `auth.organizationId` + `role` to the project's org (billing follows project). Unknown project and non-member both → `FORBIDDEN` (no existence leak).
  - `pinned`: `ProjectService.getProjectForOrganization(orgId, projectId)` must exist else `FORBIDDEN`.
  - Returns `{ auth, baseUrl, billing: {userId,userEmail,organizationId,projectId}, project }` — `project` row used for default market fallback (`locationCode`, `languageCode`, `domain`).
- Permission gates reuse app RBAC: `create_project` requires `project:create` in target org; `delete_site_audit` requires `project:delete` (owner/admin).
- Market defaults: `DEFAULT_LOCATION_CODE = 2840` (US). `locationCodeSchema` (positive int, DataForSEO location code; falls back to project market; note: some countries e.g. Iceland 2352 are Google-Ads-served: volume/CPC/trend OK, no KD/intent/domain analytics). `languageCodeSchema` refined by `isSupportedLanguageCode`. Labs-only tools call `assertLabsLocationCode` + `assertLanguageForLocation`.

#### Output conventions

- Every tool returns `mcpResponse({ text, meta?, structuredContent })`:
  - `content: [{ type:"text", text }]` — human/agent-readable summary **plus a pipe-delimited table of every row** (`formatMcpTable`: header line `a | b | c`, one line per row; cells: null/"" → `—`, ints exact, floats `.toFixed(2)`, booleans yes/no, strings whitespace-collapsed; `truncatedCell(n)` for long prose).
  - `structuredContent` — typed rows; `meta` merged into it and also into `_meta`.
  - `meta` = `{ url?, projectId?, runId?, creditsCharged?, creditsRemaining? }`; `url` is a dashboard deep link built from `baseUrl` (e.g. `/p/<id>/keywords`, `/p/<id>/rank-tracking/<trackerId>`, `/p/<id>/audit?auditId=…`).
- **Output schemas**: every tool declares one; normalized to `z.object(...).passthrough()`/`looseObject` so cached clients tolerate added fields. DataForSEO row pass-through uses `looseObjectOutputSchema = z.object({}).passthrough()`.
- Error styles: thrown `AppError` (→ JSON-RPC error) for validation/auth; *soft* errors returned as structured payloads for integrations: GSC `{ ok:false, reason:"not_connected"|"api_error"|"gsc_oauth_not_configured"|"invalid_request", connectUrl?, setupDocsUrl? }`, GA4 `{ status:"error", error:{ code, message, retryAfterSeconds?, actionUrl? } }`.
- Batch tools (research_keywords, get_serp_results) return per-item `{ ok:true,… } | { ok:false, error }` so one bad item doesn't fail the batch.
- Annotations on every tool: `readOnlyHint`, `openWorldHint:false`, `destructiveHint`. Paid tools are marked `readOnlyHint:false` (they spend credits).
- `truncatePreview(value, 300)` for long list previews (reports/templates lists).

#### Instrumentation & telemetry

`instrumentMcpToolHandler(toolName, outputSchema, handler)` wraps every tool (MCP and SAM):
- PostHog `mcp:tool_call { tool, success, error_code, client_id, source: clientId ? "mcp_client" : "in_app_agent", turn_id, duration_ms, project_id (from meta), row_count, quota_remaining (GA4 quota.tokensPerDay.remaining) }`. Hosted-only capture; self-host increments a tool-call counter for anonymous self-host telemetry.
- Re-validates `structuredContent` against the output schema; mismatch → `captureServerError("MCP output validation failed…", { errorCode:"MCP_OUTPUT_VALIDATION", issues })` and counted as failure.
- Treats `structured.status === "error"` or `structured.ok === false` as failed calls.
- Thrown errors captured (filtered by `shouldCaptureAppErrorCode`) and rethrown.
- **Activation milestones** (`organization_activation_state` table): `firstMcpAuthorizedAt` (on OAuth consent or API-key request) and `firstMcpToolCallAt` (first successful call from an external client, i.e. non-null `clientId`). Upsert with `COALESCE` (first timestamp wins); per-isolate memo Set avoids repeat writes. Feeds the dashboard's "Connect your agent" card.
- **Client label** (`resolveClientLabel`): `claude-code/*` UA → "Claude Code", `codex-mcp-client/*` → "Codex", else MCP `clientInfo.title` (2026-07-28 protocol `_meta` envelope), else UA product token, else `"API key"`; sanitized `[A-Za-z0-9._+\- ]`, max 60 chars. Used only for `created_by` on reports/templates.

#### Credits (hosted)

- DataForSEO cost × `SEO_DATA_COST_MARKUP = 1.28`, `AUTUMN_SEO_DATA_CREDITS_PER_USD = 1000` → 1 credit = $0.001 billed. Balances from Autumn features `AUTUMN_SEO_DATA_BALANCE_FEATURE_ID` (monthly) + `AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID` (top-up). Metering happens inside the shared DataForSEO client (`createDataforseoClient(billingCustomer)`), so MCP, SAM and the UI bill identically. Self-hosted: no credits, no plan gating.

### MCP Tools Catalog

**57 tools registered** (`grep -c '^  register(' src/server/mcp/server.ts` = 57), registration order below. Legend: **RO** = readOnlyHint true, **D** = destructiveHint true, **$** = spends credits.

#### Account & projects (3)

**`whoami`** — "Who am I". RO, free.
- Input: `{}`.
- Output: `{ userEmail, scopes: string[], mode: "hosted"|"self-hosted", creditsRemaining: number|null }`; text lines Account / Mode / Scopes / Credits remaining. Hosted: credits = Autumn `check` monthly + top-up balances.

**`list_projects`** — RO, free.
- Input: `{}`.
- Output: `{ projects: [{ id, name, domain|null, locationCode, languageCode, url:"/p/<id>", organization?, organizationId? }] }`. User-scoped creds list projects across **all** orgs the user belongs to (labelled with org name/id); pinned creds list only bound org. Text: `- <id>  <name> (<domain>)  organization:<name> [<orgId>]  market:<loc>/<lang>`.

**`create_project`** — write, free.
- Input: `name` string 1–120 (trimmed); `domain?` string ≤255 (host only); `locationCode?`; `languageCode?` (requires `locationCode`); `organizationId?` (required when user in >1 org; omitted → `VALIDATION_ERROR` listing orgs "Ask the user which organization…").
- Validates with the app's `createProjectSchema`; permission `project:create`.
- Output: `{ project: { id, name, domain, locationCode, languageCode, url } }`.

#### Project context (2)

**`get_project_context`** — RO, free. Input `{ projectId }`. Output `{ sections[], missingSections: string[], customSections[], competitors[], keyPages[], researchLog[], reportTemplates[] }`; text = markdown digest (`renderProjectContextMarkdown`, see Project Context section). Deep link `/p/<id>/context`.

**`update_project_context`** — write, D, free. Input `{ projectId, updates: PatchOp[] (1–50) }` — patch-op union (see Project Context). Output: full context (same shape as get) + text "Updated project context (N change(s))." + digest. Author recorded as `"mcp"` (SAM uses the same builder with `"sam"`).

#### Saved keywords & keyword research (4 + metrics)

**`list_saved_keywords`** — RO, free (DB only).
- Input: `projectId`; `search?` 1–200; `tags?` string[] ≤20 (each 1–64; ANY-match); `limit?` 50|100|250 (default 100).
- Output: `{ rows:[{ id, keyword, searchVolume, keywordDifficulty, cpc, competition, intent, tags: string[] }], totalCount, tags:[{ name, keywordCount }] }`. Sorted `createdAt desc`. Text: `- kw  id:…  vol:…  kd:…  cpc:$x.xx  tags:a,b`.

**`remove_saved_keywords`** — D, free. Input `projectId`, `savedKeywordIds` (row IDs). Output `{ projectId, requested, deletedCount }`. Missing/foreign/duplicate IDs ignored. Does not affect rank tracking.

**`research_keywords`** — $, "Research keywords (bulk)".
- Input: `projectId`; `seeds` 1–5 of `{ seed: string, locationCode?, languageCode? }`; `resultLimit?` 150|300|500 (default 150); `includeClickstreamData?` bool (default false; doubles cost; ignored for Google-Ads-served countries).
- Behavior: per seed `KeywordResearchService.research({ keywords:[seed], resultLimit, mode:"auto", clickstream })` in parallel; market resolved per seed vs project default.
- Backend: auto mode tries DataForSEO Labs `related_keywords` → `keyword_suggestions` → `keyword_ideas` (`/v3/dataforseo_labs/google/{related_keywords|keyword_suggestions|keyword_ideas}/live`) until enough non-seed rows; Ads-served locations use `/v3/keywords_data/google_ads/keywords_for_keywords/live`. R2-cached.
- Output: `{ results: [{ seed, ok:true, rowCount, source:"related"|"suggestions"|"ideas"|"google_ads", usedFallback, rows:[{ keyword, searchVolume, keywordDifficulty, cpc, competition, intent }] } | { seed, ok:false, error }] }` (12-month trend deliberately dropped). Text: per seed `## "seed" — N keywords (source: x[, fallback])` + table `keyword | volume | KD | CPC | competition | intent`, footer explaining columns.
- Cost note in description: ~30–100 credits per seed; flat ~96 for Google-Ads-served countries.

**`save_keywords`** — write, D (tag replace), free.
- Input: `projectId`; `keywords` 1–100; `metrics?` ≤100 of saved-keyword metric objects (`keyword, searchVolume, keywordDifficulty, cpc, competition, intent, monthlySearches?`); `tags?` ≤20 (1–64 chars); `tagMode?` "append"|"replace" (default append; replace requires tags); `locationCode?`, `languageCode?`.
- Idempotent (re-saving existing = no-op); missing tags auto-created.
- Output `{ projectId, savedCount, keywords, tags, tagMode, locationCode, languageCode }`.

**`get_keyword_metrics`** — $.
- Input: `projectId`; `keywords` 1–700 (each ≤80 chars); `locationCode?`, `languageCode?`; `includeMonthlyTrends?` (default true); `includeClickstreamData?` (doubles cost); `sortBy?` "search_volume"|"keyword_difficulty"|"cpc"|"competition" (default search_volume).
- Backend: `fetchKeywordMetricsForList` in batches (`KEYWORD_METRICS_BATCH_SIZE`): Labs-served → `/v3/dataforseo_labs/google/keyword_overview/live`; Ads-served → `/v3/keywords_data/google_ads/search_volume/live` (KD/intent null). Credit feature `keyword_research`.
- Output `{ keywords: [{ keyword, search_volume, keyword_difficulty, intent, cpc, competition, monthly_searches? … }] }`; table `keyword | volume | KD | …`.

#### SERP (2)

**`get_serp_results`** — $.
- Input: `projectId`; `queries` 1–10 of `{ keyword, locationCode?, languageCode? }`; `depth?` int 10–100 multiple of 10 (default `SERP_ANALYSIS_DEPTH` = 20).
- Backend: `client.serp.live` → `/v3/serp/google/organic/live/advanced`.
- Output per query `{ keyword, ok:true, items:[{ type, rank (rank_absolute ?? rank_group), title, url, domain, description }] }` or error. Table `rank | domain | title | url`.
- Cost: ~5 credits/keyword at depth 20; +~2.5 per extra 10 of depth. Not saved.

**`search_serp_locations`** — RO, free (no projectId).
- Input: `query` 1–100 (place name), `countryCode` 2-letter ISO.
- Backend: `fetchSerpLocationsForCountry(iso)` → `/v3/serp/google/locations/{iso}` (free, cached) then `rankSerpLocations` fuzzy ranking; up to 10.
- Output `{ locations:[{ locationName, locationCode, locationType }] }`. Used verbatim as `locationName` for `create_rank_tracker`.

#### Domain / competitor research (4)

**`get_domain_overview`** — $ (~100–300), cached 12h per domain.
- Input: `projectId`; `domain` 1–2048 (domain or URL); `scope?` "domain"|"subdomains"|"subfolder"|"exact_url" (default subdomains for roots, subfolder for paths); `includeSubdomains?` (deprecated → scope); `locationCode?`, `languageCode?` (Labs-only markets).
- Backend: `DomainService.getOverview` → `/v3/dataforseo_labs/google/domain_rank_overview/live` (+ backlinks summary counts).
- Output `{ domain, scope, displayTarget, organicTraffic, organicKeywords, backlinks, referringDomains, … }`. Text notes overview always covers hostname+subdomains.

**`get_domain_keyword_suggestions`** — $ (~100–300), cached 12h.
- Input: `projectId`, `domain`, `scope?`, `locationCode?`, `languageCode?`.
- Backend: `DomainService.getSuggestedKeywords` → `/v3/dataforseo_labs/google/ranked_keywords/live` with scope filters.
- Output `{ keywords:[{ keyword, position, searchVolume, keywordDifficulty, … }], target, scope }`; table `keyword | position | volume | KD`.

**`get_ranked_keywords`** — $.
- Input: `projectId`; `target` (domain w/o protocol/www, or absolute URL; regex-validated); `scope?`; `market?` `{ country?: "US"|"USA"|"United States"|"United States of America" }` (legacy); `locationCode?`/`languageCode?` (Labs country-level; take precedence); `resultTypes?` 1–5 of organic|paid|featured_snippet|local_pack|ai_overview_reference (default organic+paid); `includeSubdomains?` (deprecated); `minSearchVolume?` ≥0; `maxRank?` 1–100; `excludeBrandTerms?` 1–10 strings ≤80; `sortBy?` rank|search_volume|traffic_estimate|cpc (default search_volume); `limit?` 1–100 (default 50); `offset?` 0–1000.
- Backend: `client.domain.rankedKeywords` → `/v3/dataforseo_labs/google/ranked_keywords/live` with `target=hostname`, `item_types`, `order_by` (`ranked_serp_element.serp_item.rank_absolute,asc` | `ranked_serp_element.serp_item.etv,desc` | `keyword_data.keyword_info.cpc,desc` | `keyword_data.keyword_info.search_volume,desc`), `filters` built as DataForSEO filter arrays joined with `"and"`: scope clauses (`buildRankedKeywordsScopeFilter`), `["keyword_data.keyword_info.search_volume",">=",n]`, `["ranked_serp_element.serp_item.rank_absolute","<=",n]`, per brand term `["keyword_data.keyword","not_ilike","%term%"]`; `assertFilterConditionBudget` caps filter count.
- Output `{ keywords: <raw provider items>, totalCount, target, scope }`; table `keyword | rank | volume | CPC | url`.

**`find_serp_competitors`** — $.
- Input: `projectId`; `keywords` 1–100 (≤120 chars); `market?`; `locationCode?`/`languageCode?`; `resultTypes?` 1–4 of organic|paid|featured_snippet|local_pack (default organic+local_pack); `excludeDomains?` 1–50 domains; `includeSubdomains?`; `sortBy?` visibility|traffic_estimate|avg_position|keyword_count (default visibility); `limit?` 1–100 (default 50); `offset?`.
- Backend: `client.labs.serpCompetitors` → `/v3/dataforseo_labs/google/serp_competitors/live`; exclusion + sort done server-side after fetch.
- Output `{ competitors:[…] }`; table `domain | keywords | avg pos | median pos | visibility | etv`.

#### Backlinks (2)

**`get_backlinks_overview`** — $ (~50 domain, ~25 page).
- Input: `projectId`; `target` (domain/URL); `scope?` research scopes + deprecated `"page"` (= exact_url); `hideSpam?` (default true).
- Backend (parallel): `BacklinksService.profileOverview` (`/v3/backlinks/summary/live` + `/v3/backlinks/history/live` trends; subfolder uses filtered `/v3/backlinks/backlinks/live` totals) and, unless subfolder, `profileReferringDomainsPage({ page:1, pageSize:100, sortField:"backlinks", sortOrder:"desc" })` → `/v3/backlinks/referring_domains/live`.
- Output `{ target, scope, scopeNote?, overview, referringDomains? }`. Text bullets backlinks / referring domains / referring pages / rank + table `domain | backlinks | referring pages | rank`. Scope notes: domain scope → "Summary excludes subdomains; trend data includes subdomains (provider limitation)."; subfolder → no rank/trends/ref-domain breakdown. Self-host needs Backlinks API enabled on DataForSEO account.

**`get_backlinks_profile`** — $ (~30/page).
- Input: `projectId`; `target`; `scope?`; `page` (default 1); `pageSize` 50|100|200 (default 100); `sortField` rank|domainRank|spamScore|firstSeen (default firstSeen); `sortOrder` asc|desc (default desc); `filters` `{ include?, exclude?, minDomainRank?, maxDomainRank?, minLinkAuthority?, maxLinkAuthority?, minSpamScore?, maxSpamScore?, linkType?: "dofollow"|"nofollow", hideLost?, hideBroken?, domainFrom? }`; `mode` "one_per_domain"|"as_is" (default one_per_domain); `hideSpam?` (default true; spam threshold default 40).
- Backend: `/v3/backlinks/backlinks/live`.
- Output `{ target, scope, backlinks:{ rows[], totalCount, hasMore, page, pageSize, fetchedAt? } }`; table `source | target | anchor | type | rank | domainRank | spam | status(live/lost/broken)`.

#### Rank tracking (6)

**`create_rank_tracker`** — write, free (no check started).
- Input: `projectId`; `domain?` (defaults to project domain; else VALIDATION_ERROR); `locationCode?`, `languageCode?`; `locationName?` 1–200 (exact DataForSEO name from `search_serp_locations`, e.g. "Catonsville,Maryland,United States"; free-form rejected); `devices?` desktop|mobile|both (default **mobile**); `serpDepth?` 10–100 step 10 (default **40**); `scheduleInterval?` manual|daily|weekly|monthly (default **manual**).
- Output `{ trackerId, config }`. PostHog `rank_tracking:config_create { source:"mcp" }`.

**`get_rank_tracker`** — RO, free.
- Input: `projectId`, `trackerId?` (uuid).
- Without id: `{ configs:[…] }` text `- <id>  <domain>  loc:<code>  location:"…"  schedule:<x>`.
- With id: `{ config, results:{ rows:[{ trackingKeywordId, keyword, desktop:{position, previousPosition,…}, mobile:{…} }], run:{ id, lastCheckedAt, completedAt, status: pending|running|completed|failed, errorMessage } | null } }`; table `keyword | desktop | prev (desktop) | mobile | prev (mobile)`.

**`add_rank_tracking_keywords`** — write, free now; scheduled trackers spend later.
- Input: `projectId`; `trackerId` uuid; `keywords` 1–2000 (≤`MAX_TRACKED_KEYWORD_LENGTH`); `matchCase?` (default false — lowercases; cased keyword tracked/billed separately); `maxEstimatedScheduledCheckCredits?` positive int — **required for scheduled trackers** (approval of nominal per-check estimate, not a runtime cap).
- Output `{ trackerId, requested, added, addedIds, scheduledEstimate?: { scheduleInterval, costUsd, costCredits, checksPerMonth, monthlyCostUsd, monthlyCostCredits } }`.

**`remove_rank_tracking_keywords`** — D, free. Input `projectId`, `trackerId`, `keywordIds` 1–2000 uuids (`trackingKeywordId`). Output `{ trackerId, requested, removed, removedIds }`. History preserved.

**`estimate_rank_tracker_cost`** — RO, free.
- Input `projectId`, `trackerId`, `additionalKeywordCount?` 0–1000.
- Output `{ trackerId, costUsd, costCredits, keywordCount, devicesCount, totalChecks (= keywords × devices), method:"live", existingKeywordCount, additionalKeywordCount, scheduledEstimate? }`. Text explains queued (task_post) nominal price vs live, "rejected, failed, or timed-out queued tasks may use additional separately billed live fallback".

**`run_rank_tracker`** — $.
- Input `projectId`, `trackerId`, `maxCostCredits` positive int (approved ceiling; fresh estimate above it → rejected).
- Hosted requires paid plan; self-host ungated. If a run is in progress → `{ started:false, blockingRunId }` (no charge). Else `{ started:true, runId }`; poll `get_rank_tracker` until `lastCheckedAt` advances. Backend live SERP: `/v3/serp/google/organic/live/advanced` per keyword×device (scheduled runs use `task_post`/`task_get`). PostHog `rank_tracking:check_trigger`.

#### Local SEO / Google Business (9)

Coordinate conventions: `business_listings/search` takes `lat,lng,radiusKm` (km, rounded, min 1); Google `business_data` endpoints take `lat,lng,radiusMeters` (clamped 200–199,999 m, default 10 km); Maps SERP takes `lat,lng[,zoom z]`. Coordinates formatted to 7 decimals. Business identifier = exactly one of `businessName` (≤200), `cid` (≤64), `placeId` (≤256); `cid:`/`place_id:` prefixes passed through `keyword`. Rows are allowlist-projected (`pickRowFields`) to keep payloads small.

**`search_local_businesses`** — $.
- Input: `projectId`; `query?` ≤200 (title match); `near` `{ latitude, longitude, radiusKm 1–100000 }`; `categories?` 1–10 slugs; `minRating?` 1–5; `minReviews?` ≥0; `isClaimed?`; `sortBy?` relevance|rating|reviews; `limit?` 1–50 (default 20); `offset?`.
- Backend `/v3/business_data/business_listings/search/live` with `filters` (`["rating.value",">=",x]`, `["rating.votes_count",">=",n]`), `order_by` (`rating.value,desc` / `rating.votes_count,desc`), `is_claimed`.
- Output `{ businesses:[{ title, description, category, additional_categories, address, phone, url, domain, rating, is_claimed, cid, place_id, latitude, longitude, total_photos, check_url }] }`; table `title | category | rating | reviews | phone | address`.

**`get_local_serp_results`** — $.
- Input: `projectId`; `keyword` ≤120; `near { latitude, longitude, zoom? 4–18 }`; `searchType?` maps|local_finder (default maps); `device?` desktop|mobile (default mobile); `depth?` 1–100 (default 20); `languageCode?`.
- Backend `/v3/serp/google/maps/live/advanced` or `/v3/serp/google/local_finder/live/advanced` (`search_places:false`).
- Output `{ results:[{ rank_group, rank_absolute, title, domain, url, contact_url, address, address_info, phone, category, additional_categories, rating, rating_distribution, price_level, is_claimed, cid, place_id, latitude, longitude, total_photos, work_hours, local_justifications }] }`.

**`get_google_business_questions`** — $. Input `projectId`, identifier, `near` (km schema), `depth?` 1–100 (default 20), `languageCode?`. Backend `/v3/business_data/google/questions_and_answers/live`. Output `{ questions:[{ rank_absolute, question_id, question_text, original_question_text, profile_name, time_ago, timestamp, items:[answers{ answer_id, answer_text, original_answer_text, profile_name, time_ago, timestamp }] }] }`.

**`get_business_profile`** — $. Input `projectId`, identifier, `near?` (`businessDataNearSchema`: radiusKm 0.2–199, default 10), `locationCode?` (ignored when near set), `languageCode?`. Backend `/v3/business_data/google/my_business_info/live`. Text: title, category (+additional), rating from N reviews, rating breakdown `5★ n, 4★ n…`, address, phone, website, domain, claimed, status now, hours `mon 09:00-17:00 | … | sun closed`, photos, cid, place_id, check_url.

**`get_business_reviews`** — $, async task.
- Input: `projectId`, identifier, location fields, `depth?` 10–200 (default 20; billed per 10, per 20 with other sources), `sortBy?` newest|highest_rating|lowest_rating|relevant (default newest; ignored with other sources), `includeOtherSources?` (Yelp/Tripadvisor/Trustpilot via extended endpoint), `taskId?` (resume, format `google:<id>` | `extended:<id>`).
- Backend: POST `/v3/business_data/google/reviews/task_post` or `/v3/business_data/google/extended_reviews/task_post`, then poll `/v3/business_data/google/{endpoint}/task_get/{id}` (**6 attempts × 4 s**, collection unmetered). Still pending → `{ status:"processing", taskId }` ("call again in 30–60 seconds — resuming charges no extra credits").
- Output `{ status:"completed", taskId, reviews:[{ rank_absolute, time_ago, timestamp, rating, profile_name, review_text, original_review_text, photos_count, review_highlights, source, owner_answer, owner_time_ago, owner_timestamp, review_id … }], totals }`; table `# | when | rating | author | source | review(120) | owner replied`.

**`get_business_updates`** — $, async task. Input identifier, location, `depth?` 10–100 (default 10), `taskId?` (bare id). Backend `/v3/business_data/google/my_business_updates/task_post` + task_get polling. Output `{ status, taskId, updates:[{ rank_absolute, author, post_date, timestamp, post_text, snippet, url, links }] }`.

**`list_business_categories`** — RO, free. Input `projectId`, `query?` ≤80 (substring), `limit?` 1–200 (default 50). Backend `/v3/business_data/business_listings/categories` cached 7 days (namespace `local:business-categories`). Output `{ categories:[{ category, businessCount }] }` sorted by usage.

**`get_local_rank_grid`** — $ (gridSize² Maps SERP calls).
- Input: `projectId`; `keyword` ≤120; `target { cid?, placeId?, name? }` (≥1 required; name = case-insensitive title contains); `center { latitude, longitude }`; `gridSize?` 3|5 (default 3); `spacingKm?` 0.25–10 (default 2); `device?` (default mobile); `zoom?` 4–18 (default derived); `languageCode?`.
- Algorithm: grid points `lat = center + (middle-row)*spacing/110.574`, `lng = center + (col-middle)*spacing/(111.32*max(|cos(lat)|,0.01))`; default zoom `clamp(floor(log2(24045*cos(lat)/spacingKm)), 4, 18)`; each point → Maps SERP depth 20, concurrency 3; match by cid → place_id → name; rank = rank_absolute ?? rank_group. Aborts on `INSUFFICIENT_CREDITS`/`DATAFORSEO_AUTH_FAILED`; failed points marked `error:true`.
- Output `{ grid:[{ row, col, latitude, longitude, rank|null, resultsCount, topResult:{title,cid}, error? }], summary:{ pointsSearched, pointsFound, averageRank, top3Count, top10Count }, matchedBusiness:{ title, cid, placeId }|null }`; text renders the grid (north at top, `–` not found, `x` failed).

#### Google Search Console (2) — free, first-party

**`get_search_console_performance`** — RO.
- Input: `projectId`; `dimensions?` 1–4 of query|page|country|device|date|searchAppearance (default ["query"]); `dateRange?` last_7_days|last_28_days|last_3_months|last_6_months|last_12_months|last_16_months (default last_28_days; end = today−3 days lag); `startDate?`/`endDate?` YYYY-MM-DD (Pacific); `filters?` ≤5 `{ dimension, operator: equals|notEquals|contains|notContains (default equals), expression }` AND-ed; `rowLimit?` 1–1000 (default 250); `startRow?`; `minPosition?`, `maxPosition?`, `minImpressions?` (applied server-side over the top 1000 rows; striking distance = 5/20/50); `type?` web|image|video|news|googleNews|discover (default web); `dataState?` all|final.
- Backend: Google Search Console Search Analytics API (`searchanalytics.query`) via stored OAuth tokens.
- Output `{ ok:true, siteUrl, startDate, endDate, dimensions, rowCount, rows:[{ keys, clicks, impressions, ctr (4 dp), position? (1 dp; omitted for discover/googleNews) }], hasMore, nextStartRow? }`; table `key | clicks | impressions | CTR% | position` (first 15 rows in text). Not connected → `{ ok:false, reason:"not_connected", connectUrl:"/p/<id>/search-performance" }`; self-host without `GOOGLE_CLIENT_ID/SECRET` + `BETTER_AUTH_SECRET` → `reason:"gsc_oauth_not_configured"`.

**`inspect_urls`** — RO. Input `projectId`, `urls` 1–10 absolute URLs, `languageCode?` (BCP-47). Backend GSC URL Inspection API. Output `{ ok, siteUrl, results:[{ url, result (indexStatusResult: verdict, coverageState, googleCanonical, lastCrawlTime, mobile/rich results…), error? }] }`.

#### Google Analytics 4 (10) — free, first-party

Common input for report tools: `projectId`, `startDate?`, `endDate?` (both or neither; default last 28 complete property days; endDate clamped to last complete day → warning `end_date_clamped`), `limit` 1–1000 (default 100), `offset` (default 0). Schemas are `z.strictObject`. Output envelope `{ status:"ok"|"error", source, request, rowCount, totalRowCount, rows, pageInfo, reportMetadata, warnings, quota?, comparison?, ecommerceActivity?, siteSearchActivity?, diagnostics?, diagnosticCoverage?, error? }`. Error codes `ga4_not_connected | ga4_reconnect_required | ga4_property_inaccessible | …` (actionUrl → `/p/<id>/settings/integrations`), `gsc_not_connected | gsc_reconnect_required | gsc_upstream_unavailable`. Backend: GA4 Data API `runReport` + Admin API (via `Ga4ReportingService`, `Ga4Client`).

| Tool | Extra inputs (defaults) | Report kind / notes |
|---|---|---|
| `get_google_analytics_organic_landing_pages` | — | `landing_pages`, channel organic_search: sessions, engagement, key events, transactions, revenue |
| `get_google_analytics_page_performance` | `includeDate` (false), `channel` organic_search\|all (organic_search) | `page_performance`: views, users, engagement duration, key events |
| `get_google_analytics_key_events` | `breakdown` event\|event_and_landing_page (event), `channel`, `comparePreviousPeriod` (false) | `key_events`; comparison only for event breakdown |
| `get_search_opportunities` | `limit` 1–100 (50); no offset | GSC×GA4 join — see formula below |
| `get_google_analytics_organic_overview` | `trend` daily\|weekly (daily) | current vs equal-length previous period + trend; output `{ current, previous, comparison, trend[], diagnostics[] }`; warning `trend_truncated` |
| `get_google_analytics_traffic_acquisition` | `breakdown` channel_group\|source_medium\|campaign (channel_group), `comparePreviousPeriod` | channel all; source_medium adds attribution diagnostics |
| `get_google_analytics_measurement_health` | only projectId | streams, measurement IDs, enhanced measurement, key events, custom definitions; `{ summary{webStreamCount,keyEventCount,issueCount}, issues[], webStreams[], otherStreams[], keyEvents[], customDefinitions }` |
| `get_google_analytics_ecommerce_performance` | `breakdown` item\|landing_page (item), `onlyWithTransactions` (false), `channel` | item views, add-to-carts, purchases, item revenue; activity state detected/none/unknown |
| `get_google_analytics_site_search` | — | `site_search`, channel all: search terms, events, users, sessions, engagement |
| `get_google_analytics_audience_breakdown` | `breakdown` device\|country\|new_vs_returning (device), `channel`, `comparePreviousPeriod` | no demographics |

**`get_search_opportunities` scoring** (`SearchOpportunityService`): requires GA4 and GSC connected. GSC `page` dimension, `rowLimit 1000`, type web, `dataState final`; GA4 `landing_pages` organic, limit 1000. Candidates = GSC pages with **4 ≤ position ≤ 20**; join on normalized `host+landingPage`. For joined rows compute percentile ranks of: demand = `log1p(impressions)`; businessValue = `sessionKeyEventRate` (fallback `engagementRate` if all joined rows have 0 key events); reachability = `20 − position`. `score = round(100 × (0.5·demand + 0.3·businessValue + 0.2·reachability))`. Unjoined (`gsc_only`) rows kept with `score:null`, sorted last; tie-break impressions desc. Output `{ rows, scoring, coverage{ matchedRows,… }, truncated, … }`.

#### Site audit (6)

**`run_site_audit`** — $ (crawl is free; Lighthouse via DataForSEO costs), background.
- Input: `projectId`; `url` 1–2048 (start URL); `maxPages?` 10–10,000 (default 50; capped by plan tier via `AuditService.resolveAuditLimitTier`); `runLighthouse?` (default false → `lighthouseStrategy:"none"`, true → `"auto"` = sample ≤10 representative pages).
- Starts a Cloudflare Workflow (`SiteAuditWorkflow`); refusals returned as text: `AUDIT_CAPACITY_REACHED` ("delete old audits…"), `AUDIT_ALREADY_RUNNING` (concurrency limit).
- Output `{ auditId }`, deep link `/p/<id>/audit?auditId=…`. PostHog `site_audit:start { source:"mcp" }`.

**`get_audit_status`** — free (may reconcile a dead workflow → marks failed). Input `projectId`, `auditId?` (default latest). Output `{ status:{ id, startUrl, status, currentPhase, pagesCrawled, pagesTotal, lighthouseTotal, lighthouseCompleted, lighthouseFailed, … } }`. (SAM version waits server-side up to 50 s, polling every 2 s, returning early when the progress line changes.)

**`get_audit_issues`** — RO, free. Input `projectId`, `auditId?`, `severity?` critical|warning|info, `issueType?` (one of `AUDIT_ISSUE_TYPES` keys), `limit?` 1–1000 (default 200). Output `{ summary:[{ issueType, title, severity, count }] (sorted severity then count), issues:[{ severity, issueType, title, url, details, howToFix }] }`.

**`get_audit_pages`** — RO, free. Input `projectId`, `auditId?`, `fetchClass?` (`PAGE_FETCH_CLASSES`, incl. ok|blocked|rate_limited…), `statusCode?`, `urlContains?`, `limit?` 1–1000 (default 100). Output `{ pages:[per-page SEO data: status, title, description, word count, indexability, crawl depth, link counts, fetchClass…], total }`.

**`list_site_audits`** — RO, free. Output `{ audits:[{ id, startUrl, status, pagesCrawled, startedAt, … }] }` newest first.

**`delete_site_audit`** — D, free, owner/admin only. Input `projectId`, `auditId` (required, never defaults). Stops workflow + deletes pages/issues/Lighthouse results. Output `{ auditId, deleted:true }`.

#### Reports (4) — free

**`save_report`** — D.
- Input: `projectId`; `title` (≤120; type/subject + full date e.g. "Competitive Landscape — Sep 17, 2026"); `summary` markdown (≤2,500 chars: verdict, top action, key numbers); `html` complete self-contained document (≤500,000 UTF-8 bytes; must contain `<html` and end with `</html>`; aim <80 KB; no external resources/scripts; no backticks or `${`); `reportId?` (replace in place); `skill?` ≤60 (skill slug); `templateId?` (validated to exist in project).
- Output `{ reportId, title, created, htmlBytes, url }`. Text instructs: reply with link, one-line verdict, top action. PostHog `report:saved`.

**`list_reports`** — RO. Input `projectId`, `limit?` 1–50 (default 20), `offset?`. Output `{ reports:[metadata minus shareToken/sharedAt, summary truncated to 300 chars], totalCount, rowCount, remaining }`.

**`get_report`** — RO. Input `projectId`, `reportId`, `includeHtml?`. Output `{ report:{ …metadata, htmlBytes, url } }`; HTML appended to text only when requested (with truncation-check warning).

**`delete_report`** — D. Input `projectId`, `reportId`. Output `{ reportId, deleted:true }`; share link dies.

#### Report templates (3) — free

**`list_report_templates`** — RO. Output `{ templates:[{ id, name, description, instructionsPreview (300), updatedAt }], remaining }` (cap 10/project); text includes full instructions.

**`save_report_template`** — D. Input `projectId`, `templateId?`, `name` (≤80), `description` (≤200, "when to use"), `instructions` markdown (≤3,000: audience, sections in order, tone, sign-off, optional `accent: #hex`). Name unique per project (case-insensitive). Output `{ templateId, name, created, url }`.

**`delete_report_template`** — D. Input `projectId`, `templateId`. Output `{ templateId, deleted:true }`. Existing reports kept.

#### Full registration order (57)
whoami, list_projects, create_project, get_project_context, update_project_context, list_saved_keywords, remove_saved_keywords, research_keywords, save_keywords, get_domain_overview, get_domain_keyword_suggestions, get_backlinks_overview, get_backlinks_profile, get_serp_results, search_serp_locations, create_rank_tracker, get_rank_tracker, add_rank_tracking_keywords, remove_rank_tracking_keywords, estimate_rank_tracker_cost, run_rank_tracker, get_ranked_keywords, find_serp_competitors, search_local_businesses, get_local_serp_results, get_google_business_questions, get_business_profile, get_business_reviews, get_business_updates, list_business_categories, get_local_rank_grid, get_keyword_metrics, get_search_console_performance, inspect_urls, get_google_analytics_organic_landing_pages, get_google_analytics_page_performance, get_google_analytics_key_events, get_search_opportunities, get_google_analytics_organic_overview, get_google_analytics_traffic_acquisition, get_google_analytics_measurement_health, get_google_analytics_ecommerce_performance, get_google_analytics_site_search, get_google_analytics_audience_breakdown, run_site_audit, list_site_audits, delete_site_audit, get_audit_status, get_audit_issues, get_audit_pages, save_report, list_reports, get_report, delete_report, list_report_templates, save_report_template, delete_report_template.

`chatgpt-app-submission.json` (OpenAI Apps SDK submission) mirrors 47 of these tools with annotation justifications, 5 test cases and 3 negative test cases; the route `GET /.well-known/openai-apps-challenge` returns a static verification token (plain text).

---

## 12. Agent Skills, Plugins & Agent Setup Page

### Agent Skills & Plugins

#### Where skills live
- Canonical source: `.agents/skills/<name>/SKILL.md` (YAML frontmatter `name`, `description`, optional `metadata.internal: true`).
- `.claude/skills/*` = symlinks to the internal repo-maintenance skills only.
- `plugins/openseo/skills/*` = **real-file copies** of the 10 public skills (Codex plugin installs skip symlinks); regenerated by `pnpm sync-plugin-skills` (`scripts/sync-plugin-skills.mjs`), CI fails on drift.
- Public docs pages per skill at `https://openseo.so/docs/skills/<name>` (`web/content/docs/skills/*`).
- SAM bundles all non-internal skills at build time (except `simple-issue-description` and `seo-report`).

#### Plugin manifests
| File | Client | Content |
|---|---|---|
| `.claude-plugin/marketplace.json` | Claude Code marketplace | plugin `openseo`, source `./plugins/openseo`, category SEO |
| `plugins/openseo/.claude-plugin/plugin.json` | Claude Code plugin | name/displayName OpenSEO v1.0.0, MIT, keywords, `mcpServers.openseo = { type:"http", url:"https://app.openseo.so/mcp" }` |
| `.agents/plugins/marketplace.json` + `plugins/openseo/.codex-plugin/plugin.json` | Codex | `"skills": "./skills/"`, mcpServers url, `interface{ displayName, shortDescription, longDescription, category:"Productivity", capabilities:["Interactive"], websiteURL, privacyPolicyURL, termsOfServiceURL, defaultPrompt:[3 prompts] }` |
| `.cursor-plugin/marketplace.json` + `plugins/openseo/.cursor-plugin/plugin.json` | Cursor | `"skills":"skills"`, `"mcpServers":"mcp.json"`, logo URL |
| `plugins/openseo/mcp.json` | shared | `{ "mcpServers": { "openseo": { "url": "https://app.openseo.so/mcp" } } }` |
| `plugins/openseo/README.md` | Cursor listing | features, 10 skills, example prompts |
| `.opencode/opencode.jsonc` | repo dev only | context7 MCP; `.opencode/command/release-notes.md` |

Common pattern in every product skill: **Project context preamble** — (1) call `get_project_context` first; (2) if this skill's required sections are empty, do minimal inline setup (ask/infer+confirm, write via `update_project_context`), suggest `seo-project-setup` at the end; (3) before paid research check the research log (reuse <30 days); (4) on finish write back durable facts + `appendResearchLog { summary:"<Skill>: <inputs>. Verdict: <conclusion>" }`. **Deliver as a report** via `seo-report` (`save_report` with `skill:"<slug>"`), chat reply = ≤3 bullets + link. Each has Required inputs, Workflow, Output format (ordered report sections ending with "How this report was made" linking `https://openseo.so/docs/skills/<slug>`), Guardrails.

#### Product (public) skills — 11

| Skill | Purpose | Required context | MCP tools used | Workflow summary | Report sections |
|---|---|---|---|---|---|
| `seo-audit` (140 lines) | Audit a site, investigate real search opportunities, deliver 1–3 data-backed recommendations | business_overview | whoami, list_projects, create_project, get/update_project_context, run_site_audit, get_audit_status/issues/pages, get_backlinks_overview, get_domain_overview, get_ranked_keywords, get_serp_results, get_search_console_performance, get_keyword_metrics, research_keywords (+ web fetch) | 1 Orient (whoami, start crawl, backlinks/domain overview, domain-level ranked sample with `resultTypes:["organic"]`, sitemap page families) → 2 Investigate every page family (read ≥2 pages each, canonical/index checks, live SERP checks depth 20, count organic positions yourself "#10 (page 1)") → 3 Shortlist 5–10 candidates in `opportunities.md` from ≥3 opportunity kinds → 4 Choose (bounded fix of demonstrated problem beats bigger vague volume) → 5 Size benefit honestly (mechanism, cluster, US volumes, click-share scenario labelled hypothetical, never invent conversion) → 6 Reviewer pass then save | Your next SEO move; Recommendations (h3 each: Do this / Why / evidence table / optional scenario); What else we checked (table); How this report was made (+ `<details>` evidence) |
| `keyword-research` | Seed topics → prioritized keyword opportunities, save/tag | business_overview + current_goal | list_projects, research_keywords, get_keyword_metrics, get_ranked_keywords, get_serp_results, get_search_console_performance, list_saved_keywords, save_keywords, search_local_businesses, get_local_serp_results, get_google_business_questions | Normalize seeds; if GSC: striking-distance pull (minPosition 5, maxPosition 20, minImpressions 50) + hydrate with get_keyword_metrics; local branch; research_keywords bulk; hydrate; ranked keywords for domains; filter; prioritize (fit, intent, KD, volume/CPC, competable SERP); SERP-check ambiguous; ask before saving; suggest tags `topic:`, `intent:`, `page:` | The opportunity; Target these now (table + bar chart); Why these; Longer list; Risks and caveats; What to do next; How made |
| `keyword-clustering` | Group keywords into page-level clusters, map to existing/new pages | key pages | list_saved_keywords, research_keywords, get_ranked_keywords, get_search_console_performance (dims query+page), get_serp_results, save_keywords, local tools | Gather set; dedupe; cluster by SERP intent/page type; SERP-overlap check for borderline; assign cluster → existing URL / new page / later; cannibalization via GSC query→multiple pages; ask before tagging | The map; Clusters table; Page briefs; Cannibalization; What to do next; How made |
| `competitor-analysis` | Deep-dive one competitor | competitors | get_domain_overview, get_ranked_keywords (maxRank, minSearchVolume, excludeBrandTerms, resultTypes), get_backlinks_overview, get_serp_results, find_serp_competitors, get_search_console_performance, local tools | Overview both domains; ranked keywords both; local branch; group themes (product, alternatives, tools, guides, branded, local); backlinks; SERP compare; plan (strengths, vulnerabilities, pursue, don't copy) | Snapshot table; Biggest lesson; Where they are vulnerable; Keyword themes (+chart); Content patterns & authority; What to do next; How made |
| `competitive-landscape` | Market-level: who wins, why, openings | competitors | research_keywords, get_keyword_metrics, find_serp_competitors, get_serp_results (≤10/call), get_domain_overview (top 3–5), get_ranked_keywords, get_backlinks_overview, local tools | Build 5–10 mixed-intent queries; validate demand; recurring domains grouped (product/publisher/marketplace/community/docs); overview + ranked for leaders; backlinks when needed; synthesize | Market read; Who is winning; Why they win; Gaps and openings (+chart); What to do next; How made |
| `link-prospecting` | Find link prospects, contact paths, draft outreach | positioning + competitors | get_serp_results, get_backlinks_overview, get_domain_overview, find_serp_competitors, get_ranked_keywords, research_keywords, local tools (+ web search/browser for contacts) | Clarify asset; 5–10 queries from patterns (`<topic> resources`, `best <category> tools`, `<competitor> alternatives`, `statistics`, `guide`, `examples`, `templates`, `software`, `for <audience>`); SERP batch; competitor backlinks; filter (editorial/resource pages); angle (broken resource, better data, tool, comparison inclusion, expert quote); find contacts (bylines, contact pages, `Person`/`sameAs` schema — only record found details with source); draft outreach | Prospects/outreach report |
| `local-seo` | GBP & Maps visibility audit vs local competitors | (business location) | search_local_businesses, get_local_serp_results, get_business_profile, get_business_reviews, get_business_updates, get_google_business_questions, get_local_rank_grid, list_business_categories, run_site_audit | Find listing (cid/coords); Maps SERP top 3–5; compare category, extra categories, reviews, hours, photos, claimed; check website deep-link; reviews for user + strongest competitor (volume, recency, rating, reply rate); rank grid (storefront vs service area); Q&A/posts when basics competitive; prioritize (category/claim > posting). Multi-location: snapshot all; ≤5 deep-dive all, >5 ask user for 1–3 | Local report |
| `seo-coach` (161) | Friendly coach mode: explains workflows, picks next step | reads everything, requires nothing | list_projects, get/update_project_context, get_search_console_performance, list_reports | First response asks experience level, project, strategy vs execution; offers 2–4 options; explains each workflow; coaching patterns; "one thing to do this week" | Chat, not reports |
| `seo-project-setup` (195) | Populate shared project context + MCP checks + GSC intake | — | whoami, list_projects, create_project, get/update_project_context, find_serp_competitors, get_search_console_performance | 10-step checklist: verify MCP/resolve project; read existing; site scope; goals; positioning; save competitors; key assets; connect GSC (or CSV exports, 3 & 16 months); local folder only for file work; recommend first workflow | Chat summary |
| `seo-report` (254) | Write/save one self-contained HTML report | — | list_reports, get_report, save_report, list_report_templates | list first (reuse reportId), unique titles, templates only when named, writing rules (notes not essays, Problem/Change/Expected effect bullets, print numbers), title format `"<Type> — MMM D, YYYY"` (subject hostname only if ≠ project site), summary ≤2,500 ordered verdict→action→evidence, mandatory closing `h2#how-this-report-was-made` with "Generated by the <a …>OpenSEO X skill</a>, run by AGENT on DATE", HTML constraints (no external resources, links `target=_blank rel=noopener`, no script, inline SVG/CSS bar charts, <80 KB, no backticks/`${`, finish with `</html>`); provides starter template (CSS tokens `--bg --fg --fg-2 --fg-3 --rule --rule-2 --sunk --accent`, 660px article + sticky contents rail ≥900px, `.finding`, `.note`, `.tw` table wrapper, `.bars` CSS bar chart, print CSS) | — |
| `simple-issue-description` | Turn rough bug/feature notes into a plain issue (TL;DR / What is happening / What should happen / Extra context) | — | none | contributor tool, public via `npx skills add` | — |

#### Internal (repo-maintenance, `metadata.internal: true`)
`setup-openseo` (the installer prompt — body is exactly what the /ai "Copy setup prompt" button copies, with `https://app.openseo.so` replaced by the instance origin: detect agent, install plugin first (Codex / Claude Code guides), fall back to MCP URL + public skills, sign in via OAuth or API key from Settings, reload, verify with `whoami` + `list_projects`, final reply ≤140 words with Status/Next template recommending SEO Audit), `create-repo-skill`, `deslop`, `evaluate-skill` (runs isolated Codex sessions vs local backend, scores saved reports), `maintain-greptile-rules`, `merge-ready`, `observability-triage`, `openseo-release-notes`, `openseo-review-web-content`, `papercuts`, `review-brief`, `verify-local-mcp`.

### Agent Setup Page (/ai)

- **Route `/ai`** (`src/routes/_app/ai.tsx`), heading "Agent setup": "The most powerful way to use OpenSEO is through the AI agent you already use. Set it up once, then ask it anything." Two tabs:
  - **Set up your agent**:
    - Card "Set up your agent": text "Paste the setup prompt into your agent to connect OpenSEO and install its SEO skills…", `AgentList` icons (Claude Code, ChatGPT, Grok Bot, Hermes, OpenClaw), primary **Copy setup prompt** (= body of `.agents/skills/setup-openseo/SKILL.md` without frontmatter, `https://app.openseo.so` replaced by `window.location.origin`; PostHog `mcp:setup_prompt_copy`), link "Setup instructions" → `https://openseo.so/docs/agent-setup#set-up-your-agent`; footer "Once connected, ask your agent to use SEO Coach…".
    - Card "Update your skills": **Copy update prompt** (`agentUpdatePrompt.md`: identify agent/install method, use matching plugin/skills installer, update only OpenSEO, preserve MCP endpoint/sign-in/personal edits, compare manual copies with `github.com/every-app/open-seo/tree/main/plugins/openseo/skills`, reload, verify discovery, no SEO research) — PostHog `mcp:update_prompt_copy`.
    - Warning alert when `AUTH_MODE === "cloudflare_access"` (Managed OAuth needed, link to self-hosting guide).
    - Footer: "MCP server URL for this instance: `<origin>/mcp`" + copy button (`mcp:setup_url_copy`).
  - **Skills**: list of 10 slash-skills with blurbs, each linking `https://openseo.so/docs/skills/<name>`: seo-coach, seo-project-setup, seo-audit, keyword-research, keyword-clustering, competitive-landscape, competitor-analysis, link-prospecting, local-seo, seo-report.
- The same `AgentSetup` component (which wraps `AgentSetupPanel`, the copy-prompt panel) is reused as onboarding step 4.
- Related docs routes: `/help/openrouter-api-key` (SAM self-host key help), `/help/dataforseo-api-key`.

---

## 13. Sam (in-app agent), Onboarding Agent & Project Context

### Sam (in-app AI chat agent)

- **Route**: `/p/$projectId/sam?s=<sessionId>` (`SamChat`). Sidebar panel `SamSidebarPanel`: "New chat" button, list of sessions (title, archive button). Empty-state suggestion chips: "What keywords should I focus on next?", "Who are my top SERP competitors?", "How is my Search Console traffic trending?", "Find quick-win keywords I already rank for". Composer placeholder "Ask SAM to research, analyze, or track anything…". Retry button on error; typing indicator; markdown rendering of assistant messages.
- **Gates**:
  - `SamBetaGate` — shown until the user opts in (localStorage `sam-beta-opt-in = "1"`, PostHog `sam:beta_opt_in`): "Sam is in beta … We recommend using OpenSEO there" with "Set up your agent" (→ `/ai`) and "Use Sam anyway".
  - `SamSetupGate` / `getSamAccessSetupStatus` — hosted always enabled; self-hosted requires `OPENROUTER_API_KEY` ("OPENROUTER_API_KEY is not set for this deployment yet…"; help page `/help/openrouter-api-key`).
- **Runtime**: Cloudflare Durable Object `SamChatAgent extends Think` (`@cloudflare/think`), binding `SAM_CHAT`, client `useAgent({ agent:"sam-chat", name: sessionId })` + `useAgentChat` (WebSocket). Worker routes `/agents/*` via `routeAgentRequest` with `onBeforeConnect`/`onBeforeRequest` → `authorizeSamChat` (session must belong to user + project in their org; hosted ensures Autumn customer exists). One DO per chat session; DO name = session id.
- **Model**: OpenRouter via `@openrouter/ai-sdk-provider`; default `openai/gpt-5.6-luna` with `reasoning.effort:"max"` (via `extraBody`), override `OPENROUTER_MODEL` (MiniMax M3 path with ZDR provider routing). `usage:{include:true}` so each response carries `providerMetadata.openrouter.usage.cost` (USD).
- **Turn config**: `maxSteps: 40`, `maxOutputTokens: 16_000`. Compaction: between turns after ~120k estimated tokens, proactive mid-turn at 160k input tokens; summaries generated with the same model at reasoning "low". Interrupted-turn notice text on recovery.
- **Context blocks**: `soul` (system prompt) + `project_context` (read-only markdown digest of project memory, refreshed per turn).
- **System prompt** (`buildSamSystemPrompt`): identity "You are SAM, the SEO agent inside OpenSEO…"; plain prose + Markdown tables, no emoji; short teammate tone; never state metrics not from a tool; tools already scoped to active project; paid tools cost credits — confirm large batches; research-log 30-day staleness rule; project_context is read-only, write via `update_project_context` (typed sections, competitors, key pages, custom sections, research log format "<what>: <inputs>. Verdict: <conclusion>"); don't narrate tool calls; never pitch plans; use `get_product_info` for product questions (fallback ben@openseo.so); active project name/id, website, default market. **Intake mode** (when `business_overview` missing): only ask for the website (if none set), `map_links` → pick ≤10 pages → `read_pages` → infer business/audience/positioning/competitors → play back assumptions + guessed goal → immediately save via one `update_project_context` (sections + `addCompetitors`, marked "(inferred)").
- **Tools** (`buildSamMcpTools`): all MCP tools **except** `list_projects`, `create_project`, `get_project_context`, and reports/templates tools, plus SAM-only tools:
  - `get_product_info` — returns `openseo-fact-sheet.md` (product, plans: free trial $0.50 credits, $10/month plan with $10 credits, 30-day money-back, credit-using features, MCP setup…).
  - `map_links { domain? }` — `discoverSiteUrls(target, 60)` (homepage + sitemap), free.
  - `read_pages { urls?: ≤10 }` — `readPages(urls, 10)` or `readSite(domain, 10)` → plain text pages, free.
  - `get_audit_status` wrapped to wait server-side (poll 2 s, budget 50 s).
  - `projectId` stripped from every tool's model-facing schema and injected server-side; results flattened by `toModelOutput` → `{ summary: first 300 chars of text, data: structuredContent }`; tool errors returned as `{ error }`; each call scoped with `withPgClient`; auth context `{ orgScope:"pinned", clientId:null, scopes:["mcp"], role from membership }`.
- **Skills**: `buildSamSkillSource()` bundles public `.agents/skills/*/SKILL.md` via `import.meta.glob`, prepends a "Surface note" (already authenticated/scoped, no filesystem, no get_project_context/report tools, deliver findings in chat). djb2 fingerprint for refresh.
- **Billing** (hosted): every turn gated by `checkUsageCreditsDepleted` (second read path before refusing) → refusal via `staticAssistantModel("You're out of credits. Top up to keep using SAM.")` (no provider call). Other refusals: no session, lost org membership. LLM spend accumulated per step and metered to Autumn in $0.05 chunks via `trackUsageCreditSpend` (× 1.28 markup, 1000 credits/USD, monthly balance first then top-up), remainder flushed at turn end; DataForSEO tool spend metered inside the shared client. Self-hosted ungated.
- **Sessions table** `sam_sessions { id PK, project_id FK cascade, user_id FK cascade, title default "New chat" (auto-set from first user message, ≤60 chars), created_at, updated_at, archived_at (soft delete) }`, index `(project_id, updated_at)`. Server fns: `listSamSessions`, `createSamSession` (PostHog `sam:session_create`), `archiveSamSession` (PostHog `sam:session_archive`; no unarchive UI). Transcript lives in DO storage; GDPR erasure calls `destroyForErasure()`.
- **Telemetry** (`SamTelemetry`): one `sam:turn` event per turn (status, steps, tool calls, credits, refusal reason, compaction), PostHog LLM analytics `$ai_generation`/`$ai_trace`; tool calls emit `mcp:tool_call` with `source:"in_app_agent"`, `turn_id`.

### Onboarding Agent

- **Specs 0005/0006 (historical)**: planned a narrated pipeline (discover sitemap → scrape 3–5 pages → Labs `domain_rank_overview` + `keyword_ideas` (+ `ranked_keywords` if ranking) → one streaming LLM synthesis → versioned Project Context in R2). What shipped first was an on-demand chat with `read_website` + `get_seo_metrics` tools; that route (`/api/onboarding/chat`) no longer exists.
- **Current implementation**:
  1. **Post-signup questionnaire** `/_authenticated/onboarding?step=0..4` (step in URL; `beforeLoad` redirects to `/` if `completedAt` set; `ssr:false`). Steps: 0 "What brings you here?" (multi-select: AI workflows with Claude or Codex (MCP), Keyword research, Competitor research, Backlink analysis, Site audits, Rank tracking, Other + free text); 1 "Who are you doing SEO for?" (My own startup or business, My clients → follow-up client website count 1–3/4–10/11–25/25+, My employer's website, My own side project, I'm exploring…, Other); 2 "How did you find OpenSEO?" (Google, X/Twitter, GitHub, Instagram, YouTube, Friend or colleague, AI, Product Hunt, Other); 3 Search Console connect step (`SearchConsoleOnboardingStep`); 4 Agent setup (`AgentSetup`, records `mcpSetupIntent: "yes"|"no"`). Persisted in `user_onboarding_answers { user_id PK, organization_id, interested_features (JSON text), work_for, client_website_count, found_via, mcp_setup_intent, completed_at, gsc_nudge_dismissed_at, updated_at }` via `saveOnboardingAnswers` (upsert; completion also resolves the GSC nudge). `dismissGscNudge` for the one-time GSC re-engagement modal.
  2. **Agentic onboarding = SAM intake mode** (above) + the `seo-project-setup` skill for external agents. Both write into the Project Context store.

### Project Context / Memory

- **Purpose**: one project-scoped shared memory read/written by the app UI, SAM, and MCP clients (spec 0010; replaced old `sam_project_memory`).
- **Tables** (D1 + Postgres mirrors):
  - `project_context_sections { project_id FK cascade, key ("business_overview"|"current_goal"|"positioning"|"writing_preferences"|"custom:<slug>"), title (custom only), content (markdown), updated_at, updated_by ("user"|"sam"|"mcp") }` PK `(project_id, key)`.
  - `project_competitors { id, project_id FK, domain (normalized host), name?, notes?, updated_at, updated_by }` unique `(project_id, domain)`.
  - `project_key_pages { id, project_id FK, url, role ("hub"|"spoke"|"money"|"other"), topic?, notes?, updated_at, updated_by }` unique `(project_id, url)`.
  - `project_research_log { id, project_id FK, entry_date YYYY-MM-DD (server-stamped), summary, created_by }`.
- **Caps**: prose sections ≤4,000 chars (`PROSE_MAX_CHARS`); custom sections ≤20/project; competitors ≤100; key pages ≤100; research log pruned to **90 days** on append, reads return newest **20**; ≤50 ops per update call.
- **Patch ops** (`updateProjectContextSchema`, strict union):
  - `{ section: <typed key>, content }` (empty string clears)
  - `{ customSection: <slug /^[a-z0-9]+(-[a-z0-9]+)*$/ ≤60>, title? ≤120, content }` / `{ deleteCustomSection: slug }`
  - `{ addCompetitors: [{ domain ≤255, name? ≤120, notes? ≤500 }] (1–100) }` upsert by normalized domain / `{ removeCompetitors: [domain] }`
  - `{ addKeyPages: [{ url ≤2048, role?, topic? ≤200, notes? ≤500 }] }` upsert by URL (omitted role keeps stored role) / `{ removeKeyPages: [url] }`
  - `{ appendResearchLog: { summary 1–1000 } }` / `{ removeResearchLog: [id] }`
  - All ops validated first (`resolveContextUpdates`), then applied; caps enforced by service for every writer.
- **Read model** (`getProjectContext`): `{ sections[{key, content, updatedAt, updatedBy}], missingSections[], customSections[{slug,title,content,…}], competitors[], keyPages[], researchLog[], reportTemplates[{name, description}] }`.
- **Markdown digest** (`renderProjectContextMarkdown`): `# Project context`, then each typed section (label; empty shown so it reads as missing), custom sections, `Competitors` (`- domain — name (notes)`), `Key pages` (`- url — role · topic (notes)`), `Research log (N entries)` (`- YYYY-MM-DD: summary`, with "_Older entries within the 90-day window are omitted._" when at 20), `Report templates` (if any), final `Missing sections: a, b | none`.
- **UI**: `/p/$projectId/context` (sidebar "AI" group; old `/settings/context` redirects). `ProjectContextPage`: editable textareas for the 4 prose sections (with per-section placeholders & char hints), custom section cards (rename/edit/delete), Competitors table with inline add (`competitor.com`, "Name (optional)", "Why they matter — e.g. wins every comparison keyword (optional)") / edit / delete, Key pages table (url `example.com/pricing`, role select, "Target topic (optional)", "Notes (optional)"), research log list (read-only + delete). Every item shows provenance "Updated by SAM · 2d ago" (`AUTHOR_LABELS` user/sam/mcp). Server fns `getProjectContext`, `updateProjectContext` (author `"user"`).
- **MCP**: `get_project_context`, `update_project_context` (author `"mcp"`); SAM reads via context block and writes via adapted tool (author `"sam"`).

---

## 14. Reports, Templates & Public Share Links

### Reports, Templates & Share Links

#### Reports (spec 0012)
- **What**: agent-written, self-contained HTML reports per project, saved via MCP `save_report` (SAM has no report tools). Free (no credits); caps are runaway guards.
- **Table `reports`**: `id PK, project_id FK cascade, title, summary (md), html, skill?, template_id?, created_by (client label e.g. "Claude Code"/"Codex"/"API key"), created_by_user_id, size_bytes, share_token? (unique index), shared_at?, created_at, updated_at`; index `(project_id, updated_at, id)`.
- **Limits**: HTML ≤500,000 UTF-8 bytes; title ≤120; summary ≤2,500; skill ≤60; 10,000 reports/project (create only); **5 GB/org** total bytes (checked on create and update); list default 20 (MCP max 50, app shows 100).
- **Save rules** (`ReportService.saveReport`, validate-before-write): size messages round actual up / limit down; shape check `includes("<html") && endsWith("</html>")` ("The HTML has no closing </html>; the model stopped early. On Codex, escape backticks and ${."); unknown reportId → NOT_FOUND; **title unique per project** (clash message points to existing id); update keeps previous skill/templateId if omitted; attribution (`created_by`, `created_by_user_id`) stamped at create only.
- **App pages**:
  - `/p/$projectId/reports` — "Reports — HTML reports your agents saved to this project.", "Templates" button, table columns **Title | Created by (user name + client label) | Type (template name or skill slug, "—") | Updated | Delete**. `staleTime: 0`.
  - `/p/$projectId/reports/$reportId` — header with title + metadata (`dl`: created by, type, updated), actions: **Share** (hosted only), **Export** (opens `/r/<id>?print=1` in new tab → print dialog), overflow menu (Export, Delete), **Full screen** toggle (Esc exits), **Open in new tab** (`/r/<id>`); body = `ReportViewer` iframe `src="/r/<id>" sandbox="allow-popups allow-popups-to-escape-sandbox"`.
  - Server fns: `listReports` (drops `summary`, adds `createdByName`, `templateName`), `getReport`, `shareReport`, `unshareReport`, `deleteReport`. HTML never returned by server functions.
- **Document route `GET /r/$reportId`** (raw Response, no React): session required (hosted: 302 `/sign-in?redirect=/r/<id>`; self-host 401 text); project-access check (org + not archived); unknown/foreign → 404 "This report does not exist or you do not have access to it."; archived → 404 "This project is archived… Restore <name> to read them."; serves stored HTML byte-for-byte.
- **Sandbox headers** (`reportDocumentResponse`):
  - `Content-Security-Policy: sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'`
  - Print mode (`?print=1`): sandbox adds `allow-scripts allow-modals` and `script-src 'sha256-uE0MLbgBgIu3I3pghlY0762kVHKlP7Udz5qzZNT7piw='`; appends attribute-free `<script>addEventListener("load",()=>{for(const d of document.querySelectorAll("details"))d.open=true;setTimeout(()=>print(),150)})</script>` before `</body>`.
  - `Cross-Origin-Opener-Policy: same-origin`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store` (member route).

#### Report templates (spec 0013)
- **Table `report_templates`**: `id, project_id FK, name, description, instructions, created_by, created_by_user_id, created_at, updated_at`; unique `(project_id, name)`.
- Caps: 10/project; name ≤80; description ≤200; instructions ≤3,000; names unique case-insensitive; trimmed; validation errors are actionable text.
- UI `/p/$projectId/reports/templates`: "Report templates" table **Name | Description | Updated | (Edit/Delete)**, "New template" → `ReportTemplateForm` modal (Name placeholder "Monthly client check-in", Description "The monthly update we send retainer clients.", Instructions placeholder: `Audience… / Sections, in order… / Tone… / Sign off as… / Accent: #1C4ED8`). App-created templates get `created_by: "OpenSEO app"`. Server fns `listReportTemplates`, `saveReportTemplate` (returns `{ok:false,message}` on validation), `deleteReportTemplate`.
- Templates appear in the project-context digest; agents use one only when the user names it; `accent:` may set the report's `--accent` CSS token.

#### Public share links (spec 0014, hosted only)
- **Mint**: `shareReport` → if already shared return existing token (idempotent); else `mintShareToken()` = 24 random bytes base64url (32 chars, `/^[A-Za-z0-9_-]{32}$/`), store `share_token`, `shared_at`. Unshare nulls both (re-share mints a new token). Refused on self-hosted ("Sharing is only available on hosted OpenSEO."). PostHog `report:shared`/`report:unshared`.
- **Share modal**: "Public link" toggle; on: "Anyone with the link can view. No sign-in needed." + copy link (`<origin>/s/<token>`); off: "Only members of your organization can open it. A link that was open can keep loading for up to a minute."
- **`GET /s/$token`** — server-rendered static HTML (React `renderToStaticMarkup`, no app bundle): slim header bar (title, "Made with OpenSEO · Updated <relative time>", **Share** button — native share on touch else clipboard "Link copied", **Try OpenSEO** → `https://openseo.so/?utm_source=shared_report`), full-height iframe `src="/s/<token>/raw"` with the same sandbox attribute. `<meta name="robots" content="noindex, nofollow">`, OG tags (`og:type article`, `og:site_name OpenSEO`, `og:title`, `og:description` = first non-empty summary line ≤200 chars, `og:url`, `og:image = /s/<token>/og.png?v=<updatedAt>&domain=<projectDomain>`, twitter card). Light/dark palette via `prefers-color-scheme`. Unknown/revoked → 404 page "This report isn't shared."; archived → "This project has been archived."
- **`GET /s/$token/raw`** — token shape check before DB; any query string → 302 to bare path (cache-key hardening); `Sec-Fetch-Dest` present and ≠ `iframe` → 302 to `/s/<token>` (never top-level on app domain; absent header served); serves HTML with same CSP + `X-Robots-Tag: noindex, nofollow`, `Cache-Control: public, max-age=0, s-maxage=60` (revocation effective within ~60 s). PostHog `report:public_view` with distinctId `share:<sha256(token)[0:16]>`, user agent, `$process_person_profile:false`.
- **`GET /s/$token/og.png`** — `ImageResponse` (satori-style) 1200×630 PNG card: OpenSEO logo + wordmark, title (font 80/64/54 by length), project domain bottom-right, background `#f5f4ef`; errors → 302 `https://openseo.so/social-card.jpg`.
- GDPR erasure re-attributes the user's reports and revokes their share links; project/report deletion cascades.

---

## 15. Projects, Settings & Onboarding UI

### Projects

- **Model**: `projects` (org-scoped; name, domain, default market `location_code` (2840 US) + `language_code` ('en'), `archived_at` soft delete). Project = unit of scoping for keywords, rank tracking, audits, reports, context, SAM, GSC/GA4.
- **Server functions** (`src/serverFunctions/projects.ts`):
  - `getProjects()` → `listProjectsEnsuringOne(orgId)`: active projects ordered `created_at DESC, id DESC`; if zero, `tryCreateDefaultProject` (`name "Default"`, `domain null`, `INSERT … ON CONFLICT DO NOTHING` protected by partial unique index) and re-list.
  - `createProject({name, domain?, locationCode?, languageCode?})` — requires `project:create`; language without location rejected by zod ("A language requires a location."); location alone → language = location's native language; `assertLanguageForLocation` validates pair; creating another `Default`/no-domain → `CONFLICT` 'A project named "Default" with no domain already exists…'.
  - `updateProject({projectId, name, domain?, locationCode?, languageCode?})` — any member; same validation (omitting domain clears it).
  - `setProjectWebsite({projectId, domain, locationCode, languageCode})` — dashboard "Add your website" step.
  - `archiveProject({projectId})` — `project:delete`; cannot archive the only project (`CONFLICT "You can't archive your only project."`).
  - `getArchivedProjects()`, `restoreProject({archivedProjectId})` (param deliberately not `projectId` to bypass archived-404 middleware; Default conflict → CONFLICT message).
  - `getProjectAccess({projectId})` — access check used by project layout redirect.
- **Location/language validation** (`src/shared/keyword-locations.ts`): `isSupportedLocationCode`, `isSupportedLanguageCode`, `getLanguageCode(location)`, `getLanguageOptions(location)`, `isLanguageServedForLocation`; `assertLabsLocationCode` blocks domain analytics for locations only served by Google Ads keyword data ("Domain analytics is not available for this country…").
- **Client**: `ProjectSwitcher` (sidebar), `CreateProjectModal` (Name placeholder "Acme Inc.", Domain, Market fields; on success sets lastProjectId, invalidates `["projects"]`, toast "Project created", navigates to `/p/<id>`), `/projects` page, `ProjectGeneralSettings`, `useProjectMarket(projectId)` (feeds default market to research pages). `lastProjectId` persisted in localStorage (`active-project.ts`), always validated against the org's list.
- **Default project cleanup**: `docs/default-project-cleanup.md` + `scripts/d1-default-project-cleanup.ts` (dedupe legacy multiple Default projects before the partial unique index migration; remaps children, preserves rank history).
- **Dashboard setup checklist** (per project, `dashboardSteps.ts`): `domain` "Add your website" (done when project.domain set), `project` "Working on multiple websites?" (multiple projects), `competitor` "Explore a competitor" (click-through stamp in `project_activation_state`), `mcp` "Connect your AI agent" (org MCP authorized or first tool call; card dismiss → skipped), `gsc` "Connect Search Console" (connection exists), `team` "Invite a teammate" (has teammate). Per-user dismissals in `dashboard_step_dismissals` → status `done|skipped|todo`.
- Seed scripts: `scripts/seed-projects.ts`, `scripts/seed-rank-tracking.ts`.

### Settings

#### App-level `/settings`
- **Personal** tab: Appearance → Theme (System/Light/Dark; stored locally via `useThemePreference`, applied pre-hydration). Hosted: **API keys** manager (see Auth) + **Analytics** toggle (`analyticsOptedOut`). Self-host: About → Version.
- **Organization** tab (hosted): Team management.
- There is **no in-app field for DataForSEO or OpenRouter keys** — they are env vars/secrets. The app detects missing `DATAFORSEO_API_KEY` (`getSeoApiKeyStatus`) and shows the setup modal/banner linking to `/help/dataforseo-api-key`; SAM shows a setup gate linking to `/help/openrouter-api-key` when `OPENROUTER_API_KEY` is missing (self-host). Default SAM model `openai/gpt-5.6-luna` via OpenRouter (override `OPENROUTER_MODEL`).
- Billing is its own page `/billing`.

#### Project settings `/p/$id/settings`
- **General** (`ProjectGeneralSettings`): Name (required, ≤120), Domain (optional, placeholder `example.com`, normalized to bare lowercase host without www/protocol/path; invalid → "Enter a valid domain, like acme.com."), **Market** (`ProjectMarketFields`: Location select (`LocationSelect`, DataForSEO location codes) + Language select (options depend on location; picking a location snaps language to its native language)), helper text; Save → `updateProject` → toast "Project updated". **Danger** section: Archive project (only if >1 project; requires `project:delete`) → toast "Project archived".
- **Integrations**: Search Console connection card (`SearchConsoleConnectionCard`: connect Google → pick verified property via `SitePicker` → saves `gsc_connections`; disconnect/re-point; self-host setup warnings) and Google Analytics card (`GoogleAnalyticsConnectionCard`, `Ga4PropertyPicker`). Requires `integration:manage`. Hosted uses better-auth `genericOAuth` link flow; self-host uses hand-rolled OAuth callbacks `/api/gsc/oauth/callback`, `/api/ga4/oauth/callback` (requires `GOOGLE_CLIENT_ID/SECRET` + `BETTER_AUTH_SECRET` ≥32). Details: integrations fork.
- **Context** moved to `/p/$id/context` (project memory: sections, competitors, key pages, research log).

#### Help pages
`/help/dataforseo-api-key`, `/help/openrouter-api-key`, `/support` (email/Discord/GitHub).

### Onboarding (UI flow)

Hosted only. Triggered by `useOnboardingRedirect()` in `_app` and project layouts: when signed in, email verified (or bypass), `getOnboardingAnswers().completedAt` null, and not already on `/onboarding` → `navigate('/onboarding?step=0', replace)`. `/onboarding` `beforeLoad` redirects to `/` if completed. Step is in the URL (`?step=0..4`, clamped). Invitees skip onboarding (marked completed on accept).

`OnboardingCard` shows "step N of 5"; answers autosave on Next/Skip via `saveOnboardingAnswers(buildOnboardingPayload(answers, step, extra))` (only writes fields of steps ≤ current).

| Step | Title | Input | Persisted |
|---|---|---|---|
| 0 | "What brings you here?" — "Pick up to three things you want to work on." | Multi-select max 3: `AI workflows with Claude or Codex (MCP)` (label "AI Workflows (MCP + Skills)"), `Keyword research`, `Competitor research`, `Backlink analysis`, `Site audits`, `Rank tracking`, `Other` (+free text) | `interested_features` JSON (Other → free text) |
| 1 | "Who are you doing SEO for?" | Single: `My own startup or business` ("My Own Business"), `My clients`, `My employer's website` ("My Company's Website"), `My own side project`, `I'm exploring before choosing a project`, `Other`. Follow-up when "My clients": "About how many client sites do you work on?" `1–3`, `4–10`, `11–25`, `25+` | `work_for`, `client_website_count` |
| 2 | "How did you find OpenSEO?" | Single: Google, X / Twitter, GitHub, Instagram, YouTube, Friend or colleague, AI (Claude, ChatGPT, etc), Product Hunt, Other | `found_via` |
| 3 | "Connect Google Search Console now?" | `SearchConsoleOnboardingStep` for the current project: "Connect with Google" (`startGoogleLink("gsc", returnUrl)`) → property `SitePicker` → connected state; Skip / Back / Next | `gsc_connections` row |
| 4 | "Set up your agent" | Agent list + copy setup prompt panel (`AgentSetupPanel`), Back, "Skip for now" → finish | `mcp_setup_intent` (optional), `completed_at`, `gsc_nudge_dismissed_at` |

Continue enabled when: step0 ≥1 interest, step1 workFor set, step2 source set. Finish → save `{completed:true}` → invalidate `["onboardingAnswers"]` → navigate `/`. PostHog: `onboarding:interests_selected`, `onboarding:step_skipped`, `onboarding:setup_prompt_copy`, `onboarding:completed`.

`dismissGscNudge()` records the one-time GSC re-engagement modal resolution for legacy users (`gsc_nudge_dismissed_at`).

(Historic: an AI "onboarding strategy chat" DO existed (specs 0005/0006) and was removed; `OnboardingChatAgent` class deleted.)

---

## 16. Auth, Organizations & Team

### Auth, Organizations & Team

#### Auth modes (`AUTH_MODE`, `src/lib/auth-mode.ts`)
| Mode | Who | Identity resolution (`resolveUserContextFromHeaders`) | Org |
|---|---|---|---|
| `hosted` | openseo.so SaaS | better-auth session cookie (`getSession`, cookie cache 5 min). Active org = session `activeOrganizationId` validated against `member` row; else re-resolve (last-active → newest membership → create default org) and `setActiveOrganization`. | Real multi-user orgs |
| `cloudflare_access` (**default when unset or invalid**) | Cloudflare self-host | Verify `cf-access-jwt-assertion` JWT with JWKS `${TEAM_DOMAIN}/cdn-cgi/access/certs`, `issuer=TEAM_DOMAIN`, `audience=POLICY_AUD`; `sub`→userId, `email`. Upsert `user` row (emailVerified true). Missing header/config → `AUTH_CONFIG_MISSING` with guidance. | Everyone shares org id `shared-workspace` ("Shared organization"); role `owner`. |
| `local_noauth` | Docker / local / previews | Fixed user `local-admin` / `admin@localhost`. | `delegated-local-admin` org (per-user delegated org `delegated-<userId>`), role `owner`. |

`EnsuredUserContext = { userId, userEmail, emailVerified, organizationId, role, project? }`. Delegated modes: no member rows, implicit owner.

Client-side: `isHostedClientAuthMode()` reads build-time `import.meta.env.AUTH_MODE` (must match runtime). Hosted route guard redirects to `/sign-in` / `/verify-email`; non-hosted renders immediately.

#### better-auth configuration (hosted; also built in self-host solely to mint/refresh Google tokens)
- `baseURL = BETTER_AUTH_URL` (https or http://localhost), `secret = BETTER_AUTH_SECRET` (≥32 chars).
- `emailAndPassword`: enabled, min 8 / max 128, `requireEmailVerification` (unless `BYPASS_EMAIL_VERIFICATION=true`), reset token 1 h, `revokeSessionsOnPasswordReset`.
- `emailVerification`: `sendOnSignUp`, `autoSignInAfterVerification`; emails via **Loops transactional** (`LOOPS_TRANSACTIONAL_VERIFY_EMAIL_ID`, `..._RESET_PASSWORD_ID`, `..._INVITATION_ID`; POST `https://app.loops.so/api/v1/transactional`).
- Social: Google (`GOOGLE_CLIENT_ID/SECRET`), hosted only.
- `genericOAuth` providers `google-search-console` and `google-analytics` (discovery `accounts.google.com/.well-known/openid-configuration`, `accessType offline`, `prompt "select_account consent"`, PKCE); state cookie maxAge 600 s.
- `account.encryptOAuthTokens: true`; `accountLinking.allowDifferentEmails: true` (connect a client's Google account).
- `advanced.ipAddress.ipAddressHeaders: ["cf-connecting-ip"]`.
- Plugins: `organization` (see below), `genericOAuth`, `apiKey` (hosted), `captcha` (Cloudflare Turnstile on `/sign-up/email` when `TURNSTILE_SECRET_KEY` set), `tanstackStartCookies`.
- DB hooks: `user.create.before` rejects disposable-email domains (hosted; curated blocklist ~50 domains: 10minutemail, guerrillamail, mailinator-style, etc.) → "Please sign up with a non-disposable email address."; `user.create.after` upserts Loops contact + records Dub referral lead (reads `dub_id` cookie). `session.create.before` sets `activeOrganizationId` via `resolveSignInHostedOrganization` (last-active → newest membership → **no org if pending invitation exists** → else create default org named `"<name>'s organization"`, slug `<slugified>-<12 hex of userId>`).
- `onAPIError.errorURL = ${baseUrl}/auth-error`; trusted origins = baseUrl (+ `*.open-seo.localhost:1355` in dev).
- Additional user field `analyticsOptedOut` (bool, user-writable).

#### Sign-up / sign-in flow
1. `/sign-up`: Google or email form (+ Turnstile) → verification email → `/verify-email` (resend) → auto sign-in → `/onboarding` (default post-signup redirect).
2. `/sign-in`: email/password or Google; unverified → `/verify-email`.
3. `/forgot-password` → email → `/reset-password?token=…`.
4. Every app visit: guard → onboarding redirect until `completedAt`.

#### Organizations & roles (`src/lib/org-permissions.ts`, spec 0011)
Statements = better-auth defaults + `billing:[manage]`, `project:[create,delete]`, `integration:[manage]`.
- **owner**: all built-ins + billing:manage + project:create/delete + integration:manage.
- **admin**: admin built-ins + project:create/delete + integration:manage (no billing).
- **member**: member built-ins only (defined, not invitable yet).
- `hasOrgPermission(role, perms)` ORs across comma-joined roles; unknown roles fail closed. Server gate `requireOrgPermission(context, perms)` → `FORBIDDEN`.
- Org plugin: `allowUserToCreateOrganization:false` (one workspace per user, created server-side), `disableOrganizationDeletion:true`, `invitationExpiresIn: 7 days`, `invitationLimit: 20` pending per org.
- Hooks: `beforeCreateInvitation` → only role `admin` allowed; `beforeAcceptInvitation` → reject if already member; `beforeUpdateMemberRole` → never grant `owner`; `afterAcceptInvitation` → set `user.lastActiveOrganizationId` and mark onboarding completed + GSC nudge dismissed for that user.
- Org switcher: `switchOrganization({organizationId})` validates membership, `setActiveOrganization`, persists `lastActiveOrganizationId`; client hard-reloads `/`.
- `getOrganizationContext()` → `{organizationId, organizationName, role, organizations[]}` (drives UI gating, `useCanManageBilling`).

#### Team UI (`/settings/organization`, `TeamSettings`)
- `getTeam()` → members + pending, unexpired invitations (only visible to roles with `invitation:create`).
- Members table: Member (email/name), Role (formatted), Status; row menu "Remove member" (confirm; not self; owners removable only by owner) → `authClient.organization.removeMember`.
- Invitations rows: "Resend invitation" (re-calls `sendTeamInvitation`, same link, refreshed expiry), "Cancel invitation" (`cancelInvitation`).
- "Invite teammate" modal (email) → `sendTeamInvitation({email})`: requires `invitation:create`; KV daily budget **50 sends/org/day, 5 sends/address/day**; `createInvitation({role:"admin", resend:true, organizationId})`; sends Loops email with `inviteUrl = ${BETTER_AUTH_URL}/accept-invitation/<id>`, org name, inviter name/email; send failure → `UPSTREAM_UNAVAILABLE` ("invitation saved but email couldn't be sent; use Resend").

#### Workspace merge (cloudflare_access only)
`getWorkspaceMergeStatus()` → `{legacyWorkspaceCount}` (orgs with id `delegated-%`); dashboard `WorkspaceMergeBanner`; `mergeLegacyWorkspaces()` (any user) renames legacy Default projects to `Default (<owner localpart>)`, repoints projects / onboarding answers / GSC / GA4 connections to `shared-workspace`, merges activation timestamps (earliest wins), deletes legacy orgs — atomically via `runBatch`.

#### API keys (hosted)
- `@better-auth/api-key`, prefix `oseo_`, stored display start 9 chars, plugin rate limit disabled; `/mcp` enforces 5000 req/min per user via `MCP_RATE_LIMIT`.
- Settings → Personal → **API keys**: table (Name, Key start `oseo_xxxx…`, Created, Last used, menu "Revoke key" with confirm); "Create API key" modal (name ≤32 chars) → shows key once with instruction `Authorization: Bearer <key>` to `${origin}/mcp`, copy button. PostHog `mcp:api_key_created/revoked`.
- Keys are **user-scoped**: project-scoped MCP tools derive org from the project and re-check membership; one key spans all the user's orgs.

#### MCP OAuth (hosted)
`workers-oauth-provider` wrapping the app: dynamic client registration, authorize → sign-in if needed → `/oauth-consent` → `/api/oauth/consent`; scopes `offline_access mcp`; grant props carry `{userId, organizationId (stamped at consent), …}`; tokens in `OAUTH_KV`; membership re-validated per MCP request. Self-host behind Access requires Access "Managed OAuth".

#### Error codes (`src/shared/error-codes.ts`)
`UNAUTHENTICATED, AUTH_CONFIG_MISSING, PAYMENT_REQUIRED, INSUFFICIENT_CREDITS, FORBIDDEN, NOT_FOUND, AUDIT_CAPACITY_REACHED, AUDIT_PAGE_LIMIT_EXCEEDED, AUDIT_ALREADY_RUNNING, VALIDATION_ERROR, CRAWL_TARGET_BLOCKED, BACKLINKS_BILLING_ISSUE, AI_SEARCH_BILLING_ISSUE, DATAFORSEO_AUTH_FAILED, RATE_LIMITED, UPSTREAM_UNAVAILABLE, CONFLICT, INTERNAL_ERROR`. Non-reported to PostHog: UNAUTHENTICATED, RATE_LIMITED, NOT_FOUND, PAYMENT_REQUIRED, INSUFFICIENT_CREDITS, VALIDATION_ERROR, AUDIT_* , UPSTREAM_UNAVAILABLE. Raw-route HTTP mapping: 401/403/404/400/402, else 500. Validator (zod) failures → `VALIDATION_ERROR`.

Server-function middleware chain: global `[errorHandlingMiddleware, ensureUserMiddleware]` (ensureUser resolves context and, if payload has `projectId`, loads the non-archived project for the org or throws `NOT_FOUND`); per-function `requireAuthenticatedContext` / `requireProjectContext` (adds `projectId`).

#### GDPR
`scripts/erase-user-data.ts` (`pnpm gdpr:erase-user --email`) — Postgres-only, dry run by default, refuses orgs with >1 member; erases DB rows, calls HMAC endpoint to delete KV (audit progress, Dub pins), R2 keys, SAM DOs, audit scratchpads, OAuth grants, terminates active workflows; also Loops, PostHog person, Autumn customer + Stripe customer, Google grants revocation.

---

## 17. Billing & Plans

### Billing & Plans

Hosted only (self-host: no Autumn, everything "paid", pays DataForSEO directly at raw cost). Billing provider: **Autumn** (on Stripe). Autumn customer id = **organizationId**.

#### Plans & features (`src/shared/billing.ts`)
| Constant | Value | Meaning |
|---|---|---|
| `AUTUMN_PAID_PLAN_ID` | `base-plan` | **Base Plan $10/month**, includes $10 (=10,000 credits) usage credits monthly. |
| `AUTUMN_SEO_DATA_TOP_UP_PLAN_ID` | `credit-top-up` | One-time top-up; quantity of `topup_credits`. UI allows **$10–$99**. Never expire; used after monthly. |
| `AUTUMN_PAID_PLAN_FEATURE_ID` | `paid_plan` | Flag gating paid-only features. |
| `AUTUMN_MANAGED_ACCESS_FEATURE_ID` | `managed_service_access` | Granted by the free plan (Autumn default) and base plan; floor for using the service. |
| `AUTUMN_SEO_DATA_BALANCE_FEATURE_ID` | `usage_credits` | Monthly credit pool. |
| `AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID` | `topup_credits` | Rolled-over top-up pool. |
| `AUTUMN_SEO_DATA_CREDITS_PER_USD` | 1000 | 1000 credits = $1. |
| `SEO_DATA_COST_MARKUP` | 1.28 | Hosted markup over DataForSEO/LLM raw cost. |
| `LOW_CREDITS_THRESHOLD_USD` | 0.25 | Low-balance warning. |
| Checkout params | `tax_id_collection.enabled`, `billing_address_collection:"required"`, `customer_update:{name:"auto",address:"auto"}` | Business invoices. |

Free plan = Autumn default product (auto-attached at customer creation) granting `managed_service_access` + some `usage_credits` (amount configured in Autumn, not code).

#### Metering (spec 0002)
- All hosted DataForSEO calls go through `createDataforseoClient(billingCustomer)`: ensure customer (`getOrCreateOrganizationCustomer`, KV-cached 24 h), preflight balance check (`usage_credits + topup_credits > 0` else `INSUFFICIENT_CREDITS`), call DataForSEO, then **track actual provider-reported cost**.
- `trackUsageCreditSpend({costUsd, creditFeature, monthlyRemaining})`: `totalUsd = round5(costUsd × 1.28)`; `credits = ceil(totalUsd × 1000)`; deduct from monthly first (`min(max(monthlyRemaining,0), credits)`), rest from top-up via `autumn.track({featureId, value, properties:{currency, creditFeature, totalCostUsd, totalCostCredits, balanceFeatureId, path…}})`; PostHog `usage:credits_consume`.
- LLM spend (SAM agent) uses the same pool (`creditFeature: "agent"`).
- `checkUsageCreditsDepleted` (chat gate) double-checks a depleted reading against the full customer object before refusing; emits `usage:credits_gate_refused`.
- `applyBillingMarkupUsd(raw)` is used to display cost estimates in hosted UI (raw cost shown in self-host).
- Credit feature mapping from DataForSEO path (`mapDataforseoPathToCreditFeature`): `on_page`→site_audit; `backlinks`→backlinks; `serp/google/maps|local_finder`→local_seo, other `serp`→keyword_research; `ai_optimization/llm_mentions`→ai_citations, other ai_optimization→ai_prompt_responses; `business_data`→local_seo; `keywords_data`→keyword_research; `dataforseo_labs/*/domain_*|ranked_keywords|relevant_pages`→domain_overview, other labs→keyword_research; default site_audit. Labels: Keyword Research, Domain Overview, Backlinks, Site Audit, Rank Tracking, AI Citations, AI Prompt Responses, AI Search, Local SEO, Onboarding (legacy), SAM Agent, else "Other".

#### Plan gates (hosted)
- **Paid plan required**: running rank checks (manual `PAYMENT_REQUIRED` "Upgrade to the paid plan to run rank checks"; scheduled → skip `plan_required`), AI Visibility (Brand Lookup / Prompt Explorer: "Upgrade to the paid plan to use AI Visibility"; UI disables queries on free plan).
- **Site audit tiers** (`AUDIT_LIMITS`): free = max 50 pages/audit (`FREE_MAX_AUDIT_PAGES`), 2,000 capacity units, ≤5 running audits; paid = 10,000 pages, 100,000 units, unlimited running; self_hosted = 10,000 pages, unlimited. Min 10, default 50 pages. No `managed_service_access` → `PAYMENT_REQUIRED "Subscribe to run site audits"`.
- Everything else metered by credits only.
- SAM chat: hosted always enabled (credit gate); self-host requires `OPENROUTER_API_KEY`.

#### `/billing` page
- Loads Autumn customer via `useCustomer()`; plan = `customer.flags.paid_plan ? "paid" : "free"`.
- Card 1: `$<total remaining> remaining` (monthly + top-up, in USD = credits/1000); paid shows "Monthly $X · Top-ups $Y"; out-of-credits error text / low-credits (<$0.25) amber text; "Plan: Free Plan | Base Plan". Owner-only actions: free → Base Plan $10/month bullets ("Access to all OpenSEO features", "Includes $10.00 of Usage Credits each month") + **Upgrade Plan** (`attach({planId:"base-plan", redirectMode:"always", successUrl:/subscribe?checkout=success&redirect=/billing, checkoutSessionParams})`); paid → **Manage subscription** (`openCustomerPortal({returnUrl})`). Non-owners see "Only the organization owner can change the plan or buy credits."
- Card 2 (paid + owner): **Buy credits** number input $10–$99 (default 20) → `attach({planId:"credit-top-up", featureQuantities:[{featureId:"topup_credits", quantity: amount×1000}]})`.
- **Usage chart** (`BillingUsageChart`): Recharts BarChart, `useAggregateEvents({featureId:[usage_credits, topup_credits], range:"30d", binSize:"day"})`, total spend last 30 days, bars in USD, purple `#7c3aed`, "No usage recorded yet".
- **Feature breakdown** (`BillingFeatureBreakdown`): server fn `getBillingUsageEvents({start,end})` pages Autumn `POST https://api.useautumn.com/v1/events.list` (`customer_id`, `custom_range`, `feature_id:[usage_credits, topup_credits]`, limit 1000, offset) → group by `creditFeature` property (or derive from `path`/`paths`) → USD per feature, sorted desc.
- Footer "Billing is powered by Stripe."

#### `/subscribe` page
- Route states (`getSubscribeRouteState`): loading → `redirectToApp` if checkout completed and 30 s finalizing timeout passed; error; `paid` → redirect to `redirect ?? "/"`; `checkout=success` → **finalizing** (poll customer every 2 s, up to 30 s, "Finalizing your subscription…"); has managed access and not upgrade flow → redirect to app; else **paywall**.
- Paywall: greeting ("Welcome to OpenSEO, <first name>!" or "Upgrade your plan"), Base Plan $10/month card with features ["Keyword research, backlinks, rank tracking, and site audits", "MCP server and agent skills for Claude, Cursor, and ChatGPT", "Google Search Console Integration", "Includes $10.00 of Usage Credits each month"], link "How far do usage credits go?" → openseo.so/pricing, Subscribe button (owner) → Autumn attach; non-owners told to ask owner; account menu (email, settings, theme, sign out). PostHog: `billing:paywall_viewed`, `billing:checkout_start`, `billing:checkout_success`.

#### Free plan banner (project layout, hosted)
Out of credits → error banner "You've used all your credits. Upgrade your plan / Buy more credits to continue"; low (<$0.25) → warning. Free → link `/subscribe?upgrade=true`; paid → `/billing`.

#### Webhooks & syncs
- `POST /api/autumn/webhook`: verify Svix signature (`AUTUMN_WEBHOOK_SECRET`); on `billing.updated` with `data.customer_id` → `syncAutumnCustomerStatus` (fetch customer, derive `isPaying = base-plan subscription status === "active"`, upsert `billing_customer_status`, sync Loops contact properties `billingPlanId`/`billingPlanStatus` (or `"none"`) for every org member via `https://app.loops.so/api/v1/contacts/update`), then `trackDubSalesForOrganization`.
- **Dub referrals** (`DUB_API_KEY`): `dub_id` cookie (set by marketing site on `.openseo.so`) → on signup POST Dub lead + KV pin user; pin copied to org on every session; paid invoices → Dub sales (webhook + daily sweep, invoice-id idempotent).
- **Loops**: signup contact upsert (`userGroup:"app-user"`, name parts); transactional verify/reset/invitation emails.

---

## 18. DataForSEO Client, Cost Estimation & Master Endpoint Index

### DataForSEO Client Architecture

#### Transport (`src/server/lib/dataforseo/core.ts`)

- Base URL `https://api.dataforseo.com`; sandbox `https://sandbox.dataforseo.com` (validation-only, free).
- Auth: header `Authorization: Basic ${DATAFORSEO_API_KEY}` — the env var already is `base64("login:password")` (read per call from env/process.env; required). JSON bodies; `Accept: application/json`.
- POST body is always an array of task objects (`[{...}]`); GET used for `task_get`, `locations`, `appendix/user_data`.
- Timeout: shared `AbortSignal.timeout(60_000)` across retries. Timeout/Abort → `AppError("UPSTREAM_UNAVAILABLE", "DataForSEO request timed out on <path>")`, never retried (may already be billed).
- Retries: HTTP 5xx on idempotent reads, `DATAFORSEO_MAX_RETRIES = 2` (3 attempts), linear backoff `250ms × (attempt+1)`. Billed non-idempotent calls (business task_post, Lighthouse) pass `maxServerErrorRetries: 0`.
- HTTP error mapping: optional classifier first; then ≥500 → `UPSTREAM_UNAVAILABLE`, 429 → `RATE_LIMITED`, 401 → `DATAFORSEO_AUTH_FAILED`, else `INTERNAL_ERROR`; response body truncated to 1600 chars in error details.
- `dataforseoPostResponse` returns an unconsumed Response (Lighthouse multi-MB bodies).

#### Envelope (`envelope.ts`)

- Every section fetcher returns `DataforseoApiResponse<T> = { data: T, billing: { path: string[], costUsd: number } }`; billing built from the task's `path` + `cost` (Zod-validated; missing → INTERNAL_ERROR).
- `assertOk(response, {classify?, classifyPath?, treatNoResultsAsEmpty?, okTaskStatusCode? = 20000})`:
  - top-level `status_code !== 20000` → classified error or INTERNAL_ERROR;
  - first task missing → INTERNAL_ERROR;
  - task status ≠ ok: if `treatNoResultsAsEmpty` and message contains "no search results" → return task (empty success, still billed); else classifier; else code = `UPSTREAM_UNAVAILABLE` for provider-side codes `{40101, 40103, 50000, 50301, 50302, 50303, 50304, 50401, 50402}` otherwise `INTERNAL_ERROR`; if the task carries cost → throw `DataforseoChargedTaskError(message, billing, isInvalidField, code)`; "Invalid Field: 'x'" messages are augmented with `(sent x=<value from task.data>)`.
  - in-progress task codes `{20100, 40601, 40602}` (for task_get polling).
- `parseTaskItems(endpoint, task, zodSchema)` validates `result[0].items`; `parseTaskTotalCount` reads `result[0].total_count`.
- Billing classifier (`createDataforseoBillingClassifier`) — used for `/backlinks/` (→ `BACKLINKS_BILLING_ISSUE`) and `/ai_optimization/` (→ `AI_SEARCH_BILLING_ISSUE`): matches status `{40200, 40210, 402}` or text containing any of "insufficient funds", "balance is too low", "payment required", "billing", "balance", "problem billing", "recharged". Message: "The connected DataForSEO account has a billing or balance issue".

#### Metered client (`client.ts`) — the only app entry point

```ts
createDataforseoClient(customer: {organizationId, userEmail, userId, projectId?}) => {
  business: { businessListings, questionsAnswers, myBusinessInfo, reviewsTaskPost, updatesTaskPost },   // default feature local_seo
  backlinks: { summary, rows, referringDomains, domainPages, history },
  keywords: { related, suggestions, ideas, adsIdeas, adsSearchVolume },
  domain:   { rankOverview, rankedKeywords, relevantPages },
  serp:     { live, rankCheck (rank_tracking), rankCheckTaskPost (rank_tracking), local (local_seo) },
  labs:     { keywordOverview (default rank_tracking), serpCompetitors },
  lighthouse: { live },
  aiSearch: { mentionsSearch, aggregatedMetrics, topPages, crossAggregatedMetrics, llmResponse },
}
// Each entry = meter(customer, fetcher, defaultFeature?); callers may pass `creditFeature` in the input to override attribution.
```

`meterDataforseoCall`:
1. If NOT hosted mode (`AUTH_MODE !== "hosted"`, i.e. self-hosted) → execute and return `.data` (no billing at all; user pays DataForSEO directly).
2. Hosted: `getOrCreateOrganizationCustomer` (Autumn customer id = organizationId; existence cached in KV `autumn:customer-ensured:{orgId}` for 24 h).
3. `assertUsageCreditsAvailable` → reads Autumn balances `usage_credits` (monthly; one 300 ms retry if missing; missing again → INTERNAL_ERROR) and `topup_credits` (0 if none). If `monthly + topup <= 0` → `INSUFFICIENT_CREDITS` (UI shows "Go to Billing").
4. Execute. On `DataforseoChargedTaskError`: if invalid-field AND `costUsd <= 0` → throw `VALIDATION_ERROR` (no charge); otherwise charge the billed amount then rethrow.
5. `trackUsageCreditSpend({creditFeature: override ?? mapDataforseoPathToCreditFeature(path), costUsd, monthlyRemaining, properties:{provider:"dataforseo", paths:[path.join("/")], fromCache:false}})`.

`trackUsageCreditSpend` (shared by DataForSEO and agent-LLM spend):
```ts
SEO_DATA_COST_MARKUP = 1.28            // hosted markup (+28%)
AUTUMN_SEO_DATA_CREDITS_PER_USD = 1000 // 1 credit = $0.001
totalCostUsd     = round5(costUsd * 1.28)          // roundUsdForBilling: Math.round(v*1e5)/1e5
totalCostCredits = Math.ceil(totalCostUsd * 1000)
monthlyDeduct = min(max(monthlyRemaining,0), totalCostCredits); topupDeduct = rest
autumn.track({featureId:"usage_credits", value: monthlyDeduct, properties:{currency, creditFeature, totalCostUsd, totalCostCredits, balanceFeatureId, provider, paths, fromCache}})
autumn.track({featureId:"topup_credits", value: topupDeduct, ...})   // retries only on 429 (no idempotency key)
PostHog "usage:credits_consume" {project_id, credit_feature, monthly_credits, topup_credits, total_credits, cost_usd}
```
Other billing constants (`src/shared/billing.ts`): plans `base-plan` (paid, grants monthly `usage_credits`), `credit-top-up`; features `paid_plan`, `managed_service_access` (free default plan + paid), `usage_credits`, `topup_credits`; `LOW_CREDITS_THRESHOLD_USD = 0.25`; `applyBillingMarkupUsd(raw) = round5(raw*1.28)` for displayed estimates (hosted only; self-host shows raw). Autumn SDK retry config: backoff 250 ms→1 s, max elapsed 2.5 s. Billing page usage breakdown reads Autumn `events.list` and groups by `properties.creditFeature` (labels via `creditFeatureLabel`).

`mapDataforseoPathToCreditFeature(path)` (normalizes a missing leading "v3"):
| API module (`path[1]`) | credit feature |
|---|---|
| `on_page` | site_audit |
| `backlinks` | backlinks |
| `serp` | `local_seo` if `google/maps` or `google/local_finder`, else keyword_research |
| `ai_optimization` | `ai_citations` if `llm_mentions/*`, else ai_prompt_responses |
| `business_data` | local_seo |
| `keywords_data` | keyword_research |
| `dataforseo_labs` | domain_overview if endpoint starts with `domain_` or is `ranked_keywords`/`relevant_pages`; else keyword_research |
| other (e.g. lighthouse via on_page) | site_audit |

Credit feature labels: Keyword Research, Domain Overview, Backlinks, Site Audit, Rank Tracking, AI Citations, AI Prompt Responses, AI Search (legacy), Local SEO, Onboarding (legacy), SAM Agent (`agent`); unknown → "Other".

#### Caching

- R2 JSON cache (`src/server/lib/r2-cache.ts`): object key `dataforseo-cache/{prefix}:{sha256(JSON of params with keys sorted)}`; soft TTL via `customMetadata.expiresAt` ISO (expired → miss); values re-validated with Zod on read. `CACHE_TTL.researchResult = 86400`. Namespaces in this area: `kw:research` (24 h, version 3), `serp:analysis` (12 h). Also exported `AI_SEARCH_PROMPT_CACHE_NAMESPACE = "ai-search:prompt-response"` (AI area).
- KV: `serp-locations:{iso}` (30 d), `autumn:customer-ensured:{org}` (24 h).
- DB: `keyword_metrics` acts as the latest-metrics cache per (project, keyword, location, language) with `fetched_at`.
- Client: TanStack Query 24 h for research; tab queries share keys.

#### Keyword data provider routing (spec 0004)

| Feature | Labs country | Google-Ads-only country |
|---|---|---|
| Keyword research (UI + `research_keywords`) | Labs related→suggestions→ideas | `keywords_for_keywords` (single source) |
| `get_keyword_metrics`, saved-keyword refresh, rank-tracking metric refresh | Labs `keyword_overview` | Google Ads `search_volume` |
| SERP analysis, `get_serp_results`, rank tracking | SERP API | SERP API |
| Domain overview / ranked keywords / SERP competitors | Labs | unavailable (pickers restricted to `LABS_LOCATION_OPTIONS`, MCP returns validation error) |

`fetchKeywordMetricsForList(client, {keywords, locationCode, languageCode, creditFeature, includeClickstreamData?, locationName?})`: batches of **700**; Google-Ads country → `search_volume` (with `location_name` if given; keywords missing from Ads get explicit null rows when local); Labs country + `locationName` (city-level) → parallel Ads `search_volume` (local volume/CPC/competition) + Labs `keyword_overview` (national KD/intent) merged; keywords Ads collapsed keep KD/intent but null volume/CPC; plain Labs → `keyword_overview` (prefer clickstream block when present). Output `KeywordMetricRow {keyword, searchVolume, cpc, competition (0-1; Ads competition_index/100), competitionLevel, keywordDifficulty, intent (raw main_intent), monthlySearches}`.

#### Cost reference (from spec 0004; credits = USD × 1.28 × 1000)

| Call | Labs + clickstream | Labs default | Google Ads |
|---|---|---|---|
| research, 150 rows | $0.050 → 64 cr | $0.025 → 32 cr | $0.075 → 96 cr |
| research, 500 rows | $0.120 → 154 cr | $0.060 → 77 cr | $0.075 → 96 cr |
| metrics, 100 kw | $0.020 → 26 cr | same | $0.075 → 96 cr |
| metrics, 700 kw | $0.080 → 103 cr | same | $0.075 → 96 cr |

Labs pricing: $0.01/task + $0.0001/row; clickstream doubles. Google Ads: flat $0.075/request (up to 1,000 keywords for search_volume; 20 seeds for keywords_for_keywords), limited to 12 req/min per account. SERP: each 10 results of depth ≈ one page ≈ 2.5 credits (depth 20 ≈ 5 credits; depth 100 ≈ +20). UI copy states "Costs 2x the credits" for clickstream; no per-search USD estimate is shown on the keyword page (explicit estimates exist in rank tracking — `estimateRankCheckCredits`, live page $0.002 + $0.0015/extra page, queued $0.0006 + $0.00045 — and brand lookup, raw $0.85 + $0.20/competitor; see those sections).

#### Misc

- `fetchUserData()` → `GET /v3/appendix/user_data` (free) — only used by the maintainer script `scripts/dataforseo-account-usage.ts` (balance, spend statistics per day/minute).
- Self-host preflight warns if `DATAFORSEO_API_KEY` is unset or doesn't base64-decode to `login:password`.
- Error codes surfaced to UI: `INSUFFICIENT_CREDITS`, `VALIDATION_ERROR`, `DATAFORSEO_AUTH_FAILED`, `RATE_LIMITED`, `UPSTREAM_UNAVAILABLE`, `BACKLINKS_BILLING_ISSUE`, `AI_SEARCH_BILLING_ISSUE`, `INTERNAL_ERROR` (non-reportable set excludes provider flakes from error tracking).

### Master DataForSEO Endpoint Index (all areas)

Every DataForSEO path referenced in `src/`, `web/src/` and `scripts/` (found by grepping for `/v3/...` strings). Base URL `https://api.dataforseo.com`. All `live` endpoints take `POST` with a JSON **array** of one task object (the `task_post` ones take ≤100 tasks). `task_get`, `locations`, `categories` and `appendix/user_data` are `GET`. Detailed payloads and consumed fields are in the per-area tables referenced in the last column.

| # | Endpoint | Method | Credit feature (hosted metering) | Used by (UI / MCP / other) | Details |
|---|---|---|---|---|---|
| 1 | `/v3/dataforseo_labs/google/related_keywords/live` | POST | keyword_research | Keyword Research (auto step 1, mode "related"); MCP `research_keywords` | §2 |
| 2 | `/v3/dataforseo_labs/google/keyword_suggestions/live` | POST | keyword_research | Keyword Research (auto step 2, mode "suggestions"); MCP `research_keywords`; free tool Keyword Generator | §2, §22 |
| 3 | `/v3/dataforseo_labs/google/keyword_ideas/live` | POST | keyword_research | Keyword Research (auto step 3, mode "ideas"); MCP `research_keywords` | §2 |
| 4 | `/v3/dataforseo_labs/google/keyword_overview/live` | POST | keyword_research, or `rank_tracking` when called for trackers (client default for `labs.keywordOverview` is rank_tracking) | Saved-keyword metrics refresh; rank-tracker metrics refresh; MCP `get_keyword_metrics` | §2, §6 |
| 5 | `/v3/keywords_data/google_ads/keywords_for_keywords/live` | POST | keyword_research | Keyword Research for Google-Ads-only countries | §2 |
| 6 | `/v3/keywords_data/google_ads/search_volume/live` | POST | keyword_research / rank_tracking | Keyword metrics for Ads-only countries and city-level (`location_name`) volume; saved keywords, rank tracking, `get_keyword_metrics` | §2, §6 |
| 7 | `/v3/dataforseo_labs/google/domain_rank_overview/live` | POST | domain_overview | Domain Overview stat cards; MCP `get_domain_overview`; free tools Competitor Analysis, Website Traffic Checker | §3, §22 |
| 8 | `/v3/dataforseo_labs/google/ranked_keywords/live` | POST | domain_overview | Domain Overview Top Keywords tab; MCP `get_ranked_keywords`, `get_domain_keyword_suggestions`; rank-tracker keyword-suggestion step; free tools Competitor Analysis, Competitor Keyword Finder, Website Traffic Checker | §3, §6, §22 |
| 9 | `/v3/dataforseo_labs/google/relevant_pages/live` | POST | domain_overview | Domain Overview Top Pages tab; free tools Competitor Analysis, Website Traffic Checker | §3, §22 |
| 10 | `/v3/dataforseo_labs/google/serp_competitors/live` | POST | keyword_research | MCP `find_serp_competitors` only (no UI) | §3, §11 |
| 11 | `/v3/dataforseo_labs/google/domain_intersection/live` | POST | n/a (web free tool budget) | Free tool Competitor Analysis only | §22 |
| 12 | `/v3/serp/google/organic/live/advanced` | POST | keyword_research (SERP analysis) / rank_tracking (rank checks) | SERP Analysis panel; MCP `get_serp_results`; manual live rank checks + straggler fallback for queued checks | §2, §6 |
| 13 | `https://sandbox.dataforseo.com/v3/serp/google/organic/live/advanced` | POST | free (sandbox) | Validates a local `location_name` when a rank tracker is saved | §2, §6 |
| 14 | `/v3/serp/google/organic/task_post` | POST | rank_tracking | Scheduled rank checks (queue mode, ≤100 tasks per post, `tag` = `<keywordId>:<device>`) | §6 |
| 15 | `/v3/serp/google/organic/task_get/advanced/{id}` | GET | free (not metered) | Collect queued rank-check results | §6 |
| 16 | `/v3/serp/google/locations/{iso2}` | GET | free | Sub-country location picker (local rank tracking); MCP `search_serp_locations`; KV-cached 30 days | §2, §6 |
| 17 | `/v3/serp/google/maps/live/advanced` | POST | local_seo | MCP `get_local_serp_results` (maps), `get_local_rank_grid` | §9 |
| 18 | `/v3/serp/google/local_finder/live/advanced` | POST | local_seo | MCP `get_local_serp_results` (local finder) | §9 |
| 19 | `/v3/backlinks/summary/live` | POST | backlinks | Backlinks overview stats; dashboard backlink snapshot; MCP `get_backlinks_overview`; free tools Backlink Checker, Spam Score Checker | §4, §5, §22 |
| 20 | `/v3/backlinks/history/live` | POST | backlinks | Backlinks trend charts (domain/subdomains scope only; always subdomain-inclusive); MCP `get_backlinks_overview` trends | §4 |
| 21 | `/v3/backlinks/backlinks/live` | POST | backlinks | Backlinks tab, one-per-domain expansion, subfolder overview counts; MCP `get_backlinks_profile`; free tools Backlink Checker, Spam Score Checker | §4, §22 |
| 22 | `/v3/backlinks/referring_domains/live` | POST | backlinks | Referring Domains tab; MCP `get_backlinks_overview` top referring domains | §4 |
| 23 | `/v3/backlinks/domain_pages_summary/live` | POST | backlinks | Backlinks Top Pages tab | §4 |
| 24 | `/v3/on_page/lighthouse/live/json` | POST | site_audit | Site-audit Lighthouse sample (≤10 URLs × mobile + desktop); never retried | §7 |
| 25 | `/v3/ai_optimization/llm_mentions/aggregated_metrics/live` | POST | ai_citations | Brand Lookup totals (per platform) | §8 |
| 26 | `/v3/ai_optimization/llm_mentions/top_pages/live` | POST | ai_citations | Brand Lookup cited pages | §8 |
| 27 | `/v3/ai_optimization/llm_mentions/search/live` | POST | ai_citations | Brand Lookup prompts/questions | §8 |
| 28 | `/v3/ai_optimization/llm_mentions/cross_aggregated_metrics/live` | POST | ai_citations | Brand Lookup Share of Voice (2–10 targets) | §8 |
| 29 | `/v3/ai_optimization/{chat_gpt,claude,gemini,perplexity}/llm_responses/live` | POST | ai_prompt_responses | Prompt Explorer (one call per selected model). Model names validated against a hard-coded allowlist mirroring `/ai_optimization/{model}/llm_responses/models` (invalid names are billed by DataForSEO) | §8 |
| 30 | `/v3/business_data/business_listings/search/live` | POST | local_seo | MCP `search_local_businesses` | §9 |
| 31 | `/v3/business_data/business_listings/categories` | GET | free | MCP `list_business_categories` (rows directly on `result`) | §9 |
| 32 | `/v3/business_data/google/my_business_info/live` | POST | local_seo | MCP `get_business_profile` | §9 |
| 33 | `/v3/business_data/google/questions_and_answers/live` | POST | local_seo | MCP `get_google_business_questions` | §9 |
| 34 | `/v3/business_data/google/reviews/task_post` + `/task_get/{id}` | POST + GET | local_seo | MCP `get_business_reviews` | §9 |
| 35 | `/v3/business_data/google/extended_reviews/task_post` + `/task_get/{id}` | POST + GET | local_seo | MCP `get_business_reviews` (extended, multi-source) | §9 |
| 36 | `/v3/business_data/google/my_business_updates/task_post` + `/task_get/{id}` | POST + GET | local_seo | MCP `get_business_updates` | §9 |
| 37 | `/v3/appendix/user_data` | GET | free | Maintainer script `scripts/dataforseo-account-usage.ts` only | §2 |

Non-DataForSEO external data calls: Ahrefs free DR `GET https://api.ahrefs.com/v3/public/domain-rating-free?target=` (§4), Cloudflare DNS-over-HTTPS for SSRF checks (§7), Google Search Console + GA4 Admin/Data APIs (§10), RDAP for the Domain Age free tool (§22), OpenRouter for Sam (§13).

**Displayed cost estimates** (the only places the UI shows a price before running):
- Rank tracking: `estimateRankCheckCredits` (live page $0.002 + $0.0015 per extra 10-result page; queued $0.0006 + $0.00045), ×1.28 in hosted mode (§6).
- Brand Lookup: raw $0.85 per lookup, +$0.20 with competitors (Share of Voice), ×1.28 in hosted mode (§8).
- Keyword research: only the copy "Costs 2x the credits" next to the clickstream toggle (§2).
- MCP: tool descriptions quote typical credit costs, and `estimate_rank_tracker_cost` returns an estimate (§11).
- Marketing pricing page: per-feature raw costs and two estimator presets (§22).

---

## 19. Database Schema

### Database Schema

Two dialects kept structurally identical (`src/db/*.schema.ts` = SQLite/D1, `src/db/pg/*.schema.ts` = Postgres; `schema-parity.test.ts` enforces same tables/columns/nullability/PKs/unique indexes). 37 tables. Migrations: `drizzle/` (D1, 0000–0047) and `drizzle-pg/` (0000–0025).

**Conventions**
- IDs: `text` UUIDs (`crypto.randomUUID()`) except auto-increment integer PKs on `keyword_metrics`, `rank_snapshots`, `backlink_snapshots` (PG: `serial`).
- App timestamps are **text**. SQLite default `(current_timestamp)` → `YYYY-MM-DD HH:MM:SS`; some newer tables default to ISO `strftime('%Y-%m-%dT%H:%M:%fZ','now')`; app writes `new Date().toISOString()`. PG default `to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` (text, not timestamptz, to keep lexicographic compares). Code normalizes when comparing D1 space-format vs ISO.
- better-auth tables: SQLite `integer(timestamp_ms)`; PG `timestamp with time zone` (`defaultNow()`).
- Booleans: SQLite `integer(mode:boolean)`; PG `boolean`. Big counters in `backlink_snapshots`: PG `bigint(mode:number)`.
- JSON stored as text (`*_json`, `config`, `serp_features`, `monthly_searches`, `interested_features`).
- All project children `ON DELETE CASCADE` from `projects`; projects cascade from `organization`.

#### better-auth (identity)

**user** — `id text PK`; `name text NN`; `email text NN UNIQUE`; `email_verified bool NN default false`; `image text`; `created_at ts NN default now`; `updated_at ts NN default now (onUpdate)`; `analytics_opted_out bool` (additional field, user-writable, default false); `last_active_organization_id text` (not FK; seeds session active org; not user-writable).

**session** — `id PK`; `expires_at ts NN`; `token text NN UNIQUE`; `created_at`, `updated_at ts NN`; `ip_address`, `user_agent text`; `user_id → user.id CASCADE NN`; `active_organization_id text`. Index `session_userId_idx(user_id)`.

**account** — `id PK`; `account_id NN`; `provider_id NN` (`credential`, `google`, `google-search-console`, `google-analytics`); `user_id → user CASCADE NN`; `access_token`, `refresh_token`, `id_token` (OAuth tokens **encrypted at rest**, key from `BETTER_AUTH_SECRET`); `access_token_expires_at`, `refresh_token_expires_at ts`; `scope`; `password` (hashed); `created_at`, `updated_at NN`. Indexes `account_userId_idx(user_id)`, `account_accountId_providerId_idx(account_id, provider_id)`.

**verification** — `id PK`; `identifier NN`; `value NN`; `expires_at NN`; `created_at`, `updated_at NN`. Indexes on `identifier`, `expires_at`.

**organization** — `id PK`; `name NN`; `slug NN UNIQUE` (+ `organization_slug_uidx`); `logo`; `created_at ts NN`; `metadata text`.

**member** — `id PK`; `organization_id → organization CASCADE NN`; `user_id → user CASCADE NN`; `role text NN default 'member'` (comma-joined multi-role possible); `created_at NN`. Indexes on org, user; UNIQUE `(organization_id, user_id)`.

**invitation** — `id PK`; `organization_id → organization CASCADE NN`; `email NN`; `role`; `status NN default 'pending'`; `expires_at NN`; `created_at NN default now`; `inviter_id → user CASCADE NN`. Indexes on org, email.

**apikey** (`@better-auth/api-key`) — `id PK`; `config_id NN default 'default'`; `name`; `start` (first 9 chars stored, e.g. `oseo_abcd`); `prefix`; `key NN` (hash); `reference_id NN` (user id); `refill_interval int`; `refill_amount int`; `last_refill_at ts`; `enabled bool default true`; `rate_limit_enabled bool default true`; `rate_limit_time_window int default 60000`; `rate_limit_max int default 120`; `request_count int default 0`; `remaining int`; `last_request ts`; `expires_at ts`; `created_at`, `updated_at NN`; `permissions`, `metadata text`. Indexes on config_id, reference_id, key.

#### App core

**user_onboarding_answers** — `user_id PK → user CASCADE`; `organization_id → organization CASCADE NN`; `interested_features text NN default '[]'` (JSON array); `work_for`; `client_website_count`; `found_via`; `mcp_setup_intent` (`yes|no`); `completed_at`; `gsc_nudge_dismissed_at`; `created_at`, `updated_at NN default now`. Index `(organization_id)`.

**projects** — `id PK`; `organization_id → organization CASCADE NN`; `name NN`; `domain` (normalized bare host); `location_code int NN default 2840` (US); `language_code NN default 'en'`; `created_at NN default now`; `archived_at` (soft delete). Partial UNIQUE `projects_one_default_per_organization_idx(organization_id) WHERE name='Default' AND domain IS NULL AND archived_at IS NULL`; index `(organization_id)`.

**saved_keywords** — `id PK`; `project_id → projects CASCADE NN`; `keyword NN`; `location_code int NN default 2840`; `language_code NN default 'en'`; `created_at NN`. UNIQUE `(project_id, keyword, location_code, language_code)`; index `(project_id, created_at)`.

**saved_keyword_tags** — `id PK`; `project_id → projects CASCADE NN`; `name NN`; `normalized_name NN`; `color` (palette key e.g. `blue`, `rose`; null = derived from id); `created_at NN`. UNIQUE `(project_id, normalized_name)`; index `(project_id, name)`.

**saved_keyword_tag_assignments** — `saved_keyword_id → saved_keywords CASCADE NN`; `tag_id → saved_keyword_tags CASCADE NN`; `created_at NN`. UNIQUE `(saved_keyword_id, tag_id)`; index `(tag_id)`. (No PK column.)

**keyword_metrics** (latest cached metrics per project keyword) — `id int PK autoinc`; `project_id → projects CASCADE NN`; `keyword NN`; `location_code int NN`; `language_code NN default 'en'`; `search_volume int`; `cpc real`; `competition real`; `keyword_difficulty int`; `intent text`; `monthly_searches text` (JSON); `fetched_at NN default now`. UNIQUE `(project_id, keyword, location_code, language_code)`; index `(project_id, keyword, location_code, language_code, fetched_at)`.

#### Rank tracking

**rank_tracking_configs** — `id PK`; `project_id → projects CASCADE NN`; `domain NN`; `location_code int NN default 2840`; `language_code NN default 'en'`; `devices enum('both','desktop','mobile') NN default 'both'`; `serp_depth int NN`; `schedule_interval enum('daily','weekly','monthly','manual') NN default 'weekly'`; `location_name` (local/city targeting; null = national); `is_active bool NN default true`; `last_checked_at`; `next_check_at`; `last_skip_reason` (`no_keywords`, `plan_required`, …); `created_at NN`. Index `(project_id, is_active, created_at)`; partial UNIQUE `rank_tracking_configs_national_idx(project_id, domain, location_code) WHERE location_name IS NULL`; partial UNIQUE `rank_tracking_configs_local_idx(project_id, domain, location_code, location_name) WHERE location_name IS NOT NULL`.

**rank_tracking_keywords** — `id PK`; `config_id → rank_tracking_configs CASCADE NN`; `keyword NN` (lowercased unless match_case); `match_case bool NN default false`; `search_volume int`; `keyword_difficulty int`; `cpc real`; `metrics_fetched_at`; `created_at NN`. UNIQUE `(config_id, keyword)`.

**rank_check_runs** — `id PK`; `config_id → configs CASCADE NN`; `project_id → projects CASCADE NN`; `status enum('pending','running','completed','failed') NN default 'pending'`; `keywords_total int NN 0`; `keywords_checked int NN 0`; `is_subset_run bool NN false`; `error_message`; `started_at NN default now`; `completed_at`. Indexes `(config_id, started_at)`, `(project_id, started_at)`; partial UNIQUE `rank_check_runs_one_active_per_config_idx(config_id) WHERE status IN ('pending','running')` (DB-level single in-flight run per config).

**rank_snapshots** — `id int PK autoinc`; `run_id → rank_check_runs CASCADE NN`; `tracking_keyword_id text NN` (intentionally **no FK** — history survives keyword deletion); `keyword NN`; `device enum('desktop','mobile') NN`; `position int` (null = not found within depth); `url`; `serp_features text` (JSON array); `checked_at NN default now`. Index `(tracking_keyword_id, device, checked_at)`; UNIQUE `(run_id, tracking_keyword_id, device)`.

#### Dashboard / activation

**organization_activation_state** — `organization_id PK → organization CASCADE`; `first_mcp_authorized_at`; `first_mcp_tool_call_at`; `updated_at NN`. (First-occurrence stamps, never move.)

**project_activation_state** — `project_id PK → projects CASCADE`; `competitor_step_clicked_at`; `mcp_card_dismissed_at`; `ga4_card_dismissed_at`; `updated_at NN`.

**dashboard_step_dismissals** — `user_id → user CASCADE NN`; `project_id → projects CASCADE NN`; `step text NN` (`domain|project|competitor|mcp|gsc|team`). PK `(user_id, project_id, step)`; index `(project_id)`.

**backlink_snapshots** — `id int PK autoinc`; `project_id → projects CASCADE NN`; `domain NN`; `rank int`; `backlinks`, `referring_domains`, `broken_backlinks`, `new_backlinks`, `lost_backlinks`, `new_referring_domains`, `lost_referring_domains` (int / PG bigint); `captured_at NN default now`. Index `(project_id, captured_at)`. Written by dashboard visit-triggered refresh.

#### Project context (memory)

**project_context_sections** — `project_id → projects CASCADE NN`; `key NN` (`business_overview|current_goal|positioning|writing_preferences` or `custom:<slug>`); `title` (for custom); `content NN`; `updated_at NN`; `updated_by enum('user','sam','mcp') NN`. PK `(project_id, key)`.

**project_competitors** — `id PK`; `project_id → projects CASCADE NN`; `domain NN` (normalized bare host); `name`; `notes`; `updated_at NN`; `updated_by enum NN`. UNIQUE `(project_id, domain)`.

**project_key_pages** — `id PK`; `project_id → projects CASCADE NN`; `url NN`; `role enum('hub','spoke','money','other') NN`; `topic`; `notes`; `updated_at NN`; `updated_by enum NN`. UNIQUE `(project_id, url)`.

**project_research_log** — `id PK`; `project_id → projects CASCADE NN`; `entry_date NN` (server-stamped day); `summary NN`; `created_by enum('user','sam','mcp') NN`; `created_at NN default ISO now`. Index `(project_id, entry_date)`. Pruned to 90 days on append.

#### Reports

**reports** — `id PK`; `project_id → projects CASCADE NN`; `title NN`; `summary NN` (markdown, capped); `html NN` (self-contained doc, capped by `REPORT_MAX_HTML_BYTES`, < 2 MB); `skill` (slug, e.g. `seo-audit`); `template_id` (no FK); `created_by NN` (client label: "Claude Code", "Codex", "SAM", "API key"…); `created_by_user_id NN` (no FK); `size_bytes int NN`; `share_token` (192-bit base64url; null = not shared); `shared_at`; `created_at`, `updated_at NN default ISO now`. Index `reports_project_updated_idx(project_id, updated_at, id, size_bytes)`; UNIQUE `(share_token)`.

**report_templates** — `id PK`; `project_id → projects CASCADE NN`; `name NN`; `description NN`; `instructions NN` (markdown); `created_by NN`; `created_by_user_id NN`; `created_at`, `updated_at NN default ISO now`. UNIQUE `(project_id, name)` (service also checks case-insensitively).

#### Site audit

**audits** — `id PK`; `project_id → projects CASCADE NN`; `started_by_user_id NN` (no FK); `start_url NN`; `status enum('running','completed','failed') NN default 'running'`; `workflow_instance_id`; `config text NN default '{}'` (JSON `{maxPages, lighthouseStrategy}`); `pages_crawled`, `pages_total`, `lighthouse_total`, `lighthouse_completed`, `lighthouse_failed` int NN 0; `current_phase default 'discovery'`; `error_code` (closed vocabulary, e.g. `instance_lost`, `unknown`); `error_detail`; `failed_phase`; `started_at NN`; `completed_at`. Indexes `(project_id)`, `(started_by_user_id)`.

**audit_pages** — `id PK`; `audit_id → audits CASCADE NN`; `url NN`; `status_code int`; `redirect_url`; `title`; `meta_description`; `canonical_url`; `robots_meta`; `og_title`, `og_description`, `og_image`; `h1_count..h6_count int NN 0`; `heading_order_json`; `word_count int NN 0`; `images_total`, `images_missing_alt int NN 0`; `images_json`; `internal_link_count`, `external_link_count int NN 0`; `has_structured_data bool NN false`; `hreflang_tags_json`; `is_indexable bool NN true`; `x_robots_tag`; `header_canonical_url`; `crawl_depth int` (null = sitemap-seeded); `in_sitemap bool NN false`; `content_hash` (SHA-256 of visible text); `fetch_class enum(PAGE_FETCH_CLASSES) NN default 'ok'`; `response_time_ms int`. Index `(audit_id, url)`. (Link edges live only in the per-audit Durable Object.)

**audit_issues** — `id PK`; `audit_id → audits CASCADE NN`; `page_id → audit_pages CASCADE` (nullable); `page_url NN`; `issue_type NN`; `severity enum('critical','warning','info') NN default 'info'`; `details_json`. Indexes `(audit_id, issue_type)`, `(page_id)`.

**audit_lighthouse_results** — `id PK`; `audit_id → audits CASCADE NN`; `page_id → audit_pages CASCADE NN`; `strategy enum('mobile','desktop') NN`; `performance_score`, `accessibility_score`, `best_practices_score`, `seo_score int`; `lcp_ms`, `cls`, `inp_ms`, `ttfb_ms real`; `error_message`; `r2_key` (full payload in R2); `payload_size_bytes int`. Indexes on `audit_id`, `page_id`.

#### SAM (in-app agent)

**sam_sessions** — `id PK` (= Durable Object name); `project_id → projects CASCADE NN`; `user_id → user CASCADE NN`; `title NN default 'New chat'`; `created_at`, `updated_at NN`; `archived_at`. Index `(project_id, updated_at)`. Messages live in the `SamChatAgent` DO SQLite.

#### Integrations

**gsc_connections** — `id PK`; `project_id → projects CASCADE NN`; `organization_id → organization CASCADE NN`; `site_url NN` (verbatim `sc-domain:example.com` or `https://example.com/`); `connected_by_user_id NN` (whose Google grant to use); `gsc_account_id`; `connected_account_email`; `created_at`, `updated_at NN`. UNIQUE `(project_id)` (one property per project); index `(organization_id)`. Tokens live in `account` (provider `google-search-console`).

**ga4_connections** — `id PK`; `project_id → projects CASCADE NN`; `organization_id → organization CASCADE NN`; `property_id NN` (`properties/123456`); `property_display_name NN`; `property_time_zone NN`; `property_currency_code NN`; `connected_by_user_id NN`; `ga4_account_id NN`; `connected_account_email`; `created_at`, `updated_at NN`. UNIQUE `(project_id)`; indexes `(organization_id)`, `(connected_by_user_id, ga4_account_id)`. Tokens in `account` (provider `google-analytics`).

#### Billing / telemetry

**billing_customer_status** — `organization_id PK → organization CASCADE`; `is_paying bool NN false`; `paid_plan_id`; `paid_plan_status`; `customer_json text NN` (full Autumn customer payload); `synced_at NN`; `created_at`, `updated_at NN`.

**telemetry_state** (self-host heartbeat singleton) — `id int PK default 1`; `install_id NN`; `installed_at ts`; `last_heartbeat_at ts`; `last_version`; `mcp_tool_call_count int NN 0` (SQLite timestamps `integer timestamp_ms`, PG `timestamptz`).

#### Non-SQL storage
- **KV `KV`** keys: `audit-progress:<auditId>` (live crawl feed, ≤300 entries, TTL 30 min), `autumn:customer-ensured:<orgId>` (24 h), `invite-sends:<org>:<YYYY-MM-DD>` and `invite-sends:<org>:<email>:<day>` (24 h counters), `dub:referred-user:<userId>` (90 d), `dub:referred-org:<orgId>` (400 d), `dub:sale:*`, SERP location lists per ISO country (30 d TTL, 24 h edge cacheTtl, ~1.5 MB), Ahrefs DR cache per domain (24 h).
- **KV `OAUTH_KV`**: MCP OAuth grants/tokens/client registrations (hosted only), GC'd daily.
- **R2 `R2`**: `dataforseo-cache/<prefix>:<sha256(sorted params)>` JSON cache with soft TTL in `customMetadata.expiresAt` (keyword research 24 h, SERP 12 h, brand lookup, prompt responses) + bucket lifecycle rule deleting `dataforseo-cache/` after 7 days; Lighthouse full payloads (`audit_lighthouse_results.r2_key`).
- **Durable Objects**: `SamChatAgent` (SQLite, chat transcripts), `AuditScratchpad` (SQLite per audit: frontier, link edges, slim page mirror; destroyed at finalize; 7-day self-cleanup alarm).

---

## 20. Background Jobs, Cron, Queues & Workflows

### Background Jobs, Cron, Queues & Workflows

No queues are used. Background work = **Cloudflare Cron Triggers + Cloudflare Workflows + Durable Objects + `ctx.waitUntil`**.

#### Workers
- **`open-seo`** (app worker, `src/server.ts`): all HTTP, cron `scheduled` handler, `RankCheckWorkflow` class, `SamChatAgent` DO. Smart placement for fetch. Bindings: `DB` (D1), `KV`, `OAUTH_KV`, `R2`, `HYPERDRIVE` (PG, prod), `SITE_AUDIT_WORKFLOW` (cross-script → audit worker), `RANK_CHECK_WORKFLOW`, `SAM_CHAT` DO, `AUDIT_ENGINE` service binding, `MCP_RATE_LIMIT` (rate-limit binding, 5000 req / 60 s, hosted prod).
- **`open-seo-audit`** (`src/audit-worker.ts`, `wrangler.audit.jsonc`): isolated because Lighthouse payloads/HTML batches OOMed the app worker. Hosts `SiteAuditWorkflow` + `AuditScratchpad` DO. Default export `AuditEngine extends WorkerEntrypoint` with RPC `destroyScratchpad(auditId)` (used by audit delete/cancel and GDPR). `fetch` → 404. Gets only `DB/KV/R2/DATAFORSEO_API_KEY/AUTUMN_SECRET_KEY/POSTHOG_*` (no auth secrets). CPU limit 300,000 ms on paid plans (both workers).

#### Cron triggers (`wrangler.jsonc` → `triggers.crons`)
| Cron | Handler | Work |
|---|---|---|
| `*/5 * * * *` | `scheduled()` default branch | 1) **Stale-audit watchdog** `reconcileStaleAudits()`: audits `status='running'` started > 15 min ago (oldest first, batch 100) → read Workflow instance status; `errored`/`terminated` → `failAudit` with classified error; instance not found and audit > 10 min old → `errorCode:"instance_lost"`; emits PostHog `site_audit:complete {status:failed, reconciled_by:watchdog}`. Errors held and rethrown after step 2. 2) **Scheduled rank checks** `runScheduledRankChecks(env)`. |
| `17 3 * * *` | `scheduled()` `MCP_OAUTH_PURGE_CRON` branch (hosted only) | `openSeoOAuthProvider.purgeExpiredData(env,{batchSize:200})` on `OAUTH_KV`; then `sweepDubReferredOrganizations()` (Dub referral sales for paid Autumn invoices of referred orgs, last 45 days). |

**Scheduled rank-check algorithm** (`scheduledRankChecks.ts`):
- `dueConfigs = getDueConfigsWithOrganization(nowIso)` (active, non-manual, `next_check_at <= now`, ordered `next_check_at ASC`).
- Budget: `SCHEDULED_TASK_UNIT_BUDGET = 1000` task units per tick where units = keywords × devices(1 or 2); first start always admitted; stop when projected over budget. Wall-clock guard 3 min (`TICK_DEADLINE_MS`).
- Per config: `nextCheckAt = computeNextCheckAt(interval, observedNextCheckAt)` (anchored to previous slot).
  - 0 keywords → CAS-claim with `last_skip_reason='no_keywords'`.
  - Hosted: `customerHasPaidPlan(orgId, {retryDenied:true})` memoized per org per tick; plan-check error → leave due (no write); not paid → claim with `last_skip_reason='plan_required'`. Self-host: always treated as paid.
  - Claim slot (CAS on observed `next_check_at`, clears `last_skip_reason`), then `beginRankCheckRun({workflow: env.RANK_CHECK_WORKFLOW, trigger:"scheduled", billingCustomer:{userId:"system", userEmail:"system@openseo.so", organizationId, projectId}})`.
  - Already-running run (unique partial index) → restore previous `next_check_at` (retry next tick).
- Logs structured summary `rank_tracking_scheduler_summary` (candidates, started, unitsStarted, budget, skips, errors, oldestDueAgeMs).

#### Cloudflare Workflows
- **`RankCheckWorkflow`** (`src/server/workflows/RankCheckWorkflow.ts`, binding `RANK_CHECK_WORKFLOW`). Params: `runId, configId, billingCustomer, projectId, domain, locationCode, languageCode, locationName?, devices, serpDepth, trigger('manual'|'scheduled'), keywordIds? (subset run), maxCostCredits?`. Steps: `check-active` (fail run if config archived), `prepare` (cost estimate vs `maxCostCredits` approval, balance check), then live path or **queued path** (DataForSEO task_post then `step.sleep` polling rounds `4m,2m,2m,2m,2m,3m` with capped task_gets per round, falling back to live for stragglers). Metered steps use `retries.limit 0` (never re-pay); collect steps `retries 2 / 10 s, timeout 5 min`. Started manually (UI/MCP) or by cron. (Details: rank-tracking fork.)
- **`SiteAuditWorkflow`** (`src/server/workflows/SiteAuditWorkflow.ts`, lives in audit worker). Params `auditId, billingCustomer, projectId, startUrl, config`. Steps: `validate-context` → `runAuditPhases` (discovery → crawl chunks → multipage checks → Lighthouse sample fetch/persist → finalize) → on error `mark-failed`. Step configs (`auditStepConfigs.ts`): DISCOVERY retries 2 / 5 s exp / 4 min; CRAWL_CHUNK retries 1 / 10 s / 5 min; LIGHTHOUSE_FETCH retries 0 / 5 min (paid call); LIGHTHOUSE_PERSIST retries 3 / 5 s exp / 5 min; DB_STEP retries 3 / 5 s exp / 2 min; MULTIPAGE_CHECKS retries 2 / 5 min. Started from `AuditService.startAudit` via `env.SITE_AUDIT_WORKFLOW.create()`. Also lazily reconciled when UI polls a running audit.
- `pgStep(step, name, config, fn)` wraps each `step.do` in `withPgClient` (per-invocation PG client; ALS doesn't cross steps).

#### Durable Objects
- `SamChatAgent` (Agents SDK `AIChatAgent`, SQLite), routed at `/agents/*` by `routeAgentRequest` with `onBeforeConnect/onBeforeRequest` auth.
- `AuditScratchpad` (audit worker; per-audit frontier/link graph; alarm-based 7-day self-destruct).
- Migrations tags: v1 `OnboardingChatAgent` (later deleted v5), v2 `SamChatAgent`, v3/v4 AuditScratchpad moved to audit worker.

#### Other async work
- `ctx.waitUntil(maybeSendSelfHostHeartbeat(pathname))` on every request (self-host telemetry; 5-min cadence first 2 h after install, then daily; skipped for `/api/health`; opt-out `OPENSEO_TELEMETRY_DISABLED=1` or `DO_NOT_TRACK=1`). Heartbeat payload: counts of users, projects, site audits, rank keywords, saved keywords, gscConnected, samChatUsed, deployTarget (cloudflare|docker), dbBackend, version, mcpToolCalls, failing setup checks.
- Error capture to PostHog via `waitUntil` in server-function error middleware.
- Visit-triggered refreshes (dashboard backlink snapshot) rather than cron.
- Audit live progress via KV feed; UI polling (rank run polling, audit status polling).

#### Self-hosted / Docker equivalents
- Docker image runs `vite preview` with `@cloudflare/vite-plugin` → **workerd/miniflare locally** with both workers (`auxiliaryWorkers: wrangler.audit.jsonc`), local D1 (SQLite files under `.wrangler/`, persisted in `open_seo_data` volume), local KV/R2, local Workflows and DOs. So Workflows/DOs behave the same as on Cloudflare.
- Cron: the repo has no separate scheduler for Docker; `scheduled()` exists but miniflare does not auto-fire crons in `vite preview` (manual trigger possible via Cloudflare's `/cdn-cgi/handler/scheduled` dev endpoint). A Next.js port needs an explicit scheduler (e.g. Vercel Cron / node-cron / BullMQ) for the 5-min and daily jobs.
- Cloudflare self-host (`pnpm deploy:selfhost`, Alchemy stage `selfhost`) runs real crons/Workflows on the free plan (no CPU-limit override).
- Postgres mode (`DATABASE_PROVIDER=postgres`) only via Hyperdrive; every entrypoint (fetch, scheduled, each workflow step, DO) wraps DB work in `withPgClient()` (per-request `postgres` client `max:1`, `connect_timeout:10`, query retries).

#### Retries summary
- Autumn SDK: backoff 250 ms→1 s, max 2.5 s total on 429/5xx; `track()` retries only 429 (no idempotency key) up to 8 s.
- Autumn events.list: 3 retries on 429 honoring `Retry-After` (cap 5 s).
- Svix/Autumn webhook: non-2xx → Svix retries; handler idempotent (re-sync).
- Workflow step retry budgets as above; rank scheduler relies on "leave due" for retry.

---

## 21. Environment Variables & Deployment Modes

### Environment Variables & Deployment Modes

#### Deployment modes
| Mode | How | Auth | DB | Notes |
|---|---|---|---|---|
| Hosted SaaS (openseo.so) | Alchemy stage `hosted-prod` (`pnpm deploy:postgres`), domains `app.openseo.so`, `www.app.openseo.so` | `hosted` | Postgres (PlanetScale) via Hyperdrive (caching disabled) | Autumn billing, Loops, Turnstile, Dub, PostHog, MCP OAuth, rate-limit binding |
| Cloudflare self-host | Alchemy stage `selfhost` (`pnpm deploy:selfhost`) | `cloudflare_access` (Access app auto-provisioned from `ACCESS_ALLOWED_EMAILS`, or bring your own `TEAM_DOMAIN`+`POLICY_AUD`) | D1 (Postgres not available to self-hosters) | Works on CF free plan; shared workspace |
| Previews | Alchemy stage `<name>` (`pnpm deploy:preview --stage`) behind shared Access wildcard `open-seo-*.<WORKERS_SUBDOMAIN>` | `local_noauth` (or hosted for signup testing) | D1 | |
| Docker | `compose.yaml`, image `ghcr.io/every-app/open-seo:latest`, entrypoint: preflight → `wrangler d1 migrations apply --local` → conditional `vite build` (fingerprint of build-time env) → `vite preview --host 0.0.0.0 --port $PORT` | forced `local_noauth` (admin@localhost) | Local D1 (SQLite in volume `/app/.wrangler`) | Bind `127.0.0.1:${PORT:-3001}`; HEALTHCHECK `/api/health` (start period 300 s) |
| Local dev | `pnpm dev` (vite + CF plugin), `.env.local` | usually `local_noauth` | local D1 (optional local PG `localhost:5433` via Hyperdrive localConnectionString) | portless `open-seo.localhost:1355` |

Resources per stage: D1 `open-seo-db-<stage>`, R2 `open-seo-r2-<stage>` (7-day lifecycle on `dataforseo-cache/`), KV `open-seo-kv-<stage>`, `open-seo-oauth-kv-<stage>`, Workflows `site-audit-workflow-<stage>`, `rank-check-workflow-<stage>`, workers `open-seo-<stage>` and `open-seo-<stage>-audit`.

#### Environment variables
| Var | Purpose / where |
|---|---|
| `DATAFORSEO_API_KEY` | **Required.** Base64 of `login:password` (DataForSEO Basic auth). Both workers. |
| `AUTH_MODE` | `hosted` \| `cloudflare_access` (default) \| `local_noauth`. Also inlined into client build (envPrefix). |
| `DATABASE_PROVIDER` | `d1` (default) \| `postgres` (requires `HYPERDRIVE` binding). |
| `BETTER_AUTH_URL` | Hosted base URL (https or localhost). Also allowed Vite host. |
| `BETTER_AUTH_SECRET` | ≥32 chars; session signing + OAuth token encryption; required hosted and for self-host GSC/GA4. |
| `BYPASS_EMAIL_VERIFICATION` | `true` skips verification (dev/previews); client-inlined. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google social login (hosted) + GSC/GA4 OAuth (all modes). |
| `TEAM_DOMAIN`, `POLICY_AUD` | Cloudflare Access JWT validation (`cloudflare_access`). |
| `ACCESS_ALLOWED_EMAILS` | Alchemy deploy input: emails allowed through auto-provisioned Access app. |
| `WORKERS_SUBDOMAIN` | Alchemy: account workers.dev subdomain (preview URLs / BETTER_AUTH_URL derivation). |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | SAM agent LLM (OpenRouter); default model `openai/gpt-5.6-luna`. |
| `AUTUMN_SECRET_KEY`, `AUTUMN_WEBHOOK_SECRET` | Billing API + Svix webhook verification (hosted). |
| `LOOPS_API_KEY`, `LOOPS_TRANSACTIONAL_VERIFY_EMAIL_ID`, `LOOPS_TRANSACTIONAL_RESET_PASSWORD_ID`, `LOOPS_TRANSACTIONAL_INVITATION_ID` | Transactional email + contact sync (hosted; verify/reset required unless bypass). |
| `TURNSTILE_SITE_KEY` (client-inlined), `TURNSTILE_SECRET_KEY` | Signup captcha (hosted). Site key without secret fails hosted config check. |
| `POSTHOG_PUBLIC_KEY`, `POSTHOG_HOST` | Product analytics (client-inlined). |
| `DUB_API_KEY` | Referral lead/sale tracking (hosted). |
| `GDPR_ERASURE_SECRET` | HMAC for internal erasure endpoint. |
| `OPENSEO_TELEMETRY_DISABLED` / `DO_NOT_TRACK` | Disable self-host heartbeat (hard-coded PostHog key `phc_xaXj…`, host us.i.posthog.com). |
| `HYPERDRIVE_ORIGIN_HOST/PORT/DATABASE/USER/PASSWORD` | Alchemy prod Hyperdrive origin creds. |
| `PORT` (3001), `ALLOWED_HOST`, `OPEN_SEO_IMAGE`, `CLOUDFLARE_INCLUDE_PROCESS_ENV=true`, `VITE_SHOW_DEVTOOLS` | Docker/local runtime knobs. |
| `POSTHOG_SOURCEMAPS` | CI sourcemap build (`dist-sourcemaps`). |
| Scripts only | `POSTGRES_DATABASE_URL`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_D1_DATABASE_ID`, `POSTHOG_API_HOST/PROJECT_ID/PERSONAL_API_KEY` (migration + GDPR scripts). |

Bindings (not env strings): `DB`, `KV`, `OAUTH_KV`, `R2`, `HYPERDRIVE`, `SAM_CHAT`, `AUDIT_SCRATCHPAD`, `AUDIT_ENGINE`, `SITE_AUDIT_WORKFLOW`, `RANK_CHECK_WORKFLOW`, `MCP_RATE_LIMIT`.

Env resolution: `getOptionalEnvValue(name)` reads `process.env` first (local `.env.local`), then the Workers `env`. Hosted config completeness (`hasHostedAuthConfig`) = base URL + secret + Google creds + Turnstile consistency + (bypass or Loops verify/reset config).

Self-host preflight (`scripts/selfhost-preflight.ts` / `/api/health`) checks: `auth` (mode valid; Access vars present & TEAM_DOMAIN valid), `dataforseo` (set/valid shape), `gsc` (Google creds + BETTER_AUTH_SECRET ≥32 else "Search Console stays DISABLED"), `ai` (OPENROUTER key → SAM on/off), `runtime` (ALLOWED_HOST), `database` (count query).

D1 → Postgres migration: `scripts/migrate-d1-to-postgres.ts` + `runbooks/d1-to-postgres-{simple,detailed}.md` (copies data, rewrites D1 space timestamps to ISO, rollback = flip provider back).

#### Re-implementation notes for Next.js
- Replace Workers bindings: D1/PG → Postgres (Drizzle schema above as-is); KV → Redis/Upstash; R2 → S3; Workflows → durable job runner (Inngest/Trigger.dev/BullMQ) honoring the step retry budgets (never retry paid DataForSEO steps); DOs → Postgres tables for audit scratch state + chat transcripts; cron → Vercel Cron/scheduler for `*/5` (audit watchdog + rank scheduler) and daily (OAuth token GC + referral sweep).
- Keep the per-request auth context contract (`userId, userEmail, emailVerified, organizationId, role, project`) and "projectId in every project-scoped payload" rule.

---

## 22. Marketing Website & Free Tools

### Marketing Website (web/)

Separate TanStack Start app `open-seo-landing` deployed as Cloudflare Worker on `openseo.so` / `www.openseo.so` (fumadocs for docs/blog, Tailwind v4). Entry `web/src/worker.ts` exports the handler + `FreeToolBudget` Durable Object. Analytics: Plausible proxied first-party (`/js/script.js` → plausible script with fallback stub; `/api/event` → `https://plausible.io/api/event`, cookies stripped). Sitemap generated at build (`scripts/generate-sitemap.js`).

#### Routes
| Route | Purpose |
|---|---|
| `/` | Landing page (`landing-page.tsx`): hero, testimonials, "See OpenSEO in action", "Get superpowers with the MCP" (agent icons), comparison table, Product Hunt laurel, "100% open source", newsletter signup, footer |
| `/features` | Features hub |
| `/features/keyword-research` | "Keyword research tool for practical SEO planning" (Research seed topics / Inspect the real SERP / Save and organize) |
| `/features/site-audit` | "SEO audit tool for finding technical issues fast" |
| `/features/backlink-checker` | "Backlink checker for understanding a domain's link profile" (`/features/backlinks` 301 → here) |
| `/features/domain-overview` | "Domain overview: traffic, keywords, and pages for any domain" |
| `/features/rank-tracking` | "Rank tracker for monitoring keyword positions" |
| `/features/saved-keywords` | "Saved keywords for turning SEO research into a plan" |
| `/features/ai-brand-visibility` | "Brand lookup for ChatGPT and Google AI Overview visibility" |
| `/features/ai-search-prompts` | Prompt Explorer feature page |
| `/features/mcp` | MCP feature page (tools: research keywords, SERP results, save keywords, rank tracker, domain overview…) |
| `/tools` | Free SEO tools hub (registry order) |
| `/backlink-checker`, `/competitor-keyword-finder`, `/keyword-generator`, `/website-traffic-checker`, `/competitor-analysis`, `/spam-score-checker`, `/domain-age-checker`, `/serp-simulator` | Free tools (see below) |
| `/pricing` | Pricing + usage estimator |
| `/roadmap` | Roadmap (markdown) |
| `/about`, `/why-openseo`, `/open-source-seo` | Marketing MDX pages |
| `/google-search-console-mcp` | "Google Search Console MCP Server: No Google Cloud Setup" landing page |
| `/library` + `/library/{keyword-research, competitive-analysis, link-building, rank-tracking, site-audit, ai-agent-seo}/…` | "Strategy Library" articles (MDX) |
| `/blogs`, `/blogs/$` | Blog (fumadocs); `/guides`, `/guides/$` 301 → `/blogs` |
| `/docs`, `/docs/$` | Public docs (fumadocs) |
| `/support`, `/privacy`, `/terms-and-conditions` | Support + legal |
| `POST /api/subscribe` | Newsletter/waitlist → Loops `POST https://app.loops.so/api/v1/contacts/create` `{email, source:"openseo-waitlist"}` (409 treated as success) |
| `POST /api/{backlink-check, competitor-analysis, competitor-keyword-finder, domain-age-checker, keyword-generator, spam-score-checker, website-traffic-checker}` | Free tool APIs |

#### Pricing page logic (for re-implementing credit math)
- `MARKUP = 1.28` (28% over raw DataForSEO), `1 credit = $0.001`, base plan **$10/mo includes $10 usage** (resets monthly; top-ups roll over indefinitely); free trial includes **$0.50** credits.
- `creditsForRaw(raw) = ceil(round5(raw * 1.28) * 1000)`.
- Raw costs: rank check (queued, default depth 40, 1 device) `0.0006 + (40/10 - 1)*0.00045`; keyword Labs search `0.039` (→ 50 credits); local SERP (live Maps/Local Finder, 20 results) `0.002 + 0.0015` (→ 5); backlink profile `0.024 + 0.000036 + (0.024 + 365*0.000036)` (summary + 1-year history; → 79); AI citation per platform `0.85` (→ 1088).
- Estimator inputs: sites, keywordsPerSite, checksPerWeek (Manual 0 / Weekly 1 / Daily 7), keywordRuns, localSerps, backlinks, aiScans; presets "business" (1 site, 50 kw, weekly, 100 runs, 20 backlinks ≈ $8) and "freelancer" (15 sites, 20 kw, weekly, 370 runs, 200 local SERPs, 30 backlinks ≈ $25). Rank line = `scheduledRunsPerMonth * creditsForRaw(keywordsPerSite * rankCheckRaw)` with `WEEKS_PER_MONTH = 4.345`. Compares against Ahrefs Lite $129.

#### Content (brief)
- Docs (`web/content/docs`): Agent setup, MCP setup, Claude Code plugin, Codex plugin, Self-hosting (index, Docker, Cloudflare), Skills (index, setup, competitive-landscape, competitor-analysis, keyword-clustering, keyword-research, link-prospecting, local-seo, seo-audit, seo-coach, seo-project-setup, seo-report).
- Blogs: Best Open Source SEO Tools 2026; The Dark Query Problem (GSC hides searches); How to Prompt Claude Code for SEO; Vellum + OpenSEO; SEO for Startups; Two Surfaces, Two Timelines; What Broke the $99 Ceiling; Ranking for the Wrong Half of Your Audience.
- Strategy library: keyword research (cluster topical hubs, GSC programmatic discovery, intent beyond Google, long-tail question mining, opportunity sizing/forecasting, positioning to demand, search intent mapping, seed from conversation); competitive analysis (backlink gap, competitor traffic estimates, find real competitors, keyword gap); link building (backlink audit, how to get backlinks, referring domains); rank tracking (keyword ranking report, local rank tracking, GSC vs rank tracker, which keywords to track); site audit (index bloat, audit report template, technical audit checklist); AI-agent SEO (human-in-the-loop content, run SEO from your AI assistant, skills/memory/trace, what to automate).
- Roadmap highlights (planned, not implemented): teammates (since done), community skill library, Web Bot Auth for audits, IndexNow, prompt tracking for AI visibility, Google Business Profile integration, geo-grid rank tracking (partially via MCP), scheduled email reports/alerts, share reports (since done), Bing Webmaster Tools. Not planned: keyword density, JS rendering audits, keyword gap page.

### Free Tools

All tool pages share `ToolFrame` (hero, tool, "what you get" highlights, FAQ, CTA to `https://app.openseo.so/sign-up`, related tools, JSON-LD breadcrumbs), client `useToolRun` (POST JSON `{...inputs, turnstileToken}`; status idle/loading/done/error; Plausible events `tool_run`, `tool_result`, `tool_cta_click` with `{tool}` prop), and an upsell card. Country selector (`TOOL_COUNTRIES`, client sends only `locationCode`; server derives language): US 2840/en (default), UK 2826/en, Canada 2124/en, Australia 2036/en, Germany 2276/de, France 2250/fr, Spain 2724/es, India 2356/en, Netherlands 2528/nl, Brazil 2076/pt.

#### Shared server protection pipeline (`web/src/lib/free-tools/server.ts`)
Order per request:
1. `readToolBody`: require `Content-Type: application/json` (415), stream-read ≤ 16 KiB (413), JSON parse (400).
2. Zod input validation; `normalizeDomain` (URL hostname, strip `www.`, lowercase, strict hostname regex).
3. `dataforseoKey()` present else 503 "Service temporarily unavailable".
4. `guardToolRequest`: reject cross-origin `Origin` (403); in production require real `TURNSTILE_SECRET_KEY` (not test key `1x000…`), rate-limit binding, and `cf-connecting-ip` else 503; **rate limit 5 requests/min per IP across all tools** (`BACKLINK_CHECK_RATE_LIMIT`, key `free-tools:{ip}`) → 429 + `Retry-After: 60`; Turnstile siteverify (`https://challenges.cloudflare.com/turnstile/v0/siteverify`, 5s timeout, `remoteip`) must return `success`, `hostname == request host`, `action == "free_tool"`, else 403 "Human verification failed…"; fails closed (503).
5. `readCached(tool, key)`: Cloudflare Cache API per colo, synthetic URL `https://openseo.so/api/{tool}/{key}`; hits served without spending budget (success TTL 24h; failure envelopes cached 120s).
6. `chargeToolBudget({tool, calls})`: atomic reservation in `FreeToolBudget` Durable Object (one per UTC day, SQLite `counters(key, calls, micro_dollars)`), visitor = `sha256("{day}:{ip}")`. Checks in one transaction: `all` ≤ 6000 calls/day and cumulative estimated USD ≤ `FREE_TOOLS_DAILY_BUDGET_USD` ($100 prod, $10 preview); `tool:{slug}` ≤ per-tool calls/day; `visitor:{hash}` ≤ 40 calls/day. Returns 429 ("You've hit today's free limit. Sign up…" for visitor; "This free tool has reached today's limit…" otherwise). No refunds on failure. Alarm deletes storage 3 days after the day. Logs `free_tool_limit_reached` JSON.
7. `fetchDataforseoResult(path, payload)`: POST `https://api.dataforseo.com{path}` body `[payload]`, `Authorization: Basic {DATAFORSEO_API_KEY}`, 30s timeout; task `status_code` must be 20000 or message contains "no search results" (empty success); returns `tasks[0].result[0]`.
8. On error: write failure envelope (120s) and return 502 `{error}` with `Cache-Control: max-age=120`.

Per-tool daily call ceilings (`spend.ts`) and reserved cost per call: backlink-checker 1000 calls ($0.025/call), competitor-keyword-finder 2000 ($0.015), keyword-generator 2000 ($0.015), website-traffic-checker 3000 ($0.015), competitor-analysis 2500 ($0.015), spam-score-checker 600 ($0.025), domain-age-checker & serp-simulator: no paid calls.

#### Tools
| Tool (URL) | Inputs | DataForSEO / source + payload | Output shown |
|---|---|---|---|
| **Backlink Checker** `/backlink-checker` → `POST /api/backlink-check` | `target` domain | 2 calls in parallel. Common: `{target, include_subdomains:true, include_indirect_links:true, exclude_internal_backlinks:true, backlinks_status_type:"live", rank_scale:"one_hundred"}`. (1) `/v3/backlinks/summary/live`; (2) `/v3/backlinks/backlinks/live` + `{limit:15, mode:"one_per_domain", order_by:["domain_from_rank,desc"]}`. Cache key = domain. | Summary: rank (0–100 domain rank), backlinks, referring_domains, broken_backlinks; Top backlinks table (type=="backlink" only): domain_from, url_from, url_to, page_from_title, anchor, dofollow, domain_from_rank |
| **Spam Score Checker** `/spam-score-checker` → `POST /api/spam-score-checker` | `target` | Same common payload. (1) `/v3/backlinks/summary/live`; (2) `/v3/backlinks/backlinks/live` + `{limit:10, mode:"one_per_domain", order_by:["backlink_spam_score,desc"]}` | `backlinks_spam_score` (spam score), `info.target_spam_score`, rank, backlinks, referring domains; "worst backlinks" table: domainFrom, urlFrom, anchor, dofollow, domainRank, spamScore |
| **Website Traffic Checker** `/website-traffic-checker` → `POST /api/website-traffic-checker` | `target`, optional `compare` domain, `locationCode` | Per domain (3 calls): `/v3/dataforseo_labs/google/domain_rank_overview/live` `{target, location_code, language_code, limit:1}`; `/v3/dataforseo_labs/google/ranked_keywords/live` `{item_types:["organic"], target, location_code, language_code, limit:5, order_by:["ranked_serp_element.serp_item.etv,desc"]}`; `/v3/dataforseo_labs/google/relevant_pages/live` `{target, …, limit:5, order_by:["metrics.organic.etv,desc"]}`. Cache per domain key `organic-v2|{domain}|{loc}`; only misses are charged (3 calls each). | Per domain: organic traffic/month (`metrics.organic.etv` rounded), organic keywords (`metrics.organic.count`), traffic value (`estimated_paid_traffic_cost`), ranking pages (`total_count`); top keywords (keyword, search_volume, keyword_difficulty, position = rank_group, URL); top pages (page_address, etv, count). Compare mode shows side-by-side table "Estimated visits / month, Organic keywords, Traffic value / month, Ranking pages". |
| **Competitor Analysis** `/competitor-analysis` → `POST /api/competitor-analysis` | `competitor`, optional `yourDomain` (must differ), `locationCode` | 2 calls: `ranked_keywords/live` (limit 20, same order) + `relevant_pages/live` (limit 10). If yourDomain: +2 `domain_rank_overview/live` (both domains) + 1 `/v3/dataforseo_labs/google/domain_intersection/live` `{location_code, language_code, target1: competitor, target2: yourDomain, intersections:false, item_types:["organic"], limit:20}` (competitor-only keywords). Reserve 5 calls with own domain, else 2. Cache key `organic-v2|{competitor}|{yours or -}|{loc}`; gap failure → cache 120s and `gapFailed:true`. | Competitor top keywords + total, top pages + total, organic comparison (traffic/keywords/value you vs them), keyword gap table (keyword, volume, difficulty, their position, URL, traffic = etv) sorted by traffic |
| **Competitor Keyword Finder** `/competitor-keyword-finder` → `POST /api/competitor-keyword-finder` | `target`, `locationCode` | 1 call `ranked_keywords/live` `{item_types:["organic"], target, order_by:["ranked_serp_element.serp_item.etv,desc"], location_code, language_code, limit:20}`; cache key `{domain}|{loc}` | keyword, search volume, difficulty, position, ranking URL (20 rows) |
| **Keyword Generator** `/keyword-generator` → `POST /api/keyword-generator` | `keyword` (≤100 chars, lowercased, whitespace-collapsed), `locationCode` | 1 call `/v3/dataforseo_labs/google/keyword_suggestions/live` `{keyword, include_seed_keyword:false, include_serp_info:false, include_clickstream_data:false, exact_match:false, ignore_synonyms:true, location_code, language_code, limit:20}`; cache key `core-v2|{kw}|{loc}` | keyword, search volume (`keyword_info.search_volume`), difficulty (`keyword_properties.keyword_difficulty`) |
| **Domain Age Checker** `/domain-age-checker` → `POST /api/domain-age-checker` | `domains[]` (1–10, deduped) | No DataForSEO. RDAP: GET `https://rdap.org/domain/{domain}` (`Accept: application/rdap+json`, custom User-Agent, follow redirects, 10s timeout). Protected by rate limit + Turnstile only (no budget). Cache success 7 days, failure 5 min. | Per domain: created (`registration` event), updated (`last changed`), expires (`expiration`), registrar (jCard `fn` of entity with role registrar), age years + months; errors "No registration record found", "No public registration data for .tld", "Registration lookup timed out", "No registration date published" |
| **SERP Simulator** `/serp-simulator` | title (≤300), description (≤1000), URL, show-date toggle, desktop/mobile | Pure client-side; measures title pixel width with canvas `20px Arial` | Google-like snippet preview; desktop title width limit 600px (flags over-width), mobile 328px text width, char counts; breadcrumb URL display; tracks first edit as tool_run/tool_result |

Tests: `web/tests/free-tool-protection.test.ts` (mocked siteverify, real local DO concurrency), `free-tool-verification.spec.ts`. Deploy scripts set `VITE_REQUIRE_TURNSTILE=1`.

---

## 23. Telemetry, GDPR, Email & Referrals

### Telemetry, GDPR, Email, Referrals

#### Hosted product analytics (PostHog) — hosted mode only
- Server: `captureServerEvent({distinctId=userId, event, properties, organizationId})` with group `organization`; `captureServerError(error, props, distinctId)` via `captureExceptionImmediate`. Requires `POSTHOG_PUBLIC_KEY`, `POSTHOG_HOST`. No-op in self-host.
- Browser: lazy `posthog-js` (hosted only), `capture_exceptions`, `capture_pageview: "history_change"`, `mask_personal_data_properties`, custom PII params (`email, response_type, client_id, redirect_uri, scope, state, code_challenge, code_challenge_method, resource`), `respect_dnt`, session recording with `maskAllInputs`; `/oauth-consent` URLs stripped of query; ignorable exceptions filtered (ResizeObserver loop, Script error., aborted signals, PostHog timeouts, CancelledError…). `identifyAnalyticsUser(userId)`.
- Event catalog: `auth:sign_in_block_unverified|sign_in_google_start|sign_in_submit|sign_in_success|sign_out|sign_up_google_start|sign_up_submit|sign_up_success|verification_issue|verification_resend|verification_success`, `billing:checkout_start|checkout_success|paywall_viewed|pricing_estimator_click`, `dashboard:ga4_dismiss|next_move_click|setup_step_defer`, `data:export|export_sheets`, `domain_overview:search_complete`, `ga4:disconnect|property_select|connect_error`, `gsc:disconnect|property_select|connect_error|nudge_connect_clicked|nudge_dismissed|nudge_shown`, `keyword:save`, `keyword_research:search_complete|serp_open`, `mcp:api_key_created|api_key_revoked|authorize_success|consent_denied|consent_viewed|setup_prompt_copy|setup_url_copy|tool_call|update_prompt_copy`, `onboarding:completed|gsc_connect_clicked|interests_selected|setup_prompt_copy|step_skipped`, `rank_tracking:check_complete|check_trigger|config_create|config_update|export_csv|keyword_trend_copy|keyword_trend_export|keywords_add|metrics_refresh`, `rank_tracking_scheduler_summary`, `report:deleted|exported_pdf|opened|public_view|saved|shared|unshared`, `report_template:deleted|saved`, `sam:beta_opt_in|client_error|message_send|session_archive|session_create`, `saved_keywords:bulk_remove`, `site_audit:complete|start`, `team:invitation_accept|invitation_cancel|invitation_decline|invitation_resend|invitation_send|member_remove`, `usage:credits_consume|credits_gate_refused`.

#### Self-host anonymous telemetry (`src/server/lib/self-host-telemetry.ts`)
- Disabled when hosted, or `OPENSEO_TELEMETRY_DISABLED` / `DO_NOT_TRACK` opt-out value, or non-production build (only `production`/`selfhost` modes report).
- Triggered from request handling (`maybeSendSelfHostHeartbeat(pathname)`), skipping `/api/health` probes. In-memory throttle (60s during first 2h, 15 min after), then DB compare-and-set on singleton `telemetry_state` row (`id=1, install_id uuid, installed_at, last_heartbeat_at, last_version, mcp_tool_call_count`): heartbeat every **5 min during the first 2 hours** after install, then **every 24h**.
- Sends PostHog event `self_host.heartbeat` (hard-coded project key, `https://us.i.posthog.com`, geoip disabled, `$process_person_profile:false`, distinctId = install id) with: `deployTarget` (docker if `local_noauth` else cloudflare), `dbBackend` (d1|postgres), `version`, `prevVersion?`, `firstRun`, `minutesSinceInstall`, counts (`userCount, projectCount, siteAuditCount, rankTrackingKeywordCount, savedKeywordCount, gscConnected, samChatUsed`), `mcpToolCalls` (counter incremented per MCP tool call, decremented by reported amount after send), `setupIssues` (enumerable `check:status` pairs from setup-status, e.g. `dataforseo:error`).

#### Email (Loops) — hosted
- Transactional via `POST https://app.loops.so/api/v1/transactional` `{transactionalId, email, addToAudience:false, dataVariables}` (10s timeout): 
  - verification email (`LOOPS_TRANSACTIONAL_VERIFY_EMAIL_ID`, vars `appName, confirmationUrl`)
  - password reset (`LOOPS_TRANSACTIONAL_RESET_PASSWORD_ID`, vars `appName, resetUrl`)
  - team invitation (`LOOPS_TRANSACTIONAL_INVITATION_ID`, vars `appName, inviteUrl, organizationName, inviterName, inviterEmail`)
- Contact sync via `PUT https://app.loops.so/api/v1/contacts/update`: on signup `{email, userId, source:"openseo-signup", userGroup:"app-user", firstName, lastName}`; on billing status change (Autumn webhook) every org member gets `billingPlanId` / `billingPlanStatus` (or `"none"`).
- Marketing site newsletter: Loops `contacts/create` with `source:"openseo-waitlist"`.

#### Referrals (Dub.co) — hosted, no-op without `DUB_API_KEY`
1. `links.openseo.so/<partner>` → `openseo.so/?dub_id=<clickId>`; marketing site stores `dub_id` cookie on `.openseo.so`.
2. On signup: `POST https://api.dub.co/track/lead` `{clickId, eventName:"Sign up", mode:"wait", customerExternalId: userId}` (no name/email; 1 retry); KV `dub:referred-user:{userId}` = clickId (TTL 90 days).
3. On each session, pin copied to `dub:referred-org:{orgId}` (TTL 400 days) — only for orgs the user **founded**.
4. Paid Autumn invoices → `POST /track/sale` `{invoiceId (stripeId or org:createdAt:total), amount (cents), currency:"usd", eventName:"Invoice paid", paymentProcessor (stripe|revenuecat|custom), metadata.type: top_up|subscription}`; skip non-USD, non-paid, total ≤ 0, or > $1000. Triggered from Autumn billing webhook and a **daily cron** sweep (`17 3 * * *`, same cron as MCP OAuth KV purge) over invoices from the last 45 days; KV `dub:sale:*` marks tracked sales; "not referred" suppressed 1h.

#### GDPR erasure (hosted, Postgres-only)
- Operator CLI `pnpm gdpr:erase-user --email X` (dry-run inventory by default; refuses orgs with >1 member) then `--execute --confirm <email> --confirm-database-host <host>`.
- Steps: (1) delete Loops contact, queue PostHog person/event deletion, delete Autumn customer + linked Stripe customer; (2) call Worker `POST /api/internal/gdpr-erasure/storage` (HMAC-SHA256 over `"{timestamp}.{body}"` with `GDPR_ERASURE_SECRET`, headers `x-gdpr-timestamp`, `x-gdpr-signature`, ±5 min skew, ≤5 MB; 404 when secret unset) with payload `{userId, email, organizationIds[], samSessionIds[], auditIds[], activeAuditWorkflowIds[], activeRankWorkflowIds[], r2Keys[], googleAccounts[{providerId, accountId}]}` — terminates active `SITE_AUDIT_WORKFLOW` / `RANK_CHECK_WORKFLOW` instances, revokes Google grants (`POST https://oauth2.googleapis.com/revoke`), destroys SAM chat Durable Objects and audit scratchpads (`AUDIT_ENGINE.destroyScratchpad`), deletes KV `audit-progress:{id}`, Dub KV pins, R2 audit payloads, org-tagged AI-search prompt cache objects in R2, and MCP OAuth grants/tokens in `OAUTH_KV` (`grant:{userId}:*`, `token:{userId}:{grantId}:*`); (3) single Postgres transaction deleting orgs + user (FK cascades), verified afterward.
- Reports/report templates created by the user in surviving orgs are re-attributed to `gdpr-deleted-user` and their public share links revoked.

---

## 24. Feature Timeline from Release Notes

### Feature Timeline from Release Notes

(Items marked ⚑ are worth double-checking in other sections because they are not obvious from routes alone.)

- **v0.0.2** — Keyword research in many more countries; official Docker image CD.
- **v0.0.3** — Backlinks page.
- **v0.0.4** — `ALLOWED_HOSTS` for Docker behind reverse proxies; Lighthouse audits moved from PSI to DataForSEO (no PSI key); DataForSEO response cache moved from KV to **R2** ⚑; hosted auth mode (Better Auth), Autumn metering, PostHog error tracking.
- **v0.0.5** — Backlinks: group by domain with expandable rows, spam backlinks hidden by default ⚑, per-tab CSV export, search history ⚑ (localStorage), structured table filters; Domain Overview table filtering/sorting; Bangladesh keywords; theme switching (system/light/dark) ⚑; table filters persist across searches ⚑; backlinks trend endpoint changed to cut cost 25%; Lighthouse limited to 20-page sample ⚑; bulk save fix.
- **v0.0.6** — Rank Tracking MVP; header navigation; "AI" page linking to content-writing system (Sam).
- **v0.0.7** — All DataForSEO countries; country selector on Domain Overview; bulk delete saved keywords.
- **v0.0.8** — AI Visibility: **Brand Lookup** (queries where brand is cited, co-mentioned brands/pages) and **Prompt Explorer** (ChatGPT, Claude, Gemini, Perplexity responses).
- **v0.0.9** — Server-side pagination/filtering for domain keywords; **Export to Google Sheets from every table** ⚑; URL-driven, shareable search state ⚑.
- **v0.0.10** — Shift-click range selection ⚑; keyword intent badges; mobile keyword research UX; better modals.
- **v0.0.11** — **MCP server** (Claude Code/Codex/Desktop; `http://localhost:3001/mcp`, `https://app.openseo.so/mcp`).
- **v0.0.12** — Saved-keyword **tags** (add, bulk edit, filter) incl. via MCP.
- **v0.0.13** — Universal bulk action bar across tables ⚑; **search tabs** (multiple concurrent searches) for Keyword Research, Domain Overview, Backlinks ⚑; MCP output schemas; MCP access tokens extended to 24h.
- **v0.0.14** — Unique "Default" project per organization (`projects_one_default_per_organization_idx`) + cleanup script.
- **v0.0.15** — Agent Skills (keyword research, keyword clustering, competitor analysis, link prospecting); in-app MCP setup controls.
- **v0.0.16** — Local SEO MCP tools (nearby businesses, Google Maps/Local Finder SERPs, GBP Q&A); domain keywords & rank suggestions sorted by traffic by default.
- **v0.0.17** — `BYPASS_EMAIL_VERIFICATION` fix.
- **v0.0.18** — Self-hosted GSC via own OAuth client; GSC MCP tools (performance, URL inspection); DataForSEO 5xx quick retries + "temporarily unavailable" message ⚑.
- **v0.0.19** — **Multi-project** per organization + switcher; rank tracking trends, keyword position history, overview stats; **Share of Voice** in AI Visibility; optional **Ahrefs Domain Rating** enrichment for backlinks/referring domains ⚑ (`src/serverFunctions/ahrefs.ts`, `useAhrefsDomainRatings`); backlinks server-side pagination/sorting/filters, one-per-domain view.
- **v0.0.20** — 48 extra countries via **Google Ads data** (no KD/intent there, UI notes it) ⚑ (keyword data source routing, spec 0004); opt-in **clickstream-refined volumes** (`includeClickstreamData`) ⚑; MCP parameter descriptions; MCP server identity (name/icon).
- **v0.0.21** — Rank tracking ~3x cheaper: scheduled checks via DataForSEO **task queue** (task_post/task_get) and SERP crawling stops once domain found ⚑.
- **v0.0.22** — `get_backlinks_profile` MCP tool (paginated per-link rows); **monthly** rank tracking schedule (end of month) ⚑; explicit rank-tracking language selection (languages supported for the country); tracked domain list search + device/country filters; searchable country combobox.
- **v0.0.23** — "Update keyword stats" on Saved Keywords (refresh volume, CPC, competition, difficulty, intent) ⚑; MCP text responses include full result sets (list of tools: research_keywords, get_keyword_metrics, get_ranked_keywords, get_serp_results, search_local_businesses, get_local_serp_results, get_google_business_questions, find_serp_competitors, get_backlinks_profile, get_backlinks_overview, get_domain_keyword_suggestions, get_rank_tracker, get_search_console_performance).
- **v0.0.24** — **GSC Insights in-app** (Search Performance page, striking distance); **(Beta) in-app agent "SAM"** (requires `OPENROUTER_API_KEY`); app layout redesign; clear message for bad DataForSEO key.
- **v0.0.25** — Site Audit **Issues tab**; **city/region targeting** for rank tracking (local rank tracking, spec 0008); **multiple Google accounts** for GSC; empty H1 reported as missing; redirect/non-HTML pages display; Lighthouse start page slash fix.
- **v0.0.26** — App version shown in Settings for self-host ⚑.
- **v0.0.27** — Keyword Research **search intent filter**; Rank Tracking filters by volume/difficulty/CPC; null-last metric sorting; repeated domain/SERP lookups served from cache.
- **v0.0.28** — **Project market defaults** (default country + language per project; inherited by Keyword Research, Domain Overview, new rank trackers, MCP tools) ⚑; Enter to run keyword search, Shift+Enter / pasted lines for multi-keyword research ⚑.
- **v0.1.0** — **Project dashboard** (GSC, site audit, backlinks cards); self-host anonymous telemetry (opt-out `OPENSEO_TELEMETRY_DISABLED=1` / `DO_NOT_TRACK=1`); Prompt Explorer cited sources; closing an active search tab selects the right-hand tab.
- **v0.1.1** — Deploy-to-Cloudflare fixes.
- **v0.1.2** — `create_project` MCP tool; per-call location/language on ranked keywords & SERP competitors MCP tools; month-based GSC ranges fix.
- **v0.1.3** — `pnpm deploy:selfhost` Cloudflare provisioning; `seo-audit` skill; backlinks sorted by most recently found first ⚑; rank tracking reports **organic** position (not absolute) ⚑; `OPENROUTER_API_KEY` works in Docker.
- **v0.1.4** — **Google Analytics MCP**; rank tracking management in MCP (add/remove keywords); scheduled checks continue past skipped trackers; all SERP languages in every country; **shared workspaces for Cloudflare Access self-hosting** with a "merge workspaces" button ⚑ (`workspace-merge.ts`, `WorkspaceMergeBanner`).
- **v0.1.5** — Research scope selector: **Exact URL / Subfolder / Domain / Subdomains** ⚑ (`ResearchScopeSelect`, `researchScope.ts`); Local SEO MCP tools: business profiles, reviews, posts, categories, **local rank grids** ⚑; MCP-saved keywords keep metrics.
- **v0.1.6** — **Project context** (goals, positioning, competitors, key pages, writing preferences) shared by SAM and MCP ⚑ (spec 0010); OpenSEO skills inside SAM (beta); Lighthouse opt-in for agent-run audits; GA4 organic traffic on dashboard; GA4 MCP tools; GA4 empty comparison fix.
- **v0.1.7** — On-demand deeper SERP depth ("load more results") in Keyword Research and MCP ⚑; GSC Discover/Google News in MCP; empty SERP returns empty instead of failing.
- **v0.1.8** — **"Match case"** keyword capitalization in rank tracking ⚑; searchable GA/GSC property picker; stop/retry SAM replies; audits distinguish 429 rate limits from bot blocking ⚑.
- **v0.1.9** — **Saved reports** from MCP clients inside a project, readable in-app + **export to PDF** ⚑; reusable **report templates** per project; GSC MCP position/impressions filters; rank tracking rejects unsupported locations on save; rank checks fail visibly when no keywords checked; location search recognizes US state abbreviations.
- **After v0.1.9 (in code/specs, not in release notes)** ⚑: multi-user organizations/team invites (spec 0011; `/team`, `accept-invitation`, `InviteTeammateModal`, invitation limit 20, 7-day expiry, Loops invitation email); public report **share links** `/s/$token` (+ `/s/$token/raw`, `/s/$token/og.png`) (spec 0014); dynamic reports `/r/$reportId` (spec 0012); GA4 extended tools (traffic acquisition, ecommerce, site search, audience, measurement health, organic overview); GSC re-engagement modal; Google account removal dialog; onboarding agent (specs 0005/0006).

---

## 25. Cross-Area Gotchas & Re-implementation Notes

Things that are easy to get wrong in a 1:1 port. Where a spec and the code disagree, the **code** behavior is listed.

### 25.1 Spec vs. code discrepancies
- **Audit watchdog cron**: spec 0009 says `*/15`, but `wrangler.jsonc` runs `*/5 * * * *`. Each tick first runs `reconcileStaleAudits()` (audits `running` > 15 min, max 100), then the scheduled rank-check dispatcher.
- **Crawl concurrency**: spec 0009 describes an adaptive window of 5–40. The code (`crawl-window.ts`) caps it at **2** (retry chunks: 1), with an 8 MiB HTML byte budget per window.
- **Lighthouse sample copy**: the UI says "a sample of 20 pages". The code runs ≤ **10 URLs × 2 devices** = ≤ 20 checks.
- **Lighthouse default**: off in the UI toggle and in MCP agent guidance, but the server Zod schema defaults `lighthouseStrategy` to `"auto"`. Keep the UI default off and send the value explicitly.
- **Onboarding agent** (specs 0005/0006) is obsolete. What ships is a 5-step post-signup questionnaire plus Sam's "intake mode". Old usage events still carry the `onboarding` credit-feature label.
- **Features with no release-note entry**, only code/specs: team invites (spec 0011), dynamic reports `/r/$reportId` (0012), public share links `/s/$token` (0014), the extended GA4 tools.

### 25.2 Behavior that is easy to miss
- **Research scope** (`exact_url | subfolder | domain | subdomains`) is shared by Domain Overview, Backlinks and Brand Lookup. DataForSEO Labs `ranked_keywords` has no `include_subdomains`, so narrower scopes are emulated with filter clauses. DataForSEO allows **max 8 filter conditions** per request, and the scope consumes some of that budget before user filters (`assertFilterConditionBudget`).
- **Backlinks history** (`/v3/backlinks/history/live`) has no `include_subdomains`, so trend charts are always subdomain-inclusive even when the summary is not. Trends are hidden for URL/subfolder scopes.
- **Spam filter default differs**: the web UI shows spam (`hideSpam:false`); MCP tools default to hiding links with `backlink_spam_score > 40`.
- **Domain Overview has no competitors tab.** Competitor discovery exists only as MCP `find_serp_competitors` (`serp_competitors`) and `get_ranked_keywords`. The overview result's `backlinks`/`referringDomains` fields are always null.
- **Top Pages table** renders at most 100 rows even when page size is 200.
- **Dashboard** computes a rank-tracking summary (improved / declined / top 10) that no card currently displays. The backlink snapshot refreshes at most once per day, on dashboard visit.
- **Keyword research auto mode**: related → suggestions → ideas, stopping once ≥ 5 non-seed keywords are found. Results are R2-cached 24 h (namespace `kw:research`, version 3), and metrics are upserted into `keyword_metrics`.
- **SERP analysis cache**: 12 h, and the cached value records its depth (20 vs 100). An empty result never overwrites a good cached one.
- **Charged-but-failed DataForSEO tasks** are still billed (`DataforseoChargedTaskError`). The exception is `Invalid Field` with cost 0, which becomes a `VALIDATION_ERROR` and is not billed. Never retry Lighthouse, business `task_post` or rank `task_post` calls on 5xx (non-idempotent and billed).
- **Prompt Explorer model names** are validated against a hard-coded allowlist before calling, because DataForSEO bills an invalid `model_name`.
- **Rank tracking**: manual checks use the **live** SERP endpoint. Scheduled checks use **task_post/task_get** (cheaper), poll for about 15 min, then fall back to live for stragglers. Only one active run per tracker (DB lock). The schedule advances on a fixed anchor (no drift) using a compare-and-set claim. The dispatcher budget is 1000 task units per tick with a 3-min deadline.
- **Audit capacity is organization-wide**: Σ(pagesTotal + lighthouseTotal) over all existing audits. Deleting audits frees capacity, and on completion `pagesTotal` is rewritten to the actual pages crawled. The check runs *after* insert, and the row is rolled back on violation.
- **Crawler UA** is `OpenSEO-Audit/1.0` with no JS rendering. Bot-protection pages (401/403, `cf-mitigated`, 503 challenge markers) are classified `blocked`, and the UI links to LibreCrawl / Screaming Frog as fallbacks.
- **SSRF protection** on the start URL: DNS-over-HTTPS A/AAAA check against private ranges, plus a host blocklist for every discovered URL, and ≤ 5 validated redirect hops.
- **OpenRouter** is used only by Sam, not by AI visibility. AI visibility is 100% DataForSEO `ai_optimization`.
- **Local SEO** has no UI. It exists only as 8 MCP tools. Reviews/updates are async `task_post` calls: the tool returns `status:"processing"` with a `taskId` like `google:<id>` / `extended:<id>`, and resuming with that id is free.
- **DataForSEO / OpenRouter keys are env vars only**; there is no settings screen for them. The help pages `/help/dataforseo-api-key` and `/help/openrouter-api-key` explain how to set them.
- **Self-hosted mode** does no metering at all. `meterDataforseoCall` calls through directly, and cost estimates show raw DataForSEO USD without the 1.28 markup.
- **Docker self-host**: nothing in the repo fires the crons, so scheduled rank checks and the audit watchdog need an explicit scheduler in the Next.js port.
- **Share links** (`/s/$token`) are hosted-only. Report HTML is served with a strict CSP sandbox and a hashed print script, with a 60 s edge cache.

### 25.3 Billing math to reproduce exactly
```ts
SEO_DATA_COST_MARKUP = 1.28;              // hosted only
AUTUMN_SEO_DATA_CREDITS_PER_USD = 1000;   // 1 credit = $0.001
round5 = (v) => Math.round(v * 1e5) / 1e5;
totalCostUsd     = round5(costUsd * 1.28);
totalCostCredits = Math.ceil(totalCostUsd * 1000);
// deduct from monthly "usage_credits" first, remainder from "topup_credits"
// preflight: monthly + topup <= 0  -> INSUFFICIENT_CREDITS
// rank-check estimates: per API call, ceil(round5(checksInCall * costPerSerpAtDepth * 1.28) * 1000)
// Sam (LLM) spend is metered in $0.05 chunks through the same trackUsageCreditSpend path (feature "agent")
```
