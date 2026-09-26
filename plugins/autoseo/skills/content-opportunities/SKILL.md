---
name: content-opportunities
description: "Turn AI query fan-outs, prompts where the brand is invisible, and cited-source patterns into a prioritized content plan — optionally drafting briefs with AutoSEO's content generator."
---

# AutoSEO Content Opportunities

## Goal

Find the questions AI assistants (and the searches they run behind the scenes) cannot answer with the brand yet, and plan the few pages that would change that.

## Required inputs

- `projectId`
- Optional period (`timeframeDays`, default 90 for fan-outs), `model`, `tags`

## Project context

Project context is free and shared with the AutoSEO app (Brand Knowledge page) and other agents.

1. Call `get_project_context` first. `key_pages` are the pages to extend before proposing new ones; `writing` holds the voice rules for any draft.
2. This skill needs key pages. If none are saved, propose a shortlist from the site and confirm it, then save it with `update_project_context` (`add_key_pages`).
3. Check the `researchLog` and `list_content` so you do not re-plan pages that are already drafted.
4. On finish, save new target pages with `add_key_pages` (role `spoke` or `hub`) and append `{ op: "append_research_log", summary: "Content opportunities: <scope>. Verdict: <conclusion>" }`.

## Deliver as a report

Deliver through the `seo-report` skill. If that skill is not available, say so and stop before writing HTML.

## AutoSEO MCP tools

- `get_query_fanouts` (free): sub-queries AI assistants ran while answering tracked prompts, with frequency and models.
- `list_prompts` / `get_prompt_details` (free): prompts with low visibility or no own-domain citations.
- `get_top_sources` (free): which content types (listicles, guides, tests, reviews) get cited for the topic.
- `get_keyword_metrics` (paid, spend scope): search demand for the fan-out queries — they double as Google keywords.
- `list_content` / `get_content` (free): existing drafts and their AEO scores.
- `generate_content` (write + spend scope, AI job): draft a brief or article for a chosen opportunity — only after the user picks it.

## Workflow

1. Pull `get_query_fanouts` for the period and group the queries into themes. Frequency across models is the demand signal inside AI answers.
2. Pull `list_prompts` sorted by low visibility; keep prompts with answers but no brand mention or no own citation.
3. For each theme, check with `get_top_sources` which content type AI cites, and whether an existing key page could answer it.
4. Optionally hydrate the strongest fan-out queries with `get_keyword_metrics` to add Google demand (paid — ask first if the batch is large).
5. Decide per theme: extend an existing page, create a new page, or skip (off-strategy or already covered).
6. Pick the top three to five. For each, write the target question, the page type AI tends to cite, the must-have facts, and the page to link from.
7. Offer to draft one with `generate_content`; start it only on confirmation and report the content id and where to review it.

## Output format

1. **The plan** — two bullets: the biggest theme AI answers without you, and the first page to build.
2. **Opportunities** — a table of theme, example prompts/fan-outs, AI frequency, Google volume (if pulled), page to create or extend, priority.
3. **Briefs** — one short brief per chosen opportunity: question answered, format, must-cover facts, internal links.
4. **What to do next** — ordered list; which brief to draft first.
5. **How this report was made** — the skill line ("AutoSEO Content Opportunities skill", `content-opportunities`), period, and data sources.

## Guardrails

- Fan-out queries are machine-generated searches, not people; call their frequency "AI search frequency", not volume.
- Do not propose thin pages that restate one fan-out query; group them.
- Never start `generate_content` without the user's go-ahead.
