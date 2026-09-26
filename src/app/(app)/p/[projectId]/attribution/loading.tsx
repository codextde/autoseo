import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer } from "@/components/app/page";

export default function Loading() {
  return (
    <PageContainer>
      <div className="space-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <Skeleton className="h-10 w-full rounded-lg" />
      <Skeleton className="h-8 w-56 rounded-lg" />
      <Skeleton className="h-[340px] w-full rounded-2xl" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
      <Skeleton className="h-[420px] w-full rounded-2xl" />
    </PageContainer>
  );
}
