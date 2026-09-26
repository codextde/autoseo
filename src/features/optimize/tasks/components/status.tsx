"use client";

import { ChevronDown, Circle, CircleCheck, CircleDashed, CircleX } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TASK_STATUS_META, type TaskStatusKey } from "@/features/optimize/constants";
import { cn } from "@/lib/utils";

const ICONS = { open: Circle, in_progress: CircleDashed, done: CircleCheck, dismissed: CircleX } as const;
const TONES = {
  open: "text-foreground bg-muted ring-border",
  in_progress: "text-info bg-info/12 ring-info/25",
  done: "text-success bg-success/12 ring-success/25",
  dismissed: "text-muted-foreground bg-muted ring-border",
} as const;

export function StatusPill({ status, className }: { status: TaskStatusKey; className?: string }) {
  const Icon = ICONS[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TONES[status], className)}>
      <Icon className="size-3" />
      {TASK_STATUS_META[status].label}
    </span>
  );
}

export function StatusMenu({ value, onChange, disabled }: { value: TaskStatusKey; onChange: (s: TaskStatusKey) => void; disabled?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" className="inline-flex items-center gap-0.5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <StatusPill status={value} />
          <ChevronDown className="size-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {(Object.keys(TASK_STATUS_META) as TaskStatusKey[]).map((s) => (
          <DropdownMenuItem key={s} onClick={() => s !== value && onChange(s)}>
            <StatusPill status={s} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
