import Link from "next/link";
import { Star } from "lucide-react";
import { site } from "@/lib/site";
import { authLinks, mainNav } from "./content";
import { CtaLink, Container, GitHubIcon, Logo } from "./primitives";
import { MobileNav } from "./mobile-nav";
import { ThemeToggle } from "./theme-toggle";

const navLink =
  "rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl supports-backdrop-filter:bg-background/70">
      <Container className="flex h-16 items-center gap-4">
        <Logo className="focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none" />
        <nav aria-label="Main" className="ml-6 hidden items-center gap-0.5 md:flex">
          {mainNav.map((item) => (
            <Link key={item.href} href={item.href} className={navLink}>
              {item.label}
            </Link>
          ))}
          <a href={site.github} target="_blank" rel="noopener" className={`${navLink} inline-flex items-center gap-1.5`}>
            <GitHubIcon />
            GitHub
            <Star className="size-3.5" aria-hidden="true" />
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <ThemeToggle />
          <Link href={authLinks.login.href} prefetch={false} className={`${navLink} hidden sm:inline-flex`}>
            {authLinks.login.label}
          </Link>
          <CtaLink href={authLinks.signup.href} size="sm" className="px-3.5 sm:px-4">
            {authLinks.signup.label}
          </CtaLink>
          <MobileNav />
        </div>
      </Container>
    </header>
  );
}
