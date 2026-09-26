import Link from "next/link";
import { cn } from "@/lib/utils";

/** Standard page wrapper: consistent padding, max width and vertical rhythm. */
export function PageContainer({
  children,
  className,
  wide,
}: {
  children: React.ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <div className={cn("mx-auto w-full space-y-4 px-3 py-4 sm:space-y-5 sm:px-5 sm:py-6", wide ? "max-w-[1800px]" : "max-w-[1440px]", className)}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0 space-y-1">
        {eyebrow && <div className="text-xs font-medium tracking-wide text-brand uppercase">{eyebrow}</div>}
        <h1 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">{title}</h1>
        {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Card-like panel with optional header row. */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
  icon,
  footer,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  icon?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className={cn("min-w-0 rounded-2xl border bg-card text-card-foreground shadow-soft", className)}>
      {(title || actions) && (
        <header className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="min-w-0">
            {title && (
              <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
                {icon}
                {title}
              </h2>
            )}
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn("p-4 sm:p-5", contentClassName)}>{children}</div>
      {footer && <footer className="border-t px-4 py-3 sm:px-5">{footer}</footer>}
    </section>
  );
}

/** Horizontally scrollable, URL-driven tab bar (like finseo sub-navigation). */
export function TabNav({
  tabs,
  active,
  className,
  right,
}: {
  tabs: { key: string; label: React.ReactNode; href: string; badge?: React.ReactNode }[];
  active: string;
  className?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-center gap-3 border-b", className)}>
      <nav className="scrollbar-none -mb-px flex min-w-0 flex-1 gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            scroll={false}
            className={cn(
              "relative shrink-0 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors",
              t.key === active
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.badge}
          </Link>
        ))}
      </nav>
      {right && <div className="hidden shrink-0 items-center gap-2 pb-1 sm:flex">{right}</div>}
    </div>
  );
}
