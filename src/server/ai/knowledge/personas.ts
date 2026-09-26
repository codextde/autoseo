import "server-only";
import { z } from "zod";
import { nanoid } from "nanoid";
import { runLlm } from "@/server/ai/llm";
import { getCountry } from "@/lib/countries";
import { brandBriefing, getProjectRow, languageName } from "./profile";
import { getKnowledge, patchKnowledgeData } from "./store";
import type { Persona, PersonasData, SitemapData, InterestData } from "@/features/ai-research/types";

const personaSchema = z.object({
  personas: z.array(
    z.object({
      name: z.string(),
      role: z.string(),
      description: z.string(),
      goals: z.array(z.string()),
      pains: z.array(z.string()),
      questions: z.array(z.string()),
      funnelStage: z.enum(["tofu", "mofu", "bofu"]),
      share: z.number().nullable(),
    }),
  ),
});

export const personaInput = z.object({
  id: z.string().max(40).optional(),
  name: z.string().trim().min(1).max(120),
  role: z.string().trim().max(200),
  description: z.string().trim().max(2000),
  goals: z.array(z.string().trim().min(1).max(300)).max(12),
  pains: z.array(z.string().trim().min(1).max(300)).max(12),
  questions: z.array(z.string().trim().min(1).max(400)).max(20),
  funnelStage: z.enum(["tofu", "mofu", "bofu"]),
  share: z.number().min(0).max(100).nullable().optional(),
});

export async function analyzePersonas(projectId: string, userId: string | null, count = 5): Promise<{ data: PersonasData; summary: string }> {
  const p = await getProjectRow(projectId);
  const sitemap = await getKnowledge<SitemapData>(projectId, "sitemap");
  const interest = await getKnowledge<InterestData>(projectId, "interest");
  const extra: string[] = [];
  if (interest.data?.clusters.length)
    extra.push(`Top search interest clusters: ${interest.data.clusters.slice(0, 10).map((c) => `${c.name} (${c.volume ?? "?"}/mo)`).join(", ")}`);
  if (sitemap.data)
    extra.push(
      `Website sections: ${sitemap.data.tree.children
        .slice(0, 12)
        .map((c) => `${c.path} (${c.count} pages, ${c.type})`)
        .join(", ")}`,
    );
  const res = await runLlm({
    purpose: "brand_knowledge_personas",
    timeoutMs: 20 * 60_000,
    projectId,
    workspaceId: p.workspaceId,
    userId,
    webSearch: true,
    system: "You are a B2C/B2B market researcher. Build realistic buyer personas grounded in the brand's actual offering.",
    prompt: `${await brandBriefing(projectId)}
${extra.join("\n")}

Create ${count} distinct buyer personas for this brand in ${getCountry(p.country)?.name ?? p.country}. Write everything in ${languageName(p.language)}.
For each persona: a memorable name (e.g. "Eco-conscious homeowner Anna"), role/life situation, 2–3 sentence description, 3–5 goals, 3–5 pains, 5–8 typical questions they would ask an AI assistant like ChatGPT (natural, conversational, mostly WITHOUT naming the brand), the funnel stage where they usually are (tofu/mofu/bofu) and a rough share of the audience in percent (or null).`,
    schema: personaSchema,
    maxTokens: 8000,
  });
  const kept = (await getKnowledge<PersonasData>(projectId, "personas")).data?.personas.filter((x) => x.source === "manual") ?? [];
  const keptNames = new Set(kept.map((x) => x.name.toLowerCase()));
  const generated: Persona[] = res.data.personas.map((x) => ({
    id: nanoid(10),
    name: x.name,
    role: x.role,
    description: x.description,
    goals: x.goals.slice(0, 8),
    pains: x.pains.slice(0, 8),
    questions: x.questions.slice(0, 12),
    funnelStage: x.funnelStage,
    share: x.share,
    source: "ai" as const,
  }));
  const personas = [...kept, ...generated.filter((g) => !keptNames.has(g.name.toLowerCase()))].slice(0, 30);
  return {
    data: { personas, generatedAt: new Date().toISOString() },
    summary: `${generated.length} buyer personas generated: ${generated.map((x) => x.name).join(", ")}${kept.length ? ` (${kept.length} of your own kept)` : ""}.`,
  };
}

export async function upsertPersona(projectId: string, input: z.infer<typeof personaInput>): Promise<Persona> {
  const state = await getKnowledge<PersonasData>(projectId, "personas");
  const list = [...(state.data?.personas ?? [])];
  const persona: Persona = { ...input, id: input.id ?? nanoid(10), share: input.share ?? null, source: "manual" };
  const idx = list.findIndex((x) => x.id === persona.id);
  if (idx >= 0) list[idx] = persona;
  else {
    if (list.length >= 30) throw new Error("A project can have at most 30 personas.");
    list.push(persona);
  }
  await patchKnowledgeData(projectId, "personas", { personas: list, generatedAt: state.data?.generatedAt ?? null });
  return persona;
}

export async function deletePersona(projectId: string, personaId: string) {
  const state = await getKnowledge<PersonasData>(projectId, "personas");
  const list = (state.data?.personas ?? []).filter((x) => x.id !== personaId);
  await patchKnowledgeData(projectId, "personas", { personas: list, generatedAt: state.data?.generatedAt ?? null });
}
