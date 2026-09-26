---
name: ai-visibility-report
description: "Report how visible a brand is in AI assistant answers (ChatGPT, Perplexity, Google AI Overviews, Gemini, Claude…): KPIs and trend, competitors, cited sources, sentiment, and the next actions."
---

# AutoSEO AI Visibility Report

## Goal

Explain, for one project and period, how often AI assistants name or cite the brand when people ask the tracked prompts, how that compares with competitors and the previous period, why, and what to do next. The reader is a marketer or founder, not an SEO specialist.

Use this for a monthly check-in or when the user asks "how do we show up in ChatGPT?". For one competitor, use `competitor-gap`; for content ideas, `content-opportunities`.

## Required inputs

- `projectId` (`list_projects`)
- Optional period: `timeframeDays` (default 30) or `startDate`/`endDate`; optional `model` (AI engine ids) and `tags`

## Project context

Project context is free and shared with the AutoSEO app (Brand Knowledge page) and other agents.

1. Call `get_project_context` first. Use `business_overview` and `goal` to decide which movements matter to the business.
2. This skill needs no section to run; if `goal` is empty, ask the user in one line what AI visibility should achieve and save it with `update_project_context` (`set_section`).
3. Check the `researchLog` and `list_reports` for the previous AI visibility report; compare against it instead of starting from zero.
4. On finish, append `{ op: "append_research_log", summary: "AI visibility report: <period>. Verdict: <conclusion>" }`.

## Deliver as a report

Deliver through the `seo-report` skill. If that skill is not available, say so and stop before writing HTML.

## AutoSEO MCP tools (all free — they read tracked answers)

- `get_visibility_metrics`: visibility, mention rate, citation rate, average position, sentiment, share of voice — current vs previous period, with definitions.
- `get_visibility_timeseries`: daily series; use it to date a change.
- `get_competitor_ranking`: the brand against tracked competitors on the same metrics, with per-model visibility.
- `list_prompts` / `get_prompt_details` / `get_answer_content`: which prompts moved, and the actual answer text behind a claim.
- `get_top_sources`: the pages and domains AI assistants cite (`groupBy: "domain"` for the overview).
- `get_sentiment_overview`: how the brand is described, top praise and criticism.
- `get_tags`: the prompt groups to slice by.
- `list_tasks`: optimization tasks AutoSEO already generated from the same signals — reference them instead of inventing a new backlog.

## Workflow

1. Resolve the project and period. Pull `get_visibility_metrics` and `get_visibility_timeseries`. If there are no answers in the period, stop: tracking has not run yet (point the user to Model Settings) — do not write a report about empty data.
2. Pull `get_competitor_ranking` (sorted by visibility) and note who leads each model.
3. Find what moved: `list_prompts` for the biggest visibility changes (both directions); open 2–3 with `get_prompt_details` and read one representative answer each with `get_answer_content`.
4. Explain the movement with evidence: new or lost citations (`get_top_sources` with the same filters), competitor gains, sentiment shifts (`get_sentiment_overview`), or tracking changes (new prompts or models). Say "unexplained" when the data does not show a cause.
5. Pick at most three actions, each tied to evidence: a source to get included in, a prompt cluster to write for, a sentiment issue to address, or an existing task from `list_tasks`.

## Output format

`h1`: "AI Visibility — <project>" per the `seo-report` title rules.

1. **The verdict** — three bullets: headline KPI and change, the biggest driver, the one action.
2. **Scorecard** — a table of KPI, this period, previous, change (visibility, mention rate, citation rate, avg position, sentiment, share of voice) with definitions in a `.note`.
3. **Versus competitors** — a table of brand, visibility, mention rate, citation rate, avg position; a bar chart of visibility.
4. **What moved and why** — one finding per material change, with the prompt, the model, and a short quote from the answer.
5. **Where AI gets its information** — top cited domains and whether the brand's own pages are among them.
6. **What to do next** — an ordered list of at most three actions.
7. **How this report was made** — the skill line from `seo-report` ("AutoSEO AI Visibility Report skill", `ai-visibility-report`), the period, models and prompt count, and a note that answers vary run to run.

## Guardrails

- AI answers are sampled; small prompt sets swing. Call changes under ~5 points on fewer than 20 prompts "within normal variation".
- Quote answers exactly and say which model and date they came from.
- Never claim an AI assistant "ranks" the brand like Google; describe mentions, citations and position in the answer.
- Do not recommend tactics that manipulate AI answers (fake reviews, hidden text, prompt injection on pages).
