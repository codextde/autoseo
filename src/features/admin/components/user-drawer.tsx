"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";
import {
  Ban,
  Building2,
  Clock,
  Laptop,
  Loader2,
  LogOut,
  MonitorSmartphone,
  ShieldCheck,
  Smartphone,
  UserCheck,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultiSelect } from "@/components/app/filters";
import { ConfirmButton, StatusBadge, TimeAgo } from "@/components/app/misc";
import { cn } from "@/lib/utils";
import { auditActionLabel } from "../audit-labels";
import {
  getUserDetailAction,
  revokeAllUserSessionsAction,
  revokeUserSessionAction,
  setUserMembershipAction,
  setUserProjectAccessAction,
  updateUserAction,
} from "../actions/users";
import { UserAvatar } from "./user-avatar";
import { EraseUserDialog } from "./erase-user-dialog";

export type RoleOption = { key: string; name: string; allProjects: boolean };

type Detail = Extract<
  Awaited<ReturnType<typeof getUserDetailAction>>,
  { ok: true }
>["data"];

function DeviceIcon({ label }: { label: string | null }) {
  const Icon = /iOS|Android/.test(label ?? "") ? Smartphone : Laptop;
  return <Icon className="size-4 text-muted-foreground" />;
}

function Section({
  title,
  description,
  children,
  right,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <section className="space-y-3 border-t px-4 py-4 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function UserDrawer({
  userId,
  onClose,
  roles,
  currentUserId,
}: {
  userId: string | null;
  onClose: () => void;
  roles: RoleOption[];
  currentUserId: string;
}) {
  return (
    <Sheet open={!!userId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl"
      >
        {userId ? (
          <UserDrawerBody
            key={userId}
            userId={userId}
            onClose={onClose}
            roles={roles}
            currentUserId={currentUserId}
          />
        ) : (
          <SheetTitle className="sr-only">User details</SheetTitle>
        )}
      </SheetContent>
    </Sheet>
  );
}

function UserDrawerBody({
  userId,
  onClose,
  roles,
  currentUserId,
}: {
  userId: string;
  onClose: () => void;
  roles: RoleOption[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const apply = useCallback(
    (res: Awaited<ReturnType<typeof getUserDetailAction>>) => {
      if (res.ok) {
        setDetail(res.data);
        setError(null);
      } else setError(res.error);
    },
    [],
  );

  useEffect(() => {
    let alive = true;
    getUserDetailAction(userId).then((res) => alive && apply(res));
    return () => {
      alive = false;
    };
  }, [userId, apply]);

  const run = async (
    key: string,
    fn: () => Promise<
      { ok: true; data: unknown } | { ok: false; error: string }
    >,
    success?: string,
  ) => {
    setBusy(key);
    try {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error);
        return false;
      }
      if (success) toast.success(success);
      apply(await getUserDetailAction(userId));
      router.refresh();
      return true;
    } finally {
      setBusy(null);
    }
  };

  const u = detail?.user;
  const isSelf = u?.id === currentUserId;

  return (
    <>
      <SheetHeader className="px-4 pt-5 pb-4 sm:px-5">
        {u ? (
          <div className="flex items-center gap-3 pr-8">
            <UserAvatar
              name={u.name}
              email={u.email}
              src={u.avatarUrl}
              size="lg"
            />
            <div className="min-w-0">
              <SheetTitle className="flex flex-wrap items-center gap-2 text-base">
                <span className="truncate">
                  {u.name || u.email.split("@")[0]}
                </span>
                <StatusBadge status={u.status} />
                {u.isInstanceAdmin && (
                  <Badge
                    variant="secondary"
                    className="h-5 gap-1 px-1.5 text-[10px]"
                  >
                    <ShieldCheck className="size-3" /> Instance admin
                  </Badge>
                )}
              </SheetTitle>
              <SheetDescription className="truncate">
                {u.email}
              </SheetDescription>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Joined <TimeAgo date={u.createdAt} /> · Last sign-in{" "}
                {u.lastLoginAt ? <TimeAgo date={u.lastLoginAt} /> : "never"}
              </p>
            </div>
          </div>
        ) : (
          <>
            <SheetTitle className="sr-only">User details</SheetTitle>
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
            </div>
          </>
        )}
      </SheetHeader>

      {error && <p className="px-5 pb-4 text-sm text-destructive">{error}</p>}

      <AnimatePresence mode="wait">
        {detail && u && (
          <motion.div
            key={u.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="pb-8"
          >
            <Section
              title="Access"
              description="Disabled users are signed out and can't sign in again."
            >
              <div className="divide-y rounded-xl border">
                <div className="flex items-center justify-between gap-3 p-3">
                  <div className="flex items-center gap-2.5">
                    {u.status === "active" ? (
                      <UserCheck className="size-4 text-success" />
                    ) : (
                      <Ban className="size-4 text-muted-foreground" />
                    )}
                    <div>
                      <div className="text-sm font-medium">Account active</div>
                      <div className="text-xs text-muted-foreground">
                        Allow this person to sign in
                      </div>
                    </div>
                  </div>
                  <Switch
                    checked={u.status === "active"}
                    disabled={isSelf || busy === "status"}
                    onCheckedChange={(v) =>
                      run(
                        "status",
                        () =>
                          updateUserAction(u.id, {
                            status: v ? "active" : "disabled",
                          }),
                        v ? "User enabled" : "User disabled and signed out",
                      )
                    }
                  />
                </div>
                <div className="flex items-center justify-between gap-3 p-3">
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck className="size-4 text-brand" />
                    <div>
                      <div className="text-sm font-medium">Instance admin</div>
                      <div className="text-xs text-muted-foreground">
                        Full access to this admin panel
                      </div>
                    </div>
                  </div>
                  <Switch
                    checked={u.isInstanceAdmin}
                    disabled={busy === "admin"}
                    onCheckedChange={(v) =>
                      run(
                        "admin",
                        () => updateUserAction(u.id, { isInstanceAdmin: v }),
                        v ? "Admin access granted" : "Admin access removed",
                      )
                    }
                  />
                </div>
              </div>
            </Section>

            <Section
              title="Workspaces"
              description="Role per workspace. Roles without “all projects” only see the projects you select."
            >
              <div className="space-y-2">
                {detail.workspaces.map((ws) => {
                  const role = roles.find((r) => r.key === ws.roleKey);
                  const selected = ws.projects
                    .filter((p) => p.hasAccess)
                    .map((p) => p.id);
                  return (
                    <div
                      key={ws.id}
                      className={cn(
                        "rounded-xl border p-3",
                        !ws.roleKey && "border-dashed bg-muted/20",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Building2 className="size-4 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {ws.name}
                        </span>
                        <Select
                          value={ws.roleKey ?? "__none"}
                          disabled={busy === `role:${ws.id}`}
                          onValueChange={(v) =>
                            run(
                              `role:${ws.id}`,
                              () =>
                                setUserMembershipAction(
                                  u.id,
                                  ws.id,
                                  v === "__none" ? null : v,
                                ),
                              v === "__none"
                                ? "Removed from workspace"
                                : "Role updated",
                            )
                          }
                        >
                          <SelectTrigger size="sm" className="h-8 w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">No access</SelectItem>
                            {roles.map((r) => (
                              <SelectItem key={r.key} value={r.key}>
                                {r.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {ws.roleKey && (
                        <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-6">
                          {role?.allProjects ? (
                            <span className="text-xs text-muted-foreground">
                              Access to all projects (current & future)
                            </span>
                          ) : ws.projects.length === 0 ? (
                            <span className="text-xs text-muted-foreground">
                              This workspace has no projects yet.
                            </span>
                          ) : (
                            <>
                              <span className="text-xs text-muted-foreground">
                                Projects
                              </span>
                              <MultiSelect
                                options={ws.projects.map((p) => ({
                                  value: p.id,
                                  label: `${p.name}${p.archived ? " (archived)" : ""}`,
                                }))}
                                value={selected}
                                onChange={(v) =>
                                  run(
                                    `projects:${ws.id}`,
                                    () =>
                                      setUserProjectAccessAction(
                                        u.id,
                                        ws.id,
                                        v,
                                      ),
                                    "Project access updated",
                                  )
                                }
                                placeholder="No projects"
                                label="Projects"
                                className="min-w-40"
                              />
                              {busy === `projects:${ws.id}` && (
                                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {detail.pendingInvites.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {detail.pendingInvites.length} pending invitation
                    {detail.pendingInvites.length > 1 ? "s" : ""} for this
                    address — see Invitations.
                  </p>
                )}
              </div>
            </Section>

            <Section
              title="Devices"
              description={`${detail.sessions.length} active session${detail.sessions.length === 1 ? "" : "s"} · sessions last up to a year`}
              right={
                detail.sessions.length > 0 && (
                  <ConfirmButton
                    title="Sign out everywhere?"
                    description={
                      isSelf
                        ? "All your other devices will be signed out. This device stays signed in."
                        : "This user will be signed out on all devices."
                    }
                    confirmLabel="Sign out"
                    destructive
                    onConfirm={async () => {
                      await run(
                        "all-sessions",
                        () => revokeAllUserSessionsAction(u.id),
                        "Signed out everywhere",
                      );
                    }}
                  >
                    <Button variant="outline" size="sm" className="h-7 gap-1.5">
                      <LogOut className="size-3.5" /> Sign out everywhere
                    </Button>
                  </ConfirmButton>
                )
              }
            >
              {detail.sessions.length === 0 ? (
                <div className="flex items-center gap-2 rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
                  <MonitorSmartphone className="size-4" /> Not signed in on any
                  device.
                </div>
              ) : (
                <ul className="divide-y rounded-xl border">
                  {detail.sessions.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 p-3">
                      <DeviceIcon label={s.deviceLabel} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {s.deviceLabel ?? "Unknown device"}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {s.ip ?? "IP unknown"} · active{" "}
                          <TimeAgo date={s.lastSeenAt} /> · since{" "}
                          {new Date(s.createdAt).toLocaleDateString("en-US", {
                            dateStyle: "medium",
                          })}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 shrink-0 text-muted-foreground hover:text-destructive"
                        disabled={busy === `s:${s.id}`}
                        onClick={() =>
                          run(
                            `s:${s.id}`,
                            () => revokeUserSessionAction(u.id, s.id),
                            "Session revoked",
                          )
                        }
                      >
                        {busy === `s:${s.id}` ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          "Revoke"
                        )}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Recent activity">
              {detail.recent.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No recorded activity.
                </p>
              ) : (
                <ul className="space-y-2">
                  {detail.recent.map((e) => (
                    <li key={e.id} className="flex items-start gap-2 text-sm">
                      <Clock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">
                        {auditActionLabel(e.action)}
                      </span>
                      <TimeAgo
                        date={e.createdAt}
                        className="shrink-0 text-xs text-muted-foreground"
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {!isSelf && (
              <Section title="Danger zone">
                <div className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 sm:flex-row sm:items-center">
                  <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                    Erase deletes the account and personal data (sessions, keys, chats, bookmarks…), anonymizes the audit trail and
                    keeps projects and reports for the team. You&apos;ll see a dry run first.
                  </p>
                  <EraseUserDialog
                    user={{ id: u.id, email: u.email, name: u.name }}
                    onErased={() => {
                      onClose();
                      router.refresh();
                    }}
                  />
                </div>
              </Section>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
