# Brief for module builders (read fully before coding)

You are one of several engineers building **AutoSEO** in parallel in the same working tree
(`/Users/danielehrhardt/projects/autoseo`). AutoSEO is an open-source, self-hosted 1:1 feature copy of
finseo.ai (AI visibility / GEO platform) merged with every feature of every-app/open-seo (classic SEO suite),
plus a local CLI agent system (Claude Code / Codex).

## Read first
1. `docs/ARCHITECTURE.md` — stack, conventions, the foundation you MUST reuse, module ownership.
2. `AGENTS.md` — Next.js 16 has breaking changes. Read the relevant guide in `node_modules/next/dist/docs/`
   before using an API you are unsure about (e.g. `proxy.ts` instead of middleware, async `params`/`searchParams`/
   `cookies()`/`headers()`, `PageProps<"/route">`/`LayoutProps`/`RouteContext` global type helpers,
   `revalidateTag(tag, "max")`, `updateTag`, `refresh()`).
3. Research: `docs/research/finseo-features.md` (exact finseo UI/behaviour, captured from the live app) and
   `docs/research/open-seo-inventory.md` (exhaustive open-seo spec incl. DataForSEO endpoints, payloads, formulas).
4. Look at existing code in `src/components/app/*`, `src/server/*` before writing new helpers.

## Hard rules
- **Stay inside the files/dirs your module owns** (see your task + ARCHITECTURE "Module ownership"). You may
  create new files in your own folders freely. Do not rewrite foundation files; if you truly need a small additive
  change in a shared file (e.g. a new export), keep it minimal and backwards compatible.
- Routes are predefined in `src/lib/navigation.ts`. Project pages live under `src/app/(app)/p/[projectId]/…`,
  global pages under `src/app/(app)/(global)/…`. Every page must call a guard (`requireProject(projectId, perm?)`,
  `requireUser()`, `requireAdmin()`); every server action must use `runAction(async () => { const ctx = await
  actionProject(projectId, "perm"); … })`; every route handler must authenticate.
- **DB**: only edit your module's schema file in `src/server/db/schema/<module>.ts` (tables are prefixed/named
  clearly, ids via `id("xyz")`). Sync the dev DB with `pnpm db:push` (other engineers push concurrently; if it
  fails because of someone else's in-progress schema, wait ~30s and retry). **Never** run `drizzle-kit generate`
  and never commit to git.
- **Jobs**: register handlers/schedules only in `src/server/jobs/handlers/<module>.ts` using `defineJob` /
  `defineSchedule`. Long or external work must run as jobs, not in request handlers.
- **Config**: never add env vars. Read config with `getSetting(...)`. If your module needs a new instance setting,
  add a field (with default) to the appropriate group in `src/server/settings/registry.ts` (additive only) — secrets
  must be listed in that group's `secrets` array.
- **External APIs**: DataForSEO via `dfsPost`/`dfsGet`; LLM work via `runLlm` (local agent first, API fallback);
  record costs with `recordUsage` (dfs client already does). Handle "not configured" gracefully with an empty state
  that tells the admin where to configure it (Admin → Data Providers / AI Providers / Local Agents).
- **No fake data in real code paths.** Features must work end-to-end with real providers. Where a provider is not
  configured, show a helpful empty/disabled state. (Only the ai-insights module ships an explicit, clearly labelled
  "Load demo data" generator.)
- **UI quality bar — "2026 SaaS"**: calm warm-neutral surfaces, `Panel` cards (rounded-2xl, soft shadow), black
  primary buttons, brand green accents, tabular numbers, clear hierarchy, subtle motion (`motion/react`), dark mode.
  Match finseo's layouts/columns/filters/tabs as described in the research doc. Use shadcn primitives from
  `src/components/ui/*` and composites from `src/components/app/*` (DataTable, KpiStrip, charts, filters…).
  **Fully mobile-optimized**: must work at 375px (no page-level horizontal scroll; tables either use `mobileCard` or
  scroll inside their card; filter bars collapse via `FilterBar`; dialogs become full-width).
- State that should survive reloads/bookmarks (tabs, filters, periods, selected items) goes in the URL
  (`useUrlState`, `useUrlListState`, `TabNav` with `?tab=`).
- **Security**: validate all input with zod; check project access on every query (always filter by `projectId`);
  never expose secrets to the client; SSRF-protect any user-supplied URL fetch (block private/loopback IPs);
  escape/sanitize any HTML you render (no `dangerouslySetInnerHTML` with untrusted content unless sanitized).
- TypeScript strict; no `any` unless unavoidable. Run `pnpm typecheck` and fix errors in YOUR files (others may be
  mid-work — ignore errors in files you don't own, but never leave errors in yours). `pnpm lint` too if time permits.
- New npm dependencies: `pnpm add <pkg>` (if the lockfile is busy because another engineer installs, retry after a
  few seconds). Prefer small, maintained packages. Never pin old major versions.
- A dev server is ALREADY running on http://localhost:3000 (Turbopack, hot reload, supervised by `scripts/dev-supervisor.sh` which restarts it automatically if it crashes — wait ~20s and retry). Do not start another one and do
  not kill it. Test pages/route handlers with curl using a session cookie from `node scripts/dev-session.mjs`
  (e.g. `curl -s -b "$(node scripts/dev-session.mjs)" http://localhost:3000/p/<projectId>/...`). A test project
  exists: `prj_demo0000000001` (Solakon, solakon.de, DE). Server logs: `/tmp/autoseo-dev.log`.
- Do not use browser automation (the lead engineer does visual QA in Chrome).

## Definition of done for your module
- Every feature in your task list implemented end-to-end (DB → server → job → UI), no TODO stubs, no
  `test.skip`, no placeholder pages. If something is genuinely impossible (e.g. needs a paid third-party account),
  implement the full integration code path + clear UI state and explain it in your final report.
- Pages render without runtime errors (curl them: expect HTTP 200 and no error overlay text in the HTML), typecheck is
  clean for your files, schema pushed.
- Final message: concise report — what you built (routes, jobs, tables, key files), how you verified it, and any
  remaining gaps. Keep it factual.
