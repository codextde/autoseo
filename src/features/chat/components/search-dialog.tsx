"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Pin } from "lucide-react";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { searchChatsRequest } from "../lib/client";
import type { ChatSearchHit } from "../types";

function relative(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Command dialog searching chat titles and message contents (server-side). */
export function ChatSearchDialog({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ChatSearchHit[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        setHits(await searchChatsRequest(projectId, q, ac.signal));
      } catch {
        if (!ac.signal.aborted) setHits([]);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    }, q ? 200 : 0);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [open, q, projectId]);

  const go = (id: string) => {
    onOpenChange(false);
    setQ("");
    router.push(`/p/${projectId}/agent/c/${id}`);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search chats" description="Search your chats by title or content">
      <Command shouldFilter={false}>
        <CommandInput placeholder="Search chats…" value={q} onValueChange={setQ} />
        <CommandList className="max-h-[min(60vh,420px)]">
          <CommandEmpty>{loading ? "Searching…" : q ? "No chats match your search." : "No chats yet."}</CommandEmpty>
          {hits && hits.length > 0 && (
            <CommandGroup heading={q ? "Results" : "Recent chats"}>
              {hits.map((h) => (
                <CommandItem key={h.id} value={h.id} onSelect={() => go(h.id)} className="items-start gap-2.5 py-2">
                  {h.pinned ? <Pin className="mt-0.5 size-4 text-muted-foreground" /> : <MessageSquare className="mt-0.5 size-4 text-muted-foreground" />}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{h.title}</span>
                    {h.snippet && <span className="line-clamp-2 text-xs text-muted-foreground">{h.snippet}</span>}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground tabular">{relative(h.lastMessageAt)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
