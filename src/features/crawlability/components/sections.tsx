import { Braces, Code2, Gauge, Link2, Map as MapIcon, Server } from "lucide-react";
import { ScoreRing } from "@/components/app/charts";
import { Meter } from "@/components/app/metrics";
import { Panel } from "@/components/app/page";
import { cn } from "@/lib/utils";
import { HttpStatusBadge, pathOf, scoreTone } from "@/features/audit/components/bits";
import type { CategoryScore, CrawlabilityResult, PageCheck } from "@/server/crawlability/types";

const RENDER_LABEL = { ssr: "Server-rendered", partial: "Partly client-side", csr: "JavaScript-only" } as const;

export function CrawlabilityHero({ score, result }: { score: number | null; result: CrawlabilityResult }) {
  const aiBots = result.bots.filter((b) => b.purpose !== "seo");
  const allowed = aiBots.filter((b) => b.overall === "allowed").length;
  const blocked = aiBots.filter((b) => b.overall === "blocked").length;
  const home = result.pages[0];
  const verdict = score == null ? "" : score >= 85 ? "AI crawlers can read your site" : score >= 60 ? "Mostly accessible — a few things hold AI crawlers back" : "AI crawlers struggle to access your site";
  return (
    <section className="grid gap-5 rounded-2xl border bg-card p-4 shadow-soft sm:p-5 lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center">
      <div className="flex items-center gap-4">
        <ScoreRing value={score ?? 0} size={124} stroke={10} label="AI access" color={scoreTone(score).color} />
        <div className="min-w-0 lg:hidden">
          <p className="text-sm font-semibold">{verdict}</p>
          <p className="text-xs text-muted-foreground">{new URL(result.origin).hostname}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <p className="col-span-2 hidden text-sm font-semibold lg:block">{verdict}</p>
        <Stat label="AI crawlers allowed" value={`${allowed}/${aiBots.length}`} tone={blocked ? "text-destructive" : "text-success"} sub={blocked ? `${blocked} blocked` : "none blocked"} />
        <Stat
          label="llms.txt"
          value={result.llms.txt.present ? (result.llms.txt.validation?.valid ? "Valid" : "Issues") : "Missing"}
          tone={result.llms.txt.present ? (result.llms.txt.validation?.valid ? "text-success" : "text-warning") : "text-muted-foreground"}
          sub={result.llms.full.present ? "+ llms-full.txt" : undefined}
        />
        <Stat
          label="Rendering"
          value={home?.signals ? RENDER_LABEL[home.signals.rendering.verdict] : "—"}
          tone={home?.signals?.rendering.verdict === "ssr" ? "text-success" : home?.signals?.rendering.verdict === "csr" ? "text-destructive" : "text-warning"}
          sub={home?.signals?.rendering.frameworks.slice(0, 2).join(", ") || undefined}
        />
        <Stat label="Sitemap" value={result.sitemap.found ? `${result.sitemap.totalUrls.toLocaleString()} URLs` : "Not found"} tone={result.sitemap.found ? "" : "text-warning"} />
      </div>
      <CategoryBars categories={result.categories} />
    </section>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-muted/50 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("truncate text-base font-semibold tracking-tight tabular", tone)}>{value}</div>
      {sub && <div className="truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function CategoryBars({ categories }: { categories: CategoryScore[] }) {
  return (
    <ul className="space-y-2">
      {categories.map((c) => {
        const pct = (c.score / c.max) * 100;
        return (
          <li key={c.key} className="grid grid-cols-[minmax(0,130px)_minmax(0,1fr)_52px] items-center gap-2 text-xs">
            <span className="truncate text-muted-foreground">{c.label}</span>
            <Meter value={c.score} max={c.max} tone={pct >= 85 ? "brand" : pct >= 50 ? "warning" : "destructive"} />
            <span className="text-right tabular">
              <strong>{Number.isInteger(c.score) ? c.score : c.score.toFixed(1)}</strong>
              <span className="text-muted-foreground">/{c.max}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function PageCard({ p }: { p: PageCheck }) {
  const s = p.signals;
  const dirs = [...new Set(p.directives.map((d) => (d.scope === "all" ? d.directive : `${d.scope}: ${d.directive}`)))];
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <a href={p.finalUrl ?? p.url} target="_blank" rel="noopener noreferrer nofollow" className="block truncate font-mono text-sm font-medium hover:underline" title={p.url}>
            {pathOf(p.url)}
          </a>
          {s?.title && <p className="truncate text-xs text-muted-foreground">{s.title}</p>}
        </div>
        <HttpStatusBadge status={p.status} />
      </div>
      {p.error && <p className="rounded-lg bg-destructive/10 px-2 py-1 text-xs text-destructive">{p.error}</p>}
      {p.hops.length > 0 && (
        <p className="flex flex-wrap items-center gap-1 font-mono text-[11px] text-muted-foreground">
          {p.hops.map((h, i) => (
            <span key={i}>
              {pathOf(h.url)} <span className="text-warning">{h.status}</span> →
            </span>
          ))}
          <span>{pathOf(p.finalUrl ?? "")}</span>
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <Fact icon={<Server className="size-3.5" />} label="TTFB" value={p.ttfbMs != null ? `${p.ttfbMs} ms` : "—"} warn={(p.ttfbMs ?? 0) > 800} />
        <Fact icon={<Gauge className="size-3.5" />} label="HTML" value={p.bytes ? `${Math.round(p.bytes / 1024)} KB${p.contentEncoding ? ` · ${p.contentEncoding}` : ""}` : "—"} />
        <Fact icon={<Code2 className="size-3.5" />} label="Rendering" value={s ? RENDER_LABEL[s.rendering.verdict] : "—"} warn={s?.rendering.verdict !== "ssr"} />
        <Fact icon={<Link2 className="size-3.5" />} label="Words / links" value={s ? `${s.wordCount.toLocaleString()} / ${s.linkCount}` : "—"} />
      </div>
      {s && (
        <dl className="space-y-1.5 text-xs">
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-muted-foreground">Frameworks</dt>
            <dd>{s.rendering.frameworks.join(", ") || "—"}{s.rendering.spaMarkers.length ? <span className="text-warning"> · {s.rendering.spaMarkers.join(", ")}</span> : null}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-muted-foreground">Canonical</dt>
            <dd className="min-w-0 truncate font-mono">{p.canonical.resolved ? `${p.canonical.self ? "self" : pathOf(p.canonical.resolved)}${p.canonical.conflict ? " (conflicts with header)" : ""}` : "none"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-muted-foreground">Directives</dt>
            <dd className={cn(dirs.length && "text-warning")}>{dirs.join(", ") || "none"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-muted-foreground">
              <Braces className="mr-1 inline size-3" />
              JSON-LD
            </dt>
            <dd>{s.jsonLd.count ? `${s.jsonLd.types.join(", ") || `${s.jsonLd.count} block(s)`}${s.jsonLd.invalid ? ` · ${s.jsonLd.invalid} invalid` : ""}` : "none"}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

function Fact({ icon, label, value, warn }: { icon: React.ReactNode; label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-muted/50 px-2.5 py-1.5">
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={cn("truncate font-medium tabular", warn && "text-warning")}>{value}</div>
    </div>
  );
}

export function PagesSection({ pages }: { pages: PageCheck[] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {pages.map((p) => (
        <PageCard key={p.url} p={p} />
      ))}
    </div>
  );
}

export function RobotsSection({ result }: { result: CrawlabilityResult }) {
  const r = result.robots;
  const referenced = new Set(result.bots.map((b) => b.robots.ruleLine).filter((l): l is number => l !== null));
  const lines = (r.raw ?? "").split(/\r?\n/);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <Panel title="robots.txt" description={r.found ? `${r.groupCount} user-agent group(s) · ${Math.max(1, Math.round(r.bytes / 1024))} KB` : r.unreachable ? `HTTP ${r.status} — treated as "disallow all"` : `Not found${r.status ? ` (HTTP ${r.status})` : ""}`} contentClassName="p-0">
        {r.raw ? (
          <pre className="max-h-[520px] overflow-auto py-2 font-mono text-xs leading-5">
            {lines.map((l, i) => (
              <div key={i} className={cn("flex gap-3 px-3", referenced.has(i + 1) && "bg-warning/12")}>
                <span className="w-8 shrink-0 text-right text-muted-foreground/60 select-none">{i + 1}</span>
                <span className="whitespace-pre-wrap break-all">{l || " "}</span>
              </div>
            ))}
          </pre>
        ) : (
          <p className="px-5 py-6 text-sm text-muted-foreground">No robots.txt content to show.</p>
        )}
      </Panel>
      <div className="space-y-4">
        <Panel title="Sitemaps" icon={<MapIcon className="size-4 text-muted-foreground" />} contentClassName="p-0">
          {result.sitemap.docs.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">No sitemap found.</p>
          ) : (
            <ul className="divide-y">
              {result.sitemap.docs.slice(0, 20).map((d) => (
                <li key={d.url} className="px-4 py-2 sm:px-5">
                  <p className="truncate font-mono text-xs" title={d.url}>
                    {pathOf(d.url)}
                  </p>
                  <p className={cn("text-[11px]", d.ok ? "text-muted-foreground" : "text-destructive")}>
                    {d.ok ? (d.kind === "sitemapindex" ? `Index · ${d.nestedCount} sitemaps` : `${d.urlCount.toLocaleString()} URLs${d.withLastmod ? ` · ${d.withLastmod} with lastmod` : ""}`) : d.error}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {r.warnings.length > 0 && (
          <Panel title="Syntax notes">
            <ul className="space-y-1 text-xs text-muted-foreground">
              {r.warnings.slice(0, 20).map((w, i) => (
                <li key={i}>
                  Line {w.line}: {w.message}
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </div>
  );
}
