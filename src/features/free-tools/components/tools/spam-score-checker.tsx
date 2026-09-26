"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DataTable, type Column } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { ScoreRing } from "@/components/app/charts";
import type { SpamCheckResult } from "../../lib/types";
import { Field, FIELD_CLASS, ToolForm } from "../form";
import { useToolRun, useToolRunner } from "../runner";
import { DomainTitle, FeatureLink, FollowBadge, formatCount, MetricTiles, Reveal, ScorePill, SectionTitle, UpsellCard, UrlLink } from "../results";

type Row = SpamCheckResult["worstBacklinks"][number];

function spamColor(v: number | null) {
  if (v == null) return "var(--muted-foreground)";
  return v >= 60 ? "var(--destructive)" : v >= 30 ? "var(--warning)" : "var(--success)";
}

function spamVerdict(v: number | null) {
  if (v == null) return "No score published";
  return v >= 60 ? "High — review these links" : v >= 30 ? "Moderate — worth a look" : "Low — looks healthy";
}

const columns: Column<Row>[] = [
  {
    id: "domain",
    header: "Referring domain",
    cell: (r) => (
      <div className="min-w-0 max-w-[420px]">
        <div className="truncate text-sm font-medium">{r.domainFrom ?? "—"}</div>
        <UrlLink url={r.urlFrom} className="text-xs text-muted-foreground" />
      </div>
    ),
  },
  { id: "anchor", header: "Anchor", cell: (r) => <span className="line-clamp-2 max-w-[240px] text-sm">{r.anchor ?? <span className="text-muted-foreground italic">No anchor</span>}</span>, hideBelow: "md" },
  { id: "follow", header: "Type", cell: (r) => <FollowBadge dofollow={r.dofollow} />, align: "center" },
  { id: "rank", header: "Domain rank", cell: (r) => <ScorePill value={r.domainRank} />, sortValue: (r) => r.domainRank, align: "right", hideBelow: "sm" },
  { id: "spam", header: "Spam score", cell: (r) => <ScorePill value={r.spamScore} invert />, sortValue: (r) => r.spamScore, align: "right" },
];

function Gauge({ label, value, help }: { label: string; value: number | null; help: string }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border bg-card p-4 shadow-soft">
      <ScoreRing value={value ?? 0} size={92} stroke={9} color={spamColor(value)} label={value == null ? "n/a" : "/ 100"} />
      <div className="min-w-0">
        <div className="text-sm font-semibold">{label}</div>
        <div className="text-xs font-medium" style={{ color: spamColor(value) }}>
          {spamVerdict(value)}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{help}</p>
      </div>
    </div>
  );
}

export function SpamScoreCheckerTool({ initial }: { initial?: { target?: string } }) {
  const runner = useToolRunner();
  const [target, setTarget] = useState(initial?.target ?? "");
  const { status, errorMessage, result, submit, tool } = useToolRun<SpamCheckResult>("spam-score-checker");

  return (
    <div className="space-y-5">
      <ToolForm
        slug="spam-score-checker"
        status={status}
        errorMessage={errorMessage}
        submitLabel="Check spam score"
        costHint="2 DataForSEO calls (~$0.05) · cached 24 h"
        onSubmit={(token) => submit({ target }, token)}
      >
        <Field id="spam-target" label="Domain">
          <Input
            id="spam-target"
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
            <DomainTitle domain={result.target} sub="Backlink spam signals · DataForSEO index" />
            <FeatureLink tool={tool} query={{ target: result.target, spam: "1" }} />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Gauge label="Backlink spam score" value={result.spamScore} help="How spammy the links pointing at this domain look, on average." />
            <Gauge label="Domain spam score" value={result.targetSpamScore} help="How spammy the domain itself looks. It often disagrees with the backlink score." />
          </div>
          <MetricTiles
            className="sm:grid-cols-3"
            items={[
              { label: "Domain rank", value: result.rank ?? "—", hint: "A 0–100 score of the domain's link-profile strength." },
              { label: "Backlinks", value: formatCount(result.backlinks) },
              { label: "Referring domains", value: formatCount(result.referringDomains) },
            ]}
          />
          <section className="space-y-2">
            <SectionTitle sub="The 10 highest-spam referring domains, one link each. A high score is a reason to look — not proof of a penalty.">
              Spammiest referring domains
            </SectionTitle>
            <DataTable
              columns={columns}
              data={result.worstBacklinks}
              getRowId={(r) => `${r.urlFrom}|${r.domainFrom}`}
              paginate={false}
              dense
              empty={<EmptyState compact icon={ShieldAlert} title="No backlinks found" description="DataForSEO has no live backlinks on record for this domain." />}
              mobileCard={(r) => (
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{r.domainFrom}</div>
                      <UrlLink url={r.urlFrom} className="text-xs text-muted-foreground" />
                    </div>
                    <ScorePill value={r.spamScore} invert />
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <FollowBadge dofollow={r.dofollow} />
                    <span className="truncate">{r.anchor ?? "No anchor"}</span>
                  </div>
                </div>
              )}
            />
          </section>
          <UpsellCard tool={tool} query={{ target: result.target, spam: "1" }} />
        </Reveal>
      )}
    </div>
  );
}
