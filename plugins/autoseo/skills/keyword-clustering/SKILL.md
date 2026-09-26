---
name: keyword-clustering
description: "Cluster keywords by intent and map them to existing or proposed pages."
---

# AutoSEO Keyword Clustering

## Goal

Group keywords into page-level clusters and decide which existing or new page should target each cluster. This is a keyword mapping workflow, not just a semantic grouping exercise.

## Required inputs

- `projectId`
- A keyword list, saved keyword tag, seed topic, or target domain
- Optional existing URLs/pages to map against

If keywords are not provided, use `list_saved_keywords` for saved sets (filter with `tags`), `research_keywords` for seed discovery, or `get_ranked_keywords` when the user starts from a target domain.

## Project context

Project context is free and shared with the AutoSEO app (Brand Knowledge page) and other agents.

1. Call `get_project_context` first and ground the mapping in it — the saved key pages are the existing pages clusters should map to, and the business and goal decide which clusters are worth targeting.
2. This skill needs key pages. If none are saved, run a minimal inline setup: ask the user for the pages that matter, or propose a shortlist from the site, a site audit (`get_audit_pages`), or Search Console (`get_search_console_performance` with `dimension: "page"`) and confirm it, write it back with `update_project_context` (`add_key_pages`), then continue the clustering. Never front-load the full interview; suggest `seo-project-setup` at the end for the rest.
3. Before spending, check the `researchLog`. If the same research ran within the last 30 days, reuse that result and say so instead of re-buying it.
4. On finish, write back what is durable with `update_project_context` — new or corrected `add_key_pages` entries with the topic each page now targets — and append `{ op: "append_research_log", summary: "Keyword clustering: <keyword set>. Verdict: <conclusion>" }`.

## Deliver as a report

Deliver through the `seo-report` skill. If that skill is not available, say so and stop before writing HTML.

## AutoSEO MCP tools

Paid tools use DataForSEO and need the connection's **spend** scope.

- `list_saved_keywords`: fetch an existing keyword set, optionally filtered by `tags`.
- `research_keywords`: expand a seed when the user starts from a topic.
- `get_ranked_keywords`: exact ranking keywords and the URL that ranks for each, when the user starts from a domain or page. Several of the user's own URLs ranking for the same keyword is the best available cannibalization signal.
- `get_search_console_performance`: when Search Console is connected, pull real queries (`dimension: "query"`) and the pages earning impressions (`dimension: "page"`). The synced data does not combine query and page in one row, so confirm query-to-page mapping with `get_ranked_keywords` or `get_serp_results`.
- `get_serp_results`: validate whether keywords belong on the same page by checking SERP overlap and intent.
- `get_local_serp_results` and `search_local_businesses`: use for local SEO clusters when Maps/local-pack intent should affect page mapping.
- `save_keywords` / `tag_saved_keywords`: optionally tag final clusters after user confirmation.

## Workflow

1. Gather the candidate keyword set.
   - Use Search Console queries when connected to start from real demand, and `get_ranked_keywords` for the pages already ranking for them.
   - Use `get_ranked_keywords` for domain/page-driven clustering.
   - Use `search_local_businesses` and `get_local_serp_results` when proximity, local packs, or Google Business results determine whether terms belong on location pages.
2. Remove duplicates, irrelevant terms, and terms that clearly require a different product or audience.
3. Build clusters around intent and page type:
   - Same SERP intent and similar ranking pages belong together.
   - Different intent, buyer stage, or SERP format should be split.
   - Similar words do not guarantee the same cluster.
4. For important borderline terms, use a small `get_serp_results` batch to check overlap.
5. Assign each cluster to:
   - Existing URL, if supplied and appropriate
   - New page recommendation, if no existing page fits
   - Do-not-target / later bucket, if weak or off-strategy
6. Identify cannibalization risk when multiple pages would target the same intent. Confirm it from ranking data (two or more of the user's URLs ranking for the same query in `get_ranked_keywords`, or alternating in `get_serp_results`), not from similar titles alone.
7. Ask before applying cluster tags with `tag_saved_keywords` or `save_keywords`.

## Output format

`h1`: the site or keyword set.

If a report template applies (see `seo-report`), its sections and tone replace this list.

Sections in this order:

1. **The map** — one or two opening sentences: how many clusters, how many pages to create, how many to update, and any cannibalization found.
2. **Clusters** — a table of cluster, primary keyword, intent, target page, and priority. Keep secondary keywords in the per-cluster briefs, not in this table.
3. **Page briefs** — one finding per cluster: the page type and the searcher's problem, then the page to create or update. List required sections and internal links underneath.
4. **Cannibalization** — a table of the query, the competing URLs, and which one to keep, only when there is real evidence for it.
5. **What to do next** — an ordered list, including the tag suggestions and the explicit ask before applying them.
6. **How this report was made** — opens with the skill line from `seo-report` ("AutoSEO Keyword Clustering skill", `keyword-clustering`), then where the keywords came from, and a note labelling target pages as proposed when no URL data was supplied.

## Guardrails

- Do not over-cluster tiny keyword sets. If there are fewer than 10 usable terms, produce a simple map.
- Do not rely on lexical similarity alone. SERP intent wins.
- Do not replace tags broadly without explicit confirmation.
- If existing URL data is missing, label target pages as proposed.
