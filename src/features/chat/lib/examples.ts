/** Example prompt gallery for the Agent home ("Browse example prompts"), tailored to the project. */

export type ExampleCategory = {
  id: string;
  label: string;
  description: string;
  icon: "sparkles" | "swords" | "search" | "bug" | "file-text" | "presentation" | "bar-chart" | "map-pin";
  prompts: { title: string; prompt: string }[];
};

export type ExampleContext = { name: string; domain: string; competitors: string[]; market: string };

export function examplePrompts(p: ExampleContext): ExampleCategory[] {
  const rival = p.competitors[0] ?? "my top competitor";
  const rivals = p.competitors.slice(0, 3).join(", ") || "my main competitors";
  return [
    {
      id: "visibility",
      label: "Visibility analysis",
      description: "How AI engines mention and cite you",
      icon: "sparkles",
      prompts: [
        { title: "Visibility check-up", prompt: `How visible is ${p.name} across AI engines over the last 30 days? Summarize visibility, mention rate, citation rate and share of voice, and what changed vs. the previous period.` },
        { title: "Weakest engines", prompt: `On which AI engines is ${p.name} least visible, and which prompts drive the gap? Suggest three fixes.` },
        { title: "Sentiment drivers", prompt: `What do AI answers say about ${p.name}? Break down the sentiment and quote the most negative statements with their sources.` },
        { title: "Top cited sources", prompt: `Which sources and pages do AI engines cite most when answering our tracked prompts, and which of them mention competitors but not ${p.name}?` },
      ],
    },
    {
      id: "competitors",
      label: "Competitor gaps",
      description: "Where competitors win in AI answers",
      icon: "swords",
      prompts: [
        { title: "Competitor ranking", prompt: `Rank ${p.name} against ${rivals} on AI visibility and share of voice. Who is gaining, who is losing?` },
        { title: `Gap vs. ${rival}`, prompt: `Show the prompts where ${rival} is mentioned by AI engines but ${p.name} is not, grouped by topic, with a recommendation for each group.` },
        { title: "Head-to-head", prompt: `Compare ${p.name} and ${rival} head-to-head: visibility, position, sentiment and the sources each one gets cited from.` },
      ],
    },
    {
      id: "keywords",
      label: "Keyword research",
      description: "Demand, difficulty and quick wins",
      icon: "search",
      prompts: [
        { title: "Quick wins", prompt: `Find quick-win keywords for ${p.domain} in ${p.market}: terms we already rank for on positions 4–20 with decent volume. Prioritize the top 10.` },
        { title: "Topic ideas", prompt: `Suggest keyword clusters around our core offering in ${p.market} with search volume, difficulty and intent, and map them to existing pages on ${p.domain}.` },
        { title: "Competitor keywords", prompt: `Which keywords does ${rival} rank for that ${p.domain} does not? Show the 20 most valuable ones.` },
      ],
    },
    {
      id: "audits",
      label: "Site audits",
      description: "Technical health & crawlability",
      icon: "bug",
      prompts: [
        { title: "Audit summary", prompt: `Summarize the latest site audit of ${p.domain}: health score, the most severe issues and the pages affected. What should we fix first?` },
        { title: "AI crawler access", prompt: `Can AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended) access ${p.domain}? Check robots.txt, llms.txt and crawlability and list what blocks them.` },
      ],
    },
    {
      id: "content",
      label: "Content briefs",
      description: "Pages that win AI citations",
      icon: "file-text",
      prompts: [
        { title: "Brief for a gap prompt", prompt: `Pick the tracked prompt where ${p.name} has the biggest visibility gap and write a content brief (angle, outline, entities, FAQs, sources to earn) for a page that would win it.` },
        { title: "Improve a page", prompt: `Which page on ${p.domain} is closest to being cited by AI engines, and how should we rewrite it to become more citable?` },
      ],
    },
    {
      id: "traffic",
      label: "Traffic & rankings",
      description: "Search Console, rankings, AI referrals",
      icon: "bar-chart",
      prompts: [
        { title: "Search Console trend", prompt: `How is our Google Search Console traffic trending over the last 3 months? Which queries and pages gained or lost the most clicks?` },
        { title: "Rank changes", prompt: `Which tracked keywords moved the most in rank tracking this week, and why might that be?` },
      ],
    },
    {
      id: "reports",
      label: "Reports",
      description: "Turn data into a shareable story",
      icon: "presentation",
      prompts: [
        { title: "Monthly report", prompt: `Build a monthly AI visibility report for ${p.name}: executive summary, KPIs with changes, competitor comparison, wins, risks and next steps.` },
        { title: "Pitch deck outline", prompt: `Create a pitch outline for ${p.name} that shows its AI visibility vs. ${rivals}, with the strongest data points for each slide.` },
      ],
    },
  ];
}

/** Typewriter placeholder lines for the composer. */
export function placeholderLines(p: Pick<ExampleContext, "name" | "competitors">): string[] {
  const rival = p.competitors[0];
  return [
    `How visible is ${p.name} in ChatGPT this month?`,
    rival ? `Where does ${rival} beat us in AI answers?` : "Who are my strongest competitors in AI answers?",
    "Find quick-win keywords I already rank for",
    "What should I fix first from the latest site audit?",
    "Write a content brief for our biggest visibility gap",
    "Build a monthly report for my team",
  ];
}

/** First message of the guided "Build a report" conversation. */
export function reportKickoff(name: string): string {
  return `I want to build a report for ${name}. Ask me what I need (audience, period, focus and format) with a few quick options, then gather the data and build it.`;
}
