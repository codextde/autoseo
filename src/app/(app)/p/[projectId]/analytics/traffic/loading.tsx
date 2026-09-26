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
      <div className="flex gap-2">
        <Skeleton className="h-8 w-48 rounded-lg" />
        <Skeleton className="h-8 w-32 rounded-lg" />
      </div>
      <Skeleton className="h-[400px] w-full rounded-2xl" />
      <Skeleton className="h-[380px] w-full rounded-2xl" />
      <Skeleton className="h-[420px] w-full rounded-2xl" />
    </PageContainer>
  );
}
