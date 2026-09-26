"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Home, RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/app/misc";
import { StatusScreen } from "@/features/admin/components/system-status-screen";

/** Errors in settings/admin pages keep the app shell mounted. */
export default function GlobalSectionError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <StatusScreen
      inline
      tone="destructive"
      icon={<TriangleAlert className="size-5" />}
      title="This page failed to load"
      description="Something went wrong while loading this view. Try again — if it keeps happening, share the reference below with your admin."
      actions={
        <>
          <Button asChild variant="outline" size="lg" className="h-10 px-4">
            <Link href="/">
              <Home className="size-4" /> Go to dashboard
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
