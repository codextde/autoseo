"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, GitCompare, Loader2, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/app/misc";
import { startAuditAction } from "../actions";
import { hostOf } from "./bits";

export function AuditHeader({
  projectId,
  audit,
  previousId,
  canRun,
  showExport,
}: {
  projectId: string;
  audit: { id: string; startUrl: string; status: string; startedAt: string; completedAt: string | null; maxPages: number; lighthouse: boolean; provider: "psi" | "dataforseo"; trigger: string };
  previousId: string | null;
  canRun: boolean;
  showExport: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const base = `/p/${projectId}/seo/audit/${audit.id}`;
  const running = audit.status === "running" || audit.status === "queued";

  const rerun = () =>
    start(async () => {
      const res = await startAuditAction(projectId, { startUrl: audit.startUrl, maxPages: audit.maxPages, lighthouse: audit.lighthouse, lighthouseProvider: audit.provider });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Audit started");
      router.push(`/p/${projectId}/seo/audit/${res.data.auditId}`);
    });

  return (
    <div className="space-y-3">
      <Link href={`/p/${projectId}/seo/audit`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> All audits
      </Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{hostOf(audit.startUrl)}</h1>
            {!running && (
              <StatusBadge
                status={audit.status === "completed" ? "completed" : audit.status === "cancelled" ? "cancelled" : "failed"}
                label={audit.status === "completed" ? "Done" : audit.status === "cancelled" ? "Cancelled" : "Failed"}
              />
            )}
          </div>
          <p className="text-sm text-muted-foreground tabular">
            Site audit · Started {format(new Date(audit.startedAt), "MMM d, yyyy · HH:mm")}
            {audit.completedAt && ` · took ${Math.max(1, Math.round((new Date(audit.completedAt).getTime() - new Date(audit.startedAt).getTime()) / 60000))} min`}
            {audit.trigger !== "manual" && ` · ${audit.trigger}`}
          </p>
        </div>
        {!running && (
          <div className="flex flex-wrap items-center gap-2">
            {previousId && audit.status === "completed" && (
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <Link href={`/p/${projectId}/seo/audit/compare?a=${previousId}&b=${audit.id}`}>
                  <GitCompare className="size-3.5" /> Compare
                </Link>
              </Button>
            )}
            {showExport && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <Download className="size-3.5" /> Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {(["issues", "pages", "performance"] as const).map((kind, i) => (
                    <div key={kind}>
                      {i > 0 && <DropdownMenuSeparator />}
                      <DropdownMenuLabel className="text-xs capitalize">{kind}</DropdownMenuLabel>
                      <DropdownMenuItem asChild>
                        <a href={`${base}/export?kind=${kind}&format=csv`}>CSV</a>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <a href={`${base}/export?kind=${kind}&format=json`}>JSON</a>
                      </DropdownMenuItem>
                    </div>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {canRun && (
              <Button size="sm" className="gap-1.5" onClick={rerun} disabled={pending}>
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />} Re-run
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
