"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Ban, ExternalLink, Link2, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton } from "@/components/app/misc";
import type { AttributionDetail } from "@/server/attribution/service";
import { getResponseDetailAction, setResponseStatusAction } from "../actions";
import { ChannelBadge, money, providerName, SourceIcon } from "./shared";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-start gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

const MATCH_LABEL: Record<string, string> = {
  transaction: "Order / transaction id",
  email: "Email (hashed)",
  visitor: "Same browser (snippet visitor)",
};

function MetaList({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!entries.length) return <p className="text-sm text-muted-foreground">No metadata.</p>;
  return (
    <dl className="divide-y rounded-xl border bg-muted/20 px-3">
      {entries.map(([k, v]) => (
        <Row key={k} label={k}>
          <span className="font-mono text-xs">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
        </Row>
      ))}
    </dl>
  );
}

export function ResponseDrawer({
  projectId,
  id,
  canManage,
  onClose,
}: {
  projectId: string;
  id: string | null;
  canManage: boolean;
  onClose: () => void;
}) {
  const [state, setState] = useState<{ id: string; detail: AttributionDetail | null; error: string | null } | null>(null);
  const [busy, start] = useTransition();
  const current = id && state?.id === id ? state : null;
  const detail = current?.detail ?? null;
  const error = current?.error ?? null;
  const loading = !!id && !current;
  const setDetail = (d: AttributionDetail) => id && setState({ id, detail: d, error: null });

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getResponseDetailAction(projectId, id).then((r) => {
      if (cancelled) return;
      setState(r.ok ? { id, detail: r.data, error: null } : { id, detail: null, error: r.error });
    });
    return () => {
      cancelled = true;
    };
  }, [id, projectId]);

  const toggle = () => {
    if (!detail) return;
    const next = detail.status === "dismissed" ? "active" : "dismissed";
    start(async () => {
      const r = await setResponseStatusAction(projectId, detail.id, next);
      if (!r.ok) toast.error(r.error);
      else {
        setDetail({ ...detail, status: next });
        toast.success(next === "dismissed" ? "Response excluded from analytics" : "Response restored");
      }
    });
  };

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader className="border-b p-5">
          <SheetTitle>Response</SheetTitle>
          <SheetDescription>Full answer, merged conversion and metadata.</SheetDescription>
        </SheetHeader>
        {loading || (!detail && !error) ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : error ? (
          <p className="p-5 text-sm text-destructive">{error}</p>
        ) : detail ? (
          <div className="space-y-6 p-5">
            <div className="flex items-start gap-3">
              <SourceIcon provider={detail.provider} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{providerName(detail.provider)}</div>
                <div className="text-sm text-muted-foreground">{detail.formName ?? "—"}</div>
              </div>
              {detail.status === "dismissed" && <Badge variant="outline">Dismissed</Badge>}
            </div>

            <section className="space-y-2">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Answer</h3>
              <div className="rounded-xl border bg-muted/20 p-3">
                <ChannelBadge channel={detail.channel} detail={detail.channelDetail} />
                {detail.rawAnswer && <p className="mt-2 text-sm">“{detail.rawAnswer}”</p>}
                {detail.freetext && detail.freetext !== detail.rawAnswer && <p className="mt-1 text-sm text-muted-foreground">Free text: “{detail.freetext}”</p>}
                {typeof detail.metadata.question === "string" && <p className="mt-2 text-xs text-muted-foreground">Question: {detail.metadata.question}</p>}
              </div>
            </section>

            <section>
              <h3 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Details</h3>
              <dl className="divide-y">
                <Row label="Date">{new Date(detail.respondedAt).toLocaleString()}</Row>
                <Row label="Contact">
                  {detail.contact.emailMask || detail.contact.emailHash ? (
                    <span className="flex flex-col gap-0.5">
                      {detail.contact.emailMask && <span className="font-mono text-xs">{detail.contact.emailMask}</span>}
                      {detail.contact.emailHash && (
                        <span className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                          sha256 {detail.contact.emailHash.slice(0, 16)}…
                          <CopyButton value={detail.contact.emailHash} size="icon" className="size-6" />
                        </span>
                      )}
                    </span>
                  ) : (
                    "—"
                  )}
                </Row>
                {detail.contact.name && <Row label="Name">{detail.contact.name}</Row>}
                {detail.contact.externalId && <Row label="External ID">{detail.contact.externalId}</Row>}
                <Row label="Deal">
                  {detail.dealValue != null ? (
                    <span>
                      {money(detail.dealValue, detail.dealCurrency, 2)}{" "}
                      <span className="text-xs text-muted-foreground">{detail.valueSource === "conversion" ? "(filled from the merged conversion)" : "(from the response)"}</span>
                    </span>
                  ) : (
                    "—"
                  )}
                </Row>
                {detail.transactionId && <Row label="Order / Tx ID">{detail.transactionId}</Row>}
                {detail.pageUrl && (
                  <Row label="Page">
                    <a href={detail.pageUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:underline">
                      {detail.pageUrl.replace(/^https?:\/\//, "")} <ExternalLink className="size-3" />
                    </a>
                  </Row>
                )}
                {detail.workflow && (
                  <Row label="Workflow">
                    <Link href={`/p/${projectId}/attribution?tab=mapping&wf=${detail.workflow.id}`} className="hover:underline">
                      {detail.workflow.name}
                    </Link>
                  </Row>
                )}
              </dl>
            </section>

            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                <Link2 className="size-3.5" /> Merged conversion
              </h3>
              {detail.conversion ? (
                <div className="rounded-xl border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="capitalize">
                        {detail.conversion.kind}
                      </Badge>
                      <span className="text-sm text-muted-foreground">{providerName(detail.conversion.source.replace(/^snippet_/, ""))}</span>
                    </div>
                    <span className="font-medium tabular">{money(detail.conversion.value, detail.conversion.currency, 2)}</span>
                  </div>
                  <dl className="mt-2 divide-y">
                    {detail.conversion.transactionId && <Row label="Transaction">{detail.conversion.transactionId}</Row>}
                    <Row label="Occurred">{new Date(detail.conversion.occurredAt).toLocaleString()}</Row>
                    {detail.matchedVia && <Row label="Matched via">{MATCH_LABEL[detail.matchedVia] ?? detail.matchedVia}</Row>}
                  </dl>
                  {detail.conversionDetail?.items && detail.conversionDetail.items.length > 0 && (
                    <div className="mt-2 overflow-x-auto rounded-lg border">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50 text-muted-foreground">
                          <tr>
                            <th className="px-2 py-1.5 text-left font-normal">Item</th>
                            <th className="px-2 py-1.5 text-right font-normal">Qty</th>
                            <th className="px-2 py-1.5 text-right font-normal">Price</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.conversionDetail.items.map((it, i) => (
                            <tr key={i} className="border-t">
                              <td className="px-2 py-1.5">{String(it.name ?? it.id ?? it.sku ?? "—")}</td>
                              <td className="px-2 py-1.5 text-right tabular">{it.quantity != null ? String(it.quantity) : "—"}</td>
                              <td className="px-2 py-1.5 text-right tabular">{it.price != null ? String(it.price) : it.total != null ? String(it.total) : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
                  No conversion merged yet. Orders/leads are matched by transaction id, then hashed email (90-day lookback), and new answers look back 48 h for
                  unmatched conversions.
                </p>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Metadata</h3>
              <MetaList data={detail.metadata} />
              {detail.visitorId && <p className="font-mono text-[11px] text-muted-foreground">Visitor {detail.visitorId}</p>}
              <p className="font-mono text-[11px] text-muted-foreground">
                {detail.id} · received {new Date(detail.createdAt).toLocaleString()}
              </p>
            </section>

            {canManage && (
              <div className="flex justify-end border-t pt-4">
                <Button variant={detail.status === "dismissed" ? "outline" : "destructive"} size="sm" className="gap-1.5" disabled={busy} onClick={toggle}>
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : detail.status === "dismissed" ? <Undo2 className="size-3.5" /> : <Ban className="size-3.5" />}
                  {detail.status === "dismissed" ? "Restore to analytics" : "Dismiss response"}
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
