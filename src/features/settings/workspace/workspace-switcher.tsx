"use client";

import { useRouter, usePathname } from "next/navigation";
import { Building2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Workspace selector for settings pages (`?ws=`), shown when the user belongs to several workspaces. */
export function WorkspaceSwitcher({
  workspaces,
  current,
}: {
  workspaces: { id: string; name: string; roleName?: string }[];
  current: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  if (workspaces.length < 2) return null;
  return (
    <Select value={current} onValueChange={(v) => router.push(`${pathname}?ws=${encodeURIComponent(v)}`)}>
      <SelectTrigger className="h-8 w-full bg-background sm:w-64">
        <Building2 className="size-3.5 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {workspaces.map((w) => (
          <SelectItem key={w.id} value={w.id}>
            {w.name}
            {w.roleName && <span className="text-xs text-muted-foreground">· {w.roleName}</span>}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
