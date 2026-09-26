"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { DataTable, type Column } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { Favicon } from "@/components/app/favicon";
import type { DomainAgeResult, DomainAgeRow } from "../../lib/types";
import { Field, ToolForm } from "../form";
import { useToolRun, useToolRunner } from "../runner";
import { Reveal, SectionTitle, UpsellCard } from "../results";

const MAX_DOMAINS = 10;

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function formatAge(row: DomainAgeRow): string {
  if (row.ageYears === null || row.ageMonths === null) return "—";
  const years = row.ageYears === 1 ? "1 year" : `${row.ageYears} years`;
  const months = row.ageMonths === 1 ? "1 month" : `${row.ageMonths} months`;
  return row.ageYears === 0 ? months : `${years}, ${months}`;
}

function DomainCell({ domain }: { domain: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2 font-medium">
      <Favicon domain={domain} />
      <span className="truncate">{domain}</span>
    </span>
  );
}

const dash = (row: DomainAgeRow, text: string) => (row.error ? <span className="text-muted-foreground">—</span> : text);

const columns: Column<DomainAgeRow>[] = [
  { id: "domain", header: "Domain", cell: (r) => <DomainCell domain={r.domain} />, sortValue: (r) => r.domain },
  {
    id: "age",
    header: "Age",
    cell: (r) => (r.error ? <span className="text-xs text-muted-foreground">{r.error}</span> : <span className="font-semibold">{formatAge(r)}</span>),
    sortValue: (r) => (r.ageYears == null ? null : r.ageYears * 12 + (r.ageMonths ?? 0)),
  },
  { id: "created", header: "Registered", cell: (r) => dash(r, formatDate(r.created)), sortValue: (r) => r.created, hideBelow: "sm" },
  { id: "updated", header: "Updated", cell: (r) => dash(r, formatDate(r.updated)), hideBelow: "lg" },
  { id: "expires", header: "Expires", cell: (r) => dash(r, formatDate(r.expires)), sortValue: (r) => r.expires, hideBelow: "md" },
  { id: "registrar", header: "Registrar", cell: (r) => <span className="block max-w-[220px] truncate">{r.error ? "—" : (r.registrar ?? "—")}</span>, hideBelow: "md" },
];

export function DomainAgeCheckerTool({ initial }: { initial?: { domains?: string } }) {
  const runner = useToolRunner();
  const [domains, setDomains] = useState(initial?.domains ?? "");
  const { status, errorMessage, result, submit, tool } = useToolRun<DomainAgeResult>("domain-age-checker");
  const entered = domains
    .split(/[\n,]/)
    .map((l) => l.trim())
    .filter(Boolean);
  const overLimit = entered.length > MAX_DOMAINS;

  return (
    <div className="space-y-5">
      <ToolForm
        slug="domain-age-checker"
        status={status}
        errorMessage={errorMessage}
        submitLabel="Check domain age"
        onSubmit={(token) => submit({ domains: entered.slice(0, MAX_DOMAINS) }, token)}
      >
        <Field id="age-domains" label="Domains" hint={`One domain per line, up to ${MAX_DOMAINS}.`}>
          <Textarea
            id="age-domains"
            rows={5}
            required
            spellCheck={false}
            value={domains}
            onChange={(e) => setDomains(e.target.value)}
            placeholder={`${runner.projectDomain || "example.com"}\ncompetitor.com`}
            disabled={status === "loading"}
            className="min-h-28 bg-background text-base sm:text-sm"
          />
        </Field>
        {overLimit && (
          <p className="text-xs text-foreground">
            You pasted {entered.length} domains. Only the first {MAX_DOMAINS} domains are checked.
          </p>
        )}
      </ToolForm>

      {status === "done" && result && (
        <Reveal className="space-y-4">
          <section className="space-y-2">
            <SectionTitle sub="Registration data straight from the registry (RDAP).">Domain age</SectionTitle>
            <DataTable
              columns={columns}
              data={result.rows}
              getRowId={(r) => r.domain}
              paginate={false}
              empty={<EmptyState compact icon={CalendarClock} title="No domains checked" />}
              mobileCard={(r) => (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <DomainCell domain={r.domain} />
                    {!r.error && <span className="shrink-0 text-sm font-semibold">{formatAge(r)}</span>}
                  </div>
                  {r.error ? (
                    <p className="text-xs text-muted-foreground">{r.error}</p>
                  ) : (
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <dt className="text-muted-foreground">Registered</dt>
                      <dd className="text-right">{formatDate(r.created)}</dd>
                      <dt className="text-muted-foreground">Expires</dt>
                      <dd className="text-right">{formatDate(r.expires)}</dd>
                      <dt className="text-muted-foreground">Registrar</dt>
                      <dd className="truncate text-right">{r.registrar ?? "—"}</dd>
                    </dl>
                  )}
                </div>
              )}
            />
          </section>
          <UpsellCard tool={tool} query={result.rows[0] ? { domain: result.rows[0].domain } : undefined} />
        </Reveal>
      )}
    </div>
  );
}
