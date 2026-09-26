"use client";

import { useState } from "react";
import { getCatalogEntry } from "@/lib/integrations-catalog";
import { cn } from "@/lib/utils";

/** Vendor logo via the favicon proxy with a colored monogram fallback (no bundled third-party assets). */
export function IntegrationLogo({
  provider,
  size = "md",
  className,
}: {
  provider: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const entry = getCatalogEntry(provider);
  const [failed, setFailed] = useState(false);
  const dim = { sm: "size-7 rounded-lg", md: "size-10 rounded-xl", lg: "size-12 rounded-2xl" }[size];
  const img = { sm: "size-4", md: "size-6", lg: "size-7" }[size];
  const letters = (entry?.name ?? provider)
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  if (!entry?.domain || failed) {
    return (
      <span
        className={cn("inline-flex shrink-0 items-center justify-center font-semibold text-white shadow-xs", dim, size === "sm" ? "text-[10px]" : "text-xs", className)}
        style={{ background: entry?.color ?? "#555" }}
        aria-hidden
      >
        {letters}
      </span>
    );
  }
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center border bg-white shadow-xs", dim, className)} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/favicon/${encodeURIComponent(entry.domain)}`}
        alt=""
        loading="lazy"
        className={cn("object-contain", img)}
        onError={() => setFailed(true)}
      />
    </span>
  );
}
