"use client";

import { useState } from "react";
import { Link2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DataTable, type Column } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import type { BacklinkCheckResult } from "../../lib/types";
import { Field, FIELD_CLASS, ToolForm } from "../form";
import { useToolRun, useToolRunner } from "../runner";
import { DomainTitle, FeatureLink, FollowBadge, formatCount, MetricTiles, Reveal, ScorePill, SectionTitle, UpsellCard, UrlLink } from "../results";

type Row = BacklinkCheckResult["topBacklinks"][number];

const columns: Column<Row>[] = [
  {
    id: "source",
    header: "Referring page",
    cell: (r) => (
      <div className="min-w-0 max-w-[420px]">
        <div className="truncate text-sm font-medium">{r.pageTitle ?? r.domainFrom ?? "—"}</div>
        <UrlLink url={r.urlFrom} className="text-xs text-muted-foreground" />
      </div>
    ),
  },
  {
    id: "anchor",
    header: "Anchor",
    cell: (r) => <span className="line-clamp-2 max-w-[240px] text-sm">{r.anchor ?? <span className="text-muted-foreground italic">No anchor</span>}</span>,
    hideBelow: "md",
  },
  { id: "target", header: "Links to", cell: (r) => <UrlLink url={r.urlTo} className="max-w-[220px] text-xs" />, hideBelow: "lg" },
  { id: "follow", header: "Type", cell: (r) => <FollowBadge dofollow={r.dofollow} />, align: "center" },
  {
    id: "rank",
    header: "Domain rank",
    cell: (r) => <ScorePill value={r.domainRank} />,
    sortValue: (r) => r.domainRank,
    align: "right",
    hint: "0–100 strength of the linking domain's own link profile.",
  },
];

export function BacklinkCheckerTool({ initial }: { initial?: { target?: string } }) {
  const runner = useToolRunner();
  const [target, setTarget] = useState(initial?.target ?? "");
  const { status, errorMessage, result, submit, tool } = useToolRun<BacklinkCheckResult>("backlink-checker");

  return (
    <div className="space-y-5">
      <ToolForm
        slug="backlink-checker"
        status={status}
        errorMessage={errorMessage}
        submitLabel="Check backlinks"
        costHint="2 DataForSEO calls (~$0.05) · cached 24 h"
        onSubmit={(token) => submit({ target }, token)}
      >
        <Field id="bl-target" label="Domain">
          <Input
            id="bl-target"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            required
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={runner.projectDomain || "example.com"}
            disabled={status === "loading"}
            className={FIELD_CLASS}
          />
        </Field>
      </ToolForm>

      {status === "done" && result && (
        <Reveal className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <DomainTitle domain={result.target} sub="Live link profile · subdomains included" />
            <FeatureLink tool={tool} query={{ target: result.target }} />
          </div>
          <MetricTiles
            items={[
              { label: "Domain rank", value: result.summary.rank ?? "—", hint: "A 0–100 score of the domain's link-profile strength. Higher means more and stronger links.", accent: true },
              { label: "Backlinks", value: formatCount(result.summary.backlinks), hint: "Live links pointing at the domain (subdomains included, internal links excluded)." },
              { label: "Referring domains", value: formatCount(result.summary.referringDomains), hint: "Unique domains with at least one live link to this domain." },
              { label: "Broken backlinks", value: formatCount(result.summary.brokenBacklinks), hint: "Links pointing at pages on this domain that return an error." },
            ]}
          />
          <section className="space-y-2">
            <SectionTitle sub="The strongest links, one per referring domain.">Top backlinks</SectionTitle>
            <DataTable
              columns={columns}
              data={result.topBacklinks}
              getRowId={(r) => `${r.urlFrom}|${r.urlTo}`}
              paginate={false}
              dense
              empty={<EmptyState compact icon={Link2} title="No backlinks found" description="DataForSEO has no live backlinks on record for this domain." />}
              mobileCard={(r) => (
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{r.pageTitle ?? r.domainFrom}</div>
                      <UrlLink url={r.urlFrom} className="text-xs text-muted-foreground" />
                    </div>
                    <ScorePill value={r.domainRank} />
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <FollowBadge dofollow={r.dofollow} />
                    <span className="truncate">{r.anchor ?? "No anchor"}</span>
                  </div>
                </div>
              )}
            />
          </section>
          <UpsellCard tool={tool} query={{ target: result.target }} />
        </Reveal>
      )}
    </div>
  );
}
