---
name: ai-project-setup
description: "Set up AI visibility tracking for a project — the prompts buyers ask AI assistants, tags, and the competitors to benchmark — using prompt research and the project's context."
---

# AutoSEO AI Visibility Setup

## Goal

Give the project a tracked prompt set that reflects what real buyers ask AI assistants, grouped with tags, so every AI visibility metric means something. This complements `seo-project-setup` (business context); run that first if the context is empty.

## Required inputs

- `projectId` (or create one with `create_project`, which needs the spend scope)
- Optional: seed topics, personas, markets, competitor names

## Project context

Project context is free and shared with the AutoSEO app (Brand Knowledge page) and other agents.

1. Call `get_project_context` and `get_project` first: business, audience, positioning, market, tracked AI models.
2. This skill needs `business_overview` and `audience`. If empty, ask the user in a few lines and save them with `update_project_context` (`set_section`).
3. Check `list_prompts` (status `all`) and `get_tags` so you extend the prompt set instead of duplicating it.
4. On finish, append `{ op: "append_research_log", summary: "AI tracking setup: <prompts added>. Verdict: <conclusion>" }`.

## AutoSEO MCP tools

- `list_prompts`, `get_tags`, `get_competitor_ranking` (free): what is tracked today.
- `list_prompt_research_lists` / `list_prompt_research_items` (free): researched prompt candidates with volume scores.
- `generate_prompt_research` (write + spend scope, AI job): generate a researched prompt list from the brand profile — confirm first.
- `run_prompt_explorer` / `run_brand_lookup` (spend scope): see what AI assistants answer for a topic or the brand before choosing prompts.
- `add_research_prompts_to_tracker` or `add_prompts` (write + spend scope): add the chosen prompts; tracking runs start right away and cost money per prompt × model.
- `get_query_fanouts` (free): phrasing ideas from existing tracked prompts.

## Workflow

1. Summarize what is tracked (prompt count, tags, models, competitors) and what is missing from the buyer journey (awareness, comparison, purchase).
2. Propose 15–40 prompts in the buyer's words, not keywords: problems, "best X for Y", comparisons with named competitors, and a few branded questions. Mix funnel stages; tag them (`topic:<x>`, `stage:tofu|mofu|bofu`).
3. If research lists exist, prefer their items (they carry volume scores); otherwise offer `generate_prompt_research`.
4. Show the list and the estimated cost (prompts × tracked models per run) and ask for confirmation.
5. Add the confirmed prompts with tags; report how many were added, skipped as duplicates, or over the prompt limit.
6. Recommend the competitors to benchmark (from `get_competitor_ranking` and context); competitors are managed in the app's Competitors page.

## Output format

A short chat summary (this skill does not save a report):

- Prompts before → after, by tag and funnel stage
- Duplicates / over-limit skips
- Tracking run started (yes/no) and when first results appear
- Next workflow: `ai-visibility-report` after the first full tracking day

## Guardrails

- Never add prompts or start runs without explicit confirmation of the list and the cost.
- Do not track leading prompts that name the brand in every question; that inflates visibility.
- Keep prompts in the project's market language.
