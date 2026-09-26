"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Home, RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/app/misc";
import { StatusScreen } from "@/features/admin/components/system-status-screen";

/** Errors inside a project page keep the sidebar/topbar (the project layout stays mounted). */
export default function ProjectError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const params = useParams<{ projectId: string }>();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <StatusScreen
      inline
      tone="destructive"
      icon={<TriangleAlert className="size-5" />}
      title="This page failed to load"
      description="Something went wrong while loading this view. Your data is safe — try again or go back to the project overview."
      actions={
        <>
          <Button asChild variant="outline" size="lg" className="h-10 px-4">
            <Link href={params?.projectId ? `/p/${params.projectId}` : "/"}>
              <Home className="size-4" /> Project home
            </Link>
          </Button>
          <Button size="lg" className="h-10 px-4" onClick={() => retry()}>
            <RotateCcw className="size-4" /> Try again
          </Button>
        </>
      }
      footer={
        error.digest ? (
          <span className="inline-flex items-center gap-1 rounded-lg border bg-card px-2 py-1 font-mono">
            Reference {error.digest}
            <CopyButton value={error.digest} size="icon" className="size-6" />
          </span>
        ) : null
      }
    />
  );
}
