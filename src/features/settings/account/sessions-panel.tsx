"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { LaptopMinimal, LogOut, MonitorSmartphone, ShieldCheck, Smartphone, Tablet } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/app/page";
import { ConfirmButton, TimeAgo } from "@/components/app/misc";
import { cn } from "@/lib/utils";
import { revokeMySessionAction, signOutOtherDevicesAction } from "../actions";

export type SessionItem = {
  id: string;
  deviceLabel: string | null;
  userAgent: string | null;
  ip: string | null;
  lastSeenAt: string;
  createdAt: string;
  expiresAt: string;
};

function DeviceIcon({ label, ua }: { label: string | null; ua: string | null }) {
  const s = `${label ?? ""} ${ua ?? ""}`;
  const Icon = /iPad|Tablet/i.test(s) ? Tablet : /iOS|iPhone|Android|Mobile/i.test(s) ? Smartphone : /macOS|Windows|Linux/i.test(s) ? LaptopMinimal : MonitorSmartphone;
  return <Icon className="size-4" />;
}

export function SessionsPanel({
  sessions: initial,
  currentSessionId,
  sessionDays,
}: {
  sessions: SessionItem[];
  currentSessionId: string;
  sessionDays: number;
}) {
  const [sessions, setSessions] = useState(initial);
  const others = sessions.filter((s) => s.id !== currentSessionId);
  const ordered = [...sessions].sort((a, b) =>
    a.id === currentSessionId ? -1 : b.id === currentSessionId ? 1 : +new Date(b.lastSeenAt) - +new Date(a.lastSeenAt),
  );

  return (
    <Panel
      title="Active sessions"
      icon={<ShieldCheck className="size-4 text-brand" />}
      description={`You stay signed in for ${sessionDays} days per device and can use as many devices as you like.`}
      actions={
        others.length > 0 && (
          <ConfirmButton
            title="Sign out all other devices?"
            description={`${others.length} other ${others.length === 1 ? "session" : "sessions"} will be signed out immediately. This device stays signed in.`}
            confirmLabel="Sign out others"
            destructive
            onConfirm={async () => {
              const res = await signOutOtherDevicesAction();
              if (!res.ok) return void toast.error(res.error);
              setSessions((s) => s.filter((x) => x.id === currentSessionId));
              toast.success(`Signed out ${res.data.revoked} other ${res.data.revoked === 1 ? "device" : "devices"}`);
            }}
          >
            <Button variant="outline" size="sm" className="gap-1.5">
              <LogOut className="size-3.5" /> Sign out other devices
            </Button>
          </ConfirmButton>
        )
      }
      contentClassName="p-0 sm:p-0"
    >
      <ul className="divide-y">
        <AnimatePresence initial={false}>
          {ordered.map((s) => {
            const current = s.id === currentSessionId;
            return (
              <motion.li
                key={s.id}
                layout
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-3 px-4 py-3 sm:px-5"
              >
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-xl border",
                    current ? "border-brand/30 bg-brand-soft text-brand" : "bg-muted/60 text-muted-foreground",
                  )}
                >
                  <DeviceIcon label={s.deviceLabel} ua={s.userAgent} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{s.deviceLabel ?? "Unknown device"}</span>
                    {current && (
                      <Badge className="h-5 bg-brand text-[10px] text-brand-foreground">This device</Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span className="tabular">{s.ip ?? "IP unknown"}</span>
                    <span aria-hidden>·</span>
                    <span>
                      Active <TimeAgo date={s.lastSeenAt} />
                    </span>
                    <span aria-hidden className="hidden sm:inline">·</span>
                    <span className="hidden sm:inline">
                      Signed in <TimeAgo date={s.createdAt} />
                    </span>
                  </div>
                </div>
                {!current && (
                  <ConfirmButton
                    title="Revoke this session?"
                    description={`${s.deviceLabel ?? "This device"} will be signed out and needs a new magic link to sign in again.`}
                    confirmLabel="Revoke"
                    destructive
                    onConfirm={async () => {
                      const res = await revokeMySessionAction(s.id);
                      if (!res.ok) return void toast.error(res.error);
                      setSessions((list) => list.filter((x) => x.id !== s.id));
                      toast.success("Session revoked");
                    }}
                  >
                    <Button variant="ghost" size="sm" className="shrink-0 text-muted-foreground hover:text-destructive">
                      Revoke
                    </Button>
                  </ConfirmButton>
                )}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </Panel>
  );
}
