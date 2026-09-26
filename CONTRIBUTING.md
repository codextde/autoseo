# Contributing to AutoSEO

Thanks for taking the time to contribute! AutoSEO is open source and self-hostable, and we'd love your help
making it better — bug fixes, new features, docs, or just filing a good issue all count.

## Ways to contribute

- **Report a bug** — open a [bug report](https://github.com/codextde/autoseo/issues/new?template=bug_report.yml).
- **Suggest a feature** — open a
  [feature request](https://github.com/codextde/autoseo/issues/new?template=feature_request.yml).
- **Fix or build something** — pick up an issue (see [Good first issues](#good-first-issues)) or open a PR
  directly.
- **Ask a question / discuss an idea** — use
  [GitHub Discussions](https://github.com/codextde/autoseo/discussions) rather than an issue.

## Development setup

Requirements: Node 24, [pnpm 9.15](https://pnpm.io/installation) (`corepack enable` picks it up automatically
from `packageManager` in `package.json`), and Docker (for local Postgres).

```bash
# 1. Postgres (local dev only — the app itself doesn't need Docker)
docker run -d --name autoseo-pg -e POSTGRES_USER=autoseo -e POSTGRES_PASSWORD=autoseo -e POSTGRES_DB=autoseo \
  -p 54329:5432 postgres:17-alpine

# 2. Install dependencies
pnpm install

# 3. Sync the schema to your dev database
pnpm db:push

# 4. Start the dev server
pnpm dev   # http://localhost:3000
```

On first run, open `http://localhost:3000/setup` and grab the setup code from the terminal output to create
your owner account. Everything besides `DOMAIN`/`DATABASE_URL` (email, AI providers, DataForSEO, Google OAuth,
…) is configured afterwards in the admin panel — see `.env.example`.

`cloud/` is a separate Next.js app (AutoSEO Cloud, the hosted offering) with its own `pnpm install` / `pnpm dev`
in that directory. Most contributions target the root app.

## Before opening a PR

Run the full check suite locally — it's exactly what CI runs:

```bash
pnpm typecheck   # next typegen && tsc --noEmit
pnpm lint
pnpm test
```

For schema changes, also generate a migration and commit it:

```bash
pnpm db:generate   # writes SQL into drizzle/ — review it before committing
```

Migrations run automatically at boot in every environment (dev, Docker, production), so `db:generate` is
required for anything under `src/server/db/schema/`; `db:push` is dev-only and force-syncs without a migration
file.

## Project conventions

Read `docs/ARCHITECTURE.md` first — it covers the directory layout, the feature-module pattern
(`src/features/<module>/`), server-only conventions, the settings/permissions/jobs systems, and the list of
existing building blocks you should reuse instead of re-implementing (data tables, charts, page layout, auth
guards, etc.). A few load-bearing rules from there:

- Every page/action/route handler enforces auth via the guards in `src/server/auth/guards.ts`.
- Never read `process.env` for configuration beyond `DOMAIN`, `DATABASE_URL`, `DATA_DIR`, `NODE_ENV` — use
  `getSetting()` / `updateSetting()` (`src/server/settings`) so config stays in the DB and the admin panel.
- New DB tables/columns live in `src/server/db/schema/<module>.ts`, one file per module.
- Long-running work goes through the job queue (`enqueueJob`), not inline `await`.
- UI must stay usable at 375px width — no horizontal page scroll.

## Adding a feature module

Most features follow the same shape:

1. `src/server/db/schema/<module>.ts` — tables (if any), then `pnpm db:generate`.
2. `src/server/<module>/` — server-only business logic (used by actions, API routes, jobs, MCP tools alike).
3. `src/features/<module>/` — `actions.ts` (server actions), `queries.ts`, `types.ts`, `components/`.
4. `src/app/(app)/p/[projectId]/<module>/` (or the relevant route group) — the page(s), using
   `PageHeader`/`PageContainer` and existing `components/app/*` composites.
5. Register permissions in `src/server/auth/permissions.ts` if the module needs its own.
6. Add an entry to `src/lib/navigation.ts` so the sidebar/routing picks it up.
7. Tests alongside the code (`*.test.ts`) or under `test/`.

If you're planning something larger, open an issue or a Discussion first so we can align on approach before
you invest a lot of time.

## Commit style

We use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`,
`refactor:`, `test:`, `ci:`, …). Keep commits focused and the message in the imperative mood
(`fix: handle empty DataForSEO response` rather than `fixed bug`). Squash-merge is fine for PRs with messy
history — just make sure the final commit message is clean.

## Good first issues

Issues labeled [`good first issue`](https://github.com/codextde/autoseo/labels/good%20first%20issue) are
scoped for newcomers to the codebase. `help wanted` marks anything we'd particularly appreciate a hand with.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be kind.

## Security

Please **don't** open a public issue for security vulnerabilities — see [SECURITY.md](SECURITY.md) for how to
report privately.
