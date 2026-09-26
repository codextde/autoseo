import Link from "next/link";
import { Bot, FileText, ListFilter, Radar, ShieldCheck, Target } from "lucide-react";
import { PageContainer, PageHeader, Panel } from "@/components/app/page";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { requireProject } from "@/server/auth/guards";
import { getOverview } from "@/features/optimize/fact-check/queries";
import { FactCheckTabs } from "@/features/optimize/fact-check/components/fc-tabs";
import { LabelAlignment } from "@/features/optimize/fact-check/components/label-alignment";
import { AssetsTable } from "@/features/optimize/fact-check/components/assets-table";
import { NewAssetDialog } from "@/features/optimize/fact-check/components/new-asset-dialog";
import { RunCheckButton } from "@/features/optimize/fact-check/components/run-check-button";

export const metadata = { title: "Fact Check" };

function formatDate(iso: string | null) {
  if (!iso) return "never";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function FactCheckPage({ params }: PageProps<"/p/[projectId]/fact-check">) {
  const { projectId } = await params;
  const ctx = await requireProject(projectId);
  const canEdit = ctx.permissions.has("prompts.manage");
  const data = await getOverview(projectId);
  const hasAssets = data.assets.length > 0;
  const hasDocs = data.assets.some((a) => a.docsReady > 0);
  const base = `/p/${projectId}/fact-check`;

  return (
    <PageContainer>
      <PageHeader
        title="Fact Check"
        description={`Label Alignment · all markets · all test setups · last checked ${formatDate(data.lastCheckedAt)}`}
        actions={
          canEdit ? (
            <>
              <RunCheckButton
                projectId={projectId}
                initiallyActive={!!data.run.active}
                disabled={!hasDocs}
                disabledReason="Add an asset with at least one reference document first."
              />
              <NewAssetDialog projectId={projectId} defaultCountry={ctx.project.country} />
            </>
          ) : null
        }
      />
      <FactCheckTabs projectId={projectId} active="overview" />

      {!data.aiReady && hasAssets && (
        <div className="flex items-start gap-3 rounded-xl border bg-card px-4 py-3 text-sm">
          <Bot className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">Word-for-word mode.</span> Statements are matched lexically against the label; semantic
            verdicts (off-label, unsupported) need an AI provider. Connect a local agent or an API key in{" "}
            <span className="font-medium text-foreground">Admin → AI Providers / Local Agents</span>.
          </p>
        </div>
      )}

      <LabelAlignment projectId={projectId} totals={data.totals} />

      <Panel
        title="Assets"
        description="Answers checked against your reference documents"
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={`${base}/findings`}>
                <ListFilter className="size-3.5" /> Findings
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`${base}/accuracy`}>
                <Target className="size-3.5" /> Accuracy
              </Link>
            </Button>
            {canEdit && hasAssets && (
              <NewAssetDialog
                projectId={projectId}
                defaultCountry={ctx.project.country}
                trigger={
                  <Button variant="outline" size="sm">
                    New Asset
                  </Button>
                }
              />
            )}
          </>
        }
        contentClassName={hasAssets ? "p-3 sm:p-4" : undefined}
      >
        {hasAssets ? (
          <AssetsTable projectId={projectId} rows={data.assets} />
        ) : (
          <div className="py-4">
            <EmptyState
              icon={ShieldCheck}
              title="Check what AI says about your products"
              description="Create an asset, upload its label (SmPC, spec sheet, T&Cs…) and we compare every statement AI engines make about it with the reference text."
              action={canEdit ? <NewAssetDialog projectId={projectId} defaultCountry={ctx.project.country} /> : undefined}
            />
            <ol className="mx-auto grid max-w-3xl gap-2 sm:grid-cols-3">
              {[
                { icon: ShieldCheck, title: "1 · Create an asset", text: "Name, spelling variants and the markets (DE · EMA, US · FDA) to check." },
                { icon: FileText, title: "2 · Upload the label", text: "PDF, pasted text or a URL — split into label sections automatically." },
                { icon: Radar, title: "3 · Track prompts", text: "Tracked prompts whose answers mention the asset are checked after every run." },
              ].map((s) => (
                <li key={s.title} className="rounded-xl border bg-muted/30 p-3">
                  <s.icon className="size-4 text-muted-foreground" />
                  <div className="mt-2 text-sm font-medium">{s.title}</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        )}
      </Panel>

      {hasAssets && data.answersTracked === 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-dashed px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground">
            No tracked AI answers yet. Add prompts in the Tracker that make AI engines talk about your assets — statements are collected after each run.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href={`/p/${projectId}/ai/tracker`}>Open Tracker</Link>
          </Button>
        </div>
      )}
    </PageContainer>
  );
}
