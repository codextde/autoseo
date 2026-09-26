import "server-only";
import { sql } from "drizzle-orm";
import { registerTaskSignal } from "./registry";
import { clamp10, engineName, quote, rows, truncate, withoutRank } from "./helpers";
import type { TaskFinding } from "./types";

type PromptCiteRow = {
  prompt_id: string;
  text: string;
  funnel_stage: string | null;
  volume: number | null;
  research_volume: number | null;
  answers: number;
  own_mentions: number;
  own_cites: number;
  comp_cites: number;
  third_cites: number;
  engines: string[];
};
type FanoutRow = { prompt_id: string; query: string; n: number };
type CitedRow = { prompt_id: string; url: string; domain: string; ownership: string; n: number };
type ResearchRow = { id: string; text: string; topic: string | null; funnel_stage: string | null; volume: number | null; volume_score: number | null };

/**
 * Content gaps: high-value prompts where AI engines never cite a page of yours (they cite
 * competitors' or third-party pages instead), plus high-volume researched prompts that are not
 * covered at all yet. Each task carries a content plan built from the engines' fan-out queries.
 */
registerTaskSignal({
  key: "content_gap",
  label: "Content gaps",
  category: "content",
  description: "Prompts your pages don't address — engines cite other pages instead.",
  datasets: ["AI answer tracking", "Citations", "Query fan-outs", "Prompt research"],
  async collect(ctx) {
    const pid = ctx.projectId;
    const since = ctx.sinceDate;
    const findings: TaskFinding[] = [];
    const evaluated = new Set<string>();

    const promptRows = await rows<PromptCiteRow>(sql`
      select p.id as prompt_id, p.text, p.funnel_stage, p.volume,
        (select max(ri.volume) from prompt_research_items ri where ri.tracked_prompt_id = p.id) as research_volume,
        count(distinct a.id)::int as answers,
        count(distinct a.id) filter (where a.brand_mentioned)::int as own_mentions,
        count(c.id) filter (where s.ownership = 'own')::int as own_cites,
        count(c.id) filter (where s.ownership = 'competitor')::int as comp_cites,
        count(c.id) filter (where s.ownership = 'third_party')::int as third_cites,
        array_agg(distinct a.engine) as engines
      from prompts p
      join ai_answers a on a.prompt_id = p.id and a.status = 'ok' and a.answer_date >= ${since}
      left join ai_citations c on c.answer_id = a.id
      left join ai_sources s on s.id = c.source_id
      where p.project_id = ${pid} and p.status = 'active'
      group by p.id`);

    if (promptRows.length) {
      const fanouts = await rows<FanoutRow>(sql`
        select prompt_id, lower(query) as query, count(*)::int as n from ai_fanouts
        where project_id = ${pid} and answer_date >= ${since} group by 1, 2`);
      const cited = await rows<CitedRow>(sql`
        select c.prompt_id, s.url, s.domain, s.ownership, count(*)::int as n
        from ai_citations c join ai_sources s on s.id = c.source_id
        where c.project_id = ${pid} and c.answer_date >= ${since} and s.ownership <> 'own'
        group by 1, 2, 3, 4`);

      const candidates: Array<TaskFinding & { rank: number }> = [];
      for (const p of promptRows) {
        const answers = Number(p.answers);
        if (answers < 2) continue;
        const fp = ctx.fingerprint([p.prompt_id]);
        evaluated.add(fp);
        const ownCites = Number(p.own_cites);
        const otherCites = Number(p.comp_cites) + Number(p.third_cites);
        if (ownCites > 0 || otherCites < 2) continue;
        const volume = Number(p.volume ?? p.research_volume ?? 0);
        const questions = fanouts
          .filter((f) => f.prompt_id === p.prompt_id)
          .sort((a, b) => Number(b.n) - Number(a.n))
          .map((f) => f.query)
          .slice(0, 8);
        const pages = cited
          .filter((c) => c.prompt_id === p.prompt_id)
          .sort((a, b) => Number(b.n) - Number(a.n))
          .slice(0, 6);
        let impact = 5;
        if (volume >= 10000) impact += 2;
        else if (volume >= 1000) impact += 1;
        if (p.funnel_stage === "bofu") impact += 2;
        else if (p.funnel_stage === "mofu") impact += 1;
        if (Number(p.comp_cites) > 0) impact += 1;
        impact = clamp10(impact);
        const engines = (p.engines ?? []).filter(Boolean);
        const format = p.funnel_stage === "bofu" ? "Buyer's guide / comparison" : p.funnel_stage === "tofu" ? "Explainer / guide" : "Answer page";
        candidates.push({
          rank: impact * otherCites,
          subject: [p.prompt_id],
          category: "content",
          title: `Publish a page that answers ${quote(p.text)}`,
          summary: `Engines cited ${otherCites} other pages for this prompt and none of yours (${answers} answers).`,
          description: [
            `None of your pages is cited when ${engines.map(engineName).join(", ")} answer **${truncate(p.text, 140)}** — ${Number(p.comp_cites)} citations go to competitor sites and ${Number(p.third_cites)} to third parties.`,
            Number(p.own_mentions) > 0
              ? `Engines already mention your brand in ${Number(p.own_mentions)} answers, but they have no page of yours to cite as the source.`
              : "Engines neither mention nor cite you here, so a dedicated, citable page is the first step.",
            questions.length ? `While answering, engines searched for: ${questions.slice(0, 4).map((q) => `“${q}”`).join(", ")}.` : "",
          ]
            .filter(Boolean)
            .join(" "),
          steps: [
            "Check whether an existing page could answer this prompt; otherwise plan a new one (see the content plan).",
            "Open the answer with a 40–80 word direct answer to the prompt, then cover each fan-out question as its own H2/H3.",
            "Add concrete facts (numbers, specs, prices, dates), a comparison table and cited sources.",
            "Add Article + FAQPage JSON-LD and a meta description that answers the question.",
            "Publish, submit the URL for indexing and link to it from related pages.",
          ],
          acceptanceCriteria: [
            "A page on your domain directly answers the prompt and is indexed.",
            "At least one tracked engine cites your page for this prompt.",
          ],
          contentPlan: {
            format,
            workingTitle: p.text.endsWith("?") ? p.text : `${p.text}: the complete answer`,
            targetPrompt: p.text,
            wordCount: p.funnel_stage === "tofu" ? 1400 : 1800,
            outline: [
              "Direct answer (40–80 words)",
              ...questions.slice(0, 6).map((q) => q.charAt(0).toUpperCase() + q.slice(1)),
              "Comparison / options table",
              "FAQ",
            ],
            questions,
            entities: [ctx.project.name, ...ctx.competitors.filter((c) => c.tracked).slice(0, 4).map((c) => c.name)],
            schemaTypes: ["Article", "FAQPage"],
            notes: pages.length ? `Pages engines cite today: ${pages.map((x) => x.domain).join(", ")}. Beat them on specificity and freshness.` : undefined,
          },
          impact,
          effort: 5,
          evidence: [
            {
              kind: "sources",
              label: "Pages engines cite instead of yours",
              value: `${otherCites} citations`,
              items: pages.map((x) => ({ label: x.url.replace(/^https?:\/\/(www\.)?/, ""), href: x.url, value: Number(x.n), detail: x.ownership === "competitor" ? "Competitor" : "Third party" })),
            },
            ...(questions.length ? [{ kind: "queries" as const, label: "Fan-out searches engines ran", items: questions.map((q) => ({ label: q })) }] : []),
            {
              kind: "metric",
              label: "Your citations for this prompt",
              value: `0 of ${answers} answers`,
              description: Number(p.own_mentions) ? `Brand mentioned in ${Number(p.own_mentions)} answers` : "Brand not mentioned",
            },
          ],
          datasets: ["AI answer tracking", "Citations", ...(questions.length ? ["Query fan-outs"] : []), ...(volume ? ["Prompt research"] : [])],
          targetPrompts: [p.text],
          targetUrls: pages.map((x) => x.url),
          data: { prompt: p.text, funnel: p.funnel_stage, volume, answers, otherCites, ownMentions: Number(p.own_mentions), questions, citedDomains: pages.map((x) => x.domain) },
        });
      }
      candidates.sort((a, b) => b.rank - a.rank);
      findings.push(...candidates.slice(0, 25).map(withoutRank));
    }

    /* High-volume researched prompts not covered at all */
    const research = await rows<ResearchRow>(sql`
      select id, text, topic, funnel_stage, volume, volume_score from prompt_research_items
      where project_id = ${pid} and tracked_prompt_id is null
        and (coalesce(volume_score, 0) >= 0.6 or coalesce(volume, 0) >= 1000)
      order by coalesce(volume, 0) desc, coalesce(volume_score, 0) desc limit 15`);
    const researchFp = ctx.fingerprint(["research_uncovered"]);
    evaluated.add(researchFp);
    if (research.length >= 3) {
      findings.push({
        subject: ["research_uncovered"],
        category: "content",
        title: `Cover ${research.length} high-volume prompts from Prompt Research`,
        summary: `${research.length} frequently asked prompts are neither tracked nor answered yet.`,
        description: `Prompt Research found high-demand questions in your space that you don't track yet — so there's no evidence any of your pages answers them. Track them to measure visibility and plan content for the ones engines answer without you.`,
        steps: [
          "Add the prompts below to the Tracker (group them by topic).",
          "After the first tracking run, create answer pages for prompts where you're not cited (this generates dedicated content tasks).",
        ],
        acceptanceCriteria: ["All listed prompts are tracked."],
        impact: clamp10(5 + (research.length >= 10 ? 2 : 1)),
        effort: 2,
        evidence: [
          {
            kind: "prompts",
            label: "High-volume prompts not covered",
            items: research.map((r) => ({ label: r.text, value: r.volume ?? (r.volume_score != null ? `${Math.round(Number(r.volume_score) * 100)}%` : null), detail: r.topic })),
          },
        ],
        datasets: ["Prompt research"],
        targetPrompts: research.map((r) => r.text),
        targetUrls: [`/p/${pid}/ai/prompt-research`],
        data: { prompts: research.map((r) => r.text) },
      });
    }

    return { findings, evaluated };
  },
});
