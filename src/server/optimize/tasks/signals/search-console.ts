import "server-only";
import { sql } from "drizzle-orm";
import { registerTaskSignal } from "./registry";
import { clamp10, rows } from "./helpers";
import type { TaskFinding } from "./types";

type QueryRow = { query: string; impressions: number; clicks: number; is_prompt: boolean | null };
type PageRow = { page: string; impressions: number; clicks: number; position: number; queries: string[] };

const QUESTION = /^(how|what|why|which|when|where|who|can|is|are|does|do|should|best|wie|was|warum|welche|wann|wo|wer|kann|ist|lohnt)\b/i;

function looksLikePrompt(q: string): boolean {
  const words = q.trim().split(/\s+/).length;
  return words >= 6 || (words >= 4 && QUESTION.test(q.trim()));
}

/** Search Console: conversational queries not tracked yet, and pages with impressions but weak snippets. */
registerTaskSignal({
  key: "search_console",
  label: "Search Console opportunities",
  category: "visibility",
  description: "Conversational Search Console queries to track and pages with weak snippets.",
  datasets: ["Search Console", "AI answer tracking"],
  async collect(ctx) {
    const pid = ctx.projectId;
    if (!(await ctx.tableExists("analytics_sc_queries"))) return { findings: [], evaluated: "none" };
    const since = ctx.sinceDate;
    const findings: TaskFinding[] = [];
    const evaluated = new Set<string>();
    try {
      const hasIntents = await ctx.tableExists("analytics_sc_query_intents");
      const queries = await rows<QueryRow>(
        hasIntents
          ? sql`select q.query, sum(q.impressions)::int as impressions, sum(q.clicks)::int as clicks, bool_or(i.is_prompt) as is_prompt
              from analytics_sc_queries q left join analytics_sc_query_intents i on i.project_id = q.project_id and i.query = q.query
              where q.project_id = ${pid} and q.date >= ${since} group by q.query`
          : sql`select query, sum(impressions)::int as impressions, sum(clicks)::int as clicks, null::boolean as is_prompt
              from analytics_sc_queries where project_id = ${pid} and date >= ${since} group by query`,
      );
      if (!queries.length) return { findings: [], evaluated: "none" };
      const tracked = new Set(
        (await rows<{ t: string }>(sql`select lower(trim(text)) as t from prompts where project_id = ${pid} and status = 'active'`)).map((r) => r.t),
      );
      const candidates = queries
        .filter((q) => (q.is_prompt ?? looksLikePrompt(q.query)) && Number(q.impressions) >= 10 && !tracked.has(q.query.trim().toLowerCase()))
        .sort((a, b) => Number(b.impressions) - Number(a.impressions))
        .slice(0, 15);
      const fp = ctx.fingerprint(["untracked_prompts"]);
      evaluated.add(fp);
      if (candidates.length >= (ctx.openFingerprints.has(fp) ? 2 : 3)) {
        const imp = candidates.reduce((a, q) => a + Number(q.impressions), 0);
        findings.push({
          subject: ["untracked_prompts"],
          category: "visibility",
          title: `Track ${candidates.length} conversational queries from Search Console`,
          summary: `People already reach you with long, question-style searches (${imp.toLocaleString("en-US")} impressions) that you don't track in AI engines.`,
          description:
            "These Search Console queries read like prompts people also ask AI assistants. Tracking them shows whether engines mention you for questions you already rank for — a strong, evidence-backed prompt set.",
          steps: ["Review the queries below.", "Add the relevant ones as tracked prompts (Search Console → “+”, or Tracker → Add Prompt).", "Tag them “Search Console” to compare later."],
          acceptanceCriteria: ["The listed conversational queries are tracked as prompts."],
          impact: clamp10(5 + (imp >= 5000 ? 2 : imp >= 500 ? 1 : 0)),
          effort: 1,
          evidence: [
            {
              kind: "queries",
              label: "Conversational queries (30 days)",
              items: candidates.map((q) => ({ label: q.query, value: Number(q.impressions), detail: `${Number(q.clicks)} clicks` })),
            },
          ],
          datasets: ["Search Console", "AI answer tracking"],
          targetPrompts: candidates.map((q) => q.query),
          targetUrls: [`/p/${pid}/analytics/search-console`],
          data: { queries: candidates.map((q) => q.query) },
        });
      }

      if (await ctx.tableExists("analytics_sc_pages")) {
        const pages = await rows<PageRow>(sql`
          select page, sum(impressions)::int as impressions, sum(clicks)::int as clicks,
            (sum(position * impressions) / nullif(sum(impressions), 0))::float as position,
            (array_agg(query order by impressions desc) filter (where query <> ''))[1:5] as queries
          from analytics_sc_pages where project_id = ${pid} and date >= ${since}
          group by page having sum(impressions) >= 500 order by sum(impressions) desc limit 50`);
        for (const pg of pages) {
          const fpPage = ctx.fingerprint(["snippet", pg.page]);
          evaluated.add(fpPage);
          const ctr = Number(pg.clicks) / Math.max(1, Number(pg.impressions));
          const pos = Number(pg.position ?? 99);
          if (pos > 10 || ctr >= (ctx.openFingerprints.has(fpPage) ? 0.02 : 0.01)) continue;
          if (findings.filter((f) => f.subject[0] === "snippet").length >= 5) continue;
          findings.push({
            subject: ["snippet", pg.page],
            category: "content",
            title: `Improve the answer snippet of ${pg.page.replace(/^https?:\/\/(www\.)?/, "")}`,
            summary: `${Number(pg.impressions).toLocaleString("en-US")} impressions at position ${pos.toFixed(1)} but only ${(ctr * 100).toFixed(1)}% CTR.`,
            description:
              "The page ranks on page one but rarely gets chosen. A sharper title/meta description and an answer-first opening improve both clicks and the chance AI Overviews quote it.",
            steps: [
              "Rewrite the title and meta description around the top queries below.",
              "Open the page with a direct 40–80 word answer to the main query.",
              "Run it through Content → Optimize URL to check the AEO score.",
            ],
            acceptanceCriteria: ["CTR above 2% over the next 28 days.", "AEO score of the page ≥ 70."],
            impact: clamp10(4 + (Number(pg.impressions) >= 5000 ? 2 : 1)),
            effort: 3,
            evidence: [
              { kind: "metric", label: "Search performance (30 days)", value: `${Number(pg.clicks)} clicks · ${Number(pg.impressions)} impressions` },
              { kind: "queries", label: "Top queries", items: (pg.queries ?? []).map((q) => ({ label: q })) },
            ],
            datasets: ["Search Console"],
            targetUrls: [pg.page],
            data: { page: pg.page, ctr, position: pos, impressions: Number(pg.impressions) },
          });
        }
      }
    } catch {
      return { findings: [], evaluated: "none", note: "Search Console tables are not readable yet." };
    }
    return { findings, evaluated };
  },
});
