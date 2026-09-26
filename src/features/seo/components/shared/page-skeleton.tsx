import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer } from "@/components/app/page";

/** Route-level loading UI for SEO pages (enables partial prefetch + instant navigation). */
export function SeoPageSkeleton({ cards = 0, rows = 8 }: { cards?: number; rows?: number }) {
  return (
    <PageContainer>
      <div className="space-y-2">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-16 w-full rounded-2xl" />
      {cards > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: cards }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      )}
      <div className="space-y-2 rounded-2xl border bg-card p-4">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </PageContainer>
  );
}
