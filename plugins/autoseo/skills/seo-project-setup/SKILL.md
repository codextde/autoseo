---
name: seo-project-setup
description: "Populate a project's shared AutoSEO context — site scope, goals, positioning, competitors, key pages, and preferences — plus MCP checks and Search Console / Google Analytics intake."
---

# AutoSEO SEO Project Setup

## Goal

Interview the user once about one website or SEO project, and store the answers in that project's shared context in AutoSEO with `update_project_context`. That context is read by every other skill, by the in-app agent, and by the user on the project's Brand Knowledge page — so it survives new sessions, new machines, and new agents. This is a context setup workflow, not a full audit.

## Tone

Be friendly, practical, and structured. Ask questions in small batches. Explain why each item matters only when useful. Do not overwhelm a beginner with jargon.

## Where the answers go

Two project-context MCP tools do all the writing. Both are free.

- `get_project_context(projectId)`: everything already known about the project, plus a `missingSections` list.
- `update_project_context(projectId, updates)`: a list of patch ops. The ones this skill uses:
  - `{ op: "set_section", section: "business_overview" | "goal" | "positioning" | "audience" | "writing", content }`
  - `{ op: "add_competitors", competitors: [{ domain, name?, notes? }] }`
  - `{ op: "add_key_pages", pages: [{ url, role: "hub" | "spoke" | "money" | "other", topic?, notes? }] }`
  - `{ op: "upsert_note", category: "other", title, body }` for anything that does not fit a typed section
  - `{ op: "append_research_log", summary }` when this session spends money

Write in batches as the interview progresses — do not hold every answer until the end. Sections are prose (~4,000 characters each), so a few tight paragraphs, not a transcript.

## Checklist

### 1. Verify AutoSEO MCP and resolve the project

Writes need a `projectId`, so do this first:

1. Use `whoami` if available. It also shows the connection's scopes: writing context needs **write**; paid research later needs **spend**.
2. Use `list_projects` to confirm the user can access projects.
3. Match the project to the website/domain they want to rank for.
4. If the project list is ambiguous, ask the user which project should be used.
5. If no project matches, offer to create one with `create_project` (it needs the spend scope, because it bootstraps AI tracking).
6. If the MCP is unavailable, tell the user to connect AutoSEO MCP; without it, nothing can be saved.

Do not run research tools just to test connectivity; `whoami` and `list_projects` are enough.

### 2. Read what is already there

Call `get_project_context`. Show the user a short summary of what AutoSEO already knows and what is missing. Confirm or correct existing entries rather than re-asking questions that are already answered — this skill is often re-run after another skill filled in part of the context. `get_project` also shows the tracked market, AI models, and tracking frequency.

### 3. Collect website scope

Ask for:

- Primary website/domain
- Additional domains or subdomains
- Important products, services, categories, or pages
- Target countries/languages
- Whether the site is new, established, migrating, or recovering from a drop
- CMS or publishing workflow, if relevant

Write the durable parts to `business_overview`: what the business does, who it is for, the target markets/locales, and the site's current stage.

### 4. Capture goals

Ask the user what they want from SEO and AI search:

- More qualified leads
- More signups/trials
- More ecommerce revenue
- More newsletter/audience growth
- More brand/category awareness, including being recommended by AI assistants
- Recovery from traffic loss
- Better ranking for specific pages

Ask for success metrics and timeframe. If goals are vague, help turn them into measurable goals such as "increase non-branded organic signups" or "be named in half of the tracked ChatGPT answers about our category."

Write the result to the `goal` section, including the metric and timeframe.

### 5. Capture positioning and strategy context

Ask what research they have already done about the company, product, audience, and competitors. Request any notes, docs, customer interviews, positioning docs, pitch decks, landing pages, or strategy memos they can share.

Probe for:

- Who the product or site is for
- What pain it solves
- Why users choose it over alternatives
- Competitors and substitutes
- Strong opinions or positioning claims
- Best customers and bad-fit customers
- Existing content that already converts
- Topics they do not want to target

If the user has not done this yet, offer to help research positioning using the company website, competitor pages, reviews, forums, and web search.

Write to `positioning`: the problem, the differentiator, and any claims the user wants defended. Write who the site is for to `audience`. Ask about voice, banned words or phrases, and topics to avoid, and write those to `writing` — content-drafting workflows read that section.

### 6. Save competitors

Turn the competitors and substitutes from step 5 into `add_competitors` entries: one row per domain, with a short `notes` line on why they matter ("direct competitor, owns the comparison pages"). If the user is unsure who competes in search, `find_serp_competitors` on a handful of seed keywords will name them (paid, needs the spend scope) — confirm the list with the user before saving, and log the spend.

Competitors saved here are reused by `competitive-landscape`, `competitor-analysis`, and `link-prospecting`. The brands tracked in AI answers are managed separately (see `ai-project-setup`); mention it if the lists should match.

### 7. Inventory key assets

Ask for or discover:

- Sitemap or important URL list
- Current blog/resources/content library
- Product/category/feature pages
- Existing keyword lists (`list_saved_keywords`)
- Current rank trackers (`get_rank_tracker`)
- Backlink or PR assets
- Linkable assets such as studies, templates, tools, datasets, calculators, or original opinions

Save the pages that actually matter with `add_key_pages` — money pages, topic hubs, and the linkable assets. This is a curated shortlist, not a site inventory: 10 to 30 URLs is normal. Give each one a `role` and, where known, the `topic` it targets.

### 8. Connect Google Search Console and Google Analytics

Search Console is the richest first-party signal: existing impressions, near-ranking terms, and pages that already have search demand. Google Analytics adds sessions and key events per landing page.

Both are connected in the AutoSEO app, on the project's Integrations page (an admin may first need to add the Google OAuth client in Admin → Data Providers). Check the connection with `get_search_console_performance` and `get_google_analytics_measurement_health`; they return a clear "not connected" error with the link otherwise. Once connected, `keyword-research`, `keyword-clustering`, and `seo-audit` read the data directly — no manual files to maintain.

If the user cannot connect Google, ask for Search Console CSV exports (queries and pages, last 3 and 16 months) in a local `gsc/` folder instead.

### 9. Set up a local folder only for file work

Project knowledge lives in AutoSEO, not on disk. A local folder is still useful for the things that are actually files: exports, crawls, drafts, briefs.

If the user wants one, suggest `~/SEO/<company-or-site>/` or a folder beside the website/content repo, with a structure like:

```text
seo-workspace/
  gsc/
  drafts/
```

Do not create folders unless the user asks, and do not duplicate goals, positioning, or competitors into a local file — that is what the project context is for.

### 10. Recommend first workflow

After intake, recommend one next AutoSEO workflow:

- `seo-audit`: when the site already exists and the user wants to know what to fix or do first, especially if they are new to SEO
- `ai-visibility-report`: when being named by AI assistants matters and prompts are already tracked
- `keyword-research`: when the user needs ideas from seed topics
- `keyword-clustering`: when they have keywords or Search Console data to map to pages
- `competitive-landscape`: when the market is unclear
- `competitor-analysis`: when they know a competitor to study
- `link-prospecting`: when they have a linkable asset or target page

## Output format

Use a checklist with statuses:

| Step | Status | Notes | Next action |
| ---- | ------ | ----- | ----------- |

Then summarize:

- AutoSEO MCP/project status and scopes
- Sites in scope
- Goals
- Known positioning
- Competitors saved
- Key pages saved
- Search Console / Google Analytics status and any local files
- Sections still missing from project context
- Recommended next workflow

Tell the user they can read and edit everything saved here on the project's Brand Knowledge page.

## Guardrails

- Keep setup lightweight. The user should feel oriented, not assigned homework.
- Confirm facts with the user before writing them. Inferences from the site are fine to propose, but they get saved as agreed answers, not guesses.
- Do not pretend a CSV has been uploaded unless you can see it, and do not claim Search Console is connected unless `get_search_console_performance` confirms it.
- Keep project setup focused on setup and context unless the user asks for live research. If a step does spend money, append a research-log entry so other skills do not re-buy it.
- If web search or scraping is used for positioning research, distinguish source evidence from inference.
- `set_section` replaces a section. When context already exists, merge the new answers into the existing prose instead of discarding it.
