import { site } from "@/lib/site";
import { footer } from "./content";
import { Container, GitHubIcon, Logo, SmartLink } from "./primitives";

const linkClass =
  "rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none";

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t bg-card/50">
      <Container className="py-14 sm:py-16">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div className="max-w-sm">
            <Logo className="focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none" />
            <p className="mt-4 text-sm leading-6 text-muted-foreground">{footer.tagline}</p>
            <a
              href={site.github}
              target="_blank"
              rel="noopener"
              className="mt-5 inline-flex h-9 items-center gap-2 rounded-full border bg-card px-4 text-sm font-medium transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none"
            >
              <GitHubIcon />
              Star on GitHub
            </a>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:col-span-3">
            {footer.columns.map((col) => (
              <nav key={col.title} aria-label={col.title}>
                <h2 className="text-sm font-semibold">{col.title}</h2>
                <ul className="mt-4 space-y-3">
                  {col.links.map((link) => (
                    <li key={link.href}>
                      <SmartLink href={link.href} className={linkClass}>
                        {link.label}
                      </SmartLink>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>
        <div className="mt-12 flex flex-col gap-3 border-t pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year}{" "}
            <a href={site.legal.website} target="_blank" rel="noopener" className="hover:text-foreground">
              {site.company}
            </a>
            . {site.name} is open source under the MIT license.
          </p>
          <p>{footer.madeBy}</p>
        </div>
      </Container>
    </footer>
  );
}
