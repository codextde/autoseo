import Link from "next/link";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/icon.svg" alt="" width={28} height={28} className={cn("size-7 rounded-[0.45rem] dark:ring-1 dark:ring-white/15", className)} />;
}

export function Brand({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2 rounded-md font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50", className)}>
      <BrandMark />
      <span className="text-[1.05rem]">
        AutoSEO <span className="text-brand">Cloud</span>
      </span>
    </Link>
  );
}
