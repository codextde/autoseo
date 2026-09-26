import { cn } from "@/lib/utils";

export function LogoMark({ className, src }: { className?: string; src?: string }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className={cn("size-7 rounded-lg object-contain", className)} />;
  }
  return (
    <svg viewBox="0 0 64 64" fill="none" className={cn("size-7", className)} aria-hidden>
      <rect width="64" height="64" rx="16" className="fill-foreground" />
      <path
        d="M18 44 L29 20 h6 L46 44"
        className="stroke-background"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M24 35 h16" stroke="#22c55e" strokeWidth="5.5" strokeLinecap="round" />
      <circle cx="46" cy="18" r="4" fill="#22c55e" />
    </svg>
  );
}

export function Logo({ name, src, className }: { name: string; src?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <LogoMark src={src} />
      <span className="truncate">{name}</span>
    </span>
  );
}
