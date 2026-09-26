"use client";

import { ShoppingBag, Sparkles, Star } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCurrency } from "@/components/app/metrics";
import { cn } from "@/lib/utils";

const TILE_COLORS = ["#f97316", "#3b82f6", "#a855f7", "#14b8a6", "#ef4444", "#eab308", "#ec4899", "#64748b"];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Product/ad image with a neutral generated tile when no (https) image is available. */
export function ThumbTile({ src, name, className }: { src?: string | null; name: string; className?: string }) {
  if (src)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" loading="lazy" className={cn("size-10 shrink-0 rounded-lg border bg-white object-contain", className)} />
    );
  const color = TILE_COLORS[hash(name) % TILE_COLORS.length]!;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span
      className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg text-xs font-semibold", className)}
      style={{ background: `color-mix(in oklch, ${color} 16%, var(--card))`, color }}
      aria-hidden
    >
      {initials || <ShoppingBag className="size-4" />}
    </span>
  );
}

export function Price({ price, oldPrice, currency }: { price: number | null; oldPrice?: number | null; currency?: string | null }) {
  if (price == null) return <span className="text-muted-foreground">—</span>;
  const cur = currency && /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="font-medium tabular">{formatCurrency(price, cur, price % 1 ? 2 : 0)}</span>
      {oldPrice != null && oldPrice > price && <span className="text-xs text-muted-foreground line-through tabular">{formatCurrency(oldPrice, cur, oldPrice % 1 ? 2 : 0)}</span>}
    </span>
  );
}

export function Rating({ rating, reviews }: { rating: number | null; reviews?: number | null }) {
  if (rating == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1 tabular">
      <Star className="size-3.5 fill-warning text-warning" />
      <span className="font-medium">{rating.toFixed(1)}</span>
      {reviews != null && reviews > 0 && <span className="text-xs text-muted-foreground">({reviews.toLocaleString()})</span>}
    </span>
  );
}

export function SourceIcons({ sources }: { sources: ("llm" | "shopping")[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      {sources.includes("shopping") && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex size-6 items-center justify-center rounded-md bg-info/10 text-info">
              <ShoppingBag className="size-3.5" />
            </span>
          </TooltipTrigger>
          <TooltipContent>Shopping card (rendered product listing)</TooltipContent>
        </Tooltip>
      )}
      {sources.includes("llm") && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex size-6 items-center justify-center rounded-md bg-brand-soft text-brand">
              <Sparkles className="size-3.5" />
            </span>
          </TooltipTrigger>
          <TooltipContent>Named in the answer text (LLM mention)</TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}
