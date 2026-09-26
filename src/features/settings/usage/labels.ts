/** Friendly labels for provider / feature keys recorded in `usage_events` (isomorphic). */
export const PROVIDER_LABELS: Record<string, string> = {
  dataforseo: "DataForSEO",
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  perplexity: "Perplexity",
  gemini: "Google Gemini",
  xai: "xAI",
  mistral: "Mistral",
  deepseek: "DeepSeek",
  local_agent: "Local agents",
  google: "Google",
  bing: "Bing",
};

export function providerLabel(key: string) {
  return PROVIDER_LABELS[key] ?? key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function featureLabel(key: string) {
  return key.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** USD with sensible precision for tiny API costs ($0.0042) and large totals ($1,234). */
export function formatUsd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  const digits = abs === 0 ? 2 : abs < 0.01 ? 4 : abs < 100 ? 2 : 0;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}
