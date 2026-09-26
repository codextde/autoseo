import "server-only";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { aiAnswers, integrations, prompts } from "@/server/db/schema";
import { availableLlmProviders } from "@/server/ai/llm";
import { isDataForSeoConfigured } from "@/server/dataforseo/client";
import { getEngine } from "@/lib/engines";
import { registerTaskSignal } from "./registry";
import { rows } from "./helpers";
import type { TaskFinding } from "./types";

const SEARCH_CONSOLE = ["google_search_console", "bing_webmaster"];
const ANALYTICS = ["google_analytics", "matomo", "piwik_pro"];
const BOT_SOURCES = ["cloudflare", "akamai", "server_logs"];

/**
 * Setup gaps: tracking configuration that limits what AutoSEO can measure (no engines, too few
 * prompts, no competitors, tracking stalled, missing data connections, no AI provider).
 */
registerTaskSignal({
  key: "setup_gap",
  label: "Setup gaps",
  category: "setup",
  description: "Tracking configuration gaps (engines, prompts, competitors, integrations, AI provider).",
  datasets: ["Project settings", "Integrations", "AI answer tracking"],
  async collect(ctx) {
    const p = ctx.project;
    const base = `/p/${p.id}`;
    const findings: TaskFinding[] = [];

    const [promptStats] = await db
      .select({
        active: sql<number>`count(*) filter (where ${prompts.status} = 'active')`.mapWith(Number),
        branded: sql<number>`count(*) filter (where ${prompts.status} = 'active' and ${prompts.branded})`.mapWith(Number),
      })
      .from(prompts)
      .where(eq(prompts.projectId, p.id));
    const activePrompts = promptStats?.active ?? 0;

    const recentSince = new Date(ctx.now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
    const [answerStats] = await db
      .select({
        ok: sql<number>`count(*) filter (where ${aiAnswers.status} = 'ok')`.mapWith(Number),
        failed: sql<number>`count(*) filter (where ${aiAnswers.status} = 'error')`.mapWith(Number),
      })
      .from(aiAnswers)
      .where(and(eq(aiAnswers.projectId, p.id), gte(aiAnswers.answerDate, recentSince)));

    const connected = await db
      .select({ provider: integrations.provider, status: integrations.status })
      .from(integrations)
      .where(and(eq(integrations.projectId, p.id), inArray(integrations.provider, [...SEARCH_CONSOLE, ...ANALYTICS, ...BOT_SOURCES])));
    const has = (keys: string[]) => connected.some((c) => keys.includes(c.provider) && c.status === "connected");

    let botRows = 0;
    if (await ctx.tableExists("analytics_bot_visits")) {
      try {
        const [r] = await rows<{ n: number }>(sql`select count(*)::int as n from analytics_bot_visits where project_id = ${p.id} and ts >= ${ctx.since.toISOString()}`);
        botRows = Number(r?.n ?? 0);
      } catch {
        botRows = 0;
      }
    }

    const [llm, dfs] = await Promise.all([availableLlmProviders().catch(() => []), isDataForSeoConfigured().catch(() => false)]);

    const engines = (p.engines ?? []).filter((e) => getEngine(e));
    if (!engines.length) {
      findings.push({
        subject: ["no_engines"],
        category: "setup",
        title: "Enable AI engines for prompt tracking",
        summary: "No AI engine is enabled, so no answers are collected for this project.",
        description:
          "AutoSEO can only measure visibility on engines you enable. Turn on the engines your audience uses — at least ChatGPT, Perplexity and Google AI Overviews.",
        steps: ["Open Model Settings.", "Enable ChatGPT, Perplexity and Google AI Overview (plus any engine relevant to your market).", "Save and run tracking once."],
        acceptanceCriteria: ["At least three engines are enabled for the project.", "Answers from each enabled engine appear in the Tracker."],
        impact: 10,
        effort: 1,
        evidence: [{ kind: "note", label: "Enabled engines", value: "0" }],
        datasets: ["Project settings"],
        targetUrls: [`${base}/ai/models`],
        data: { engines },
      });
    }

    if (activePrompts === 0) {
      findings.push({
        subject: ["no_prompts"],
        category: "setup",
        title: "Add the prompts your customers ask AI",
        summary: "No prompts are tracked yet — visibility, competitors and sources stay empty until you add some.",
        description:
          "Prompts are the questions your audience asks ChatGPT, Perplexity & co. Track 20–50 of them across the funnel (problem-aware, comparisons, buying intent) to get a reliable visibility baseline.",
        steps: [
          "Open Prompt Research and generate prompt ideas for your topics.",
          "Add 20–50 prompts across TOFU, MOFU and BOFU (include comparisons against competitors).",
          "Tag them by topic so you can slice results later.",
        ],
        acceptanceCriteria: ["At least 20 active prompts are tracked.", "Prompts cover all three funnel stages."],
        impact: 10,
        effort: 2,
        evidence: [{ kind: "metric", label: "Active prompts", value: "0" }],
        datasets: ["Project settings"],
        targetUrls: [`${base}/ai/prompt-research`, `${base}/ai/tracker`],
        data: { activePrompts },
      });
    } else if (activePrompts < 15) {
      findings.push({
        subject: ["few_prompts"],
        category: "setup",
        title: `Expand your prompt set (${activePrompts} tracked)`,
        summary: "A small prompt set makes visibility swing wildly — aim for at least 20 prompts.",
        description: `Only ${activePrompts} prompts are tracked. With fewer than ~20 prompts a single answer changes your visibility score by several points, and topics or funnel stages stay uncovered.`,
        steps: ["Open Prompt Research and review suggested prompts.", "Add prompts for uncovered topics and buying-intent questions.", "Include comparison prompts that name your main competitors."],
        acceptanceCriteria: ["At least 20 active prompts are tracked."],
        impact: 6,
        effort: 2,
        evidence: [{ kind: "metric", label: "Active prompts", value: String(activePrompts), description: "Recommended: 20+" }],
        datasets: ["Project settings"],
        targetUrls: [`${base}/ai/prompt-research`],
        data: { activePrompts },
      });
    }

    const tracked = ctx.competitors.filter((c) => c.tracked);
    if (tracked.length === 0) {
      findings.push({
        subject: ["no_competitors"],
        category: "setup",
        title: "Add the competitors you want to benchmark against",
        summary: "Without competitors we can't compute share of voice, head-to-heads or citation gaps.",
        description:
          "Competitor tracking powers share of voice, competitor gap tasks and offsite opportunities. Add the 3–10 brands that show up for your topics.",
        steps: ["Open Competitors.", "Add 3–10 competitor brands with their domains.", "Confirm auto-discovered brands you want to keep."],
        acceptanceCriteria: ["At least three competitors are tracked with a domain."],
        impact: 8,
        effort: 1,
        evidence: [{ kind: "metric", label: "Tracked competitors", value: "0" }],
        datasets: ["Project settings"],
        targetUrls: [`${base}/ai/competitors`],
        data: { competitors: 0 },
      });
    }

    if (p.trackingFrequency === "paused" && activePrompts > 0) {
      findings.push({
        subject: ["tracking_paused"],
        category: "setup",
        title: "Resume AI tracking",
        summary: "Tracking is paused — visibility data is getting stale.",
        description: "Prompt tracking is paused for this project, so tasks can't detect changes or confirm fixes.",
        steps: ["Open Model Settings.", "Set the tracking frequency to daily or weekly."],
        acceptanceCriteria: ["Tracking frequency is daily or weekly.", "New answers appear in the Tracker."],
        impact: 8,
        effort: 1,
        evidence: [{ kind: "note", label: "Tracking frequency", value: "Paused" }],
        datasets: ["Project settings"],
        targetUrls: [`${base}/ai/models`],
        data: { frequency: p.trackingFrequency },
      });
    } else if (activePrompts > 0 && engines.length > 0 && (answerStats?.ok ?? 0) === 0 && p.createdAt.getTime() < ctx.now.getTime() - 2 * 86400000) {
      const failed = answerStats?.failed ?? 0;
      findings.push({
        subject: ["no_answers"],
        category: "setup",
        title: "AI tracking isn't producing answers",
        summary: failed
          ? `${failed} tracking attempts failed in the last 7 days and no answer was collected.`
          : "No AI answers were collected in the last 7 days.",
        description:
          "Prompts and engines are configured, but no answers arrived in the last 7 days. Usually a data provider (DataForSEO) or AI provider is missing, out of budget or failing.",
        steps: [
          dfs ? "Check DataForSEO balance and errors in Admin → Data Providers." : "Connect DataForSEO in Admin → Data Providers.",
          llm.length ? "Check the AI provider status in Admin → AI Providers." : "Connect a local agent or an AI API key in Admin → AI Providers.",
          "Open Admin → Jobs and look for failed tracking jobs.",
          "Run tracking manually from the Tracker once fixed.",
        ],
        acceptanceCriteria: ["New answers appear in the Tracker for every enabled engine."],
        impact: 9,
        effort: 3,
        evidence: [
          {
            kind: "metric",
            label: "Answers in the last 7 days",
            value: "0",
            items: [
              { label: "Failed attempts", value: failed },
              { label: "DataForSEO", value: dfs ? "Configured" : "Not configured", good: dfs },
              { label: "AI providers", value: llm.length ? llm.join(", ") : "None", good: llm.length > 0 },
            ],
          },
        ],
        datasets: ["AI answer tracking", "Project settings"],
        targetUrls: [`${base}/ai/tracker`],
        data: { failed, dfs, llm },
      });
    }

    if (!llm.length) {
      findings.push({
        subject: ["no_ai_provider"],
        category: "setup",
        title: "Connect an AI provider for analysis and writing",
        summary: "No local agent or AI API key is available — sentiment, fact checks and content drafting are limited.",
        description:
          "AutoSEO routes analysis (sentiment, statements, fact checks) and writing (tasks, content drafts) through a local agent (Claude Code / Codex) or an API key. None is available right now.",
        steps: ["Install a local agent from Local Agents, or", "add an Anthropic / OpenAI / OpenRouter API key in Admin → AI Providers.", "Re-run the analysis from Tasks."],
        acceptanceCriteria: ["At least one AI provider shows as available."],
        impact: 7,
        effort: 2,
        evidence: [{ kind: "note", label: "AI providers available", value: "None" }],
        datasets: ["Instance settings"],
        targetUrls: ["/agents", "/admin/ai"],
        data: { llm },
      });
    }

    if (!has(SEARCH_CONSOLE)) {
      findings.push({
        subject: ["no_search_console"],
        category: "setup",
        title: "Connect Google Search Console",
        summary: "Search Console reveals the conversational queries people already use to find you.",
        description:
          "Search Console data lets AutoSEO find long, question-style queries (future AI prompts), pages that earn impressions and snippets worth improving.",
        steps: ["Open Integrations → Search Console.", "Connect Google Search Console (or Bing Webmaster Tools) and pick the property.", "Wait for the first sync (data is 2–3 days delayed)."],
        acceptanceCriteria: ["Search Console shows as connected and synced."],
        impact: 6,
        effort: 2,
        evidence: [{ kind: "note", label: "Search Console", value: "Not connected" }],
        datasets: ["Integrations"],
        targetUrls: [`${base}/integrations`, `${base}/analytics/search-console`],
        data: {},
      });
    }

    if (!has(ANALYTICS)) {
      findings.push({
        subject: ["no_analytics"],
        category: "setup",
        title: "Connect web analytics to measure AI referral traffic",
        summary: "Connect GA4, Matomo or Piwik PRO to see sessions, conversions and revenue from AI platforms.",
        description: "Without analytics we can't show which AI engines send visitors, which pages they land on and what they convert to.",
        steps: ["Open Integrations → Analytics.", "Connect Google Analytics 4, Matomo or Piwik PRO.", "Select the property of this website."],
        acceptanceCriteria: ["An analytics integration is connected and synced."],
        impact: 5,
        effort: 2,
        evidence: [{ kind: "note", label: "Analytics", value: "Not connected" }],
        datasets: ["Integrations"],
        targetUrls: [`${base}/integrations`],
        data: {},
      });
    }

    if (!has(BOT_SOURCES) && botRows === 0) {
      findings.push({
        subject: ["no_bot_traffic"],
        category: "setup",
        title: "Send server or CDN logs to track AI crawlers",
        summary: "Bot traffic shows whether GPTBot, PerplexityBot & co. actually crawl your pages.",
        description:
          "AI engines can only cite pages their crawlers reach. Connect Cloudflare/Akamai or push server logs to see which AI bots visit, which pages they fetch and which errors they hit.",
        steps: ["Open Analytics → Bot Traffic → Sync.", "Connect Cloudflare / Akamai, or push NDJSON logs from nginx/Apache.", "Verify that bot visits appear."],
        acceptanceCriteria: ["AI bot visits from the last 30 days are visible in Bot Traffic."],
        impact: 5,
        effort: 4,
        evidence: [{ kind: "note", label: "AI bot visits (30 days)", value: "0" }],
        datasets: ["Integrations", "Bot traffic"],
        targetUrls: [`${base}/analytics/bots`],
        data: {},
      });
    }

    return { findings, evaluated: "all" };
  },
});
