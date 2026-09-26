import Image from "next/image";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { site } from "@/lib/site";

type FrameProps = {
  src: string;
  alt: string;
  /** Path shown in the fake address bar, relative to the demo instance. */
  url?: string;
  sizes?: string;
  /** Hero image only: fetch eagerly with high priority (LCP). */
  priority?: boolean;
  reveal?: boolean;
  className?: string;
};

/** Product screenshot (1600×1000) in a minimal browser window. */
export function BrowserFrame({ src, alt, url = "", sizes, priority, reveal = true, className }: FrameProps) {
  return (
    <figure
      className={cn(
        "overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_oklch(0_0_0/0.04),0_24px_64px_-24px_oklch(0_0_0/0.25)] ring-1 ring-black/[0.03] dark:shadow-[0_24px_64px_-24px_oklch(0_0_0/0.8)] dark:ring-white/5",
        reveal && "mk-reveal",
        className,
      )}
    >
      <div className="flex h-9 items-center gap-3 border-b bg-muted/70 px-3.5 sm:h-10" aria-hidden="true">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
        </div>
        <div className="mx-auto flex h-6 max-w-[60%] min-w-0 items-center gap-1.5 truncate rounded-md bg-background/80 px-3 text-[0.7rem] text-muted-foreground sm:text-xs">
          <Lock className="size-3 shrink-0" />
          <span className="truncate">
            acme.{site.host}
            {url ? `/${url}` : ""}
          </span>
        </div>
        <div className="w-10" />
      </div>
      <Image
        src={src}
        alt={alt}
        width={1600}
        height={1000}
        sizes={sizes ?? "(min-width: 1152px) 680px, (min-width: 1024px) 58vw, 100vw"}
        fetchPriority={priority ? "high" : undefined}
        loading={priority ? "eager" : undefined}
        className="block h-auto w-full"
      />
    </figure>
  );
}

/** Phone screenshot (390×844) in a device outline. */
export function PhoneFrame({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    <figure
      className={cn(
        "overflow-hidden rounded-[2rem] border-[6px] border-[#1c1c1a] bg-[#1c1c1a] shadow-[0_24px_64px_-16px_oklch(0_0_0/0.45)] ring-1 ring-black/10 dark:ring-white/10",
        className,
      )}
    >
      <Image
        src={src}
        alt={alt}
        width={390}
        height={844}
        sizes="200px"
        className="block h-auto w-full rounded-[1.6rem]"
      />
    </figure>
  );
}
