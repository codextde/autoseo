import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ListFilter } from "lucide-react";
import { KpiStrip } from "@/components/app/metrics";
import { PageContainer, PageHeader, Panel } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { requireProject } from "@/server/auth/guards";
import { getAssetDetail, getRunState } from "@/features/optimize/fact-check/queries";
import { AssetEditor } from "@/features/optimize/fact-check/components/asset-editor";
import { MarketChip } from "@/features/optimize/fact-check/components/badges";
import { DocumentsPanel } from "@/features/optimize/fact-check/components/documents-panel";
import { RunCheckButton } from "@/features/optimize/fact-check/components/run-check-button";
import { StatementsTable } from "@/features/optimize/fact-check/components/statements-table";

export const metadata = { title: "Fact Check · Asset" };

export default async function AssetPage({ params }: PageProps<"/p/[projectId]/fact-check/assets/[assetId]">) {
  const { projectId, assetId } = await params;
  const ctx = await requireProject(projectId);
  const canEdit = ctx.permissions.has("prompts.manage");
  const [detail, run] = await Promise.all([getAssetDetail(projectId, assetId), getRunState(projectId)]);
  if (!detail) notFound();
  const { asset, counts } = detail;
  const matchRate = counts.checked ? `${Math.round((counts.matched / counts.checked) * 100)}%` : "—";
  const readyDocs = detail.documents.filter((d) => d.status === "ready").length;
  const base = `/p/${projectId}/fact-check`;

  return (
    <PageContainer>
      <Link href={base} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Fact Check
      </Link>
      <PageHeader
        eyebrow={asset.status === "paused" ? "Paused asset" : "Asset"}
        title={asset.name}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            {asset.activeIngredient && <span className="mr-1">{asset.activeIngredient}</span>}
            {asset.markets.map((m) => (
              <MarketChip key={m.country} country={m.country} regulator={m.regulator} />
            ))}
            {asset.lastCheckedAt && <span className="ml-1 text-xs">· last checked {new Date(asset.lastCheckedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
          </span>
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={`${base}/findings?asset=${asset.id}&status=all`}>
                <ListFilter className="size-3.5" /> Findings
              </Link>
            </Button>
            {canEdit && (
              <RunCheckButton
                projectId={projectId}
                assetId={asset.id}
                initiallyActive={!!run.active}
                disabled={!readyDocs || asset.status !== "active"}
                disabledReason={asset.status !== "active" ? "The asset is paused." : "Add a reference document first."}
                variant="default"
              />
            )}
          </>
        }
      />
      <KpiStrip
        items={[
          { key: "collected", label: "Statements collected", value: counts.collected },
          { key: "checked", label: "Checked", value: counts.checked, sub: counts.pending ? `${counts.pending} waiting` : undefined },
          { key: "match", label: "Matches label", value: matchRate },
          { key: "dev", label: "Deviations", value: detail.deviations, sub: `${counts.needs_review} need review` },
        ]}
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <DocumentsPanel projectId={projectId} assetId={asset.id} documents={detail.documents} markets={asset.markets} canEdit={canEdit} />
        <AssetEditor projectId={projectId} asset={asset} canEdit={canEdit} />
      </div>
      <Panel title="Recent statements" description="What AI engines said about this asset, and how it compares to the label" contentClassName="p-3 sm:p-4">
        <StatementsTable rows={detail.statements} />
      </Panel>
    </PageContainer>
  );
}
