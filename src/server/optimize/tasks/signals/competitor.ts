import "server-only";
import { sql } from "drizzle-orm";
import { registerTaskSignal } from "./registry";
import { clamp10, engineName, fmtPct, quote, rows, truncate, withoutRank } from "./helpers";
import type { TaskFinding } from "./types";

type H2HRow = { competitor_id: string; losses: number; wins: number; ties: number; claims: string[]; engines: string[] };
type PickRow = { label: string; competitor_id: string | null; is_own: boolean; n: number; engines: string[] };
type SovRow = { competitor_id: string | null; is_own: boolean; answers: number };
type LeadRow = { competitor_id: string; text: string; comp: number; own: number };

/** Competitor gaps: head-to-head comparisons you lose, "best for" picks you never get, share-of-voice gaps. */
registerTaskSignal({
  key: "competitor_gap",
  label: "Competitor gaps",
  category: "competitor",
  description: "Head-to-head comparisons competitors win, recommendations they own and share-of-voice gaps.",
  datasets: ["Recommendations", "Competitor mentions", "AI answer tracking"],
  async collect(ctx) {
    const pid = ctx.projectId;
    const since = ctx.sinceDate;
    const compName = new Map(ctx.competitors.map((c) => [c.id, c.name]));
    const findings: TaskFinding[] = [];
    const evaluated = new Set<string>();

    const [{ n: answers } = { n: 0 }] = await rows<{ n: number }>(
      sql`select count(*)::int as n from ai_answers where project_id = ${pid} and answer_date >= ${since} and status = 'ok'`,
    );
    if (!Number(answers)) return { findings: [], evaluated: "none" };

    /* Head-to-head */
    const h2h = await rows<H2HRow>(sql`
      select competitor_id,
        count(*) filter (where loss)::int as losses, count(*) filter (where win)::int as wins, count(*) filter (where tie)::int as ties,
        (array_agg(label) filter (where loss))[1:5] as claims, array_agg(distinct engine) filter (where loss) as engines
      from (
        select r.label, r.engine,
          case when r.is_own then r.opponent_competitor_id else r.competitor_id end as competitor_id,
          (r.is_own and r.winner = 'opponent') or (r.opponent_is_own and r.winner = 'brand') as loss,
          (r.is_own and r.winner = 'brand') or (r.opponent_is_own and r.winner = 'opponent') as win,
          r.winner = 'tie' as tie
        from ai_recommendations r
        where r.project_id = ${pid} and r.answer_date >= ${since} and r.kind = 'head_to_head' and (r.is_own or r.opponent_is_own)
      ) x where competitor_id is not null group by competitor_id`);
    for (const r of h2h) {
      const name = compName.get(r.competitor_id);
      if (!name) continue;
      const fp = ctx.fingerprint(["h2h", r.competitor_id]);
      evaluated.add(fp);
      const losses = Number(r.losses);
      const wins = Number(r.wins);
      const total = losses + wins + Number(r.ties);
      const lossShare = losses / Math.max(1, losses + wins);
      if (losses < 3 || lossShare < (ctx.openFingerprints.has(fp) ? 0.5 : 0.55)) continue;
      findings.push({
        subject: ["h2h", r.competitor_id],
        category: "competitor",
        title: `Win head-to-head comparisons against ${name}`,
        summary: `When AI compares you with ${name}, it favours ${name} in ${losses} of ${total} claims.`,
        description: `AI engines compare your brand directly with **${name}** and side with them ${losses} times (you win ${wins}). Engines base these verdicts on comparison articles, reviews and the facts each brand publishes — if your advantages aren't documented, they can't be cited.`,
        steps: [
          "Collect the claims below and list which ones are factually outdated or incomplete.",
          `Publish a fair, well-sourced “${ctx.project.name} vs ${name}” comparison page with a feature/price table and clear best-fit use cases.`,
          "Update product pages with the specs, prices and proof points engines compare on.",
          `Pitch comparison and review sites that already cover ${name} to include you.`,
          "Re-check after the next tracking runs.",
        ],
        acceptanceCriteria: [`AI favours you in at least as many head-to-head claims against ${name} as it favours ${name}.`, "Your comparison page is live and indexed."],
        contentPlan: {
          format: "Comparison page",
          workingTitle: `${ctx.project.name} vs ${name}: honest comparison`,
          targetKeyword: `${ctx.project.name} vs ${name}`,
          outline: ["Quick verdict (who each is best for)", "Comparison table", "Key differences", "Pricing", "Which should you choose?", "FAQ"],
          schemaTypes: ["Article", "FAQPage"],
        },
        impact: clamp10(4 + (losses >= 50 ? 3 : losses >= 10 ? 2 : 1) + (lossShare >= 0.7 ? 2 : lossShare >= 0.6 ? 1 : 0)),
        effort: 5,
        evidence: [
          {
            kind: "metric",
            label: "Head-to-head claims",
            value: `${losses} lost · ${wins} won · ${Number(r.ties)} tie`,
            chart: [
              { label: "Won", value: wins },
              { label: "Lost", value: losses },
            ],
          },
          { kind: "quotes", label: "Claims favouring the competitor", items: (r.claims ?? []).map((c) => ({ label: quote(c) })) },
          { kind: "engines", label: "Engines", items: (r.engines ?? []).filter(Boolean).map((e) => ({ label: engineName(e), engine: e })) },
        ],
        datasets: ["Recommendations", "AI answer tracking"],
        targetUrls: [`/p/${pid}/ai/sentiment?tab=recommendations`],
        data: { competitor: name, losses, wins, claims: (r.claims ?? []).slice(0, 3) },
      });
    }

    /* "Best for …" picks you never get */
    const picks = await rows<PickRow>(sql`
      select label, competitor_id, is_own, count(*)::int as n, array_agg(distinct engine) as engines
      from ai_recommendations where project_id = ${pid} and answer_date >= ${since} and kind = 'best_for'
      group by 1, 2, 3`);
    const byLabel = new Map<string, PickRow[]>();
    for (const p of picks) {
      const key = p.label.trim();
      if (!byLabel.has(key)) byLabel.set(key, []);
      byLabel.get(key)!.push(p);
    }
    const pickCandidates: Array<TaskFinding & { rank: number }> = [];
    for (const [label, list] of byLabel) {
      const fp = ctx.fingerprint(["best_for", label]);
      evaluated.add(fp);
      const own = list.filter((p) => p.is_own).reduce((a, p) => a + Number(p.n), 0);
      const comps = list
        .filter((p) => !p.is_own && p.competitor_id && compName.has(p.competitor_id))
        .sort((a, b) => Number(b.n) - Number(a.n));
      const compTotal = comps.reduce((a, p) => a + Number(p.n), 0);
      const ownShare = own / Math.max(1, own + compTotal);
      if (compTotal < 3 || ownShare >= (ctx.openFingerprints.has(fp) ? 0.2 : 0.1)) continue;
      const leader = compName.get(comps[0]!.competitor_id!)!;
      pickCandidates.push({
        rank: compTotal * (1 - ownShare),
        subject: ["best_for", label],
        category: "competitor",
        title: `Become the recommended pick for “${truncate(label, 60)}”`,
        summary: own
          ? `AI picks ${leader}${comps.length > 1 ? ` and ${comps.length - 1} other brands` : ""} ${compTotal}× for “${label}” — you only ${own}× (${Math.round(ownShare * 100)}%).`
          : `AI recommends ${leader}${comps.length > 1 ? ` and ${comps.length - 1} other brands` : ""} ${compTotal}× for “${label}” — you're never the pick.`,
        description: `When users ask for the best option for **${label}**, AI engines pick competitors (${comps
          .slice(0, 3)
          .map((c) => `${compName.get(c.competitor_id!)} ${Number(c.n)}×`)
          .join(", ")}). If you genuinely fit this situation, you need content and third-party proof that makes the fit explicit.`,
        steps: [
          `Decide whether ${ctx.project.name} is a genuine fit for “${label}” (if not, dismiss this task).`,
          `Create a landing page / guide section that states plainly why you're a strong choice for “${label}”, with proof (specs, tests, customer quotes).`,
          `Get reviewers and comparison sites to evaluate you for this use case.`,
          "Re-check after the next tracking runs.",
        ],
        acceptanceCriteria: [`You get at least 20% of the “${truncate(label, 50)}” picks (currently ${Math.round(ownShare * 100)}%).`],
        impact: clamp10(4 + (compTotal >= 10 ? 3 : compTotal >= 5 ? 2 : 1)),
        effort: 5,
        evidence: [
          {
            kind: "competitors",
            label: "Brands AI recommends instead",
            items: comps.slice(0, 5).map((c) => ({ label: compName.get(c.competitor_id!)!, value: Number(c.n), detail: (c.engines ?? []).map(engineName).join(", ") })),
          },
        ],
        datasets: ["Recommendations", "Competitor mentions"],
        targetUrls: [`/p/${pid}/ai/sentiment?tab=recommendations`],
        data: { label, competitors: comps.slice(0, 3).map((c) => compName.get(c.competitor_id!)), picks: compTotal, ownPicks: own },
      });
    }
    pickCandidates.sort((a, b) => b.rank - a.rank);
    findings.push(...pickCandidates.slice(0, 8).map(withoutRank));

    /* Share-of-voice gap vs the strongest competitor */
    const sov = await rows<SovRow>(sql`
      select competitor_id, is_own, count(distinct answer_id)::int as answers
      from ai_mentions where project_id = ${pid} and answer_date >= ${since} group by 1, 2`);
    const ownAnswers = sov.filter((s) => s.is_own).reduce((a, s) => a + Number(s.answers), 0);
    const totalAnswers = Number(answers);
    for (const s of sov) {
      if (s.is_own || !s.competitor_id || !compName.has(s.competitor_id)) continue;
      const fp = ctx.fingerprint(["sov", s.competitor_id]);
      evaluated.add(fp);
      const compRate = Number(s.answers) / totalAnswers;
      const ownRate = ownAnswers / totalAnswers;
      const gap = compRate - ownRate;
      if (Number(s.answers) < 10 || gap < (ctx.openFingerprints.has(fp) ? 0.08 : 0.15)) continue;
      const name = compName.get(s.competitor_id)!;
      const leads = await rows<LeadRow>(sql`
        select m.competitor_id, p.text,
          count(distinct m.answer_id) filter (where m.competitor_id = ${s.competitor_id})::int as comp,
          count(distinct m.answer_id) filter (where m.is_own)::int as own
        from ai_mentions m join prompts p on p.id = m.prompt_id
        where m.project_id = ${pid} and m.answer_date >= ${since}
        group by 1, 2 having count(distinct m.answer_id) filter (where m.competitor_id = ${s.competitor_id}) > 0
        order by 3 desc limit 8`).catch(() => [] as LeadRow[]);
      findings.push({
        subject: ["sov", s.competitor_id],
        category: "competitor",
        title: `Close the share-of-voice gap to ${name}`,
        summary: `${name} appears in ${fmtPct(compRate * 100)} of AI answers, you in ${fmtPct(ownRate * 100)}.`,
        description: `Across all tracked prompts and engines, **${name}** is mentioned ${Math.round(gap * 100)} percentage points more often than you. The prompts below are where they lead most.`,
        steps: [
          `Review the prompts where ${name} leads and group them by topic.`,
          "Prioritise the topics with buying intent and create/upgrade answer pages for them.",
          `Target the sources engines cite for ${name} (see Sources → filter by competitor).`,
          "Track progress in Competitors → Visibility ranking.",
        ],
        acceptanceCriteria: [`Share-of-voice gap to ${name} shrinks below 8 percentage points.`],
        impact: clamp10(6 + (gap >= 0.3 ? 2 : 1)),
        effort: 7,
        evidence: [
          {
            kind: "metric",
            label: "Answers mentioning each brand (30 days)",
            value: `${fmtPct(compRate * 100)} vs ${fmtPct(ownRate * 100)}`,
            chart: [
              { label: ctx.project.name, value: Math.round(ownRate * 100) },
              { label: name, value: Math.round(compRate * 100) },
            ],
          },
          {
            kind: "prompts",
            label: `Prompts where ${name} leads`,
            items: leads.filter((l) => Number(l.comp) > Number(l.own)).map((l) => ({ label: l.text, value: `${Number(l.comp)} vs ${Number(l.own)}` })),
          },
        ],
        datasets: ["Competitor mentions", "AI answer tracking"],
        targetUrls: [`/p/${pid}/ai/competitors`],
        data: { competitor: name, compRate, ownRate },
      });
    }

    return { findings, evaluated };
  },
});
