import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { reportDeck } from "@/server/reports/service";
import { loadReportData } from "@/server/reports/data";
import { getShareAccess } from "@/server/reports/share-access";
import type { DataBundle } from "@/features/reports/lib/bundle";
import { resolveDeckData } from "@/features/reports/lib/catalog";
import { PrintPage } from "@/features/reports/components/standalone";

export const metadata: Metadata = { title: "Print report", robots: { index: false, follow: false } };

export default async function SharedPrintPage({ params, searchParams }: PageProps<"/share/r/[token]/print">) {
  const { token } = await params;
  const sp = await searchParams;
  const access = await getShareAccess(token);
  if (access.state === "missing") notFound();
  if (access.state === "locked") redirect(`/share/r/${token}`);
  const { r } = access.found;
  if (r.kind === "html") redirect(`/share/r/${token}/raw?print=1`);
  const deck = reportDeck(r);
  if (!deck) notFound();
  const snapshot = r.shareMode === "snapshot" ? (r.snapshot as { bundle?: DataBundle } | null) : null;
  const bundle = snapshot?.bundle ?? (await loadReportData(r.projectId, r.dateRange).catch(() => null));
  const resolved = resolveDeckData(deck, { bundle, report: { title: r.title, subtitle: r.subtitle } });
  return <PrintPage deck={deck} bundle={null} resolved={resolved} title={r.title} subtitle={r.subtitle} assetBase={`/share/r/${token}/asset`} backHref={`/share/r/${token}`} autoPrint={sp.auto === "1"} />;
}
