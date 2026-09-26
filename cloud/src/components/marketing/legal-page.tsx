import type { ReactNode } from "react";
import { site } from "@/lib/site";
import { PageHero } from "./page-hero";
import { Container } from "./primitives";
import { Prose } from "./prose";

export function LegalPage({
  crumb,
  title,
  subtitle,
  children,
}: {
  crumb: string;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <PageHero crumb={crumb} title={title} subtitle={subtitle} />
      <Container className="max-w-3xl py-14 sm:py-20">
        <Prose>{children}</Prose>
        <p className="mt-16 border-t pt-6 text-sm text-muted-foreground">
          Last updated: <time dateTime={site.legalUpdated}>{site.legalUpdated}</time>
        </p>
      </Container>
    </>
  );
}
