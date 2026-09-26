# AutoSEO agent plugin

Connect your AI agent (Claude Code, Codex, Cursor) to a **self-hosted AutoSEO** instance: AI visibility (GEO) data — how ChatGPT, Perplexity, Google AI Overviews, Gemini and Claude answer about your brand — plus keyword research, SERPs, domains, backlinks, rank tracking, local SEO, site audits, Search Console and Google Analytics.

The plugin bundles the AutoSEO MCP server connection and 17 skills that guide the agent through complete workflows and save their results as shareable reports in AutoSEO.

## Install

The easiest way is from your instance: **Settings → API & MCP → Agent setup** shows the exact commands and a pre-configured download for your URL.

- **Claude Code (recommended):**
  - From your instance (HTTPS): `claude plugin marketplace add https://YOUR-AUTOSEO-DOMAIN/api/plugin/marketplace.json`, then `claude plugin install autoseo@autoseo`.
  - From this repository: `claude plugin marketplace add <this-repo>` and `claude plugin install autoseo@autoseo`. Claude Code asks for your AutoSEO URL when the plugin is enabled.
- **Codex:** download the pre-configured bundle from your instance (`/api/plugin/autoseo-marketplace.zip`), unzip it, run `codex plugin marketplace add ./autoseo-marketplace`, then install AutoSEO from `/plugins`. When installing from this repository instead, first replace `https://YOUR-AUTOSEO-DOMAIN` in `plugins/autoseo/mcp.json`.
- **Cursor:** import the repository (or the unzipped bundle pushed to your own Git repo) as a team marketplace in Cursor's plugin settings, or add the MCP server directly with the JSON snippet from your instance.

Sign in with OAuth the first time the agent uses an AutoSEO tool (a workspace owner or admin approves the connection), or use an API key from Settings → API & MCP.

## Skills

SEO workflows: `seo-audit`, `keyword-research`, `keyword-clustering`, `competitive-landscape`, `competitor-analysis`, `link-prospecting`, `local-seo`.
AI visibility: `ai-visibility-report`, `competitor-gap`, `content-opportunities`, `sentiment-review`, `source-outreach`, `ai-project-setup`.
Guides and utilities: `seo-coach`, `seo-project-setup`, `seo-report`, `simple-issue-description`.

In Claude Code, plugin skills are namespaced: `/autoseo:seo-audit`.

## Try it

- "How visible is my brand in ChatGPT this month, and what should I do next?"
- "Audit my website and tell me what to fix first."
- "What does competitor.com rank for that I don't?"
- "Which pages are close to ranking in Google Search Console?"

## Costs and permissions

Tools that cost money (DataForSEO research, AI generation, tracking runs) need the connection's **spend** scope and the matching role permission; everything else reads data your AutoSEO instance already has. Budgets are set by your admin in AutoSEO (Admin → Limits).

## License and attribution

The SEO workflow skills are adapted from the OpenSEO skills (MIT License, © 2026 Ben Senescu) — see `NOTICE.md`.
