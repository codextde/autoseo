"use client";

import { useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, RefreshCw, ShoppingBag, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Panel } from "@/components/app/page";
import { DataTable, type Column } from "@/components/app/data-table";
import { MultiSelect, SearchInput } from "@/components/app/filters";
import { Delta, formatCurrency } from "@/components/app/metrics";
import { EngineStack } from "@/components/app/engine-icon";
import { Favicon } from "@/components/app/favicon";
import { EmptyState } from "@/components/app/empty-state";
import { cn } from "@/lib/utils";
import type { ProductRow, ProductsOverview } from "@/server/ai/insights/products";
import { downloadCsv } from "../../lib/csv";
import { useClientListParam, useClientParam } from "../../lib/client-url";
import { SentimentPill, YouBadge } from "../brand";
import { Price, Rating, SourceIcons, ThumbTile } from "./product-bits";

const EMPTY_TEXT =
  "Products are captured from shopping cards and product mentions in AI answers (e.g. ChatGPT shopping results or Google AI Overviews via DataForSEO). They appear after the next tracking run that returns product data.";

type BrandRow = ProductsOverview["brands"][number];
type StoreRow = ProductsOverview["stores"][number];

export function ProductsView({ projectId, data, query, tab }: { projectId: string; data: ProductsOverview; query: string; tab: "products" | "stores" }) {
  if (data.totals.appearances === 0)
    return (
      <Panel>
        <EmptyState icon={ShoppingBag} title="No products in AI answers yet" description={EMPTY_TEXT} />
      </Panel>
    );
  return tab === "stores" ? <StoresTab data={data} /> : <ProductsTab projectId={projectId} data={data} query={query} />;
}

function ProductsTab({ projectId, data, query }: { projectId: string; data: ProductsOverview; query: string }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [q, setQ] = useClientParam("q", "");
  const [source, setSource] = useClientParam("source", "all");
  const [cats, setCats] = useClientListParam("cat");
  const [brandsSel, setBrandsSel] = useClientListParam("brand");
  const [sort, setSort] = useClientParam("sort", "appearances");

  const categories = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of data.products) if (p.category) m.set(p.category, (m.get(p.category) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, label: value, count }));
  }, [data.products]);

  const brandOptions = useMemo(() => data.brands.map((b) => ({ value: b.key, label: b.name, count: b.products })), [data.brands]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = data.products.filter((p) => {
      if (source === "shopping" && !p.sources.includes("shopping")) return false;
      if (source === "llm" && !p.sources.includes("llm")) return false;
      if (source === "both" && p.sources.length < 2) return false;
      if (cats.length && !(p.category && cats.includes(p.category))) return false;
      if (brandsSel.length && !(p.brandKey && brandsSel.includes(p.brandKey))) return false;
      if (needle && !`${p.name} ${p.brandName ?? ""} ${p.stores.join(" ")}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    const by: Record<string, (a: ProductRow, b: ProductRow) => number> = {
      appearances: (a, b) => b.appearances - a.appearances,
      price_asc: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
      price_desc: (a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity),
      rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
      recent: (a, b) => b.lastSeen.localeCompare(a.lastSeen),
    };
    return [...list].sort(by[sort] ?? by.appearances);
  }, [data.products, q, source, cats, brandsSel, sort]);

  const detail = (p: ProductRow) => `/p/${projectId}/ai/products/${p.id}${query}`;
  const top = data.products.slice(0, 8);
  const maxTop = Math.max(1, ...top.map((p) => p.appearances));

  const brandColumns: Column<BrandRow>[] = [
    { id: "rank", header: "#", width: "36px", cell: (_r, i) => <span className="text-xs text-muted-foreground tabular">{i + 1}</span> },
    {
      id: "brand",
      header: "Brand",
      cell: (b) => (
        <span className="flex min-w-32 items-center gap-2">
          <Favicon domain={b.domain} fallback={b.name} className="size-5 rounded-md" />
          <span className="truncate font-medium">{b.name}</span>
          {b.isOwn && <YouBadge />}
          {!b.tracked && <span className="text-[10px] text-muted-foreground">untracked</span>}
        </span>
      ),
    },
    { id: "products", header: "Products", align: "right", sortValue: (b) => b.products, cell: (b) => <Num v={b.products} d={b.productsDelta} /> },
    { id: "mentions", header: "Mentions", align: "right", sortValue: (b) => b.mentions, cell: (b) => <Num v={b.mentions} d={b.mentionsDelta} /> },
    {
      id: "sentiment",
      header: "Sentiment",
      align: "right",
      hideBelow: "md",
      sortValue: (b) => b.sentiment,
      cell: (b) => (
        <span className="inline-flex items-center gap-1.5">
          <SentimentPill score={b.sentiment} />
          <Delta value={b.sentimentDelta} digits={0} showZero={false} />
        </span>
      ),
    },
    {
      id: "share",
      header: "Share",
      align: "right",
      sortValue: (b) => b.share,
      cell: (b) => (
        <span className="inline-flex flex-col items-end leading-tight">
          <span className="font-medium tabular">{b.share.toFixed(1)}%</span>
          <Delta value={b.shareDelta} suffix="pp" showZero={false} />
        </span>
      ),
    },
  ];

  const columns: Column<ProductRow>[] = [
    {
      id: "product",
      header: "Product",
      sticky: true,
      cell: (p) => (
        <Link href={detail(p)} className="flex max-w-sm min-w-52 items-center gap-2.5 hover:underline">
          <ThumbTile src={p.imageUrl} name={p.name} />
          <span className="min-w-0">
            <span className="line-clamp-2 text-sm font-medium">{p.name}</span>
            {p.category && <span className="text-xs text-muted-foreground">{p.category}</span>}
          </span>
        </Link>
      ),
    },
    { id: "source", header: "Source", hideBelow: "md", cell: (p) => <SourceIcons sources={p.sources} /> },
    {
      id: "brand",
      header: "Brand",
      hideBelow: "md",
      cell: (p) => (
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          {p.brandName ?? "—"}
          {p.isOwn && <YouBadge />}
        </span>
      ),
    },
    { id: "price", header: "Price", align: "right", cell: (p) => <Price price={p.price} oldPrice={p.oldPrice} currency={p.currency} /> },
    { id: "rating", header: "Rating", align: "right", hideBelow: "lg", cell: (p) => <Rating rating={p.rating} reviews={p.reviews} /> },
    { id: "engines", header: "Engines", hideBelow: "lg", cell: (p) => <EngineStack ids={p.engines} max={4} /> },
    { id: "appearances", header: "Appearances", align: "right", cell: (p) => <Num v={p.appearances} d={p.appearancesDelta} /> },
    {
      id: "action",
      header: <span className="sr-only">Action</span>,
      align: "right",
      cell: (p) => (
        <Button asChild variant="outline" size="sm" className="h-7">
          <Link href={detail(p)}>View Product</Link>
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid gap-4 sm:gap-5 xl:grid-cols-2">
        <Panel title="Top products" description="Most-surfaced products across AI answers" contentClassName="p-2 sm:p-3">
          <ol className="space-y-1">
            {top.map((p, i) => (
              <li key={p.id}>
                <Link href={detail(p)} className="relative flex items-center gap-2.5 overflow-hidden rounded-lg px-2 py-1.5 hover:ring-1 hover:ring-border">
                  <span className="absolute inset-y-0 left-0 rounded-lg bg-muted" style={{ width: `${(p.appearances / maxTop) * 100}%` }} />
                  <span className="relative w-4 text-xs text-muted-foreground tabular">{i + 1}</span>
                  <ThumbTile src={p.imageUrl} name={p.name} className="relative size-8" />
                  <span className="relative min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{p.brandName}</span>
                  </span>
                  {p.isOwn && <YouBadge className="relative" />}
                  <span className="relative text-xs font-medium tabular">{p.appearances.toLocaleString()}</span>
                </Link>
              </li>
            ))}
          </ol>
        </Panel>
        <Panel title="Top brands" description="Whose products AI recommends most">
          <DataTable
            columns={brandColumns}
            data={data.brands.slice(0, 10)}
            getRowId={(b) => b.key}
            paginate={false}
            dense
            rowClassName={(b) => (b.isOwn ? "bg-brand-soft/30" : undefined)}
            mobileCard={(b) => (
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <Favicon domain={b.domain} fallback={b.name} />
                  <span className="truncate font-medium">{b.name}</span>
                  {b.isOwn && <YouBadge />}
                </span>
                <span className="text-xs text-muted-foreground tabular">
                  {b.products} products · {b.share.toFixed(1)}%
                </span>
              </div>
            )}
          />
        </Panel>
      </div>

      <Panel title="Products" description="Every product across AI answers — mentioned in text (LLM) and rendered shopping listings, unified">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <SearchInput value={q} onChange={(v) => setQ(v || null)} placeholder="Search products or stores…" className="sm:max-w-64 sm:flex-1" />
          <Select value={source} onValueChange={(v) => setSource(v)}>
            <SelectTrigger size="sm" className="h-8 w-full text-xs sm:w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="shopping">Shopping</SelectItem>
              <SelectItem value="llm">LLM mentions</SelectItem>
              <SelectItem value="both">Both</SelectItem>
            </SelectContent>
          </Select>
          {categories.length > 0 && <MultiSelect options={categories} value={cats} onChange={setCats} placeholder="All categories" label="Categories" />}
          <MultiSelect options={brandOptions} value={brandsSel} onChange={setBrandsSel} placeholder="All brands" label="Brands" />
          <Select value={sort} onValueChange={(v) => setSort(v)}>
            <SelectTrigger size="sm" className="h-8 w-full text-xs sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="appearances">Sort: Appearances</SelectItem>
              <SelectItem value="price_asc">Sort: Price ↑</SelectItem>
              <SelectItem value="price_desc">Sort: Price ↓</SelectItem>
              <SelectItem value="rating">Sort: Rating</SelectItem>
              <SelectItem value="recent">Sort: Recently seen</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex gap-2 sm:ml-auto">
            <Button variant="outline" size="icon-sm" className="size-8" aria-label="Refresh" onClick={() => startRefresh(() => router.refresh())}>
              <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={!filtered.length}
              onClick={() =>
                downloadCsv(
                  `products-${new Date().toISOString().slice(0, 10)}`,
                  ["Product", "Brand", "Category", "Sources", "Price", "Old price", "Currency", "Rating", "Reviews", "Engines", "Appearances", "Last seen"],
                  filtered.map((p) => [p.name, p.brandName, p.category, p.sources.join(" "), p.price, p.oldPrice, p.currency, p.rating, p.reviews, p.engines.join(" "), p.appearances, p.lastSeen]),
                )
              }
            >
              <Download className="size-3.5" /> Export
            </Button>
          </div>
        </div>
        <DataTable
          columns={columns}
          data={filtered}
          getRowId={(p) => p.id}
          pageSize={25}
          rowClassName={(p) => (p.isOwn ? "bg-brand-soft/20" : undefined)}
          empty={<EmptyState compact title="No products match" description="Try clearing the filters." />}
          mobileCard={(p) => (
            <Link href={detail(p)} className="flex items-center gap-3">
              <ThumbTile src={p.imageUrl} name={p.name} />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-sm font-medium">{p.name}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {p.brandName} · <Rating rating={p.rating} />
                </span>
              </span>
              <span className="text-right text-xs">
                <Price price={p.price} oldPrice={p.oldPrice} currency={p.currency} />
                <span className="block text-muted-foreground tabular">{p.appearances}×</span>
              </span>
            </Link>
          )}
        />
      </Panel>
    </div>
  );
}

function StoresTab({ data }: { data: ProductsOverview }) {
  const top = data.stores.slice(0, 10);
  const max = Math.max(1, ...top.map((s) => s.appearances));
  const columns: Column<StoreRow>[] = [
    { id: "rank", header: "#", width: "36px", cell: (_s, i) => <span className="text-xs text-muted-foreground tabular">{i + 1}</span> },
    {
      id: "store",
      header: "Store",
      sortValue: (s) => s.store.toLowerCase(),
      cell: (s) => (
        <span className="flex min-w-36 items-center gap-2">
          <Favicon domain={s.domain} fallback={s.store} />
          <span className="min-w-0">
            <span className="block truncate font-medium">{s.store}</span>
            {s.domain && <span className="block truncate text-xs text-muted-foreground">{s.domain}</span>}
          </span>
        </span>
      ),
    },
    { id: "appearances", header: "Appearances", align: "right", sortValue: (s) => s.appearances, cell: (s) => <Num v={s.appearances} d={s.appearancesDelta} /> },
    { id: "share", header: "Share", align: "right", sortValue: (s) => s.share, cell: (s) => <span className="tabular">{s.share.toFixed(1)}%</span> },
    { id: "products", header: "Products", align: "right", hideBelow: "md", sortValue: (s) => s.products, cell: (s) => <span className="tabular">{s.products}</span> },
    {
      id: "avg",
      header: "Avg price",
      align: "right",
      hideBelow: "md",
      sortValue: (s) => s.avgPrice,
      cell: (s) => <span className="tabular">{s.avgPrice == null ? "—" : formatCurrency(s.avgPrice, s.currency && /^[A-Z]{3}$/.test(s.currency) ? s.currency : "USD")}</span>,
    },
  ];
  if (!data.stores.length)
    return (
      <Panel>
        <EmptyState icon={Store} title="No stores yet" description="Stores appear when AI answers render shopping listings with seller information." />
      </Panel>
    );
  return (
    <div className="grid gap-4 sm:gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
      <Panel title="Top stores" description="Sellers AI cites products from, across shopping blocks" contentClassName="p-2 sm:p-3">
        <ol className="space-y-1">
          {top.map((s, i) => (
            <li key={s.store} className="relative flex items-center gap-2.5 overflow-hidden rounded-lg px-2.5 py-2 text-sm">
              <span className="absolute inset-y-0 left-0 rounded-lg bg-muted" style={{ width: `${(s.appearances / max) * 100}%` }} />
              <span className="relative w-4 text-xs text-muted-foreground tabular">{i + 1}</span>
              <Favicon domain={s.domain} fallback={s.store} className="relative" />
              <span className="relative min-w-0 flex-1 truncate font-medium">{s.store}</span>
              <span className="relative text-xs tabular">
                {s.appearances.toLocaleString()} <span className="text-muted-foreground">· {s.share.toFixed(0)}%</span>
              </span>
            </li>
          ))}
        </ol>
      </Panel>
      <Panel title="Stores">
        <DataTable
          columns={columns}
          data={data.stores}
          getRowId={(s) => s.store}
          initialSort={{ id: "appearances", dir: "desc" }}
          pageSize={25}
          mobileCard={(s) => (
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <Favicon domain={s.domain} fallback={s.store} />
                <span className="truncate font-medium">{s.store}</span>
              </span>
              <span className="text-xs text-muted-foreground tabular">
                {s.appearances} · {s.share.toFixed(1)}%
              </span>
            </div>
          )}
        />
      </Panel>
    </div>
  );
}

function Num({ v, d }: { v: number; d: number | null }) {
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="font-medium tabular">{v.toLocaleString()}</span>
      <Delta value={d} digits={0} showZero={false} />
    </span>
  );
}
