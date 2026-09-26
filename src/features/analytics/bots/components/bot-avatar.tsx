"use client";

import { EngineIcon } from "@/components/app/engine-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AI_BOTS } from "@/lib/engines";
import { cn } from "@/lib/utils";

const BOT_COMPANY = new Map<string, string>(AI_BOTS.map((b) => [b.token.toLowerCase(), b.company]));

export function companyOf(bot: string): string | undefined {
  return BOT_COMPANY.get(bot.toLowerCase());
}

const COMPANY_ENGINE: Record<string, string> = {
  OpenAI: "chatgpt",
  Anthropic: "claude",
  Perplexity: "perplexity",
  Google: "gemini",
  Microsoft: "copilot",
  Mistral: "mistral",
};

const COMPANY_COLOR: Record<string, string> = {
  Apple: "#111111",
  Meta: "#0866ff",
  ByteDance: "#fe2c55",
  Amazon: "#ff9900",
  DuckDuckGo: "#de5833",
  Cohere: "#39594d",
  "You.com": "#6d28d9",
  "Common Crawl": "#2f6f4e",
  Ahrefs: "#ff8800",
  Semrush: "#ff642d",
};

/** Small square avatar for a crawler (engine glyph for AI vendors, monogram otherwise). */
export function BotAvatar({
  bot,
  company,
  size = "sm",
  withTooltip = true,
  className,
}: {
  bot: string;
  company?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  withTooltip?: boolean;
  className?: string;
}) {
  company ??= companyOf(bot);
  const engine = company ? COMPANY_ENGINE[company] : undefined;
  let node: React.ReactNode;
  if (engine) {
    node = <EngineIcon id={engine} size={size} withTooltip={false} className={className} />;
  } else {
    const dim = { xs: "size-4 rounded-[4px] text-[8px]", sm: "size-5 rounded-md text-[9px]", md: "size-7 rounded-lg text-[11px]", lg: "size-9 rounded-xl text-xs" }[size];
    node = (
      <span
        className={cn("inline-flex shrink-0 items-center justify-center font-semibold text-white shadow-xs", dim, className)}
        style={{ background: (company && COMPANY_COLOR[company]) ?? "#6b7280" }}
      >
        {bot.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "?"}
      </span>
    );
  }
  if (!withTooltip) return node;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{node}</span>
      </TooltipTrigger>
      <TooltipContent>
        {bot}
        {company ? ` · ${company}` : ""}
      </TooltipContent>
    </Tooltip>
  );
}

export function BotStack({ bots, max = 4 }: { bots: string[]; max?: number }) {
  const shown = bots.slice(0, max);
  return (
    <span className="inline-flex items-center gap-0.5">
      {shown.map((b) => (
        <BotAvatar key={b} bot={b} size="xs" />
      ))}
      {bots.length > max && <span className="ml-0.5 text-[10px] text-muted-foreground">+{bots.length - max}</span>}
    </span>
  );
}
