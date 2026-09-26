"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function cleanDomain(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]!
    .toLowerCase();
}

/** Site favicon, proxied through our server (`/api/favicon/<domain>`) to avoid leaking visitors to third parties. */
export function Favicon({
  domain,
  src,
  className,
  fallback,
}: {
  domain?: string | null;
  src?: string | null;
  className?: string;
  fallback?: string;
}) {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const d = cleanDomain(domain);
  const url = src || (d ? `/api/favicon/${encodeURIComponent(d)}` : "");
  const letter = (fallback ?? d ?? "?").charAt(0).toUpperCase();
  // An image that failed before hydration never fires onError — check once mounted.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, [url]);
  if (!url || failed) {
    return (
      <span
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-muted text-[9px] font-semibold text-muted-foreground",
          className,
        )}
      >
        {letter}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      src={url}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("size-4 shrink-0 rounded-[4px] object-contain", className)}
    />
  );
}
