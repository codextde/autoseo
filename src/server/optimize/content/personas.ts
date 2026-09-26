import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { contentPersonas, projects } from "@/server/db/schema";
import { runLlm } from "@/server/ai/llm";

/**
 * Expert persona library: archetypal expert perspectives a draft can be written from. These are
 * roles (not invented real people). Without an AI provider the built-in archetypes below are
 * adapted to the topic; with AI, 12–16 topic-specific perspectives are generated.
 */
const ARCHETYPES: Array<{ name: string; role: (t: string) => string; expertise: (t: string) => string[]; bio: (t: string) => string; voice: string }> = [
  {
    name: "The Hands-on Practitioner",
    role: (t) => `Senior ${t} practitioner`,
    expertise: (t) => [`${t} in daily practice`, "Common mistakes", "Practical checklists"],
    bio: (t) => `Has worked hands-on with ${t} for over a decade and explains what actually works in practice.`,
    voice: "Direct, practical, step-by-step; uses concrete examples from real projects.",
  },
  {
    name: "The Independent Tester",
    role: (t) => `Independent ${t} reviewer`,
    expertise: (t) => ["Comparative testing", "Measurement methodology", `${t} benchmarks`],
    bio: (t) => `Tests ${t} products and services side by side with a documented methodology.`,
    voice: "Neutral, evidence-first; states test conditions and numbers before verdicts.",
  },
  {
    name: "The Industry Analyst",
    role: (t) => `${t} market analyst`,
    expertise: () => ["Market data", "Pricing trends", "Forecasts"],
    bio: (t) => `Follows the ${t} market, its players and pricing, and puts developments into context.`,
    voice: "Data-driven, concise, cites sources and dates for every figure.",
  },
  {
    name: "The Consumer Advocate",
    role: (t) => `${t} consumer advisor`,
    expertise: () => ["Hidden costs", "Contracts & warranties", "Buyer pitfalls"],
    bio: (t) => `Helps buyers of ${t} avoid bad deals and understand the fine print.`,
    voice: "Protective, plain-language, highlights risks and what to ask before buying.",
  },
  {
    name: "The Technical Engineer",
    role: (t) => `${t} engineer`,
    expertise: () => ["Specifications", "Standards", "Performance trade-offs"],
    bio: (t) => `Explains how ${t} works under the hood and which specs really matter.`,
    voice: "Precise and technical but accessible; defines terms and units.",
  },
  {
    name: "The Regulatory Expert",
    role: (t) => `${t} compliance specialist`,
    expertise: () => ["Regulations", "Certifications", "Legal requirements"],
    bio: (t) => `Tracks the rules, norms and certifications that apply to ${t}.`,
    voice: "Careful and exact; references the regulation, date and scope of each rule.",
  },
  {
    name: "The Educator",
    role: (t) => `${t} educator`,
    expertise: () => ["Fundamentals", "Explaining concepts", "Beginner questions"],
    bio: (t) => `Teaches ${t} to newcomers and turns jargon into clear explanations.`,
    voice: "Friendly, structured, answers the basic question first, then goes deeper.",
  },
  {
    name: "The Long-term User",
    role: (t) => `Experienced ${t} user`,
    expertise: () => ["Real-world experience", "Durability", "Maintenance"],
    bio: (t) => `Has used ${t} for years and reports what holds up over time.`,
    voice: "Candid and experiential; balances pros and cons with lived detail.",
  },
  {
    name: "The Value Specialist",
    role: (t) => `${t} value-for-money expert`,
    expertise: () => ["Cost comparison", "Total cost of ownership", "Budget options"],
    bio: (t) => `Calculates what ${t} really costs and where the best value is.`,
    voice: "Numerate, pragmatic; shows the calculation behind every recommendation.",
  },
  {
    name: "The Sustainability Expert",
    role: (t) => `${t} sustainability consultant`,
    expertise: () => ["Environmental impact", "Lifecycle", "Certifications"],
    bio: (t) => `Assesses the environmental footprint and longevity of ${t} options.`,
    voice: "Balanced, avoids greenwashing, quantifies impact where possible.",
  },
  {
    name: "The Service Professional",
    role: (t) => `${t} installation & service pro`,
    expertise: () => ["Setup", "Troubleshooting", "Support"],
    bio: (t) => `Installs and services ${t} and knows the problems customers run into.`,
    voice: "Practical, troubleshooting-oriented, uses numbered procedures.",
  },
  {
    name: "The Researcher",
    role: (t) => `${t} researcher`,
    expertise: () => ["Studies", "Evidence quality", "Methodology"],
    bio: (t) => `Reads the research on ${t} and separates solid evidence from marketing claims.`,
    voice: "Rigorous, cites studies, distinguishes correlation from causation.",
  },
  {
    name: "The Brand Product Specialist",
    role: (t) => `In-house ${t} product specialist`,
    expertise: () => ["Product details", "Use cases", "Customer questions"],
    bio: (t) => `Knows the brand's own ${t} offering in depth and answers customer questions transparently.`,
    voice: "Knowledgeable and transparent; discloses the brand perspective and compares fairly.",
  },
];

const aiSchema = z.object({
  personas: z.array(
    z.object({
      name: z.string(),
      role: z.string(),
      expertise: z.array(z.string()),
      bio: z.string(),
      voice: z.string(),
      credentials: z.string(),
    }),
  ),
});

export async function insertLibraryPersonas(projectId: string, topic: string) {
  const t = topic.trim();
  const existing = await db
    .select({ name: contentPersonas.name })
    .from(contentPersonas)
    .where(and(eq(contentPersonas.projectId, projectId), eq(contentPersonas.topic, t)));
  const have = new Set(existing.map((e) => e.name));
  const rows = ARCHETYPES.filter((a) => !have.has(a.name)).map((a) => ({
    projectId,
    topic: t,
    name: a.name,
    role: a.role(t),
    expertise: a.expertise(t),
    bio: a.bio(t),
    voice: a.voice,
    source: "library" as const,
  }));
  if (rows.length) await db.insert(contentPersonas).values(rows);
  return rows.length;
}

export async function generatePersonasWithAi(projectId: string, topic: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new Error("Project not found");
  const t = topic.trim();
  const res = await runLlm({
    purpose: "content.personas",
    system:
      "You design expert writing perspectives for content that AI answer engines should trust and cite. Personas are archetypal expert roles — never invent real people, real names, employers or verifiable credentials.",
    prompt: `Create 14 distinct expert personas for the topic "${t}" (market: ${project.country}, language: ${project.language}; brand: ${project.name}, ${project.domain}${project.description ? ` — ${project.description}` : ""}).
Cover different angles: hands-on practice, independent testing, data/market analysis, consumer protection, engineering/specs, regulation, education for beginners, long-term user experience, value/cost, sustainability, service/installation, research/evidence, the brand's own product specialist, and one contrarian/critical perspective.
For each: name (a role-style label like "The Independent Tester", no personal names), role (job title), expertise (3–5 short areas), bio (1–2 sentences), voice (how they write), credentials (the kind of experience that makes this perspective credible, phrased generically).`,
    schema: aiSchema,
    effort: "low",
    projectId,
    workspaceId: project.workspaceId,
  });
  const existing = await db
    .select({ name: contentPersonas.name })
    .from(contentPersonas)
    .where(and(eq(contentPersonas.projectId, projectId), eq(contentPersonas.topic, t)));
  const have = new Set(existing.map((e) => e.name.toLowerCase()));
  const rows = res.data.personas
    .filter((p) => p.name.trim() && !have.has(p.name.trim().toLowerCase()))
    .slice(0, 16)
    .map((p) => ({
      projectId,
      topic: t,
      name: p.name.trim().slice(0, 80),
      role: p.role.trim().slice(0, 120),
      expertise: p.expertise.map((e) => e.trim()).filter(Boolean).slice(0, 6),
      bio: p.bio.trim().slice(0, 600),
      voice: p.voice.trim().slice(0, 400),
      credentials: p.credentials.trim().slice(0, 300) || null,
      source: "ai" as const,
    }));
  if (rows.length) await db.insert(contentPersonas).values(rows);
  return rows.length;
}
