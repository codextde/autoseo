"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PeriodFilter } from "@/features/analytics/components/shared";
import { UploadLogsButton } from "./upload-dialog";

export function BotToolbar({
  projectId,
  preset,
  from,
  to,
  canUpload,
}: {
  projectId: string;
  preset: string;
  from: string;
  to: string;
  canUpload: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <PeriodFilter preset={preset} from={from} to={to} />
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        aria-label="Refresh"
        disabled={pending}
        onClick={() => start(() => router.refresh())}
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
      </Button>
      {canUpload && <UploadLogsButton projectId={projectId} />}
    </div>
  );
}
