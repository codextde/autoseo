import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/app/logo";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { getBranding } from "@/server/branding";
import { getPublicFreeToolsConfig } from "@/server/free-tools/public-config";

/** Public chrome for the login-free tools. The whole segment 404s unless Admin → Free SEO tools → Public is on. */
export default async function FreeToolsLayout({ children }: LayoutProps<"/free-tools">) {
  // The admin "Public" switch is evaluated per request (never prerendered at build time).
  await connection();
  const [config, brand] = await Promise.all([getPublicFreeToolsConfig(), getBranding()]);
  if (!config.enabled) notFound();
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/free-tools" className="flex min-w-0 items-center gap-2 font-semibold tracking-tight">
            <LogoMark src={brand.logoUrl || undefined} />
            <span className="truncate">{brand.appName}</span>
            <span className="hidden rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand sm:inline">Free SEO tools</span>
          </Link>
          <div className="flex shrink-0 items-center gap-1.5">
            <ThemeToggle />
            <Button asChild size="sm">
              <Link href={config.cta.href}>
                {config.cta.label}
                <ArrowRight />
              </Link>
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-1 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>
            © {new Date().getFullYear()} {brand.appName} · Free SEO tools
          </span>
          <span>Data: DataForSEO · RDAP registries · Usage limits apply</span>
        </div>
      </footer>
    </div>
  );
}
