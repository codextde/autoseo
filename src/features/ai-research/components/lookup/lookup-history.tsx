"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { History, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/app/page";
import { StatusBadge, TimeAgo } from "@/components/app/misc";
import { cn } from "@/lib/utils";
import { deleteLookupAction } from "../../actions/lookup";
import type { LookupHistoryItem } from "../../types";

export function LookupHistory({
  projectId,
  items,
  activeId,
  onSelect,
  canDelete,
  title = "History",
  renderSub,
}: {
  projectId: string;
  items: LookupHistoryItem[];
  activeId: string | null;
  onSelect: (item: LookupHistoryItem) => void;
  canDelete: boolean;
  title?: string;
  renderSub?: (item: LookupHistoryItem) => React.ReactNode;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  return (
    <Panel title={title} icon={<History className="size-4 text-muted-foreground" />} contentClassName="p-2">
      {items.length === 0 ? (
        <p className="px-2 py-6 text-center text-sm text-muted-foreground">No lookups yet.</p>
      ) : (
        <ul className="max-h-[520px] space-y-0.5 overflow-y-auto">
          {items.map((h) => (
            <li key={h.id} className="group relative">
              <button
                type="button"
                onClick={() => onSelect(h)}
                className={cn("w-full rounded-lg px-2.5 py-2 pr-9 text-left hover:bg-muted/60", activeId === h.id && "bg-muted")}
              >
                <p className="line-clamp-2 text-sm font-medium">{h.query}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                  {h.status !== "done" && <StatusBadge status={h.status} className="py-0 text-[10px]" />}
                  <TimeAgo date={h.createdAt} />
                  {h.costUsd > 0 && <span className="tabular">${h.costUsd.toFixed(3)}</span>}
                  {h.createdByName && <span className="truncate">{h.createdByName}</span>}
                  {renderSub?.(h)}
                </div>
              </button>
              {canDelete && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="absolute top-2 right-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label="Delete from history"
                  onClick={() =>
                    start(async () => {
                      const res = await deleteLookupAction(projectId, h.id);
                      if (!res.ok) toast.error(res.error);
                      else router.refresh();
                    })
                  }
                >
                  <Trash2 className="size-3" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
