"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNowStrict } from "date-fns";
import { ExternalLink, FileUp, KeyRound, Link2, Loader2, Package, PlugZap, RefreshCw, Trash2, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, type Column } from "@/components/app/data-table";
import { Panel } from "@/components/app/page";
import { SearchInput } from "@/components/app/filters";
import { ConfirmButton, CopyButton, StatusBadge } from "@/components/app/misc";
import { formatCurrency, formatNumber } from "@/components/app/metrics";
import { useUrlState } from "@/hooks/use-url-state";
import { useJobPoll } from "../shared/use-job-poll";
import { AnalysisRunning } from "../shared/analysis-running";
import {
  clearCatalogAction,
  connectFeedAction,
  disconnectStreamAction,
  listProductsAction,
  rotateProductTokenAction,
  syncFeedNowAction,
  uploadProductsAction,
} from "../../actions/knowledge";
import type { CatalogProduct, KnowledgeState, ProductStreamConfig } from "../../types";

type ProductsPage = { rows: CatalogProduct[]; total: number; categories: { name: string; count: number }[] };

function ConnectDialog({
  projectId,
  open,
  onOpenChange,
  stream,
  endpoint,
  canManageSettings,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  stream: ProductStreamConfig;
  endpoint: string;
  canManageSettings: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<string>(stream.source ?? "feed");
  const [feedUrl, setFeedUrl] = useState(stream.feedUrl ?? "");
  const [daily, setDaily] = useState(stream.syncDaily);
  const [replace, setReplace] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);

  const connectFeed = () =>
    start(async () => {
      const res = await connectFeedAction(projectId, feedUrl.trim(), daily);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Feed connected — importing products…");
      onOpenChange(false);
      router.refresh();
    });
  const upload = () =>
    start(async () => {
      if (!file) return void toast.error("Choose a file first.");
      const fd = new FormData();
      fd.set("file", file);
      fd.set("replace", String(replace));
      const res = await uploadProductsAction(projectId, fd);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${formatNumber(res.data.received)} products imported (${res.data.created} new, ${res.data.updated} updated${res.data.skipped ? `, ${res.data.skipped} skipped` : ""})`);
      onOpenChange(false);
      router.refresh();
    });
  const rotate = () =>
    start(async () => {
      const res = await rotateProductTokenAction(projectId);
      if (!res.ok) return void toast.error(res.error);
      setToken(res.data.token);
      router.refresh();
    });

  const curl = `curl -X POST ${endpoint} \\
  -H "Authorization: Bearer ${token ?? "aps_…"}" \\
  -H "Content-Type: application/json" \\
  -d '[{"sku":"SKU-1","name":"Product name","url":"https://example.com/p/1","image_url":"https://example.com/p/1.jpg","price":199.0,"currency":"EUR","category":"Balcony power plants","brand":"Brand"}]'`;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setToken(null);
      }}
    >
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Connect your product stream</DialogTitle>
          <DialogDescription>Keep your catalog in sync so AI answers can be matched against your real products — via feed URL, file upload or push API.</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full">
            <TabsTrigger value="feed">
              <Link2 className="size-3.5" /> Feed URL
            </TabsTrigger>
            <TabsTrigger value="file">
              <FileUp className="size-3.5" /> File
            </TabsTrigger>
            <TabsTrigger value="api">
              <KeyRound className="size-3.5" /> API
            </TabsTrigger>
          </TabsList>
          <TabsContent value="feed" className="space-y-3 pt-3">
            <div className="space-y-1">
              <Label>Feed URL</Label>
              <Input value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} placeholder="https://shop.example.com/feeds/google-merchant.xml" inputMode="url" />
              <p className="text-xs text-muted-foreground">Google Merchant XML, RSS/Atom, CSV or JSON — Shopify stores can use https://your-store/products.json.</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={daily} onCheckedChange={setDaily} /> Re-sync daily
            </label>
            <Button onClick={connectFeed} disabled={pending || !feedUrl.trim()} className="w-full sm:w-auto">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />} Connect feed
            </Button>
          </TabsContent>
          <TabsContent value="file" className="space-y-3 pt-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center gap-1.5 rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground hover:border-foreground/40 hover:text-foreground"
            >
              <FileUp className="size-5" />
              {file ? <span className="font-medium text-foreground">{file.name}</span> : "Choose CSV, JSON or XML file"}
              <span className="text-[11px]">max 20 MB · up to 10,000 products</span>
            </button>
            <input ref={fileRef} type="file" accept=".csv,.json,.xml,.tsv,.txt,text/csv,application/json,application/xml,text/xml" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={replace} onCheckedChange={(v) => setReplace(!!v)} /> Replace products from earlier file uploads
            </label>
            <Button onClick={upload} disabled={pending || !file} className="w-full sm:w-auto">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />} Import file
            </Button>
          </TabsContent>
          <TabsContent value="api" className="space-y-3 pt-3">
            <div className="space-y-1">
              <Label>Endpoint</Label>
              <div className="flex gap-2">
                <Input readOnly value={endpoint} className="font-mono text-xs" />
                <CopyButton value={endpoint} size="icon" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Token</Label>
              {token ? (
                <div className="space-y-1.5 rounded-lg border border-warning/30 bg-warning/8 p-2.5">
                  <div className="flex gap-2">
                    <Input readOnly value={token} className="font-mono text-xs" />
                    <CopyButton value={token} size="icon" />
                  </div>
                  <p className="text-xs text-muted-foreground">Copy it now — it is shown only once. Only a SHA-256 hash is stored.</p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{stream.tokenPrefix ? `Active token ${stream.tokenPrefix}… (rotate to get a new one)` : "No token yet."}</p>
              )}
              {canManageSettings ? (
                <Button variant="outline" size="sm" onClick={rotate} disabled={pending}>
                  {pending ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
                  {stream.tokenPrefix ? "Rotate token" : "Generate token"}
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">Creating API tokens requires the “Integrations, API keys, model settings” permission.</p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Example</Label>
              <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-[11px] leading-relaxed">{curl}</pre>
              <p className="text-xs text-muted-foreground">Send a JSON array (or {"{ \"products\": [...], \"replace\": true }"}), up to 10,000 products per request. Fields: sku, name, url, image_url, price, currency, category, brand, description, gtin, availability.</p>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

export function ProductsTab({
  projectId,
  state,
  stream,
  initial,
  endpoint,
  canManage,
  canManageSettings,
}: {
  projectId: string;
  state: KnowledgeState<Record<string, unknown>>;
  stream: ProductStreamConfig;
  initial: ProductsPage;
  endpoint: string;
  canManage: boolean;
  canManageSettings: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useUrlState("pq", "");
  const [page, setPage] = useState<ProductsPage>(initial);
  const [loading, start] = useTransition();
  const running = state.status === "running";
  const job = useJobPoll(projectId, running ? state.jobId : null, { intervalMs: 3000 });

  const firstQuery = useRef(true);
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setPage(initial);
  }
  useEffect(() => {
    if (firstQuery.current) {
      firstQuery.current = false;
      if (!q) return;
    }
    start(async () => {
      const res = await listProductsAction(projectId, q, 0);
      if (res.ok) setPage(res.data);
    });
  }, [q, projectId]);

  const more = () =>
    start(async () => {
      const res = await listProductsAction(projectId, q, page.rows.length);
      if (res.ok) setPage({ ...res.data, rows: [...page.rows, ...res.data.rows] });
    });

  const connected = !!stream.source;
  const hasProducts = initial.total > 0;

  const columns: Column<CatalogProduct>[] = [
    {
      id: "name",
      header: "Product",
      cell: (p) => (
        <div className="flex min-w-0 items-center gap-3">
          <ProductImage src={p.imageUrl} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{p.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {[p.brand, p.sku].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
        </div>
      ),
      sortValue: (p) => p.name,
    },
    { id: "price", header: "Price", align: "right", cell: (p) => (p.price != null ? formatCurrency(p.price, p.currency ?? "EUR", 2) : "—"), sortValue: (p) => p.price },
    { id: "category", header: "Category", hideBelow: "md", cell: (p) => <span className="line-clamp-1 text-xs text-muted-foreground">{p.category ?? "—"}</span>, sortValue: (p) => p.category },
    { id: "availability", header: "Stock", hideBelow: "lg", cell: (p) => <span className="text-xs text-muted-foreground">{p.availability ?? "—"}</span> },
    {
      id: "url",
      header: "URL",
      hideBelow: "sm",
      cell: (p) =>
        p.url ? (
          <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex max-w-56 items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <span className="truncate">{p.url.replace(/^https?:\/\/(www\.)?/, "")}</span>
            <ExternalLink className="size-3 shrink-0" />
          </a>
        ) : (
          "—"
        ),
    },
  ];

  if (running && !hasProducts) {
    return <AnalysisRunning source="Your products" status={job} estimate="Feed imports usually finish within a few minutes." showPromptResearchNote={false} />;
  }

  return (
    <div className="space-y-4">
      {!connected && !hasProducts ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border bg-card px-5 py-12 text-center shadow-soft">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
            <Package className="size-5" />
          </div>
          <div className="max-w-lg space-y-1.5">
            <p className="text-base font-semibold">Connect your product stream</p>
            <p className="text-sm text-muted-foreground">
              Import your catalog via feed URL (Google Merchant / Shopify), file or push API. Products are matched against AI answers and used as context for prompts and content.
            </p>
          </div>
          {canManage ? (
            <Button onClick={() => setOpen(true)}>
              <PlugZap className="size-4" /> Connect product stream
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Ask a project member with “manage prompts” permission to connect your catalog.</p>
          )}
        </div>
      ) : (
        <Panel
          title="Product stream"
          icon={<PlugZap className="size-4 text-muted-foreground" />}
          actions={
            canManage && (
              <>
                {stream.source === "feed" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={running}
                    onClick={async () => {
                      const res = await syncFeedNowAction(projectId);
                      if (!res.ok) toast.error(res.error);
                      else {
                        toast.success("Sync started");
                        router.refresh();
                      }
                    }}
                  >
                    <RefreshCw className={running ? "size-3.5 animate-spin" : "size-3.5"} /> {running ? "Syncing…" : "Sync now"}
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
                  {connected ? "Change source" : "Connect"}
                </Button>
                {connected && (
                  <ConfirmButton
                    title="Disconnect product stream?"
                    description="The feed / API token is removed. Your imported products stay in the catalog."
                    confirmLabel="Disconnect"
                    destructive
                    onConfirm={async () => {
                      const res = await disconnectStreamAction(projectId);
                      if (!res.ok) toast.error(res.error);
                      else router.refresh();
                    }}
                  >
                    <Button size="sm" variant="ghost">
                      <Unplug className="size-3.5" /> Disconnect
                    </Button>
                  </ConfirmButton>
                )}
              </>
            )
          }
        >
          <div className="grid gap-3 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Source</p>
              <p className="font-medium">{stream.source === "feed" ? "Feed URL" : stream.source === "file" ? "File upload" : stream.source === "api" ? "Push API" : "—"}</p>
              {stream.feedUrl && <p className="truncate font-mono text-[11px] text-muted-foreground">{stream.feedUrl}</p>}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              {running ? <StatusBadge status="running" label="Syncing" /> : stream.status ? <StatusBadge status={stream.status === "connected" ? "active" : stream.status} label={stream.status} /> : <span>—</span>}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Last import</p>
              <p className="font-medium">{stream.lastImport ? formatDistanceToNowStrict(new Date(stream.lastImport.at), { addSuffix: true }) : "—"}</p>
              {stream.lastImport && (
                <p className="text-[11px] text-muted-foreground">
                  {formatNumber(stream.lastImport.received)} received · {stream.lastImport.created} new · {stream.lastImport.updated} updated
                </p>
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Catalog</p>
              <p className="font-medium tabular">{formatNumber(initial.total)} products</p>
            </div>
          </div>
          {stream.lastError && <p className="mt-3 rounded-lg bg-destructive/5 px-3 py-2 text-xs text-destructive">{stream.lastError}</p>}
          {running && job?.progress?.message && <p className="mt-3 text-xs text-muted-foreground">{job.progress.message}</p>}
        </Panel>
      )}

      {(hasProducts || q) && (
        <Panel
          title="Catalog"
          description={`${formatNumber(page.total)} products${q ? ` matching “${q}”` : ""}`}
          actions={
            canManage &&
            hasProducts && (
              <ConfirmButton
                title="Clear the catalog?"
                description="All imported products of this project are deleted. Connected feeds re-import on the next sync."
                confirmLabel="Clear catalog"
                destructive
                onConfirm={async () => {
                  const res = await clearCatalogAction(projectId);
                  if (!res.ok) toast.error(res.error);
                  else router.refresh();
                }}
              >
                <Button size="sm" variant="ghost" className="text-muted-foreground">
                  <Trash2 className="size-3.5" /> Clear
                </Button>
              </ConfirmButton>
            )
          }
          contentClassName="space-y-3 p-3 sm:p-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={q} onChange={(v) => setQ(v || null)} placeholder="Search products, SKU, category…" className="min-w-0 flex-1 sm:max-w-sm" />
            {page.categories.slice(0, 6).map((c) => (
              <button key={c.name} type="button" onClick={() => setQ(c.name)} className="hidden rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground hover:text-foreground md:inline-block">
                {c.name} <span className="tabular">{c.count}</span>
              </button>
            ))}
          </div>
          <DataTable
            columns={columns}
            data={page.rows}
            getRowId={(p) => p.id}
            loading={loading && page.rows.length === 0}
            paginate={false}
            mobileCard={(p) => (
              <div className="flex items-center gap-3">
                <ProductImage src={p.imageUrl} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{p.category ?? p.brand ?? "—"}</p>
                </div>
                <span className="text-sm font-medium tabular">{p.price != null ? formatCurrency(p.price, p.currency ?? "EUR", 2) : "—"}</span>
              </div>
            )}
            empty={<div className="py-10 text-center text-sm text-muted-foreground">No products match your search.</div>}
          />
          {page.rows.length < page.total && (
            <div className="flex justify-center">
              <Button variant="outline" size="sm" onClick={more} disabled={loading}>
                {loading && <Loader2 className="size-3.5 animate-spin" />} Load more ({formatNumber(page.total - page.rows.length)} remaining)
              </Button>
            </div>
          )}
        </Panel>
      )}

      {canManage && <ConnectDialog projectId={projectId} open={open} onOpenChange={setOpen} stream={stream} endpoint={endpoint} canManageSettings={canManageSettings} />}
    </div>
  );
}

function ProductImage({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed)
    return (
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Package className="size-4" />
      </span>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="size-10 shrink-0 rounded-lg border bg-white object-contain" />
  );
}
