---
name: competitive-landscape
description: "Map SEO market leaders, winning content themes, keyword coverage, backlinks, and strategic gaps."
---

# AutoSEO Competitive Landscape

## Goal

Answer: "Who is winning this SEO market, what content is working for them, and where are the openings?"

Use this when the user wants a market-level view across several competitors. For a deep dive on one domain, use `competitor-analysis`. For who wins in AI assistant answers rather than Google, use `competitor-gap`.

## Required inputs

- `projectId`
- Topic, seed keywords, market/category, or user's domain
- Optional known competitors
- Optional market (`locationCode` / `languageCode`; the project market is the default)

## Project context

Project context is free and shared with the AutoSEO app (Brand Knowledge page) and other agents.

1. Call `get_project_context` first and ground the market read in it — the saved competitors are the starting roster, and the business and positioning decide who counts as a competitor.
2. This skill needs competitors. If none are saved, run a minimal inline setup: ask the user who they compete with, or infer a shortlist from `find_serp_competitors` and the site and confirm it, write it back with `update_project_context` (`add_competitors`), then continue the landscape work. Never front-load the full interview; suggest `seo-project-setup` at the end for the rest.
3. Before spending, check the `researchLog`. If the same research ran within the last 30 days, reuse that result and say so instead of re-buying it.
4. On finish, write back what is durable with `update_project_context` — every confirmed competitor via `add_competitors` with a short note on why they matter, plus `remove_competitors` for entries you added that turned out irrelevant (leave rows the user added alone) — and append `{ op: "append_research_log", summary: "Competitive landscape: <market/query set>. Verdict: <conclusion>" }`.

## Deliver as a report

Deliver through the `seo-report` skill. If that skill is not available, say so and stop before writing HTML.

## AutoSEO MCP tools

Paid tools use DataForSEO and need the connection's **spend** scope.

- `research_keywords`: discover representative market queries.
- `get_keyword_metrics`: validate known query sets with volume, difficulty, intent, and trends.
- `get_serp_results`: identify recurring ranking domains across target queries (up to 10 queries per call).
- `find_serp_competitors`: compare domains competing across supplied keywords; use this before manual SERP counting when a keyword set is available.
- `get_domain_overview`: size organic footprint for candidate leaders.
- `get_search_console_performance`: when the user's own domain is in the comparison and Search Console is connected, anchor their position with first-party clicks/impressions/CTR rather than third-party estimates.
- `get_ranked_keywords`: exact ranking keywords, URLs, ranks, and intents for leaders (`domain`, filters such as `maxRank`, `minSearchVolume`, `excludeTerms`).
- `get_domain_top_pages`: which pages carry a leader's traffic — the fastest read of what content works for them.
- `get_backlinks_overview`: compare backlink/referring-domain strength where relevant.
- `search_local_businesses`, `get_local_serp_results`, and `get_google_business_questions`: use for local SEO markets where proximity, Maps rankings, business categories, reviews, or Google Q&A affect who is winning.
- `get_competitor_ranking` (free): how the same brands fare in AI assistant answers, when the project tracks AI visibility — a useful contrast column, not a substitute for SERP evidence.

## Workflow

1. Define the market query set:
   - Use provided keywords, or call `research_keywords` to build 5-10 representative queries.
   - Include mixed intent: informational, commercial, comparison, and tool/software terms when applicable.
   - For local SEO, include neighborhood/city/service-area queries and identify the priority locations or coordinates.
2. If the query set is already known, use `get_keyword_metrics` to validate relative demand and difficulty and `find_serp_competitors` to identify recurring domains at scale.
3. For local SEO, call `search_local_businesses` and `get_local_serp_results` for the highest-priority location(s) before synthesizing winners. Use `get_serp_results` as a complement for organic pages, not as the only local evidence.
4. Call `get_serp_results` for representative queries when live SERP composition or ranking URLs need inspection. Send at most 10 queries per call.
5. Identify recurring domains and group them by type:
   - Direct product competitors
   - Publishers/media
   - Marketplaces/directories
   - Communities/forums
   - Documentation/resources
6. For the strongest recurring domains, call `get_domain_overview`; default to the top 3-5 domains before expanding.
7. For direct competitors and relevant publishers, call `get_ranked_keywords` (and `get_domain_top_pages` when page-level patterns matter).
8. Use `get_backlinks_overview` when backlink authority appears important or the user asks why a domain is winning. Backlink data may be unavailable if the DataForSEO account has not enabled it; continue with SERP/domain evidence if it fails.
9. Synthesize patterns: content types, themes, SERP formats, local-pack signals, authority advantages, and underserved angles.

## Output format

`h1`: the market or category.

If a report template applies (see `seo-report`), its sections and tone replace this list.

Sections in this order:

1. **The market read** — one or two opening sentences naming the leaders, the most winnable area, and the biggest barrier.
2. **Who is winning** — a table of domain, type, organic footprint, winning themes, and the gap. Label domain types explicitly.
3. **Why they win** — one finding per pattern, the Fix pointing at what the user should do instead.
4. **Gaps and openings** — a table of theme, demand, and who currently owns it, plus a bar chart when a handful of themes carry the demand.
5. **What to do next** — an ordered list ending in the next workflow to run: competitor analysis, keyword clustering, or a content brief.
6. **How this report was made** — opens with the skill line from `seo-report` ("AutoSEO Competitive Landscape skill", `competitive-landscape`), then the query set used, and a note calling the read directional when the query set was small.

## Guardrails

- Distinguish SEO competitors from business competitors.
- Do not overstate exact traffic when AutoSEO returns estimates.
- If using a small query set, call the result directional.
- Do not assume a publisher is a product competitor; label domain types clearly.
- For local markets, distinguish organic-page winners from Maps/local-pack winners.
