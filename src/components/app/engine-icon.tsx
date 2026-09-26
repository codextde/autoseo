import { getEngine } from "@/lib/engines";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Simplified, original glyphs for each AI engine (no third-party logo assets). */
function Glyph({ id }: { id: string }) {
  switch (id) {
    case "chatgpt":
    case "chatgpt_gui":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          {[0, 60, 120, 180, 240, 300].map((a) => (
            <ellipse key={a} cx="12" cy="12" rx="3.2" ry="7.6" transform={`rotate(${a} 12 12)`} />
          ))}
        </svg>
      );
    case "perplexity":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
          <path d="M12 3v18M5 7l7 5 7-5M5 7v9l7-4 7 4V7M8 21v-6M16 21v-6" />
        </svg>
      );
    case "ai_overview":
    case "google_ai_mode":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z" />
          <circle cx="19" cy="19" r="2.4" />
        </svg>
      );
    case "gemini":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 1.5c.6 5.6 4.9 9.9 10.5 10.5-5.6.6-9.9 4.9-10.5 10.5C11.4 16.9 7.1 12.6 1.5 12 7.1 11.4 11.4 7.1 12 1.5z" />
        </svg>
      );
    case "claude":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
          {[0, 30, 60, 90, 120, 150].map((a) => (
            <line key={a} x1="12" y1="3" x2="12" y2="21" transform={`rotate(${a} 12 12)`} />
          ))}
        </svg>
      );
    case "copilot":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 4h6.5a3 3 0 0 1 2.8 2l3.2 9.5A3 3 0 0 1 17.7 20H9.5a3 3 0 0 1-2.8-2L3.5 8.5A3 3 0 0 1 6.3 4z" opacity=".85" />
        </svg>
      );
    case "grok":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M5 19L19 5M9 5h10v10" />
        </svg>
      );
    case "mistral":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 4h4v4H3zM17 4h4v4h-4zM3 8h8v4H3zM13 8h8v4h-8zM3 12h18v4H3zM3 16h4v4H3zM11 16h2v4h-2zM17 16h4v4h-4z" />
        </svg>
      );
    case "deepseek":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M21 7c-1 .5-2 .4-2.7-.3C16.4 4.4 13.8 3.3 11 3.6 6.4 4.1 3 8.1 3.3 12.7 3.6 17.1 7.3 20.6 11.8 20.5c3.2-.1 6-1.9 7.4-4.7.3-.6.9-.9 1.5-.7-.4-2-.2-4.2.3-6.1zM9 11a1.3 1.3 0 1 1 0-2.6A1.3 1.3 0 0 1 9 11z" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="12" r="7" />
        </svg>
      );
  }
}

export function EngineIcon({
  id,
  size = "sm",
  className,
  withTooltip = true,
  active = true,
}: {
  id: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  withTooltip?: boolean;
  active?: boolean;
}) {
  const engine = getEngine(id);
  const dim = { xs: "size-4 p-[2px] rounded-[4px]", sm: "size-5 p-[3px] rounded-md", md: "size-7 p-1.5 rounded-lg", lg: "size-9 p-2 rounded-xl" }[size];
  const node = (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center text-white shadow-xs [&>svg]:size-full", dim, !active && "opacity-35 grayscale", className)}
      style={{ background: engine?.color ?? "#666" }}
      aria-label={engine?.name ?? id}
    >
      <Glyph id={id} />
    </span>
  );
  if (!withTooltip) return node;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{node}</TooltipTrigger>
      <TooltipContent>{engine?.name ?? id}</TooltipContent>
    </Tooltip>
  );
}

export function EngineStack({ ids, max = 4, size = "xs" }: { ids: string[]; max?: number; size?: "xs" | "sm" }) {
  const shown = ids.slice(0, max);
  return (
    <span className="inline-flex items-center gap-0.5">
      {shown.map((id) => (
        <EngineIcon key={id} id={id} size={size} />
      ))}
      {ids.length > max && <span className="ml-0.5 text-[10px] text-muted-foreground">+{ids.length - max}</span>}
    </span>
  );
}
