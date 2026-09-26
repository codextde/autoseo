import "server-only";
import { sql } from "drizzle-orm";
import { registerTaskSignal } from "./registry";
import { clamp10, engineName, quote, rows, truncate } from "./helpers";
import type { TaskFinding } from "./types";

type ClusterRow = {
  topic: string;
  theme: string | null;
  n: number;
  answers: number;
  prompts: number;
  severity: number;
  engines: string[];
  quotes: string[];
};
type PraiseRow = { topic: string; n: number };
type FactRow = { asset_id: string; asset: string; n: number; critical: number; major: number; engines: string[]; claims: string[]; verdicts: string[] };

/**
 * Reputation: clusters of criticism AI engines repeat about your brand (aspect sentiment), plus
 * inaccurate claims about your products detected by Fact Check.
 */
registerTaskSignal({
  key: "reputation_cluster",
  label: "Reputation & criticism",
  category: "reputation",
  description: "Recurring criticism and inaccurate claims about your brand in AI answers.",
  datasets: ["Sentiment statements", "AI answer tracking", "Fact check"],
  async collect(ctx) {
    const pid = ctx.projectId;
    const since = ctx.sinceDate;
    const findings: TaskFinding[] = [];
    const evaluated = new Set<string>();

    const [{ n: statementCount } = { n: 0 }] = await rows<{ n: number }>(
      sql`select count(*)::int as n from ai_statements where project_id = ${pid} and answer_date >= ${since} and is_own`,
    );
    if (Number(statementCount) > 0) {
      const clusters = await rows<ClusterRow>(sql`
        select coalesce(nullif(attribute, ''), nullif(theme, ''), 'General') as topic, max(theme) as theme,
          count(*)::int as n, count(distinct answer_id)::int as answers, count(distinct prompt_id)::int as prompts,
          avg(severity)::float as severity, array_agg(distinct engine) as engines,
          (array_agg(quote order by severity desc))[1:5] as quotes
        from ai_statements
        where project_id = ${pid} and answer_date >= ${since} and is_own and polarity = 'criticism'
        group by 1`);
      const praise = await rows<PraiseRow>(sql`
        select coalesce(nullif(attribute, ''), nullif(theme, ''), 'General') as topic, count(*)::int as n
        from ai_statements where project_id = ${pid} and answer_date >= ${since} and is_own and polarity = 'praise' group by 1`);
      const praiseMap = new Map(praise.map((p) => [p.topic.toLowerCase(), Number(p.n)]));
      const allTopics = await rows<{ topic: string }>(sql`
        select distinct coalesce(nullif(attribute, ''), nullif(theme, ''), 'General') as topic
        from ai_statements where project_id = ${pid} and answer_date >= ${since} and is_own`);
      for (const t of allTopics) evaluated.add(ctx.fingerprint(["criticism", t.topic]));

      const ranked = clusters
        .map((c) => {
          const n = Number(c.n);
          const praiseN = praiseMap.get(c.topic.toLowerCase()) ?? 0;
          return { c, n, praiseN, share: n / Math.max(1, n + praiseN) };
        })
        .sort((a, b) => b.n * b.share - a.n * a.share);
      let taken = 0;
      for (const { c, n, praiseN, share } of ranked) {
        const engines = (c.engines ?? []).filter(Boolean);
        const fp = ctx.fingerprint(["criticism", c.topic]);
        const keep = ctx.openFingerprints.has(fp);
        // A cluster counts when criticism is a meaningful share of what AI says about the topic.
        const minShare = keep ? 0.15 : 0.2;
        if (n < 3 || (share < minShare && !(n >= 25 && share >= 0.12)) || (!keep && engines.length < 2 && n < 5)) continue;
        if (taken >= 8) break;
        taken++;
        const sev = Number(c.severity ?? 50);
        let impact = 3 + (share >= 0.5 ? 3 : share >= 0.3 ? 2 : 1) + (n >= 50 ? 2 : n >= 15 ? 1 : 0) + (sev >= 70 ? 1 : 0) + (engines.length >= 3 ? 1 : 0);
        impact = clamp10(impact);
        findings.push({
          subject: ["criticism", c.topic],
          category: "reputation",
          title: `Address recurring criticism: ${truncate(c.topic, 60)}`,
          summary: `AI engines criticised “${c.topic}” ${n}× across ${Number(c.prompts)} prompts — ${Math.round(share * 100)}% of what they say about it${praiseN ? ` (${praiseN} positive)` : ""}.`,
          description: [
            `In the last 30 days ${engines.map(engineName).join(", ")} repeated criticism about **${c.topic}**${c.theme && c.theme !== c.topic ? ` (${c.theme})` : ""} in ${Number(c.answers)} answers.`,
            "Engines echo what reviews, forums and articles say. Fix the underlying issue where it's real, and publish clear, citable facts where the criticism is outdated or wrong.",
          ].join(" "),
          steps: [
            "Read the quotes below and the answers they come from — is the criticism accurate, outdated or a misunderstanding?",
            "If it's real: brief product/support on the issue and document the fix (changelog, updated specs, policy).",
            `Publish a clear, factual page or FAQ entry addressing “${truncate(c.topic, 60)}” (with numbers, dates, proof).`,
            "Update third-party profiles and respond to the reviews/threads engines cite for this topic.",
            "Re-check after the next tracking runs.",
          ],
          acceptanceCriteria: [
            `Criticism makes up less than 15% of AI statements about “${truncate(c.topic, 50)}” (currently ${Math.round(share * 100)}%).`,
            "Your factual response page is live and indexed.",
          ],
          impact,
          effort: 5,
          evidence: [
            {
              kind: "quotes",
              label: "What AI says",
              value: `${n} statements · avg severity ${Math.round(sev)}`,
              items: (c.quotes ?? []).slice(0, 5).map((q) => ({ label: quote(q) })),
            },
            { kind: "engines", label: "Engines repeating it", items: engines.map((e) => ({ label: engineName(e), engine: e })) },
            ...(praiseN ? [{ kind: "metric" as const, label: "Positive statements on the same topic", value: String(praiseN) }] : []),
          ],
          datasets: ["Sentiment statements", "AI answer tracking"],
          targetUrls: [`/p/${pid}/ai/sentiment?tab=criticism`],
          data: { topic: c.topic, theme: c.theme, statements: n, praise: praiseN, criticismShare: Math.round(share * 100), severity: Math.round(sev), engines, quotes: (c.quotes ?? []).slice(0, 3) },
        });
      }
    }

    /* Inaccurate claims about your products (Fact Check) */
    const facts = await rows<FactRow>(sql`
      select s.asset_id, a.name as asset, count(*)::int as n,
        count(*) filter (where s.severity = 'critical')::int as critical,
        count(*) filter (where s.severity = 'major')::int as major,
        array_agg(distinct s.engine) as engines,
        (array_agg(s.claim order by s.seen_count desc))[1:4] as claims,
        array_agg(distinct s.verdict) as verdicts
      from fc_statements s join fc_assets a on a.id = s.asset_id
      where s.project_id = ${pid} and s.status = 'open'
        and s.verdict in ('contradicted', 'outdated', 'off_label', 'unsupported')
        and s.severity in ('critical', 'major')
      group by 1, 2`).catch(() => [] as FactRow[]);
    const assets = await rows<{ id: string }>(sql`select id from fc_assets where project_id = ${pid} and status = 'active'`).catch(() => []);
    for (const a of assets) evaluated.add(ctx.fingerprint(["fact_check", a.id]));
    for (const f of facts) {
      const critical = Number(f.critical);
      const major = Number(f.major);
      findings.push({
        subject: ["fact_check", f.asset_id],
        category: "reputation",
        title: `Correct inaccurate AI claims about ${f.asset}`,
        summary: `${critical ? `${critical} critical and ` : ""}${major} major deviations from the reference label are open.`,
        description: `Fact Check found statements about **${f.asset}** in AI answers that contradict, go beyond or are not supported by your reference documents (${(f.verdicts ?? []).join(", ").replace(/_/g, "-")}).`,
        steps: [
          "Open the findings for this asset and review each claim against the label.",
          "Publish or update an authoritative page with the correct facts (mirroring the label wording).",
          "Request corrections on the third-party sources engines cite for these claims.",
          "Resolve findings in Fact Check once engines repeat the correct facts.",
        ],
        acceptanceCriteria: ["No open critical or major findings remain for this asset."],
        impact: clamp10(6 + (critical ? 3 : 0) + (major >= 5 ? 1 : 0)),
        effort: 5,
        evidence: [
          {
            kind: "quotes",
            label: "Deviating claims",
            value: `${Number(f.n)} open`,
            items: (f.claims ?? []).map((c) => ({ label: quote(c) })),
          },
          { kind: "engines", label: "Engines", items: (f.engines ?? []).map((e) => ({ label: engineName(e), engine: e })) },
        ],
        datasets: ["Fact check", "AI answer tracking"],
        targetUrls: [`/p/${pid}/fact-check/findings?asset=${f.asset_id}`],
        data: { asset: f.asset, open: Number(f.n), critical, major },
      });
    }

    const hadData = Number(statementCount) > 0 || assets.length > 0;
    return { findings, evaluated: hadData ? evaluated : "none" };
  },
});
