/** Content types of cited sources (finseo "Source Types"), with display colors. */
export const SOURCE_TYPES: Record<string, { label: string; color: string }> = {
  listicle: { label: "Listicle", color: "#f97316" },
  "buying-guide": { label: "Buying guide", color: "#eab308" },
  test: { label: "Test / Review", color: "#a855f7" },
  ugc: { label: "UGC", color: "#ec4899" },
  article: { label: "Article", color: "#3b82f6" },
  reference: { label: "Reference", color: "#14b8a6" },
  video: { label: "Video", color: "#ef4444" },
  retail: { label: "Retail", color: "#22c55e" },
  news: { label: "News", color: "#0ea5e9" },
  forum: { label: "Forum", color: "#d946ef" },
  brand: { label: "Brand site", color: "#64748b" },
  docs: { label: "Docs", color: "#8b5cf6" },
  other: { label: "Other", color: "#a8a29e" },
};

export function sourceType(t: string | null | undefined) {
  return SOURCE_TYPES[t ?? "other"] ?? { label: t ?? "Other", color: "#a8a29e" };
}

/** "Get listed" playbook per content type. */
export function getListedAdvice(type: string, opts: { youMentioned: boolean; ownership: string }): { title: string; steps: string[] } {
  if (opts.ownership === "own")
    return {
      title: "This is your own page",
      steps: [
        "Keep it fresh: update facts, prices and dates regularly — engines prefer recently updated pages.",
        "Add clear, quotable statements (specs, comparisons, FAQs) that answer the prompts citing it.",
        "Use structured data (Product, FAQ, Organization) so engines can extract facts reliably.",
      ],
    };
  if (opts.ownership === "competitor")
    return {
      title: "A competitor's page is shaping answers",
      steps: [
        "Publish a stronger page on your site that covers the same questions with better evidence.",
        "Earn third-party coverage (reviews, listicles) that counterbalances competitor-owned content.",
        "Track the prompts citing this page and check whether your own page gets cited over time.",
      ],
    };
  const base: Record<string, string[]> = {
    listicle: [
      "Contact the author/editor with a concise pitch: what makes you different, proof points, and product samples or a demo.",
      "Offer an expert quote or data point they can add when they next update the list.",
      "Check the page's update cadence — listicles are refreshed regularly, time your outreach accordingly.",
    ],
    "buying-guide": [
      "Send the publisher accurate specs, pricing and availability for your products.",
      "Provide a comparison sheet that makes it easy to add you to the guide's criteria.",
      "Make sure your own product pages answer the same buying criteria so engines can corroborate.",
    ],
    test: [
      "Offer a product for testing or a sponsored-free review unit to the testing team.",
      "Share independent test results, certifications or awards they can reference.",
      "Follow up when a new test round is announced.",
    ],
    ugc: [
      "Participate authentically: answer questions in the thread with helpful, non-promotional replies (disclose affiliation).",
      "Encourage real customers to share experiences where relevant.",
      "Monitor recurring questions and publish answers on your own site too.",
    ],
    forum: [
      "Join the discussion with genuinely helpful answers and disclose your affiliation.",
      "Address recurring objections publicly and link to evidence.",
      "Monitor the thread — forums are cited for months after the last reply.",
    ],
    reference: [
      "Ensure your brand facts are correct and supported by reliable, citable sources.",
      "Publish an authoritative 'About/Facts' page and press coverage that editors can reference.",
      "Do not edit reference pages about yourself directly — suggest changes on the talk page with sources.",
    ],
    video: [
      "Reach out to the creator for a review or comparison video featuring your product.",
      "Publish your own explainer/comparison videos with descriptive titles and transcripts.",
      "Offer creators samples, affiliate terms or exclusive insights.",
    ],
    retail: [
      "List your products with this retailer (or improve the existing listing: title, specs, images).",
      "Collect reviews on the retailer page — ratings are often quoted by AI answers.",
      "Keep price and availability in sync; engines surface in-stock offers.",
    ],
    news: [
      "Pitch a story or data-driven angle to the journalist/outlet.",
      "Publish newsworthy updates (launches, studies) with a press release and media kit.",
      "Build relationships with reporters covering your category.",
    ],
    article: [
      "Pitch the author with a unique angle, expert commentary or original data.",
      "Offer to contribute a guest article or be quoted as a source.",
      "Publish complementary content on your site the article could link to.",
    ],
  };
  const steps = base[type] ?? [
    "Identify the editor/owner of this page and pitch why your brand belongs in it.",
    "Provide proof points (reviews, data, awards) that make inclusion easy.",
    "Create a page on your site that covers the same questions so engines can corroborate you.",
  ];
  return {
    title: opts.youMentioned ? "Strengthen your presence here" : "You're missing from answers citing this source — get listed",
    steps,
  };
}
