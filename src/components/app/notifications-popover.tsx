"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { listNotificationsAction, markNotificationsReadAction } from "@/features/shell/actions";

type N = { id: string; title: string; body: string | null; href: string | null; readAt: Date | null; createdAt: Date };

export function NotificationsPopover() {
  const [items, setItems] = useState<N[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    void listNotificationsAction().then((r) => r.ok && setItems(r.data as N[]));
  }, [open]);
  const unread = items.filter((n) => !n.readAt).length;
  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v && unread) void markNotificationsReadAction().then(() => setItems((i) => i.map((n) => ({ ...n, readAt: new Date() }))));
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative size-9" aria-label="Notifications">
          <Bell className="size-[18px]" />
          {unread > 0 && <span className="absolute top-2 right-2 size-2 rounded-full bg-brand ring-2 ring-background" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-4 py-3 text-sm font-medium">Notifications</div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
          ) : (
            items.map((n) => {
              const body = (
                <div className="space-y-0.5 px-4 py-3 hover:bg-muted/50">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {!n.readAt && <span className="size-1.5 rounded-full bg-brand" />}
                    {n.title}
                  </div>
                  {n.body && <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>}
                  <p className="text-[11px] text-muted-foreground">{formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}</p>
                </div>
              );
              return n.href ? (
                <Link key={n.id} href={n.href} onClick={() => setOpen(false)} className="block border-b last:border-0">
                  {body}
                </Link>
              ) : (
                <div key={n.id} className="border-b last:border-0">
                  {body}
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
