"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, ExternalLink, FileCode2, FileText, Globe, Loader2, Rocket, Save, Sheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge, TimeAgo } from "@/components/app/misc";
import { cn } from "@/lib/utils";
import type { ConnectedIntegration } from "@/server/optimize/integrations/types";
import { getProviderMeta } from "../providers";
import { framerExportAction, publishContentAction } from "../actions";
import { IntegrationConnect } from "./integration-connect";
import { ProviderGlyph } from "./provider-glyph";
import { openExternal, safeHttpUrl } from "@/features/optimize/shared/safe-url";

type Published = { url: string | null; provider: string | null; externalId: string | null; publishedAt: string | null };

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Publishing side panel for the content editor. Includes the CMS connect/manage control (it answers
 * `?connect=<cms>` deep links), so pages rendering this panel don't need a separate IntegrationConnect kind="cms".
 */
export function PublishPanel({
  projectId,
  contentId,
  connected,
  canEdit,
  canManage,
  published,
}: {
  projectId: string;
  contentId: string;
  connected: ConnectedIntegration[];
  canEdit: boolean;
  canManage: boolean;
  published: Published;
}) {
  const router = useRouter();
  const cms = useMemo(() => connected.filter((c) => c.kind === "cms" && c.status !== "disconnected"), [connected]);
  const options = useMemo(() => {
    const list = cms.map((c) => ({ provider: c.provider, name: c.name, item: c as ConnectedIntegration | null }));
    if (!list.some((o) => o.provider === "framer")) list.push({ provider: "framer", name: "Framer (export)", item: null });
    return list;
  }, [cms]);
  const defaultProvider =
    (published.provider && options.some((o) => o.provider === published.provider) ? published.provider : null) ??
    options.find((o) => o.provider !== "framer")?.provider ??
    "framer";
  const [selected, setProvider] = useState(defaultProvider);
  const provider = options.some((o) => o.provider === selected) ? selected : defaultProvider;
  const [mode, setMode] = useState<"publish" | "draft">("publish");
  const [pending, start] = useTransition();
  const [exporting, startExport] = useTransition();

  const meta = getProviderMeta(provider);
  const item = cms.find((c) => c.provider === provider) ?? null;
  const isUpdate = !!published.externalId && published.provider === provider;
  const exportOnly = !!meta?.exportOnly;

  const publish = () =>
    start(async () => {
      const res = await publishContentAction({ projectId, contentId, provider, draft: mode === "draft" });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const url = safeHttpUrl(res.data.url);
      toast.success(mode === "draft" ? `Saved as draft in ${meta?.name}` : `Published to ${meta?.name}`, {
        action: url ? { label: "View", onClick: () => openExternal(url) } : undefined,
      });
      router.refresh();
    });

  const exportAs = (kind: "markdown" | "html" | "csv") =>
    startExport(async () => {
      const res = await framerExportAction(projectId, contentId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const { filename } = res.data;
      if (kind === "markdown") download(`${filename}.md`, res.data.markdown, "text/markdown;charset=utf-8");
      else if (kind === "html") download(`${filename}.html`, res.data.html, "text/html;charset=utf-8");
      else download(`${filename}-framer-cms.csv`, "﻿" + res.data.csv, "text/csv;charset=utf-8");
    });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">Publish</div>
        <IntegrationConnect projectId={projectId} kind="cms" connected={connected} canManage={canManage} className="justify-end" />
      </div>

      {published.publishedAt && published.provider && (
        <div className="rounded-xl border bg-brand-soft/30 p-3">
          <div className="flex items-center gap-2 text-xs">
            <ProviderGlyph provider={published.provider} size="xs" />
            <StatusBadge status="published" />
            <span className="text-muted-foreground">
              on {getProviderMeta(published.provider)?.name ?? published.provider} · <TimeAgo date={published.publishedAt} />
            </span>
          </div>
          {safeHttpUrl(published.url) && (
            <a
              href={safeHttpUrl(published.url)!}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-2 flex min-w-0 items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
            >
              <Globe className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{published.url!.replace(/^https?:\/\//, "")}</span>
              <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
            </a>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Destination</Label>
        <Select value={provider} onValueChange={setProvider}>
          <SelectTrigger className="h-9 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.provider} value={o.provider}>
                <span className="flex min-w-0 items-center gap-2">
                  <ProviderGlyph provider={o.provider} size="xs" />
                  <span className="truncate">{o.name}</span>
                  {o.item?.target && <span className="truncate text-muted-foreground">· {o.item.target.name}</span>}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!cms.some((c) => c.provider !== "framer") && (
          <p className="text-[11px] text-muted-foreground">
            Connect WordPress, Webflow or Shopify to publish in one click{canManage ? "" : " (ask a workspace admin)"}.
          </p>
        )}
      </div>

      {exportOnly ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Button variant="outline" size="sm" disabled={exporting} onClick={() => exportAs("csv")}>
              {exporting ? <Loader2 className="animate-spin" /> : <Sheet />} CMS CSV
            </Button>
            <Button variant="outline" size="sm" disabled={exporting} onClick={() => exportAs("html")}>
              <FileCode2 /> HTML
            </Button>
            <Button variant="outline" size="sm" disabled={exporting} onClick={() => exportAs("markdown")}>
              <FileText /> Markdown
            </Button>
          </div>
          <ol className="space-y-1.5 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
            {[
              "In Framer open CMS and select (or create) your blog collection with fields Title, Slug, Content (Formatted Text), Meta Title, Meta Description and FAQ (Formatted Text).",
              "Click ••• → Import CSV and choose the downloaded “CMS CSV” file.",
              "Map the columns to the fields, import, then add SEO title & description in the page settings if your template uses them.",
              "Publish the site. Alternatively paste the HTML export into a Formatted Text field.",
            ].map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-background text-[10px] font-semibold text-foreground ring-1 ring-border">
                  {i + 1}
                </span>
                <span className="min-w-0">{s}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-0.5">
            {(
              [
                ["publish", "Publish live", Rocket],
                ["draft", "Save as draft", Save],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key)}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                  mode === key ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
          {item?.status === "pending" && (
            <p className="text-xs text-warning">Choose a {meta?.targetLabel?.toLowerCase() ?? "target"} for {meta?.name} before publishing.</p>
          )}
          {item?.lastError && item.status === "error" && <p className="text-xs break-words text-destructive">{item.lastError}</p>}
          <Button className="w-full" disabled={!canEdit || !item || item.status === "pending" || pending} onClick={publish}>
            {pending ? <Loader2 className="animate-spin" /> : mode === "draft" ? <Save /> : <Rocket />}
            {pending
              ? "Publishing…"
              : `${isUpdate ? "Update in" : mode === "draft" ? "Save draft in" : "Publish to"} ${meta?.name ?? "CMS"}`}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Sends title, slug, formatted body{meta?.key === "wordpress" ? ", JSON-LD schema" : ""}, FAQ and meta description.{" "}
            {isUpdate ? "The existing item is updated — no duplicate is created." : ""}
          </p>
          {!canEdit && <p className="text-xs text-muted-foreground">You need edit access to publish.</p>}
        </div>
      )}
      {!exportOnly && (
        <button
          type="button"
          onClick={() => setProvider("framer")}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <Download className="size-3" /> Framer or another CMS? Download Markdown, HTML or CSV
        </button>
      )}
    </div>
  );
}
