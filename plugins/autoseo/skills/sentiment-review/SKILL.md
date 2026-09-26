---
name: sentiment-review
description: "Review how AI assistants describe the brand — sentiment score, what they praise and criticise, head-to-head claims — with quotes and concrete fixes."
---

# AutoSEO Sentiment Review

## Goal

Tell the user what AI assistants say about the brand when they mention it, which criticisms recur, where those claims come from, and what can realistically change them.

## Required inputs

- `projectId`
- Optional competitor to compare (`compareWith`), period (`timeframeDays`, default 30), `model`, `tags`

## Project context

Project context is free and shared with the AutoSEO app (Brand Knowledge page) and other agents.

1. Call `get_project_context` first. `positioning` lists the claims the brand wants to be known for — check whether AI repeats them.
2. If `positioning` is empty, ask the user in one line which strengths should come across and save it with `update_project_context` (`set_section`).
3. Check the `researchLog` for an earlier sentiment review and compare.
4. On finish, append `{ op: "append_research_log", summary: "Sentiment review: <period>. Verdict: <conclusion>" }`.

## Deliver as a report

Deliver through the `seo-report` skill. If that skill is not available, say so and stop before writing HTML.

## AutoSEO MCP tools (free)

- `get_sentiment_overview`: score 0–100 with change, praise / neutral / criticism mix, top praised and criticised attributes, the brand table vs competitors.
- `get_competitor_h2h`: comparison claims between the brand and one competitor.
- `get_answer_content`: the answers behind a criticism — quote them.
- `get_top_sources`: the pages cited in those answers, which is usually where a criticism originates.
- `list_tasks`: AutoSEO may already have generated reputation tasks for recurring criticism.

## Workflow

1. `get_sentiment_overview` for the period (with `compareWith` when the user names a competitor).
2. List the top three criticisms and top three praises with counts. For each criticism, read one or two answers with `get_answer_content` and note the sources cited.
3. Check whether each criticism is factual and current (visit the cited source and the brand's own page on the topic). Classify: outdated information, a real weakness, a misunderstanding, or a competitor-favouring source.
4. Match each to a fix: update or add an authoritative page, correct a third-party listing, answer the concern publicly, or change the product (flag, do not solve).
5. Check `list_tasks` for existing reputation tasks and reference them.

## Output format

1. **The verdict** — score and change, the one criticism to address first.
2. **What AI praises** — a table of attribute, mentions, a short quote.
3. **What AI criticises** — a table of attribute, mentions, a short quote, source, classification.
4. **Fixes** — one finding per criticism worth acting on: evidence, change, expected effect.
5. **What to do next** — ordered list.
6. **How this report was made** — the skill line ("AutoSEO Sentiment Review skill", `sentiment-review`), period, models.

## Guardrails

- Quote exactly and attribute each quote to a model and date.
- Do not recommend review gating, fake reviews, or astroturfing.
- A criticism that is true is a product issue; say so plainly instead of proposing messaging to hide it.
