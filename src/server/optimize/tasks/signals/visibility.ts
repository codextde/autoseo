import "server-only";
import { sql } from "drizzle-orm";
import { registerTaskSignal } from "./registry";
import { clamp10, engineName, fmtPct, isOwnDomain, quote, rows, truncate, withoutRank } from "./helpers";
import type { TaskFinding } from "./types";

type PromptEngineRow = { prompt_id: string; engine: string; answers: number; own: number };
type CompRow = { prompt_id: string; engine: string; competitor_id: string; answers: number };
type SourceRow = { prompt_id: string; domain: string; url: string; n: number };
type PromptRow = { id: string; text: string; volume: number | null; funnel_stage: string | null; country: string; branded: boolean; research_volume: number | null };

const MIN_ANSWERS = 2;
const CREATE_BELOW = 0.25;
const KEEP_BELOW = 0.4;
const COMPETITOR_MIN = 0.3;

/**
 * AI visibility gaps: prompts where competitors are named in AI answers and you are not —
 * broken down per engine — plus engines where your visibility lags far behind the others.
 */
registerTaskSignal({
  key: "visibility_gap",
  label: "AI visibility gaps",
  category: "visibility",
  description: "Prompts where competitors appear in AI answers and you don't (per engine).",
  datasets: ["AI answer tracking", "Competitor mentions", "Citations"],
  async collect(ctx) {
    const pid = ctx.projectId;
    const since = ctx.sinceDate;
    const perEngine = await rows<PromptEngineRow>(sql`
      select a.prompt_id, a.engine, count(*)::int as answers, count(*) filter (where a.brand_mentioned)::int as own
      from ai_answers a join prompts p on p.id = a.prompt_id
      where a.project_id = ${pid} and a.answer_date >= ${since} and a.status = 'ok' and p.status = 'active'
      group by 1, 2`);
    if (!perEngine.length) return { findings: [], evaluated: "none", note: "No AI answers in the analysis window." };

    const compRows = await rows<CompRow>(sql`
      select m.prompt_id, m.engine, m.competitor_id, count(distinct m.answer_id)::int as answers
      from ai_mentions m
      where m.project_id = ${pid} and m.answer_date >= ${since} and m.competitor_id is not null and not m.is_own
      group by 1, 2, 3`);
    const sourceRows = await rows<SourceRow>(sql`
      select c.prompt_id, s.domain, min(s.url) as url, count(*)::int as n
      from ai_citations c
      join ai_sources s on s.id = c.source_id
      join ai_answers a on a.id = c.answer_id
      where c.project_id = ${pid} and c.answer_date >= ${since} and not a.brand_mentioned
      group by 1, 2`);
    const promptRows = await rows<PromptRow>(sql`
      select p.id, p.text, p.volume, p.funnel_stage, p.country, p.branded,
        (select max(ri.volume) from prompt_research_items ri where ri.tracked_prompt_id = p.id) as research_volume
      from prompts p where p.project_id = ${pid} and p.status = 'active'`);

    const compName = new Map(ctx.competitors.map((c) => [c.id, c.name]));
    const promptMap = new Map(promptRows.map((p) => [p.id, p]));
    const byPrompt = new Map<string, PromptEngineRow[]>();
    for (const r of perEngine) {
      if (!byPrompt.has(r.prompt_id)) byPrompt.set(r.prompt_id, []);
      byPrompt.get(r.prompt_id)!.push({ ...r, answers: Number(r.answers), own: Number(r.own) });
    }
    const compByPrompt = new Map<string, CompRow[]>();
    for (const r of compRows) {
      if (!compByPrompt.has(r.prompt_id)) compByPrompt.set(r.prompt_id, []);
      compByPrompt.get(r.prompt_id)!.push({ ...r, answers: Number(r.answers) });
    }

    const evaluated = new Set<string>();
    const candidates: Array<TaskFinding & { rank: number }> = [];

    for (const [promptId, engines] of byPrompt) {
      const prompt = promptMap.get(promptId);
      if (!prompt) continue;
      const total = engines.reduce((a, e) => a + e.answers, 0);
      if (total < MIN_ANSWERS) continue;
      const fp = ctx.fingerprint([promptId]);
      evaluated.add(fp);
      const own = engines.reduce((a, e) => a + e.own, 0);
      const ownRate = own / total;
      const threshold = ctx.openFingerprints.has(fp) ? KEEP_BELOW : CREATE_BELOW;
      if (ownRate >= threshold) continue;

      const comps = compByPrompt.get(promptId) ?? [];
      const compTotals = new Map<string, number>();
      for (const c of comps) compTotals.set(c.competitor_id, (compTotals.get(c.competitor_id) ?? 0) + c.answers);
      const rankedComps = [...compTotals.entries()]
        .map(([id, n]) => ({ id, name: compName.get(id) ?? "Competitor", n, rate: n / total }))
        .filter((c) => compName.has(c.id))
        .sort((a, b) => b.n - a.n);
      const top = rankedComps[0];
      if (!top || top.rate < COMPETITOR_MIN) continue;

      const missingEngines = engines.filter((e) => e.own === 0).map((e) => e.engine);
      const sources = sourceRows
        .filter((s) => s.prompt_id === promptId && !isOwnDomain(s.domain, ctx.ownDomains))
        .sort((a, b) => Number(b.n) - Number(a.n))
        .slice(0, 6);
      const volume = Number(prompt.volume ?? prompt.research_volume ?? 0);
      let impact = 5;
      if (volume >= 10000) impact += 2;
      else if (volume >= 1000) impact += 1;
      if (prompt.funnel_stage === "bofu") impact += 2;
      else if (prompt.funnel_stage === "mofu") impact += 1;
      if (top.rate >= 0.6) impact += 1;
      if (missingEngines.length >= 3) impact += 1;
      if (prompt.branded) impact += 1;
      impact = clamp10(impact);
      const effort = sources.length >= 3 ? 5 : 6;
      const promptText = prompt.text;

      const engineItems = engines
        .sort((a, b) => b.answers - a.answers)
        .map((e) => {
          const topHere = comps
            .filter((c) => c.engine === e.engine && compName.has(c.competitor_id))
            .sort((a, b) => b.answers - a.answers)[0];
          return {
            label: engineName(e.engine),
            engine: e.engine,
            value: `${e.own} / ${e.answers}`,
            detail: topHere ? `${compName.get(topHere.competitor_id)} named in ${topHere.answers}/${e.answers}` : "No competitor named",
            good: e.own > 0,
          };
        });

      candidates.push({
        rank: impact * (1 - ownRate) * top.rate,
        subject: [promptId],
        category: "visibility",
        title: `Get mentioned for ${quote(promptText)}`,
        summary: `You appear in ${own}/${total} answers (${fmtPct(ownRate * 100)}) while ${top.name} appears in ${top.n} (${fmtPct(top.rate * 100)}).`,
        description: [
          `AI engines answer **${truncate(promptText, 140)}** without naming your brand in ${total - own} of ${total} answers over the last 30 days.`,
          `${rankedComps
            .slice(0, 3)
            .map((c) => `**${c.name}** is named in ${fmtPct(c.rate * 100)}`)
            .join(", ")} of the same answers.`,
          missingEngines.length ? `You are missing entirely on ${missingEngines.map(engineName).join(", ")}.` : "",
          sources.length ? `The engines build these answers from sources like ${sources.slice(0, 3).map((s) => s.domain).join(", ")} — that's where you need to be present.` : "",
        ]
          .filter(Boolean)
          .join(" "),
        steps: [
          `Open the prompt in the Tracker and read the ${total - own} answers that don't mention you (focus on ${missingEngines.length ? missingEngines.map(engineName).join(", ") : "the engines with the lowest visibility"}).`,
          `Create or update a page that answers “${truncate(promptText, 80)}” directly in the first paragraph, with concrete facts, a comparison table and FAQ schema.`,
          sources.length
            ? `Get your brand onto the pages engines cite here: ${sources.slice(0, 4).map((s) => s.domain).join(", ")} (reviews, listicles, community threads).`
            : "Earn mentions on the review sites, listicles and communities that rank for this question.",
          `Explain clearly where you're a better fit than ${top.name} (use cases, pricing, proof) so engines can recommend you.`,
          "Re-check after the next tracking runs; this task resolves itself once you're mentioned consistently.",
        ],
        acceptanceCriteria: [
          `Your brand is mentioned in at least 40% of answers for this prompt (currently ${fmtPct(ownRate * 100)}).`,
          missingEngines.length ? `Mentioned at least once on ${missingEngines.map(engineName).join(", ")}.` : "Mentioned on every tracked engine.",
        ],
        contentPlan: {
          format: prompt.funnel_stage === "bofu" ? "Comparison / buyer's guide" : "Answer page",
          targetPrompt: promptText,
          workingTitle: promptText,
          notes: `Answer-first, cite sources, compare against ${rankedComps
            .slice(0, 3)
            .map((c) => c.name)
            .join(", ")}.`,
        },
        impact,
        effort,
        evidence: [
          {
            kind: "engines",
            label: "Mentions per engine (last 30 days)",
            value: `${own} / ${total} answers`,
            items: engineItems,
            chart: engines.map((e) => ({ label: engineName(e.engine), value: Math.round((e.own / e.answers) * 100), compare: null })),
          },
          {
            kind: "competitors",
            label: "Competitors named instead",
            items: rankedComps.slice(0, 5).map((c) => ({ label: c.name, value: fmtPct(c.rate * 100), detail: `${c.n} of ${total} answers` })),
          },
          ...(sources.length
            ? [
                {
                  kind: "sources" as const,
                  label: "Sources cited in answers without you",
                  items: sources.map((s) => ({ label: s.domain, value: Number(s.n), href: s.url })),
                },
              ]
            : []),
        ],
        datasets: ["AI answer tracking", "Competitor mentions", ...(sources.length ? ["Citations"] : []), ...(volume ? ["Prompt research"] : [])],
        targetPrompts: [promptText],
        targetUrls: [`/p/${pid}/ai/tracker?prompt=${promptId}`],
        data: {
          prompt: promptText,
          country: prompt.country,
          funnel: prompt.funnel_stage,
          volume,
          answers: total,
          ownMentions: own,
          missingEngines,
          competitors: rankedComps.slice(0, 5).map((c) => ({ name: c.name, answers: c.n })),
          sources: sources.map((s) => s.domain),
        },
      });
    }

    candidates.sort((a, b) => b.rank - a.rank);
    const findings: TaskFinding[] = candidates.slice(0, 30).map(withoutRank);

    /* Engine-level gaps: an engine where your mention rate is far below your best engine. */
    const engineTotals = new Map<string, { answers: number; own: number }>();
    for (const r of perEngine) {
      const t = engineTotals.get(r.engine) ?? { answers: 0, own: 0 };
      t.answers += Number(r.answers);
      t.own += Number(r.own);
      engineTotals.set(r.engine, t);
    }
    const engineRates = [...engineTotals.entries()].filter(([, t]) => t.answers >= 10).map(([engine, t]) => ({ engine, ...t, rate: t.own / t.answers }));
    const best = [...engineRates].sort((a, b) => b.rate - a.rate)[0];
    const compByEngine = new Map<string, number>();
    for (const c of compRows) compByEngine.set(c.engine, (compByEngine.get(c.engine) ?? 0) + Number(c.answers));
    for (const e of engineRates) {
      const fp = ctx.fingerprint(["engine", e.engine]);
      evaluated.add(fp);
      if (!best || best.engine === e.engine || best.rate < 0.2) continue;
      const ratio = e.rate / best.rate;
      if (ratio >= (ctx.openFingerprints.has(fp) ? 0.7 : 0.5)) continue;
      const name = engineName(e.engine);
      findings.push({
        subject: ["engine", e.engine],
        category: "visibility",
        title: `Close your visibility gap on ${name}`,
        summary: `${name} mentions you in ${fmtPct(e.rate * 100)} of answers vs ${fmtPct(best.rate * 100)} on ${engineName(best.engine)}.`,
        description: `Across all tracked prompts, ${name} names your brand far less often than ${engineName(best.engine)}. Each engine relies on different sources (search index, partners, community content), so the fix is engine-specific.`,
        steps: [
          `Filter the Tracker to ${name} and list the prompts where you're missing.`,
          `Check which domains ${name} cites for those prompts (Sources → filter by model) and prioritise getting listed there.`,
          e.engine.startsWith("chatgpt") || e.engine === "copilot"
            ? "Make sure Bing indexes your key pages (submit the sitemap in Bing Webmaster Tools) and allow OAI-SearchBot / Bingbot in robots.txt."
            : e.engine === "perplexity"
              ? "Allow PerplexityBot in robots.txt and strengthen presence on Reddit, review sites and recent news coverage."
              : e.engine.includes("ai_") || e.engine === "gemini"
                ? "Improve Google rankings for the underlying queries (AI Overviews draw from top organic results) and add structured data."
                : "Publish clear, well-structured answer pages and earn third-party mentions the engine can retrieve.",
          "Re-check after the next tracking runs.",
        ],
        acceptanceCriteria: [`${name} mention rate reaches at least 70% of your best engine's rate.`],
        impact: clamp10(6 + (ratio < 0.25 ? 2 : 1)),
        effort: 6,
        evidence: [
          {
            kind: "engines",
            label: "Mention rate by engine (all prompts, 30 days)",
            items: engineRates
              .sort((a, b) => b.rate - a.rate)
              .map((r) => ({ label: engineName(r.engine), engine: r.engine, value: fmtPct(r.rate * 100), detail: `${r.own} / ${r.answers} answers`, good: r.engine !== e.engine })),
            chart: engineRates.map((r) => ({ label: engineName(r.engine), value: Math.round(r.rate * 100) })),
          },
          { kind: "metric", label: "Competitor mentions on this engine", value: String(compByEngine.get(e.engine) ?? 0) },
        ],
        datasets: ["AI answer tracking", "Competitor mentions"],
        targetUrls: [`/p/${pid}/ai/tracker?models=${e.engine}`],
        data: { engine: e.engine, rate: e.rate, bestEngine: best.engine, bestRate: best.rate, answers: e.answers },
      });
    }

    return { findings, evaluated };
  },
});
