import type { EngineId, EngineProvider } from "@/lib/engines";

export type AnswerCitation = { url: string; title: string | null; position: number };

export type ShoppingItem = {
  name: string;
  brand?: string | null;
  price?: number | null;
  oldPrice?: number | null;
  currency?: string | null;
  rating?: number | null;
  reviews?: number | null;
  store?: string | null;
  storeDomain?: string | null;
  url?: string | null;
  imageUrl?: string | null;
  position: number;
};

export type AdItem = {
  advertiser: string;
  advertiserDomain?: string | null;
  headline: string;
  description?: string | null;
  imageUrl?: string | null;
  landingUrl?: string | null;
  position?: number | null;
  rating?: number | null;
};

export type AnswerProject = {
  id: string;
  workspaceId: string;
  name: string;
  domain: string;
};

export type AnswerRequest = {
  engine: EngineId;
  prompt: string;
  /** ISO market ("DE", "UK", …) */
  country: string;
  language: string;
  project: AnswerProject;
  /** Force a provider (otherwise resolved from Admin → AI engines). */
  provider?: EngineProvider;
  userId?: string | null;
};

export type AnswerResult = {
  /** Answer as markdown. */
  text: string;
  citations: AnswerCitation[];
  /** Sub-queries the engine searched for (query fan-out). */
  fanouts: string[];
  shopping: ShoppingItem[];
  ads: AdItem[];
  model: string;
  provider: EngineProvider;
  costUsd: number;
  /** Trimmed provider payload for debugging / later re-parsing. */
  raw: Record<string, unknown>;
};

export type EngineErrorCode = "disabled" | "not_configured" | "unsupported" | "agent_offline" | "no_answer";

/** The engine cannot answer right now (not configured, disabled, agent offline…). Not retryable. */
export class EngineUnavailableError extends Error {
  constructor(
    message: string,
    public code: EngineErrorCode,
  ) {
    super(message);
    this.name = "EngineUnavailableError";
  }
}
