---
name: competitor-gap
description: "Find where competitors are named or cited in AI assistant answers and the brand is missing — prompts, cited sources and head-to-head claims — and turn the biggest gaps into actions."
---

# AutoSEO Competitor Gap (AI Answers)

## Goal

Show which buying questions AI assistants answer with a competitor instead of the brand, why (which sources they rely on, what they claim), and which gaps are worth closing first.

For Google organic competition, use `competitor-analysis` or `competitive-landscape` instead.

## Required inputs

- `projectId`
- Optional competitor (id, name or domain from `get_competitor_ranking`); omit for all tracked competitors
- Optional period (`timeframeDays`, default 30), `model`, `tags`

## Project context

Project context is free and shared with the AutoSEO app (Brand Knowledge page) and other agents.

1. Call `get_project_context` first; `positioning` tells you which gaps are worth fighting for and which are off-strategy.
2. If `positioning` is empty, ask the user in one line what they want to be recommended for, and save it with `update_project_context` (`set_section`).
3. Check the `researchLog` for an earlier gap analysis of the same competitor within 30 days and build on it.
4. On finish, append `{ op: "append_research_log", summary: "AI competitor gap: <competitor|all>. Verdict: <conclusion>" }`.

## Deliver as a report

Deliver through the `seo-report` skill. If that skill is not available, say so and stop before writing HTML.

## AutoSEO MCP tools (free)

- `get_competitor_ranking`: pick the competitor(s) that lead; sort by `visibility` or `mentionRate`.
- `get_competitor_gap_analysis`: prompts where the competitor is named but the brand is not, and the sources cited in those answers.
- `get_competitor_h2h`: KPIs side by side, answers naming both (who is named first), AI comparison claims, and competitor sentiment.
- `get_answer_content`: read the actual answers behind the biggest gaps.
- `get_top_sources`: whether the gap sources also cite the brand elsewhere.
- `get_query_fanouts`: what the assistants searched for on the gap prompts.

## Workflow

1. `get_competitor_ranking` to choose the competitor (or confirm the user's choice) and note the visibility gap per model.
2. `get_competitor_gap_analysis` for that competitor. Take the top gap prompts by gap answers and the top sources cited in gap answers.
3. Read two or three gap answers with `get_answer_content`: what does the assistant say about the competitor that it cannot say about the brand?
4. `get_competitor_h2h`: where both are named, who wins, and which claims favour the competitor.
5. Classify each gap: missing content (the brand has no page answering the question), missing source presence (third-party pages that list the competitor but not the brand), weaker claims (reviews, pricing, features), or off-strategy (not worth closing).
6. Rank gaps by prompt importance (tags, funnel stage) × gap size × feasibility.

## Output format

1. **The gap** — two bullets: where the competitor wins in AI answers and the gap to close first.
2. **Prompts they win** — a table of prompt, gap answers, your mention rate, competitor mentions.
3. **Sources behind the gap** — a table of URL/domain, content type, gap answers citing it, and whether the brand is listed there.
4. **Head to head** — wins/losses/ties and the claims that favour the competitor, quoted.
5. **What to do next** — an ordered list: content to create, sources to approach (hand off to `source-outreach`), claims to substantiate.
6. **How this report was made** — the skill line ("AutoSEO Competitor Gap skill", `competitor-gap`), period, models and prompt count.

## Guardrails

- A gap in a handful of answers is weak evidence; show the answer counts.
- Quote claims exactly; do not paraphrase a competitor claim into something stronger.
- Do not recommend copying competitor content; recommend a better answer to the same question.
