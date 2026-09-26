# AutoSEO

**Open-source, self-hosted AI visibility (GEO/AEO) + SEO platform.** Track how ChatGPT, Perplexity, Gemini, Claude,
Google AI Overviews / AI Mode, Copilot, Grok, Mistral and DeepSeek talk about your brand — next to keyword research,
rank tracking, backlinks, site audits, Search Console, GA4 traffic, bot analytics, attribution, AI tasks, content
optimization, fact checking and white-label reports. All AI work runs on **your own local Claude Code / Codex CLI**
through lightweight agents (API keys are only a fallback).

- Next.js 16 · React 19 · Tailwind v4 · shadcn/ui · PostgreSQL · Drizzle
- One `DOMAIN` variable. Everything else — email (SMTP / Amazon SES), AI providers, DataForSEO, Google OAuth,
  onboarding, branding, roles & permissions, limits, security — is configured in the **admin panel**.
- Invite-only magic-link login (+ one-time codes), optional email-domain allow-list (e.g. only `@solakon.de`),
  1-year sessions, unlimited devices, roles & per-project access, audit log, GDPR export & erasure.
- Fully mobile optimized, light & dark mode.

## Features

| Area | What's inside |
|---|---|
| AI Visibility | Prompt research, tracker (trends, breakdown, prompt flow, locations, query fan-outs), competitors, sentiment, sources, products, ads, brand lookup, prompt explorer, model settings |
| SEO | Keyword research, saved keywords, rank tracking, domain overview, backlinks, site audit (issues, pages, Lighthouse, compare), local SEO, free SEO tools, export to CSV / Google Sheets |
| Analytics | Human traffic (GA4 & others), bot traffic (log uploads, CDN connectors, server-log webhook), Search Console (performance, opportunities, URL inspection) |
| Attribution | 7-step setup, snippet + webhooks, channel & revenue attribution |
| Optimizations | Tasks (push to Jira/Linear/…), content briefs & drafts (publish to WordPress/Webflow/…), crawlability, fact check |
| Reports | Drag & drop report builder, 11 templates, brand kits, PPTX/PDF export, password-protected share links, AI HTML reports |
| Agent mode | Chat with your data through your own Claude Code / Codex (with every AutoSEO tool) or the API fallback |
| API | REST v1 (OpenAPI), MCP server (100+ tools), OAuth 2.1, API keys with `read` / `write` / `spend` / `export` scopes, 17 agent skills, Claude Code / Codex / Cursor plugins |
| Admin | Users, invitations, roles & permissions, workspaces & projects, authentication, email, AI & data providers, onboarding, branding, limits & budgets, billing & costs, free tools, local agents, jobs, audit log, system health |

## Deploy with Coolify

1. Create a new resource → **Docker Compose** → point it at this repository (build pack: Docker Compose,
   file `docker-compose.yml`).
2. Set the domain of the `app` service (e.g. `https://seo.example.com`) and add the environment variable
   `DOMAIN=seo.example.com`. Coolify generates the Postgres password automatically (`SERVICE_PASSWORD_POSTGRES`).
3. Deploy. On first boot the app runs its database migrations and prints a **setup code** to the logs
   (a new code on every restart until setup is done):

   ```
   ╔════════════════════════════════════════╗
   ║  AutoSEO first-run setup               ║
   ║  Open https://seo.example.com/setup    ║
   ║  Setup code: 1234-5678                 ║
   ╚════════════════════════════════════════╝
   ```

4. Open `/setup`, enter the code, name your workspace, create the owner account and (optionally) restrict sign-ins
   to your company domains. You're signed in immediately; configure email delivery next (Admin → Email).

Data lives in two volumes — back up both:

- `autoseo-pg` — PostgreSQL
- `autoseo-data` — uploads, caches, the auto-generated encryption key for stored secrets (`secret.key`) and the
  agent release signing key (`agent-release-key.pem`). Losing `secret.key` makes stored provider credentials
  unreadable; losing the signing key means installed agents stop auto-updating until they are reinstalled.

Updating is a redeploy: migrations run automatically at boot and connected local agents update themselves to the
new build.

### Reverse proxy & security settings

- The app trusts `X-Real-IP` / the right-most `X-Forwarded-For` hop set by Coolify's Traefik for rate limits.
  If all traffic comes through **Cloudflare**, enable Admin → Authentication → *Behind Cloudflare* so
  `CF-Connecting-IP` is used (never enable it otherwise — the header could be spoofed).
- Outbound requests to private/LAN addresses are blocked (SSRF protection). Allow specific intranet hosts for
  integrations (e.g. an internal WordPress) under Admin → Authentication → *Internal hosts allowed for integrations*.
- Sessions use `__Host-` cookies (Secure, HttpOnly, SameSite=Lax). Stored secrets are encrypted with AES-256-GCM;
  API keys, OAuth and agent tokens are stored as SHA-256 hashes only.

## Run locally with Docker

```bash
cp .env.example .env          # DOMAIN=localhost:3000
docker compose up --build     # http://localhost:3000 (setup code in `docker compose logs app`)
```

## Configuration (admin panel)

| Area | What you configure |
|---|---|
| Authentication | Allowed email domains, invite-only mode, domain self-signup, session length (default 365 days), max devices, magic-link lifetime, Cloudflare, internal hosts |
| Email | SMTP or Amazon SES (region preset), sender, test email |
| AI providers | Prefer local agents, fallback order, Anthropic / OpenAI / OpenRouter / Perplexity / Gemini / xAI / Mistral / DeepSeek keys, per-engine provider mapping |
| Data providers | DataForSEO (keywords, SERPs, backlinks, AI engines), Google OAuth (Search Console, GA4, Sheets), PageSpeed, Bing, Cloudflare |
| Onboarding | Wizard steps, default market/engines/frequency, suggested prompt & competitor counts |
| Branding | App name, logo, colors, docs & demo links |
| Roles & permissions | Owner / Admin / Member / Client + custom roles, per-project access |
| Limits & budgets | Projects, prompts, daily/monthly spend caps, audit size, job concurrency, agency markup |
| Free SEO tools | Publish the free tools at `/free-tools` (off by default), daily budget, rate limits, Turnstile |
| Local agents | Check-in interval, work dir, cleanup, auto-update |

## Local agents (Claude Code / Codex)

Open **Settings → Local Agents → Install agent**, copy the one-liner for macOS/Linux (bash) or Windows (PowerShell)
and run it on a machine that has `claude` and/or `codex` installed:

```bash
curl -fsSL https://seo.example.com/install.sh | AUTOSEO_AGENT_TOKEN=… bash -s -- --host https://seo.example.com
```

- Outbound HTTPS only, no open ports. Starts automatically (launchd / systemd user unit / Scheduled Task).
- Tokens never expire, are stored as SHA-256 only and are shown once. Reinstalling issues a new token.
- Every job runs in a fresh CLI session in its own folder (default: temp dir), jobs run in parallel.
- Updates itself on every deploy (releases are signed; the agent verifies the signature).
- **Lean** mode (default for shared/team work) runs the CLI without your personal settings, MCP servers or shell.
  **Full** mode (your own MCP servers, web fetch) only ever runs for jobs *you* started, and only if you allowed it
  locally with `--allow-full`. Other flags: `--runtime claude|codex`, `--workdir`, `--max-parallel`,
  `--mcp-servers`, `--allow-codex-shell`, `--allow-remote-workdir`, `--no-auto-update`, `--no-autostart`,
  `--uninstall`.

## API, MCP & agent plugins

- REST: `https://seo.example.com/api/v1` (OpenAPI at `/api/v1/openapi.json`, docs under Settings → API & MCP)
- MCP (streamable HTTP): `https://seo.example.com/api/mcp` — OAuth 2.1 or API key
- Claude Code plugin marketplace: `/plugin marketplace add https://seo.example.com/api/plugin/marketplace.json`
  (bundles for Codex and Cursor and a skills zip are under Settings → API & MCP → Skills)

## Development

```bash
docker run -d --name autoseo-pg -e POSTGRES_USER=autoseo -e POSTGRES_PASSWORD=autoseo -e POSTGRES_DB=autoseo \
  -p 54329:5432 postgres:17-alpine
pnpm install
pnpm db:push      # sync schema to the dev database
pnpm dev          # http://localhost:3000
pnpm typecheck && pnpm lint && pnpm test
pnpm db:generate  # create a SQL migration after schema changes (applied automatically in production)
```

See `docs/ARCHITECTURE.md` for the code layout and conventions.

## License

MIT. Parts of the SEO feature set and agent skills are adapted from [open-seo](https://github.com/every-app/open-seo)
(MIT) — see `plugins/autoseo/NOTICE.md`.
