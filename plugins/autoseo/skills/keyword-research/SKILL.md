---
name: keyword-research
description: "Discover keyword opportunities, evaluate metrics and SERPs, and save/tag promising terms."
---

# AutoSEO Keyword Research

## Goal

Turn seed topics into a prioritized keyword opportunity set using AutoSEO MCP data. The output should help the user decide what to target, what to save, and what to research next.

## Required inputs

- `projectId`
- One or more seed topics, products, pages, competitors, or audience problems
- Optional market (DataForSEO `locationCode` / `languageCode`)

If `projectId` is missing, use `list_projects` first. The project's market is the default for every tool; if a different market would materially change the metrics, ask the user.

## Project context

Project context is free and shared with the AutoSEO app (Brand Knowledge page) and other agents.

1. Call `get_project_context` first and ground the research in it — the business, the goal, the market, and the competitors and key pages already saved.
2. This skill needs the `business_overview` and `goal` sections. If either is empty, run a minimal inline setup: ask the user, or infer from the site and confirm, just enough to fill them, write them back with `update_project_context` (`{ op: "set_section", section, content }`), then continue the research. Never front-load the full interview; suggest `seo-project-setup` at the end for the rest.
3. Before spending, check the `researchLog`. If the same research ran within the last 30 days, reuse that result and say so instead of re-buying it. `list_saved_keywords` shows what was already saved.
4. On finish, write back what is durable — a sharpened `business_overview` or `goal`, competitors that kept appearing in the SERPs via `add_competitors`, pages the keywords should land on via `add_key_pages` — and append `{ op: "append_research_log", summary: "Keyword research: <seeds/market>. Verdict: <conclusion>" }`.

## Deliver as a report

Deliver through the `seo-report` skill. If that skill is not available, say so and stop before writing HTML.

## AutoSEO MCP tools

Paid tools use DataForSEO and need the connection's **spend** scope (their descriptions give the approximate cost). `whoami` shows the scopes.

- `research_keywords`: primary discovery tool. Pass `seeds: [{ seed }]` (1–5 per call) and prefer `resultLimit: 150` unless the user asks for exhaustive research.
- `get_keyword_metrics`: hydrate up to 700 known keywords with volume, keyword difficulty (KD), search intent, CPC, and monthly trends in one call. Use it to score candidate or known terms — including the Search Console striking-distance queries from step 1.
- `get_ranked_keywords`: exact ranking keyword rows for a `domain` (or a page with `scope: "exact_url"`) when a target domain or page is part of the brief.
- `get_search_console_striking_distance` / `get_search_console_performance`: when Search Console is connected, start from the project's real first-party demand — queries already earning impressions and near-ranking ("striking distance") terms. With the performance tool pass `dimension: "query", minPosition: 5, maxPosition: 20, minImpressions: 50`. Data is synced daily (2–3 day lag). Then hydrate those queries with `get_keyword_metrics` to attach difficulty and intent.
- `get_serp_results`: inspect SERPs for the top candidate terms (`queries: [{ keyword }]`, up to 10), especially when intent is ambiguous.
- `search_local_businesses`, `get_local_serp_results`, and `get_google_business_questions`: use for local SEO topics when a business/location radius matters. Local tools run asynchronously; if one returns a `runId`, fetch the result with `get_local_seo_run`.
- `list_saved_keywords`: avoid duplicating already-saved work, or use existing tags as context.
- `save_keywords` / `tag_saved_keywords`: save or tag selected keywords only after explicit user confirmation.
- `get_query_fanouts`: the sub-queries AI assistants searched while answering the project's tracked prompts — a useful source of long-tail seeds and of how buyers phrase questions.

## Workflow

1. Normalize seeds into a small set of distinct research angles. If Search Console is connected, first pull the striking-distance queries and hydrate them with `get_keyword_metrics`. That ranked, hydrated list is your fastest opportunity set — work it before broad discovery.
2. If the request is local SEO, identify the business, location/coordinates or service area, and local categories. Use `search_local_businesses` and `get_local_serp_results` for the most important location/keyword set instead of relying only on national keyword/SERP data.
3. Call `research_keywords` for exploratory seeds. Use bulk calls when possible.
4. Use `get_keyword_metrics` to hydrate a fixed keyword list — or the striking-distance queries from step 1 — with volume, KD, and intent before prioritizing.
5. Use `get_ranked_keywords` when the user provides a domain/page and wants opportunities based on current rankings, near-misses (`minRank: 4, maxRank: 20`), or competitor-owned terms.
6. Remove irrelevant, duplicate, branded-only, and off-intent terms.
7. Prioritize by practical opportunity, not volume alone:
   - Strong match to the user's product/page/topic
   - Clear search intent
   - Reasonable difficulty
   - Useful volume/CPC signal
   - SERP where the user can plausibly compete
   - For local SEO, local-pack/Maps visibility and proximity fit
8. Use `get_serp_results` for high-potential or ambiguous keywords when SERP intent would change the recommendation; keep the default check small.
9. Present a shortlist and a longer opportunity table.
10. Ask before saving keywords. When saving, suggest concise tags such as `topic:<topic>`, `intent:<intent>`, or `page:<slug>`.

## Output format

`h1`: the site or topic.

If a report template applies (see `seo-report`), its sections and tone replace this list.

Sections in this order:

1. **The opportunity** — one or two opening sentences naming the best theme and why the site can win it now.
2. **Target these now** — a table of keyword, intent, volume, KD, CPC, and the page to make. Add a bar chart comparing the volumes of the shortlist.
3. **Why these** — one finding per keyword that needs justifying: the SERP or metric evidence, then the page to build.
4. **The longer opportunity list** — a second table, same columns.
5. **Risks and caveats** — notes: SERP intent that would change the recommendation, missing metrics written as `unknown`, close-variant volumes that are one bucket rather than several.
6. **What to do next** — an ordered list, including whether to run keyword clustering, write a content brief, or save the chosen keywords.
7. **How this report was made** — opens with the skill line from `seo-report` ("AutoSEO Keyword Research skill", `keyword-research`), then which tools returned what.

## Guardrails

- Do not invent metrics. If AutoSEO does not return a value, write `unknown`.
- Do not call `save_keywords` or `tag_saved_keywords` without explicit confirmation.
- Prefer business-fit and intent-fit over chasing the largest volume term.
