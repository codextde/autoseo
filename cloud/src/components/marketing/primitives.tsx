import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { site } from "@/lib/site";

/** AutoSEO logo mark (same artwork as /icon.svg). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className={cn("size-7", className)}>
      <rect width="64" height="64" rx="16" fill="#141413" />
      <path d="M18 44 L29 20 h6 L46 44" stroke="#fff" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24 35 h16" stroke="#22c55e" strokeWidth="5.5" strokeLinecap="round" />
      <circle cx="46" cy="18" r="4" fill="#22c55e" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("inline-flex items-center gap-2 rounded-md font-semibold tracking-tight", className)}>
      <LogoMark className="ring-1 ring-transparent dark:ring-white/15 rounded-[0.45rem]" />
      <span className="text-[1.05rem]">{site.name}</span>
    </Link>
  );
}

export function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={cn("size-4", className)}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function Container({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8", className)} {...props} />;
}

/** Accent text color with AA contrast on the warm background in both themes. */
export const accentText = "text-green-700 dark:text-green-400";

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-sm font-semibold tracking-wide uppercase", accentText, className)}>{children}</p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = "center",
  as: Heading = "h2",
  id,
  className,
}: {
  id?: string;
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  align?: "center" | "left";
  as?: "h1" | "h2";
  className?: string;
}) {
  return (
    <div className={cn("max-w-3xl", align === "center" && "mx-auto text-center", className)}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <Heading
        id={id}
        className={cn(
          "text-3xl font-semibold tracking-tight text-balance sm:text-4xl lg:text-[2.75rem] lg:leading-[1.1]",
          eyebrow && "mt-3",
        )}
      >
        {title}
      </Heading>
      {subtitle && <p className="mt-4 text-lg text-pretty text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

export function CheckList({ items, className }: { items: readonly string[]; className?: string }) {
  return (
    <ul className={cn("space-y-3", className)}>
      {items.map((item) => (
        <li key={item} className="flex gap-3 text-[0.95rem] leading-6">
          <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-brand-soft text-green-700 dark:text-green-300">
            <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

const ctaBase =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap transition-[background-color,color,box-shadow,transform] outline-none focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px [&_svg]:shrink-0";

const ctaVariants = {
  primary: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/85",
  secondary: "border border-border bg-card text-foreground shadow-xs hover:bg-muted dark:border-input",
  ghost: "text-foreground hover:bg-muted",
  inverted: "bg-white text-[#141413] hover:bg-white/85",
  "inverted-outline": "border border-white/20 text-white hover:bg-white/10",
};

const ctaSizes = {
  sm: "h-9 px-4 text-sm",
  md: "h-10 px-5 text-sm",
  lg: "h-12 px-6 text-[0.95rem]",
};

type CtaProps = {
  href: string;
  children: ReactNode;
  variant?: keyof typeof ctaVariants;
  size?: keyof typeof ctaSizes;
  arrow?: boolean;
  className?: string;
};

/** Pages that are rendered on request (auth + app); never prefetch them from the static marketing pages. */
const noPrefetch = ["/signup", "/login", "/dashboard"];

export function CtaLink({ href, children, variant = "primary", size = "md", arrow, className }: CtaProps) {
  const classes = cn(ctaBase, ctaVariants[variant], ctaSizes[size], "group", className);
  const content = (
    <>
      {children}
      {arrow && (
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      )}
    </>
  );
  if (/^https?:\/\//.test(href)) {
    return (
      <a href={href} className={classes} target="_blank" rel="noopener">
        {content}
      </a>
    );
  }
  return (
    <Link href={href} className={classes} prefetch={noPrefetch.includes(href) ? false : undefined}>
      {content}
    </Link>
  );
}

/** Link that opens external URLs in a new tab and uses next/link for internal paths. */
export function SmartLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  if (/^https?:\/\//.test(href)) {
    return (
      <a href={href} className={className} target="_blank" rel="noopener">
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className} prefetch={noPrefetch.includes(href) ? false : undefined}>
      {children}
    </Link>
  );
}
