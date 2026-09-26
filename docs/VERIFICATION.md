# Verification log

Evidence for each requirement of the project brief, gathered on 2026-09-26 against the dev server
(`localhost:3000`, Chrome via Claude in Chrome) and a production container built from `docker-compose.yml`
(`localhost:3100`, fresh volumes). Automated suites: `pnpm typecheck`, `pnpm lint`, `pnpm test` (see bottom).

## Product parity

| Requirement | Evidence |
|---|---|
| Every finseo.ai page/tab/action | `docs/research/finseo-features.md` inventory; coverage audit of ~535 items (finseo + open-seo) found 9 gaps, all closed; independent re-audit: 26/26 PASS with file:line evidence |
| All open-seo features (`every-app/open-seo`) | `docs/research/open-seo-inventory.md` §1–§25; closed gaps: GSC URL Inspection, GA4 MCP tools (9), multi-account Google OAuth, 11 open-seo agent skills (+6 own), Claude Code / Codex / Cursor plugin manifests + served marketplace, GDPR export & erasure, billing & cost estimator, 8 free SEO tools (in-app + optional public), export to Google Sheets |
| Next.js / shadcn / Tailwind, latest | Next 16.3.6 (Turbopack, `proxy.ts`), React 19.3, Tailwind 4.3, shadcn 4.21 |
| Only `DOMAIN` in `.env` | `.env.example` contains exactly `DOMAIN=…`; everything else lives in Admin (settings registry, AES-256-GCM for secrets) |
| Works out of the box / Coolify + Docker Compose | `docker compose up --build` on empty volumes → migrations applied at boot, setup code printed, first-run setup completed in Chrome → owner signed in → onboarding; `/api/health` 200; security headers present; image builds without a database |
| Mobile optimized | Chrome sweep of 72 app routes + 19 detail routes at 375 px and 1440 px: no horizontal overflow, no dev-overlay issues (fixed: API docs tool names, Brand Knowledge toolbar, agent detail grid) |

## Authentication & permissions

| Requirement | Evidence (live in Chrome / DB) |
|---|---|
| Magic login | `/login` → "Check your inbox" → link from mail log → `/auth/verify` confirm step → signed in, redirected to `?next=` target |
| SMTP / Amazon SES | Admin → Email (preset SES + region or custom SMTP, test mail); without SMTP the link is logged for admins |
| Link single-use | Re-opening the used link → "This sign-in link is invalid or was already used." |
| 1-year login | New session `expires_at - created_at = 365 days` |
| Multiple devices | 3 concurrent browser sessions + script sessions active for the same user, none revoked |
| Invite-only with domain check | `someone@gmail.com` → generic response, audit `auth.login_denied` "This email domain is not allowed to sign in.", no token created |
| Users & permissions | Owner / Admin / Member / Client + custom roles (Admin → Roles), per-project access; permission checks verified with temporary users (billing 403 for Client, OAuth consent requires `settings.manage`, …) |
| Good security | Whole-app security review (2 High, 6 Medium, 16 Low) — all fixed: atomic code attempts + trusted client IP, safe redirects, owner-only Full-mode agent jobs, SSRF-safe fetches, secret re-entry on destination change, CSRF checks on route handlers, hashed setup code, masked DB errors, CSP/HSTS headers, signed agent releases |

## Local agent spec (live test with a real install)

| Requirement | Evidence |
|---|---|
| One-liner with token + host | `curl …/install.sh \| AUTOSEO_AGENT_TOKEN=… bash -s -- --host …` → detected Node 26.10, Claude Code 2.1.283, Codex 0.154.0, connected |
| Autostart | launchd / systemd user unit / Scheduled Task in installers (test used `--no-autostart`) |
| Outbound only | No listening sockets in `agent/agent.mjs` |
| Token never expires, SHA-256 only, shown once | DB stores a 64-char hash; config file on the machine is `0600`; dialog "shown only once" |
| Self-update on new deploy | Changing the served agent build → running agent logged `Updating agent dev-145b2c356a10 → dev-5848ff659cb8`, installed, restarted, reconnected (signature verified); restoring rolled it back the same way |
| Update action | "Update" → applied on next check-in (activity log `update_requested` → `updated`) |
| Reinstall | Confirm dialog (new token, old invalid, jobs requeued, settings/history kept) → new one-liner |
| Test | Real self-test job pinned to the machine, attempt 1/1: "claude 2.1.283: OK in 3.8s" with health payload |
| Live terminal | Streams agent log + job output in the browser |
| Cleanup + auto-cleanup | "Cleanup" → next check-in: "Cleanup removed 2 finished job folders (13 KB freed)"; hourly auto-cleanup job |
| Jobs in own folder, parallel | Per-job folder under the work dir (default OS temp), 2 parallel slots |
| Settings per agent (CLI) | Runtime switched to Codex in the dashboard → agent log `Runtime is now codex` within seconds; switched back to Detect |
| Reporting | CLI versions per check-in on the machine panel and list; activity log per agent/job |
| AI via local agent, API fallback | `runLlm` routes to the agent first, then Anthropic / OpenAI / OpenRouter; agent chat verified with real Claude Code sessions and AutoSEO MCP tools |

## Automated checks (final run)

| Check | Result |
|---|---|
| `pnpm typecheck` | no errors |
| `pnpm lint` | 0 errors, 0 warnings |
| `pnpm test` | 51 files, 560 tests passed |
| `pnpm build` (no database reachable) | compiled successfully, all routes dynamic |
| `drizzle/0000_init.sql` on a fresh database | 110 tables, second run is a no-op, `drizzle-kit push` reports no drift |
| `docker compose up --build` (fresh volumes) | boots, migrates, prints setup code, setup → onboarding in Chrome |

## Known limits (environment, not code)

- No real Google OAuth client, DataForSEO account or AI API keys on this instance: those paths are covered by
  mocked tests and "not configured" states, not live calls.
- Codex CLI on the test machine returns 401 (its login), so Codex runs were verified up to launch arguments.
