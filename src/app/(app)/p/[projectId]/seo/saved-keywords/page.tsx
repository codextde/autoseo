import { PageContainer, PageHeader } from "@/components/app/page";
import { listSavedKeywords } from "@/server/seo";
import { SAVED_SORT_FIELDS, type SavedSortField } from "@/server/seo/saved-keywords";
import { clientPageInfo, loadSeoPage } from "@/features/seo/server/page-context";
import { SavedKeywordsView, type SavedQuery } from "@/features/seo/components/saved/saved-keywords-view";
import { DataForSeoBanner } from "@/features/seo/components/shared/empty-states";

export const metadata = { title: "Saved Keywords" };

function str(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}
function list(v: string | string[] | undefined): string[] {
  return str(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
}
function numStr(v: string | string[] | undefined): string {
  const s = str(v);
  return s !== "" && Number.isFinite(Number(s)) ? s : "";
}

export default async function SavedKeywordsPage({ params, searchParams }: PageProps<"/p/[projectId]/seo/saved-keywords">) {
  const { projectId } = await params;
  const sp = await searchParams;
  const info = await loadSeoPage(projectId);
  const sort = (SAVED_SORT_FIELDS as readonly string[]).includes(str(sp.sort)) ? (str(sp.sort) as SavedSortField) : "fetchedAt";
  const size = [100, 250].includes(Number(str(sp.size))) ? (Number(str(sp.size)) as 100 | 250) : 50;
  const query: SavedQuery = {
    include: list(sp.inc),
    exclude: list(sp.exc),
    minVol: numStr(sp.minVol),
    maxVol: numStr(sp.maxVol),
    minCpc: numStr(sp.minCpc),
    maxCpc: numStr(sp.maxCpc),
    minKd: numStr(sp.minKd),
    maxKd: numStr(sp.maxKd),
    tags: list(sp.tags),
    sort,
    order: str(sp.order) === "asc" ? "asc" : "desc",
    page: Math.max(1, Math.floor(Number(str(sp.page)) || 1)),
    size,
  };
  const n = (v: string) => (v === "" ? undefined : Number(v));
  const clampKd = (v: string) => (v === "" ? undefined : Math.min(100, Math.max(0, Math.round(Number(v)))));
  const data = await listSavedKeywords(info.ctx, {
    includeTerms: query.include,
    excludeTerms: query.exclude,
    minVolume: n(query.minVol) != null ? Math.max(0, Math.round(n(query.minVol)!)) : undefined,
    maxVolume: n(query.maxVol) != null ? Math.max(0, Math.round(n(query.maxVol)!)) : undefined,
    minCpc: n(query.minCpc) != null ? Math.max(0, n(query.minCpc)!) : undefined,
    maxCpc: n(query.maxCpc) != null ? Math.max(0, n(query.maxCpc)!) : undefined,
    minDifficulty: clampKd(query.minKd),
    maxDifficulty: clampKd(query.maxKd),
    tagIds: query.tags,
    page: query.page,
    pageSize: query.size,
    sort: query.sort,
    order: query.order,
  });

  return (
    <PageContainer>
      <PageHeader
        eyebrow="SEO"
        title="Saved Keywords"
        description="Save keyword ideas from research, organize them with tags, and revisit when you're ready to act."
      />
      {!info.configured && <DataForSeoBanner isAdmin={info.isAdmin} />}
      <SavedKeywordsView info={clientPageInfo(info)} query={query} rows={data.rows} totalCount={data.totalCount} tags={data.tags} />
    </PageContainer>
  );
}
