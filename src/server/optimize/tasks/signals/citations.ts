import "server-only";
import { sql } from "drizzle-orm";
import { registerTaskSignal } from "./registry";
import { clamp10, engineName, isOwnDomain, rows, withoutRank } from "./helpers";
import type { TaskFinding } from "./types";

type DomainRow = {
  domain: string;
  content_type: string;
  citations: number;
  prompts: number;
  engines: string[];
  urls: string[];
  own_with: number;
};
type CompRow = { domain: string; competitor_id: string; n: number };
type PromptRow = { domain: string; text: string; n: number };

const PLAYBOOK: Record<string, { verb: string; effort: number; steps: string[] }> = {
  forum: {
    verb: "Join the conversations on",
    effort: 3,
    steps: [
      "Read the cited threads and note the questions and objections people raise.",
      "Reply from an authentic, disclosed brand or expert account with genuinely helpful answers (no link spam).",
      "Start a new thread answering a recurring question in depth where the community allows it.",
    ],
  },
  ugc: {
    verb: "Build presence on",
    effort: 4,
    steps: [
      "Claim or create your brand profile on the platform.",
      "Ask recent happy customers for reviews / contributions (follow the platform's rules).",
      "Respond publicly to existing reviews and questions.",
    ],
  },
  listicle: {
    verb: "Get included in the rankings on",
    effort: 6,
    steps: [
      "Identify the author/editor of the cited list articles.",
      "Pitch an inclusion with a concise fact sheet (differentiators, pricing, test unit or demo access).",
      "Offer data, expert quotes or an exclusive angle for the next update of the article.",
    ],
  },
  "buying-guide": {
    verb: "Get recommended in the buying guides on",
    effort: 6,
    steps: [
      "Review which products/brands the cited guides recommend and why.",
      "Send the editor a product sample or demo plus a fact sheet matching their criteria.",
      "Follow up when the guide is next updated.",
    ],
  },
  test: {
    verb: "Get tested by",
    effort: 7,
    steps: ["Check the publication's test methodology and submission process.", "Offer a test unit / account and technical data.", "Prepare comparison data against the brands currently tested."],
  },
  article: {
    verb: "Earn coverage on",
    effort: 6,
    steps: ["Find the authors of the cited articles.", "Pitch a story angle, data point or expert commentary relevant to their beat.", "Offer quotes and assets they can use."],
  },
  news: {
    verb: "Earn press coverage on",
    effort: 7,
    steps: ["Prepare a newsworthy angle (data study, launch, expert take).", "Pitch the journalists covering the cited stories.", "Provide a press kit with facts and quotes."],
  },
  reference: {
    verb: "Improve your presence on",
    effort: 8,
    steps: ["Check whether your brand/products are covered accurately.", "Follow the site's editorial rules — propose sourced factual additions via the proper process.", "Publish citable primary sources (data, specs) editors can reference."],
  },
  video: {
    verb: "Get featured in videos on",
    effort: 7,
    steps: ["List the creators behind the cited videos.", "Offer review units or collaborations.", "Publish your own explainer/comparison videos with clear titles and chapters."],
  },
  retail: {
    verb: "List and optimise your products on",
    effort: 6,
    steps: ["Make sure your products are listed with complete titles, specs and images.", "Collect ratings and reviews.", "Answer the product Q&A with the facts buyers ask about."],
  },
};

const DEFAULT_PLAY = {
  verb: "Get mentioned on",
  effort: 5,
  steps: ["Review the cited pages and what they say about competitors.", "Contact the site owner/editor with a relevant contribution or correction.", "Provide facts and assets that make mentioning you easy."],
};

/** Off-site citation gaps: third-party sources AI engines cite in answers that name competitors but not you. */
registerTaskSignal({
  key: "citation_gap",
  label: "Citation gaps",
  category: "offsite",
  description: "Forums, review sites and publishers cited for competitors but not for you.",
  datasets: ["Citations", "AI answer tracking", "Competitor mentions"],
  async collect(ctx) {
    const pid = ctx.projectId;
    const since = ctx.sinceDate;
    const [{ n: totalCitations } = { n: 0 }] = await rows<{ n: number }>(
      sql`select count(*)::int as n from ai_citations where project_id = ${pid} and answer_date >= ${since}`,
    );
    if (!Number(totalCitations)) return { findings: [], evaluated: "none", note: "No citations in the analysis window." };

    const domainRows = await rows<DomainRow>(sql`
      select s.domain, max(s.content_type) as content_type,
        count(*) filter (where not a.brand_mentioned and exists (select 1 from ai_mentions m where m.answer_id = a.id and m.competitor_id is not null))::int as citations,
        count(distinct c.prompt_id) filter (where not a.brand_mentioned)::int as prompts,
        array_agg(distinct c.engine) as engines,
        (array_agg(distinct s.url))[1:6] as urls,
        count(*) filter (where a.brand_mentioned)::int as own_with
      from ai_citations c
      join ai_sources s on s.id = c.source_id
      join ai_answers a on a.id = c.answer_id
      where c.project_id = ${pid} and c.answer_date >= ${since} and s.ownership = 'third_party'
      group by s.domain`);
    const compRows = await rows<CompRow>(sql`
      select s.domain, m.competitor_id, count(distinct m.answer_id)::int as n
      from ai_citations c
      join ai_sources s on s.id = c.source_id
      join ai_mentions m on m.answer_id = c.answer_id and m.competitor_id is not null
      where c.project_id = ${pid} and c.answer_date >= ${since} and s.ownership = 'third_party'
      group by 1, 2`);
    const promptRows = await rows<PromptRow>(sql`
      select s.domain, p.text, count(*)::int as n
      from ai_citations c
      join ai_sources s on s.id = c.source_id
      join prompts p on p.id = c.prompt_id
      where c.project_id = ${pid} and c.answer_date >= ${since} and s.ownership = 'third_party'
      group by 1, 2`);
    const compName = new Map(ctx.competitors.map((c) => [c.id, c.name]));
    const compDomains = ctx.competitors.map((c) => (c.domain ?? "").replace(/^www\./, "")).filter(Boolean);

    const evaluated = new Set<string>();
    const candidates: Array<TaskFinding & { rank: number }> = [];
    for (const d of domainRows) {
      if (isOwnDomain(d.domain, ctx.ownDomains) || isOwnDomain(d.domain, compDomains)) continue;
      const fp = ctx.fingerprint([d.domain]);
      evaluated.add(fp);
      const gapCitations = Number(d.citations);
      const prompts = Number(d.prompts);
      const ownWith = Number(d.own_with);
      const keep = ctx.openFingerprints.has(fp);
      if (gapCitations < (keep ? 2 : 3) || (prompts < 2 && gapCitations < 5)) continue;
      // Already cited in many answers that also mention you → not a gap.
      if (ownWith > gapCitations) continue;
      const comps = compRows
        .filter((c) => c.domain === d.domain && compName.has(c.competitor_id))
        .sort((a, b) => Number(b.n) - Number(a.n))
        .slice(0, 5);
      const promptsList = promptRows
        .filter((p) => p.domain === d.domain)
        .sort((a, b) => Number(b.n) - Number(a.n))
        .slice(0, 5);
      const type = d.content_type || "other";
      const play = PLAYBOOK[type] ?? DEFAULT_PLAY;
      const engines = (d.engines ?? []).filter(Boolean);
      let impact = 4;
      if (gapCitations >= 20) impact += 3;
      else if (gapCitations >= 8) impact += 2;
      else if (gapCitations >= 4) impact += 1;
      if (prompts >= 5) impact += 1;
      if (engines.length >= 3) impact += 1;
      impact = clamp10(impact);
      const compNames = comps.map((c) => compName.get(c.competitor_id)!).filter(Boolean);
      candidates.push({
        rank: gapCitations * (1 + prompts / 10),
        subject: [d.domain],
        category: "offsite",
        title: `${play.verb} ${d.domain}`,
        summary: `${d.domain} was cited ${gapCitations}× in answers that name ${compNames.slice(0, 2).join(" & ") || "competitors"} but not you (${prompts} prompts).`,
        description: [
          `AI engines (${engines.map(engineName).join(", ")}) repeatedly use **${d.domain}** as a source when answering prompts in your space — in the last 30 days it was cited ${gapCitations} times in answers that recommend ${compNames.length ? compNames.join(", ") : "competitors"} without mentioning you.`,
          "Being present and positively represented on this source is one of the most direct ways to show up in those answers.",
        ].join(" "),
        steps: [...play.steps, "Track the cited URLs below; the task resolves once engines cite this source in answers that mention you."],
        acceptanceCriteria: [
          `Your brand is mentioned on the cited ${d.domain} pages (or new pages on the same site).`,
          "Answers citing this source mention your brand in the next tracking cycles.",
        ],
        impact,
        effort: play.effort,
        evidence: [
          {
            kind: "sources",
            label: "Cited pages",
            value: `${gapCitations} citations · ${prompts} prompts`,
            items: (d.urls ?? []).slice(0, 6).map((u) => ({ label: u.replace(/^https?:\/\/(www\.)?/, ""), href: u })),
          },
          {
            kind: "competitors",
            label: "Competitors named alongside this source",
            items: comps.map((c) => ({ label: compName.get(c.competitor_id)!, value: Number(c.n), detail: "answers" })),
          },
          {
            kind: "prompts",
            label: "Prompts where engines cite it",
            items: promptsList.map((p) => ({ label: p.text, value: Number(p.n) })),
          },
          { kind: "engines", label: "Engines citing it", items: engines.map((e) => ({ label: engineName(e), engine: e })) },
        ],
        datasets: ["Citations", "AI answer tracking", "Competitor mentions"],
        targetUrls: (d.urls ?? []).slice(0, 6),
        targetPrompts: promptsList.map((p) => p.text),
        data: { domain: d.domain, type, citations: gapCitations, prompts, engines, competitors: compNames, ownWith },
      });
    }
    candidates.sort((a, b) => b.rank - a.rank);
    return { findings: candidates.slice(0, 20).map(withoutRank), evaluated };
  },
});
