# QA findings (lead visual QA)

- [x] Tracker prompt table: "Citations" column shows 0 for all prompts on the demo project while citation rate KPI is 31.4% (per-prompt own citation count query vs demo data).
- [x] Tracker prompt table: Model Visibility icons wrap onto 2 rows at 1512px — now a one-row overlapping stack (max 8 icons, visible engines first + "+N" overflow, no-wrap), single tooltip lists every engine's status + visibility %.

## Verified in Chrome (lead)
- [x] First-run setup with setup code from logs → owner account + session
- [x] Magic-link login: email → "Check your inbox" (SMTP not configured → log hint) → 6-digit code auto-submits → project
- [x] Magic-link verify page: explicit "Sign in on this device" confirm; link is single-use ("invalid or already used" on reuse)
- [x] Sessions: 365-day expiry, multiple concurrent device sessions stay active
- [x] Allowed domains (solakon.de, autoseo.test): invite dialog marks @gmail.com as outside allowed domains and skips it
- [x] Invitation accept (new user) → member without project access sees "Ask your admin for access"
- [x] Admin panel: overview/health, roles matrix, authentication, invitations
- [x] AI Tracker, Competitors (desktop + 375px mobile cards + drawer sidebar), Home dashboard, Prompt Research, Brand Knowledge (real Solakon clusters via local agent)
- [x] SEO pages empty states (no DataForSEO), Site Audit results (real solakon.de audit), Crawlability (97)
- [x] Integrations catalog, Bot Traffic, Search Console, Attribution (7-step setup), Tasks, Content, Fact Check, API & MCP, Local Agents list + install dialog
- [x] Report editor: select, drag, handles, position panel, undo
- [x] Agent mode chat: conversation view (thinking, tool cards, stop state), 375 px layout, no hydration issues
- [x] Magic link re-test: domain allow-list denial (@gmail.com), link + confirm → signed in with `?next=`, link single-use, 365-day session, 3 concurrent device sessions
- [x] Local agent live: install one-liner, check-in with CLI versions, Reinstall dialog, self-test job (Claude Code OK), runtime setting → "Runtime is now codex", self-update rollout + rollback, Cleanup, activity log
- [x] Docker Compose on fresh volumes: migrations at boot, setup code, first-run setup → onboarding, health + security headers
- [x] Route sweep 1440 px + 375 px (91 routes incl. detail pages): fixed API docs overflow, Brand Knowledge toolbar overflow, agent detail grid overflow, TimeAgo hydration mismatch, Meter inside <p>, sidebar skeleton random width, missing key on insight detail filters
- [x] Breadcrumbs: entity names on detail pages ("Velocita", agent name), acronyms (SERP, SEO, AI)
- [x] SERP simulator: pixel meter, 600 px truncation, realistic typing without errors
