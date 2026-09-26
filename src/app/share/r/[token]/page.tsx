import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBranding } from "@/server/branding";
import { countShareView, reportDeck } from "@/server/reports/service";
import { loadReportData } from "@/server/reports/data";
import { getShareAccess } from "@/server/reports/share-access";
import type { DataBundle } from "@/features/reports/lib/bundle";
import { resolveDeckData } from "@/features/reports/lib/catalog";
import { DeckViewer } from "@/features/reports/components/deck-viewer";
import { PasswordGate } from "@/features/reports/components/standalone";

export async function generateMetadata({ params }: PageProps<"/share/r/[token]">): Promise<Metadata> {
  const { token } = await params;
  const access = await getShareAccess(token).catch(() => ({ state: "missing" as const }));
  const title = access.state === "ok" ? access.found.r.title : access.state === "locked" ? access.title : "Shared report";
  const description = access.state === "ok" ? (access.found.r.summary ?? access.found.r.subtitle ?? undefined)?.slice(0, 200) : undefined;
  return {
    title,
    description,
    robots: { index: false, follow: false, nocache: true },
    openGraph: { type: "article", title, description },
  };
}

export default async function SharedReportPage({ params, searchParams }: PageProps<"/share/r/[token]">) {
  const { token } = await params;
  const sp = await searchParams;
  const branding = await getBranding();
  const access = await getShareAccess(token);
  if (access.state === "missing") notFound();
  if (access.state === "locked") return <PasswordGate token={token} title={access.title} appName={branding.appName} />;
  const { r, projectDomain } = access.found;
  await countShareView(r.id);
  const poweredBy = `Shared with ${branding.appName}${projectDomain ? ` · ${projectDomain}` : ""}`;

  if (r.kind === "html") {
    return (
      <div className="flex h-dvh flex-col bg-background">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2.5">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">{r.title}</h1>
            <p className="truncate text-xs text-muted-foreground">
              {poweredBy} · updated {r.updatedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </p>
          </div>
          <a href={`/share/r/${token}/raw?print=1`} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-muted">
            Download PDF
          </a>
        </header>
        {r.html ? (
          <iframe title={r.title} src={`/share/r/${token}/raw`} sandbox="allow-popups allow-popups-to-escape-sandbox" className="min-h-0 w-full flex-1 border-0 bg-white" referrerPolicy="no-referrer" />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">This report is still being written. Check back in a few minutes.</div>
        )}
      </div>
    );
  }

  const deck = reportDeck(r);
  if (!deck) notFound();
  const snapshot = r.shareMode === "snapshot" ? (r.snapshot as { bundle?: DataBundle; capturedAt?: string } | null) : null;
  const bundle = snapshot?.bundle ?? (await loadReportData(r.projectId, r.dateRange).catch(() => null));
  // Resolve server-side: the browser only receives the values the slides reference.
  const resolved = resolveDeckData(deck, { bundle, report: { title: r.title, subtitle: r.subtitle } });
  return (
    <DeckViewer
      mode="share"
      deck={deck}
      bundle={null}
      resolved={resolved}
      title={r.title}
      subtitle={r.subtitle}
      assetBase={`/share/r/${token}/asset`}
      printHref={`/share/r/${token}/print?auto=1`}
      presentOnOpen={sp.present === "1"}
      poweredBy={poweredBy}
      snapshotAt={snapshot?.capturedAt ?? null}
    />
  );
}
