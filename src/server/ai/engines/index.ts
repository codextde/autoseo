import "server-only";
import { getEngine } from "@/lib/engines";
import { answerViaDataForSeo } from "./dataforseo";
import { answerViaApi } from "./api";
import { answerViaAgent } from "./agent";
import { getEngineAvailabilityFor, getEngineModelOverride } from "./availability";
import type { AnswerRequest, AnswerResult } from "./types";
import { EngineUnavailableError } from "./types";

export type { AnswerRequest, AnswerResult, AnswerCitation, ShoppingItem, AdItem, AnswerProject } from "./types";
export { EngineUnavailableError } from "./types";
export { getEngineAvailability, getEngineAvailabilityFor, providerLabel, type EngineAvailability, type EngineStatus } from "./availability";

/**
 * Asks one AI engine a prompt the way a user in `country` would, via the provider selected in
 * Admin → AI Providers (auto = first configured provider in the engine's preference order).
 * Throws EngineUnavailableError when no provider can answer (not retryable).
 */
export async function answerPrompt(req: AnswerRequest): Promise<AnswerResult> {
  const engine = getEngine(req.engine);
  if (!engine) throw new EngineUnavailableError(`Unknown engine "${req.engine}".`, "unsupported");
  let provider = req.provider;
  if (!provider) {
    const avail = await getEngineAvailabilityFor(req.engine, { workspaceId: req.project.workspaceId });
    if (!avail?.provider || !avail.configured) {
      throw new EngineUnavailableError(`${engine.name}: ${avail?.reason ?? "not available"}`, avail?.status === "disabled" ? "disabled" : "not_configured");
    }
    provider = avail.provider;
  } else if (!engine.providers.includes(provider)) {
    throw new EngineUnavailableError(`${engine.name} cannot be answered via ${provider}.`, "unsupported");
  }
  const model = await getEngineModelOverride(engine.id);
  const prompt = req.prompt.trim();
  if (!prompt) throw new EngineUnavailableError("Empty prompt.", "no_answer");
  const request = { ...req, prompt, provider };
  switch (provider) {
    case "dataforseo":
      return answerViaDataForSeo(request, model);
    case "api":
      return answerViaApi(request, model);
    case "agent":
      return answerViaAgent(request);
  }
}
