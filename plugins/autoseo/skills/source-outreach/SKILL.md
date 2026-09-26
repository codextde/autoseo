---
name: source-outreach
description: "Find the third-party pages AI assistants cite most for the brand's topics, check whether the brand is listed there, and plan outreach to get included."
---

# AutoSEO Source Outreach

## Goal

AI assistants lean on a small set of pages (listicles, tests, reviews, forums) when they answer. Find those pages for the tracked prompts, see which ones leave the brand out, and plan realistic ways to get included or corrected.

For classic backlink prospecting from Google SERPs, use `link-prospecting`.

## Required inputs

- `projectId`
- Optional period (`timeframeDays`, default 30), `model`, `tags`, a competitor to focus on

## Project context

Project context is free and shared with the AutoSEO app (Brand Knowledge page) and other agents.

1. Call `get_project_context` first. `positioning` supplies the reason a publisher should include the brand; saved competitors show who is already listed.
2. If `positioning` is empty, ask the user in one line why a reviewer should include them and save it with `update_project_context` (`set_section`).
3. Check the `researchLog` for earlier outreach plans within 30 days.
4. On finish, append `{ op: "append_research_log", summary: "Source outreach: <scope>. Verdict: <conclusion>" }`.

## Deliver as a report

Deliver through the `seo-report` skill. If that skill is not available, say so and stop before writing HTML.

## AutoSEO MCP tools

- `get_top_sources` (free): most cited URLs and domains, content type, ownership, models, change vs previous period.
- `get_competitor_gap_analysis` (free): sources cited in answers that name a competitor but not the brand.
- `get_answer_content` (free): how a source is used inside an answer.
- `get_domain_overview`, `get_backlinks_overview` (paid, spend scope): qualify a publisher when priority is unclear.
- Web search / browsing (outside AutoSEO): open each source, check whether the brand is listed, and find the editor or author contact.

## Workflow

1. `get_top_sources` grouped by domain, then by URL for the top domains. Keep third-party sources; own pages are a different job.
2. `get_competitor_gap_analysis` (all competitors) to add the sources that appear in answers where the brand is missing.
3. Open each candidate page: is the brand listed? Is the information current? Is it editorial, user-generated, a marketplace, or paid placement?
4. Pick the angle per source: inclusion in a list, correction of outdated facts, a product test or sample, an expert quote, a community answer (disclose affiliation).
5. Find contact paths only from public sources and record where each was found.
6. Draft two or three reusable outreach messages.

## Output format

1. **The angle** — the source to approach first and why it matters for AI answers.
2. **Sources** — a table of URL, type, citations, models, brand listed (yes/no/outdated), angle, contact path.
3. **Outreach drafts** — two or three short messages.
4. **What to do next** — ordered list.
5. **How this report was made** — the skill line ("AutoSEO Source Outreach skill", `source-outreach`), period, and which contacts came from the web.

## Guardrails

- Never invent contacts; attribute each to the page it came from.
- Flag paid placements and direct competitors.
- Community answers must disclose the affiliation; never recommend sock-puppet posts.
