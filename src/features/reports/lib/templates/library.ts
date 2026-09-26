import { card, chart, eyebrow, heading, icon, kpi, line, list, score, slide, table, text, box } from "../build";
import { CLASSIC_H, CLASSIC_W, SLIDE_H, SLIDE_W, type Deck, type Slide, type SlideElement, type Theme } from "../types";
import { CW, M, W, agencyLogo, callout, clientLogo, coverDecor, footer, header, kpiRow, stepCard } from "./common";

/*
 * Finseo-style library templates. Everything data-driven uses live tokens / bindings, so a deck
 * fills itself for whichever client (project) and period it is opened with.
 */

/* ───────────── shared slide recipes ───────────── */

function cover(o: { eyebrow: string; title: string; sub: string; ring?: { metric: string; label: string }; kpi?: { metric: string; label: string } }): Slide {
  const els: SlideElement[] = [
    ...coverDecor(),
    agencyLogo(),
    eyebrow(o.eyebrow, { x: M, y: 318, w: 1000, h: 34 }),
    heading(o.title, { x: M, y: 370, w: 1040, h: 300, size: 104, lh: 1.02, name: "Title" }),
    text(o.sub, { x: M, y: 700, w: 940, h: 140, size: 32, color: "$muted", lh: 1.4, name: "Subtitle" }),
    text("Prepared for **{{client.name}}** by {{agency.name}} · {{report.date}}", { x: M, y: 930, w: 1100, h: 40, size: 24, color: "$muted", name: "Prepared for" }),
  ];
  if (o.ring) els.push(score(o.ring.metric, { x: 1340, y: 210, w: 440, h: 440, label: o.ring.label, thickness: 30, name: "Score ring" }));
  if (o.kpi)
    els.push(
      kpi(o.kpi.metric, o.kpi.label, { x: 1330, y: 250, w: 460, h: 360, valueSize: 150, labelSize: 28, fill: "$surface", align: "center", name: "Cover KPI" }),
    );
  return slide(els, { name: "Cover" });
}

function panelTitle(title: string, x: number, y: number, w: number): SlideElement {
  return text(`**${title}**`, { x, y, w, h: 44, size: 28, font: "heading", name: `${title} title` });
}

/** A card with a title and a live list inside. */
function listCard(title: string, source: string, x: number, y: number, w: number, h: number, o: Parameters<typeof list>[1] extends infer T ? Partial<T> : never = {}): SlideElement[] {
  return [
    card({ x, y, w, h, name: `${title} card` }),
    panelTitle(title, x + 44, y + 36, w - 88),
    list(source, { x: x + 44, y: y + 100, w: w - 88, h: h - 136, limit: 6, size: 26, ...o, name: title }),
  ];
}

function geoBreakdown(): Slide {
  const tw = (1048 - 32) / 2;
  return slide(
    [
      ...header("GEO score", "Your GEO score is =={{ai.geo_score}}==/100"),
      clientLogo(),
      card({ x: M, y: 340, w: 600, h: 610 }),
      score("ai.geo_score", { x: M + 50, y: 370, w: 500, h: 500, label: "GEO score · grade {{ai.geo_grade}}", thickness: 34 }),
      text("45% visibility · 25% citations · 15% sentiment · 15% position", { x: M + 40, y: 885, w: 520, h: 40, size: 19, color: "$muted", align: "center" }),
      kpi("ai.visibility", "Visibility · 45%", { x: 760, y: 340, w: tw, h: 290, delta: "ai.visibility_delta", spark: "trend.visibility" }),
      kpi("ai.citation_rate", "Citation rate · 25%", { x: 760 + tw + 32, y: 340, w: tw, h: 290, delta: "ai.citation_rate_delta", spark: "trend.citation_rate" }),
      kpi("ai.sentiment", "Sentiment · 15%", { x: 760, y: 660, w: tw, h: 290, delta: "ai.sentiment_delta", spark: "trend.sentiment" }),
      kpi("ai.avg_position", "Avg. position · 15%", { x: 760 + tw + 32, y: 660, w: tw, h: 290, delta: "ai.avg_position_delta", spark: "trend.position" }),
      ...footer(),
    ],
    { name: "GEO score", notes: "The GEO score blends visibility (45%), citation rate (25%), sentiment (15%) and average position (15%) into one 0–100 number." },
  );
}

function engineSplit(): Slide {
  return slide(
    [
      ...header("Engine split", "Visibility differs by ==AI engine=="),
      clientLogo(),
      chart("engines.visibility", "bar", { x: M, y: 340, w: 1180, h: 610, fill: "$surface", radius: 32, title: "Visibility per engine", fontSize: 22 }),
      ...callout("{{ai.best_engine}}", "Strongest engine — {{ai.best_engine_visibility}} of its answers include you", 1340, 340, 468, 295, { valueSize: 50 }),
      ...callout("{{ai.worst_engine}}", "Biggest opportunity — only {{ai.worst_engine_visibility}} visibility", 1340, 655, 468, 295, { valueSize: 50, accent: true }),
      ...footer(),
    ],
    { name: "Engine split" },
  );
}

function competitorGap(): Slide {
  return slide(
    [
      ...header("Competitive gap", "=={{ai.top_competitor}}== is winning answers you should own"),
      clientLogo(),
      chart("brands.visibility", "hbar", { x: M, y: 340, w: 1040, h: 610, fill: "$surface", radius: 32, title: "AI visibility by brand", limit: 8, fontSize: 24 }),
      ...callout("{{ai.visibility_gap}}", "Gap between {{brand.name}} and {{ai.top_competitor}} ({{ai.top_competitor_visibility}} visibility)", 1200, 340, 608, 295, { accent: true, valueSize: 76 }),
      ...callout("{{ai.rank}} {{ai.rank_of}}", "Your rank among tracked brands by AI visibility", 1200, 655, 608, 295, { valueSize: 76 }),
      ...footer(),
    ],
    { name: "Competitor gap" },
  );
}

function actionPlan(title: string, steps: [string, string][], icons: string[] = ["shield-check", "link", "target"]): Slide {
  const w = (CW - 64) / 3;
  return slide(
    [
      ...header("The plan", title),
      clientLogo(),
      ...steps.flatMap(([t, b], i) => stepCard(i + 1, t, b, M + i * (w + 32), 340, w, 470, icons[i])),
      box({ x: M, y: 840, w: CW, h: 110, radius: 28, fill: "$accent", gradient: { from: "$accent", to: "$accent2", angle: 90 }, name: "CTA band" }),
      text("**Next step:** a 30-minute kickoff with {{agency.name}} — {{agency.email}}", {
        x: M + 44,
        y: 840,
        w: CW - 88,
        h: 110,
        size: 30,
        color: "$bg",
        valign: "middle",
        name: "CTA",
      }),
    ],
    { name: "Action plan" },
  );
}

/* ───────────── 1. Blank ───────────── */

function blank(): Slide[] {
  return [slide([], { name: "Slide 1" })];
}

/* ───────────── 2. Pitch (11) ───────────── */

function pitch(): Slide[] {
  const cw3 = (CW - 64) / 3;
  const stat = (i: number, ic: string, value: string, caption: string): SlideElement[] => {
    const x = M + i * (cw3 + 32);
    return [
      card({ x, y: 360, w: cw3, h: 420 }),
      icon(ic, { x: x + 48, y: 408, w: 80, h: 80, bg: "$surface2" }),
      text(value, { x: x + 48, y: 530, w: cw3 - 96, h: 110, size: 96, weight: 700, font: "heading", ls: -0.03 }),
      text(caption, { x: x + 48, y: 650, w: cw3 - 96, h: 110, size: 26, color: "$muted", lh: 1.35 }),
    ];
  };
  return [
    cover({
      eyebrow: "AI visibility pitch",
      title: "Is {{brand.name}} visible in ==AI search==?",
      sub: "How ChatGPT, Perplexity, Gemini and Google's AI answer your customers' questions — and which brands they recommend instead.",
      ring: { metric: "ai.geo_score", label: "GEO score" },
    }),
    slide(
      [
        ...header("The shift", "Your customers now ask ==AI== — not just Google"),
        clientLogo(),
        ...stat(0, "message-square", "{{ai.tracked_prompts}}", "real buying questions tracked across AI assistants"),
        ...stat(1, "bot", "{{ai.engines}}", "AI engines monitored every day — ChatGPT, Perplexity, Gemini, Google AI and more"),
        ...stat(2, "sparkles", "{{ai.answers}}", "AI answers analysed in {{report.period}}"),
        text(
          "AI assistants don't show ten blue links. They name a handful of brands and cite the sources they trust — if you are not in the answer, you are not in the consideration set.",
          { x: M, y: 820, w: 1500, h: 120, size: 28, color: "$muted", lh: 1.45 },
        ),
        ...footer(),
      ],
      { name: "The shift" },
    ),
    slide(
      [
        ...header("Where you stand", "{{brand.name}} appears in =={{ai.visibility}}== of AI answers"),
        clientLogo(),
        ...kpiRow(
          [
            { metric: "ai.visibility", label: "Visibility", delta: "ai.visibility_delta", spark: "trend.visibility" },
            { metric: "ai.mention_rate", label: "Mention rate", delta: "ai.mention_rate_delta", spark: "trend.mention_rate" },
            { metric: "ai.citation_rate", label: "Citation rate", delta: "ai.citation_rate_delta", spark: "trend.citation_rate" },
            { metric: "ai.avg_position", label: "Avg. position", delta: "ai.avg_position_delta", spark: "trend.position" },
          ],
          340,
          320,
        ),
        text(
          "**Visibility** = share of AI answers that name or cite {{brand.name}}. **Mention rate** counts answers naming you, **citation rate** answers linking to your site. Position is your average rank among the brands an answer names.",
          { x: M, y: 700, w: 1000, h: 250, size: 26, color: "$muted", lh: 1.5 },
        ),
        ...callout("{{ai.rank}} {{ai.rank_of}}", "Your rank among all tracked brands — leader: {{ai.leader}}", 1200, 700, 608, 250, { valueSize: 72 }),
        ...footer(),
      ],
      { name: "Where you stand" },
    ),
    geoBreakdown(),
    slide(
      [
        ...header("Momentum", "Visibility over the last {{report.days}} days"),
        clientLogo(),
        chart("trend.visibility", "area", { x: M, y: 340, w: 1180, h: 610, fill: "$surface", radius: 32, title: "Visibility score (daily)", fontSize: 22 }),
        kpi("ai.visibility", "Visibility", { x: 1340, y: 340, w: 468, h: 295, delta: "ai.visibility_delta" }),
        kpi("ai.mention_rate", "Mention rate", { x: 1340, y: 655, w: 468, h: 295, delta: "ai.mention_rate_delta" }),
        ...footer(),
      ],
      { name: "Visibility trend" },
    ),
    competitorGap(),
    slide(
      [
        ...header("Share of voice", "How often AI names you ==vs. the competition=="),
        clientLogo(),
        chart("brands.share_of_voice", "donut", { x: M, y: 340, w: 1040, h: 610, fill: "$surface", radius: 32, limit: 6, fontSize: 24 }),
        text(
          "=={{ai.share_of_voice}}== of all brand mentions in AI answers go to {{brand.name}}.\n\nThe leader, **{{ai.leader}}**, sets the bar. Every point of share of voice is a customer conversation won before anyone reaches a search results page.",
          { x: 1220, y: 360, w: 588, h: 560, size: 32, lh: 1.45, name: "Share of voice copy" },
        ),
        ...footer(),
      ],
      { name: "Share of voice" },
    ),
    engineSplit(),
    slide(
      [
        ...header("Sources", "What AI ==reads== before it answers"),
        clientLogo(),
        ...listCard("Most cited sources", "list.sources", M, 340, 900, 610, { limit: 7, bar: true, size: 25 }),
        chart("sources.types", "donut", { x: 1044, y: 340, w: 764, h: 610, fill: "$surface", radius: 32, title: "Source types", fontSize: 22 }),
        ...footer(),
      ],
      { name: "Sources" },
    ),
    slide(
      [
        ...header("Blind spots", "=={{ai.prompts_invisible}}== buying questions where AI ignores you"),
        clientLogo(),
        ...listCard("Questions without {{brand.name}}", "list.gap_prompts", M, 340, 1040, 610, { limit: 7, value: false, size: 24 }),
        chart("prompts.coverage", "donut", { x: 1184, y: 340, w: 624, h: 610, fill: "$surface", radius: 32, title: "Answer coverage", fontSize: 21 }),
        ...footer(),
      ],
      { name: "Blind spots" },
    ),
    actionPlan("How we get {{brand.name}} ==into the answer==", [
      ["Fix the foundation", "Make every page crawlable and citable for AI bots: robots.txt, llms.txt, schema and fast server-rendered content."],
      ["Win the sources", "Earn mentions on the listicles, reviews and communities AI engines cite most — starting with {{ai.top_source}}."],
      ["Own the answers", "Publish answer-first content for the {{ai.prompts_invisible}} prompts where you are invisible, then track the lift weekly."],
    ]),
  ];
}

/* ───────────── 3. Audit Pitch (11) ───────────── */

function auditPitch(): Slide[] {
  const finding = (n: number, body: string, y: number): SlideElement[] => [
    text(`0${n}`, { x: M, y, w: 110, h: 80, size: 56, weight: 700, font: "heading", color: "$accent" }),
    text(body, { x: M + 130, y: y + 6, w: 950, h: 150, size: 34, lh: 1.3, font: "heading", weight: 500 }),
  ];
  const tw = (CW - 64) / 3;
  const techCard = (i: number, metric: string, label: string, caption: string): SlideElement[] => {
    const x = M + i * (tw + 32);
    return [
      card({ x, y: 340, w: tw, h: 610 }),
      score(metric, { x: x + (tw - 360) / 2, y: 380, w: 360, h: 360, label, thickness: 26 }),
      text(caption, { x: x + 40, y: 780, w: tw - 80, h: 140, size: 24, color: "$muted", lh: 1.4, align: "center" }),
    ];
  };
  return [
    cover({
      eyebrow: "GEO audit",
      title: "How AI engines see =={{brand.name}}==",
      sub: "A full audit of visibility, citations, sentiment and technical readiness across {{ai.engines}} AI engines.",
      ring: { metric: "ai.geo_score", label: "GEO score" },
    }),
    slide(
      [
        ...header("Executive summary", "Three things you need to know"),
        clientLogo(),
        ...finding(1, "{{brand.name}} is visible in =={{ai.visibility}}== of AI answers — rank {{ai.rank}} {{ai.rank_of}}.", 360),
        ...finding(2, "{{ai.top_competitor}} leads with {{ai.top_competitor_visibility}} visibility — a gap of =={{ai.visibility_gap}}==.", 560),
        ...finding(3, "=={{ai.prompts_invisible}}== of {{ai.tracked_prompts}} tracked questions never mention or cite you.", 760),
        card({ x: 1320, y: 340, w: 488, h: 610 }),
        score("ai.geo_score", { x: 1364, y: 390, w: 400, h: 400, label: "GEO score", thickness: 30 }),
        text("Grade **{{ai.geo_grade}}** · {{report.period}}", { x: 1340, y: 830, w: 448, h: 60, size: 26, color: "$muted", align: "center" }),
        ...footer(),
      ],
      { name: "Executive summary" },
    ),
    slide(
      [
        ...header("Scorecard", "Your AI visibility ==scorecard=="),
        clientLogo(),
        ...kpiRow(
          [
            { metric: "ai.visibility", label: "Visibility", delta: "ai.visibility_delta", spark: "trend.visibility" },
            { metric: "ai.mention_rate", label: "Mention rate", delta: "ai.mention_rate_delta", spark: "trend.mention_rate" },
            { metric: "ai.citation_rate", label: "Citation rate", delta: "ai.citation_rate_delta", spark: "trend.citation_rate" },
            { metric: "ai.avg_position", label: "Avg. position", delta: "ai.avg_position_delta", spark: "trend.position" },
          ],
          340,
          295,
        ),
        ...kpiRow(
          [
            { metric: "ai.sentiment", label: "Sentiment", delta: "ai.sentiment_delta" },
            { metric: "ai.share_of_voice", label: "Share of voice", delta: "ai.share_of_voice_delta" },
            { metric: "ai.citations", label: "Citations of your domain" },
            { metric: "ai.answers", label: "AI answers analysed", delta: "ai.answers_delta" },
          ],
          655,
          295,
        ),
        ...footer(),
      ],
      { name: "Scorecard" },
    ),
    slide(
      [
        ...header("By engine", "Visibility across {{ai.engines}} AI engines"),
        clientLogo(),
        chart("engines.visibility", "bar", { x: M, y: 340, w: CW, h: 610, fill: "$surface", radius: 32, title: "Visibility per engine", fontSize: 24 }),
        ...footer(),
      ],
      { name: "Engines" },
    ),
    slide(
      [
        ...header("Competitors", "How {{brand.name}} ==compares=="),
        clientLogo(),
        card({ x: M, y: 340, w: CW, h: 610 }),
        table({ x: M + 44, y: 376, w: CW - 88, h: 540, source: "table.competitors", limit: 8, size: 28 }),
        ...footer(),
      ],
      { name: "Competitor benchmark" },
    ),
    slide(
      [
        ...header("Citations", "Who AI ==trusts== as a source"),
        clientLogo(),
        chart("sources.top", "hbar", { x: M, y: 340, w: 1000, h: 610, fill: "$surface", radius: 32, title: "Most cited domains", limit: 8, fontSize: 23 }),
        chart("sources.ownership", "donut", { x: 1144, y: 340, w: 664, h: 610, fill: "$surface", radius: 32, title: "Citation ownership", fontSize: 22 }),
        ...footer(),
      ],
      { name: "Citations" },
    ),
    slide(
      [
        ...header("Sentiment", "What AI says about =={{brand.name}}=="),
        clientLogo(),
        kpi("ai.sentiment", "Sentiment score", { x: M, y: 340, w: 400, h: 295, delta: "ai.sentiment_delta" }),
        kpi("ai.praise_share", "Praise share", { x: M, y: 655, w: 400, h: 295 }),
        ...listCard("What AI praises", "list.praise", 544, 340, 616, 610, { variant: "bullets", limit: 5, size: 24, rank: false, value: false }),
        ...listCard("What AI criticises", "list.criticism", 1192, 340, 616, 610, { variant: "bullets", limit: 5, size: 24, rank: false, value: false }),
        ...footer(),
      ],
      { name: "Sentiment" },
    ),
    slide(
      [
        ...header("Coverage", "Where you show up in the ==buying journey=="),
        clientLogo(),
        chart("prompts.coverage", "donut", { x: M, y: 340, w: 800, h: 610, fill: "$surface", radius: 32, title: "Answer coverage", fontSize: 22 }),
        chart("funnel.visibility", "bar", { x: 944, y: 340, w: 864, h: 610, fill: "$surface", radius: 32, title: "Visibility by funnel stage", fontSize: 22 }),
        ...footer(),
      ],
      { name: "Prompt coverage" },
    ),
    slide(
      [
        ...header("Content gaps", "Questions you should be ==answering=="),
        clientLogo(),
        ...listCard("Prompts without {{brand.name}}", "list.gap_prompts", M, 340, 1100, 610, { limit: 8, value: false, size: 24 }),
        ...callout("{{ai.prompts_invisible}}", "tracked prompts where no AI engine mentions or cites {{brand.name}}", 1260, 340, 548, 295, { accent: true }),
        ...callout("{{ai.prompt_coverage}}", "prompt coverage today — target 60%+", 1260, 655, 548, 295),
        ...footer(),
      ],
      { name: "Content gaps" },
    ),
    slide(
      [
        ...header("Technical readiness", "Can AI crawlers ==read and cite== your site?"),
        clientLogo(),
        ...techCard(0, "seo.crawlability_score", "AI crawlability", "robots.txt, llms.txt and AI bot access (run a Crawlability check to fill this)."),
        ...techCard(1, "seo.audit_score", "Site health", "Technical SEO health from the latest site audit."),
        ...techCard(2, "ai.citation_rate", "Citation rate", "Share of AI answers that link to your domain."),
        ...footer(),
      ],
      { name: "Technical readiness" },
    ),
    actionPlan(
      "Your ==90-day== GEO roadmap",
      [
        ["Days 1–30", "Fix crawlability and structured data, publish llms.txt, and rewrite key pages answer-first."],
        ["Days 31–60", "Create content for the top gap prompts and earn listings on the sources AI cites most."],
        ["Days 61–90", "Scale what works per engine, close the gap to {{ai.top_competitor}} and report the lift monthly."],
      ],
      ["wand-sparkles", "rocket", "trophy"],
    ),
  ];
}

/* ───────────── 4. Monthly Report (7) ───────────── */

function monthly(): Slide[] {
  const half = (CW - 32) / 2;
  return [
    cover({
      eyebrow: "Monthly AI visibility report",
      title: "=={{report.month}}==\nAI visibility report",
      sub: "{{client.name}} · {{report.period}}",
      ring: { metric: "ai.visibility", label: "Visibility" },
    }),
    slide(
      [
        ...header("This month", "Highlights for =={{report.month}}=="),
        clientLogo(),
        ...kpiRow(
          [
            { metric: "ai.visibility", label: "Visibility", delta: "ai.visibility_delta", spark: "trend.visibility" },
            { metric: "ai.mention_rate", label: "Mention rate", delta: "ai.mention_rate_delta", spark: "trend.mention_rate" },
            { metric: "ai.citation_rate", label: "Citation rate", delta: "ai.citation_rate_delta", spark: "trend.citation_rate" },
            { metric: "ai.avg_position", label: "Avg. position", delta: "ai.avg_position_delta", spark: "trend.position" },
          ],
          340,
          310,
        ),
        card({ x: M, y: 680, w: 1100, h: 270 }),
        text(
          "- Visibility moved **{{ai.visibility_delta}}** to **{{ai.visibility}}**\n- **{{ai.citations}}** citations of your domain across {{ai.answers}} AI answers\n- Rank **{{ai.rank}}** {{ai.rank_of}} — the leader is {{ai.leader}}",
          { x: M + 44, y: 712, w: 1012, h: 210, size: 28, lh: 1.6, name: "Highlights" },
        ),
        ...callout("{{ai.geo_score}}", "GEO score this month ({{ai.geo_score_delta}} vs. last period)", 1260, 680, 548, 270),
        ...footer(),
      ],
      { name: "Highlights" },
    ),
    slide(
      [
        ...header("Trend", "Visibility vs. competitors"),
        clientLogo(),
        chart("trend.brands", "line", { x: M, y: 340, w: CW, h: 610, fill: "$surface", radius: 32, limit: 4, fontSize: 22 }),
        ...footer(),
      ],
      { name: "Trend" },
    ),
    slide(
      [
        ...header("Competitors", "The competitive picture"),
        clientLogo(),
        chart("brands.visibility", "hbar", { x: M, y: 340, w: 1000, h: 610, fill: "$surface", radius: 32, title: "Visibility by brand", limit: 8, fontSize: 23 }),
        chart("brands.share_of_voice", "donut", { x: 1144, y: 340, w: 664, h: 610, fill: "$surface", radius: 32, title: "Share of voice", limit: 5, fontSize: 21 }),
        ...footer(),
      ],
      { name: "Competitors" },
    ),
    slide(
      [
        ...header("Citations", "Sources AI ==relied on=="),
        clientLogo(),
        ...listCard("Top cited sources", "list.sources", M, 340, 1000, 610, { limit: 7, bar: true, size: 25 }),
        kpi("ai.citations", "Citations of your domain", { x: 1144, y: 340, w: 664, h: 250 }),
        chart("sources.types", "donut", { x: 1144, y: 620, w: 664, h: 330, fill: "$surface", radius: 32, fontSize: 19 }),
        ...footer(),
      ],
      { name: "Citations" },
    ),
    slide(
      [
        ...header("Prompts", "Wins and gaps"),
        clientLogo(),
        ...listCard("Top prompts", "list.top_prompts", M, 340, half, 610, { limit: 7, size: 24, bar: true }),
        ...listCard("Gaps to close", "list.gap_prompts", M + half + 32, 340, half, 610, { limit: 7, size: 24, value: false }),
        ...footer(),
      ],
      { name: "Prompts" },
    ),
    slide(
      [
        ...header("Next month", "Focus for ==next month=="),
        clientLogo(),
        ...listCard("Open tasks", "list.tasks", M, 340, 1100, 610, { limit: 6, size: 25 }),
        card({ x: 1260, y: 340, w: 548, h: 610, fill: "$surface2", stroke: "transparent" }),
        text(
          "**Focus areas**\n- Close the gap to {{ai.top_competitor}}\n- Lift citation rate above {{ai.citation_rate}}\n- Answer the top gap prompts\n- Grow share of voice on {{ai.worst_engine}}",
          { x: 1300, y: 380, w: 468, h: 540, size: 28, lh: 1.65, name: "Focus areas" },
        ),
        ...footer(),
      ],
      { name: "Next month" },
    ),
  ];
}

/* ───────────── 5. Competitor Benchmark (5) ───────────── */

function competitorBenchmark(): Slide[] {
  return [
    cover({
      eyebrow: "Competitor benchmark",
      title: "The ==AI search== competitive landscape",
      sub: "{{brand.name}} vs. {{ai.competitors}} competitors across {{ai.engines}} AI engines · {{report.period}}",
      kpi: { metric: "ai.rank", label: "Your visibility rank" },
    }),
    slide(
      [
        ...header("Ranking", "Who AI ==recommends== most"),
        clientLogo(),
        chart("brands.visibility", "hbar", { x: M, y: 340, w: CW, h: 610, fill: "$surface", radius: 32, limit: 10, fontSize: 25 }),
        ...footer(),
      ],
      { name: "Ranking" },
    ),
    slide(
      [
        ...header("Over time", "Visibility vs. top competitors"),
        clientLogo(),
        chart("trend.brands", "line", { x: M, y: 340, w: CW, h: 610, fill: "$surface", radius: 32, limit: 5, fontSize: 22 }),
        ...footer(),
      ],
      { name: "Trend" },
    ),
    slide(
      [
        ...header("Benchmark", "Head-to-head metrics"),
        clientLogo(),
        card({ x: M, y: 340, w: 1180, h: 610 }),
        table({ x: M + 40, y: 372, w: 1100, h: 550, source: "table.competitors", limit: 8, size: 25 }),
        chart("brands.share_of_voice", "donut", { x: 1324, y: 340, w: 484, h: 610, fill: "$surface", radius: 32, title: "Share of voice", limit: 5, fontSize: 19 }),
        ...footer(),
      ],
      { name: "Benchmark table" },
    ),
    slide(
      [
        ...header("Opportunity", "Closing the gap to =={{ai.top_competitor}}=="),
        clientLogo(),
        ...callout("{{ai.visibility_gap}}", "visibility gap to {{ai.top_competitor}}", M, 340, 544, 295, { accent: true }),
        ...callout("{{ai.share_of_voice}}", "your share of voice today", M, 655, 544, 295),
        ...listCard("Competitors to beat", "list.rivals", 688, 340, 1120, 610, { limit: 6, bar: true, size: 26 }),
        ...footer(),
      ],
      { name: "Opportunity" },
    ),
  ];
}

/* ───────────── 6. Citation Analysis (5) ───────────── */

function citationAnalysis(): Slide[] {
  const half = (CW - 32) / 2;
  return [
    cover({
      eyebrow: "Citation analysis",
      title: "Who AI ==cites== — and why",
      sub: "The sources ChatGPT, Perplexity & co. rely on when answering questions about {{brand.name}}'s market · {{report.period}}",
      kpi: { metric: "ai.citations", label: "Citations of your domain" },
    }),
    slide(
      [
        ...header("Overview", "Citations at a glance"),
        clientLogo(),
        ...kpiRow(
          [
            { metric: "ai.citations", label: "Citations of your domain" },
            { metric: "ai.citation_rate", label: "Citation rate", delta: "ai.citation_rate_delta" },
            { metric: "ai.own_citation_share", label: "Your share of all citations" },
            { metric: "ai.sources", label: "Distinct sources cited" },
          ],
          340,
          250,
        ),
        chart("trend.citation_rate", "area", { x: M, y: 620, w: CW, h: 330, fill: "$surface", radius: 32, title: "Citation rate (daily)", fontSize: 20 }),
        ...footer(),
      ],
      { name: "Overview" },
    ),
    slide(
      [
        ...header("Top sources", "The domains AI ==cites most=="),
        clientLogo(),
        chart("sources.top", "hbar", { x: M, y: 340, w: 1100, h: 610, fill: "$surface", radius: 32, limit: 10, fontSize: 23 }),
        text(
          "**{{ai.top_source}}** is the most cited source in your market.\n\nAI engines lean on a small set of trusted domains. Being listed, reviewed or quoted there is the fastest way into the answer.",
          { x: 1260, y: 360, w: 548, h: 580, size: 30, lh: 1.45 },
        ),
        ...footer(),
      ],
      { name: "Top sources" },
    ),
    slide(
      [
        ...header("Source mix", "What kind of content ==gets cited=="),
        clientLogo(),
        chart("sources.types", "donut", { x: M, y: 340, w: half, h: 610, fill: "$surface", radius: 32, title: "By content type", fontSize: 21 }),
        chart("sources.ownership", "donut", { x: M + half + 32, y: 340, w: half, h: 610, fill: "$surface", radius: 32, title: "By ownership", fontSize: 21 }),
        ...footer(),
      ],
      { name: "Source mix" },
    ),
    slide(
      [
        ...header("Your pages", "Pages AI ==already trusts=="),
        clientLogo(),
        ...listCard("Your cited pages", "list.own_pages", M, 340, 1100, 610, { limit: 7, bar: true, size: 24 }),
        card({ x: 1260, y: 340, w: 548, h: 610, fill: "$surface2", stroke: "transparent" }),
        text(
          "**How to earn more citations**\n- Add quotable facts and statistics\n- Publish comparison and best-of pages\n- Get listed on {{ai.top_source}}\n- Keep pages fresh and server-rendered",
          { x: 1300, y: 380, w: 468, h: 540, size: 27, lh: 1.6 },
        ),
        ...footer(),
      ],
      { name: "Your pages" },
    ),
  ];
}

/* ───────────── 7. Prompt Coverage (5) ───────────── */

function promptCoverage(): Slide[] {
  const half = (CW - 32) / 2;
  return [
    cover({
      eyebrow: "Prompt coverage",
      title: "Which questions ==surface== {{brand.name}}?",
      sub: "Coverage of {{ai.tracked_prompts}} real customer questions across {{ai.engines}} AI engines · {{report.period}}",
      ring: { metric: "ai.prompt_coverage", label: "Prompt coverage" },
    }),
    slide(
      [
        ...header("Coverage", "=={{ai.prompts_visible}}== of {{ai.tracked_prompts}} questions surface your brand"),
        clientLogo(),
        chart("prompts.coverage", "donut", { x: M, y: 340, w: 1000, h: 610, fill: "$surface", radius: 32, title: "Answer coverage", fontSize: 23 }),
        kpi("ai.prompt_coverage", "Prompt coverage", { x: 1144, y: 340, w: 664, h: 295 }),
        kpi("ai.prompts_invisible", "Prompts where you are invisible", { x: 1144, y: 655, w: 664, h: 295, valueColor: "$negative" }),
        ...footer(),
      ],
      { name: "Coverage" },
    ),
    slide(
      [
        ...header("Journey", "Coverage across the ==funnel== and topics"),
        clientLogo(),
        chart("funnel.visibility", "bar", { x: M, y: 340, w: half, h: 610, fill: "$surface", radius: 32, title: "By funnel stage", fontSize: 22 }),
        chart("topics.visibility", "hbar", { x: M + half + 32, y: 340, w: half, h: 610, fill: "$surface", radius: 32, title: "By topic", limit: 8, fontSize: 21 }),
        ...footer(),
      ],
      { name: "Journey" },
    ),
    slide(
      [
        ...header("Wins", "Questions where AI ==recommends you=="),
        clientLogo(),
        ...listCard("Top prompts", "list.top_prompts", M, 340, CW, 610, { limit: 8, bar: true, size: 25 }),
        ...footer(),
      ],
      { name: "Wins" },
    ),
    slide(
      [
        ...header("Gaps", "Questions to ==win next=="),
        clientLogo(),
        ...listCard("Prompts without {{brand.name}}", "list.gap_prompts", M, 340, 1100, 610, { limit: 8, value: false, size: 24 }),
        ...listCard("What AI searched for", "list.fanouts", 1260, 340, 548, 610, { limit: 8, size: 21, rank: false }),
        ...footer(),
      ],
      { name: "Gaps" },
    ),
  ];
}

/* ───────────── 8. GEO Audit (5) ───────────── */

function geoAudit(): Slide[] {
  const half = (CW - 32) / 2;
  return [
    cover({
      eyebrow: "GEO audit",
      title: "Generative Engine ==Optimization== audit",
      sub: "How {{brand.name}} performs in AI answers — and the fastest path to more visibility.",
      ring: { metric: "ai.geo_score", label: "GEO score" },
    }),
    geoBreakdown(),
    engineSplit(),
    slide(
      [
        ...header("Perception", "Strengths & ==weaknesses=="),
        clientLogo(),
        ...listCard("Strengths — what AI praises", "list.praise", M, 340, half, 610, { variant: "bullets", limit: 5, size: 25, rank: false, value: false }),
        ...listCard("Weaknesses — what AI criticises", "list.criticism", M + half + 32, 340, half, 610, { variant: "bullets", limit: 5, size: 25, rank: false, value: false }),
        ...footer(),
      ],
      { name: "Strengths & weaknesses" },
    ),
    slide(
      [
        ...header("Action plan", "Prioritised ==next steps=="),
        clientLogo(),
        ...listCard("Highest-impact tasks", "list.tasks", M, 340, 1100, 610, { limit: 6, size: 25 }),
        card({ x: 1260, y: 340, w: 548, h: 610, fill: "$accent", stroke: "transparent" }),
        text("**Quick wins**\n- Publish llms.txt\n- Add FAQ & Product schema\n- Answer the top 5 gap prompts\n- Pitch {{ai.top_source}}", {
          x: 1300,
          y: 380,
          w: 468,
          h: 540,
          size: 28,
          lh: 1.65,
          color: "$bg",
        }),
        ...footer(),
      ],
      { name: "Action plan" },
    ),
  ];
}

/* ───────────── 9. Baseline Snapshot (5) ───────────── */

function baseline(): Slide[] {
  const tw = (CW - 64) / 3;
  const tile = (i: number, row: number, metric: string, label: string) =>
    kpi(metric, label, { x: M + i * (tw + 32), y: row === 0 ? 340 : 660, w: tw, h: 290, valueSize: 96 });
  return [
    cover({
      eyebrow: "Baseline snapshot",
      title: "Where =={{brand.name}}== starts",
      sub: "Measured {{report.date}} across {{ai.engines}} AI engines and {{ai.tracked_prompts}} tracked prompts.",
      kpi: { metric: "ai.visibility", label: "Baseline visibility" },
    }),
    slide(
      [
        ...header("Baseline", "Your ==starting line=="),
        clientLogo(),
        tile(0, 0, "ai.visibility", "Visibility"),
        tile(1, 0, "ai.mention_rate", "Mention rate"),
        tile(2, 0, "ai.citation_rate", "Citation rate"),
        tile(0, 1, "ai.avg_position", "Avg. position"),
        tile(1, 1, "ai.sentiment", "Sentiment"),
        tile(2, 1, "ai.share_of_voice", "Share of voice"),
        ...footer(),
      ],
      { name: "Baseline KPIs" },
    ),
    slide(
      [
        ...header("Engines", "Baseline by ==AI engine=="),
        clientLogo(),
        card({ x: M, y: 340, w: CW, h: 610 }),
        table({ x: M + 44, y: 376, w: CW - 88, h: 540, source: "table.engines", limit: 10, size: 27 }),
        ...footer(),
      ],
      { name: "Engine baseline" },
    ),
    slide(
      [
        ...header("Competitors", "Baseline vs. ==competitors=="),
        clientLogo(),
        chart("brands.visibility", "hbar", { x: M, y: 340, w: 1100, h: 610, fill: "$surface", radius: 32, limit: 8, fontSize: 24 }),
        ...callout("{{ai.rank}} {{ai.rank_of}}", "Your starting rank by AI visibility", 1260, 340, 548, 295, { accent: true, valueSize: 72 }),
        ...callout("{{ai.leader}}", "Current visibility leader in your market", 1260, 655, 548, 295, { valueSize: 52 }),
        ...footer(),
      ],
      { name: "Competitor baseline" },
    ),
    slide(
      [
        ...header("Tracking plan", "What we ==measure== from here"),
        clientLogo(),
        ...callout("{{ai.tracked_prompts}}", "customer questions tracked daily", M, 340, tw, 300),
        ...callout("{{ai.engines}}", "AI engines — ChatGPT, Perplexity, Gemini, Google AI…", M + tw + 32, 340, tw, 300),
        ...callout("{{ai.competitors}}", "competitors benchmarked", M + 2 * (tw + 32), 340, tw, 300),
        text(
          "Every month we report progress against this baseline: **visibility**, **mention rate**, **citation rate**, **position**, **sentiment** and **share of voice** — per engine, per topic and against {{ai.top_competitor}}.",
          { x: M, y: 700, w: 1500, h: 220, size: 30, lh: 1.5, color: "$muted" },
        ),
        ...footer(),
      ],
      { name: "Tracking plan" },
    ),
  ];
}

/* ───────────── 10. Executive One-Pager (1) ───────────── */

function onePager(): Slide[] {
  return [
    slide(
      [
        eyebrow("Executive summary · {{report.period}}", { x: M, y: 72, w: 1200, h: 32 }),
        heading("{{brand.name}} in ==AI search==", { x: M, y: 114, w: 1300, h: 90, size: 68 }),
        text("Visibility **{{ai.visibility}}** ({{ai.visibility_delta}}) · rank **{{ai.rank}}** {{ai.rank_of}} · leader {{ai.leader}}", {
          x: M,
          y: 214,
          w: 1300,
          h: 44,
          size: 26,
          color: "$muted",
        }),
        score("ai.geo_score", { x: 1568, y: 56, w: 240, h: 240, label: "GEO score", thickness: 20 }),
        ...kpiRow(
          [
            { metric: "ai.visibility", label: "Visibility", delta: "ai.visibility_delta" },
            { metric: "ai.mention_rate", label: "Mention rate", delta: "ai.mention_rate_delta" },
            { metric: "ai.citation_rate", label: "Citation rate", delta: "ai.citation_rate_delta" },
            { metric: "ai.share_of_voice", label: "Share of voice", delta: "ai.share_of_voice_delta" },
          ],
          316,
          220,
          { valueSize: 64 },
        ),
        chart("trend.visibility", "area", { x: M, y: 568, w: 1000, h: 400, fill: "$surface", radius: 28, title: "Visibility trend", fontSize: 19 }),
        card({ x: 1144, y: 568, w: 664, h: 400 }),
        text("**Top competitors**", { x: 1180, y: 596, w: 600, h: 40, size: 24, font: "heading" }),
        list("list.competitors", { x: 1180, y: 646, w: 592, h: 300, limit: 5, size: 21, bar: false }),
        line({ x: M, y: 1000, w: CW, h: 2 }),
        text("{{agency.name}}", { x: M, y: 1016, w: 800, h: 30, size: 19, color: "$muted" }),
        text("{{client.name}} · {{report.date}}", { x: W - M - 900, y: 1016, w: 900, h: 30, size: 19, color: "$muted", align: "right" }),
      ],
      { name: "Executive one-pager" },
    ),
  ];
}

/* ───────────── 11. Blank (Classic) ───────────── */

function classic(): Slide[] {
  return [
    slide(
      [
        eyebrow("{{client.name}}", { x: 80, y: 80, w: 1080, h: 32 }),
        heading("AI visibility report", { x: 80, y: 120, w: 1080, h: 80, size: 60 }),
        text("{{report.period}} · prepared by {{agency.name}}", { x: 80, y: 210, w: 1080, h: 40, size: 24, color: "$muted" }),
        line({ x: 80, y: 280, w: 1080, h: 2 }),
      ],
      { name: "Page 1" },
    ),
  ];
}

/* ───────────── registry ───────────── */

export type LibraryTemplate = {
  key: string;
  name: string;
  description: string;
  format: "slides" | "classic";
  build: () => Slide[];
};

export const LIBRARY_TEMPLATES: LibraryTemplate[] = [
  { key: "blank", name: "Blank", description: "Start from an empty slide", format: "slides", build: blank },
  { key: "pitch", name: "Pitch", description: "Win the client: visibility, competitor gap, action plan", format: "slides", build: pitch },
  { key: "audit_pitch", name: "Audit Pitch", description: "Full GEO audit story incl. technical readiness & roadmap", format: "slides", build: auditPitch },
  { key: "monthly", name: "Monthly Report", description: "Monthly KPIs, trends, competitors and next steps", format: "slides", build: monthly },
  { key: "competitor_benchmark", name: "Competitor Benchmark", description: "Ranking, share of voice and head-to-head metrics", format: "slides", build: competitorBenchmark },
  { key: "citation_analysis", name: "Citation Analysis", description: "Which sources AI cites and how to earn citations", format: "slides", build: citationAnalysis },
  { key: "prompt_coverage", name: "Prompt Coverage", description: "Coverage across prompts, funnel stages and topics", format: "slides", build: promptCoverage },
  { key: "geo_audit", name: "GEO Audit", description: "GEO score breakdown, engines, perception, actions", format: "slides", build: geoAudit },
  { key: "baseline", name: "Baseline Snapshot", description: "Starting-point metrics before an engagement", format: "slides", build: baseline },
  { key: "one_pager", name: "Executive One-Pager", description: "Everything that matters on a single slide", format: "slides", build: onePager },
  { key: "classic", name: "Blank (Classic)", description: "v1 widget canvas — portrait page with snapping grid", format: "classic", build: classic },
];

export function getLibraryTemplate(key: string): LibraryTemplate | undefined {
  return LIBRARY_TEMPLATES.find((t) => t.key === key);
}

/** Instantiates a library template as a deck with the given theme. */
export function buildLibraryDeck(key: string, theme: Theme): Deck {
  const tpl = getLibraryTemplate(key) ?? LIBRARY_TEMPLATES[0]!;
  const classicFormat = tpl.format === "classic";
  return {
    version: 1,
    format: tpl.format,
    size: classicFormat ? { w: CLASSIC_W, h: CLASSIC_H } : { w: SLIDE_W, h: SLIDE_H },
    theme,
    ...(classicFormat ? { grid: 20 } : {}),
    slides: tpl.build(),
  };
}
