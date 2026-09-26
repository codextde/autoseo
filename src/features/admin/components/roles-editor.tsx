"use client";

import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import { motion } from "motion/react";
import { Copy, Lock, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Panel } from "@/components/app/page";
import { PERMISSIONS, type Permission } from "@/server/auth/permissions";
import { cn } from "@/lib/utils";
import { OWNER_LOCKED, type RoleItem } from "../roles-shared";
import { SaveBar } from "./settings-kit";
import { createRoleAction, deleteRoleAction, resetRoleAction, saveRolesAction } from "../actions/roles";

type Edit = { name?: string; description?: string | null; permissions?: Permission[]; allProjects?: boolean };

const GROUPS = (() => {
  const map = new Map<string, Permission[]>();
  for (const [key, meta] of Object.entries(PERMISSIONS) as [Permission, (typeof PERMISSIONS)[Permission]][]) {
    map.set(meta.group, [...(map.get(meta.group) ?? []), key]);
  }
  return [...map.entries()];
})();

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

export function RolesEditor({ initialRoles }: { initialRoles: RoleItem[] }) {
  const [roles, setRoles] = useState(initialRoles);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [saving, setSaving] = useState(false);
  const [mobileRole, setMobileRole] = useState(initialRoles[0]?.key ?? "");
  const [createOpen, setCreateOpen] = useState<null | { copyFrom?: RoleItem }>(null);
  const [renameRole, setRenameRole] = useState<RoleItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoleItem | null>(null);

  const effective = useMemo(
    () =>
      roles.map((r) => {
        const e = edits[r.key];
        return e ? { ...r, ...e, permissions: e.permissions ?? r.permissions } : r;
      }),
    [roles, edits],
  );

  const changed = useMemo(
    () =>
      effective.filter((r) => {
        const orig = roles.find((o) => o.key === r.key)!;
        return (
          r.name !== orig.name ||
          (r.description ?? "") !== (orig.description ?? "") ||
          r.allProjects !== orig.allProjects ||
          !sameSet(r.permissions, orig.permissions)
        );
      }),
    [effective, roles],
  );

  const patch = (key: string, e: Edit) => setEdits((prev) => ({ ...prev, [key]: { ...prev[key], ...e } }));

  const toggle = (role: RoleItem, perm: Permission, value: boolean) => {
    if (perm === "projects.all") {
      const perms = value ? [...new Set([...role.permissions, perm])] : role.permissions.filter((p) => p !== perm);
      patch(role.key, { permissions: perms, allProjects: value });
      return;
    }
    const perms = value ? [...new Set([...role.permissions, perm])] : role.permissions.filter((p) => p !== perm);
    patch(role.key, { permissions: perms });
  };

  const has = (role: RoleItem, perm: Permission) =>
    perm === "projects.all" ? role.allProjects || role.permissions.includes(perm) : role.permissions.includes(perm);
  const locked = (role: RoleItem, perm: Permission) => role.key === "owner" && (OWNER_LOCKED.includes(perm) || perm === "projects.all");

  const save = async () => {
    setSaving(true);
    try {
      const res = await saveRolesAction(
        changed.map((r) => ({ key: r.key, name: r.name, description: r.description, permissions: r.permissions, allProjects: r.allProjects })),
      );
      if (!res.ok) return void toast.error(res.error);
      setRoles(res.data);
      setEdits({});
      toast.success("Roles saved");
    } finally {
      setSaving(false);
    }
  };

  /** Replaces the role list from the server; unsaved edits of other roles are kept. */
  const applyServer = (data: RoleItem[], clearKeys: string[] = []) => {
    setRoles(data);
    setEdits((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !clearKeys.includes(k) && data.some((r) => r.key === k))));
  };

  const cell = (role: RoleItem, perm: Permission) => {
    const isLocked = locked(role, perm);
    const checked = has(role, perm);
    const box = (
      <span className="inline-flex items-center justify-center">
        <Checkbox
          checked={checked}
          disabled={isLocked}
          onCheckedChange={(v) => toggle(role, perm, v === true)}
          aria-label={`${PERMISSIONS[perm].label} for ${role.name}`}
          className="size-[18px]"
        />
      </span>
    );
    if (perm === "projects.all") {
      return (
        <div className="flex flex-col items-center gap-1">
          {box}
          {!checked && <span className="text-[10px] whitespace-nowrap text-muted-foreground">Selected only</span>}
        </div>
      );
    }
    return isLocked ? (
      <Tooltip>
        <TooltipTrigger asChild>{box}</TooltipTrigger>
        <TooltipContent>The Owner role always keeps this permission.</TooltipContent>
      </Tooltip>
    ) : (
      box
    );
  };

  const roleMenu = (role: RoleItem) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-6" aria-label={`${role.name} actions`}>
          <MoreHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={() => setRenameRole(role)}>
          <Pencil /> Rename & describe
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setCreateOpen({ copyFrom: role })}>
          <Copy /> Duplicate
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {role.builtin ? (
          <DropdownMenuItem
            onSelect={async () => {
              const res = await resetRoleAction(role.key);
              if (!res.ok) return void toast.error(res.error);
              applyServer(res.data, [role.key]);
              toast.success(`${role.name} reset to defaults`);
            }}
          >
            <RotateCcw /> Reset to defaults
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleteTarget(role)}>
            <Trash2 /> Delete role
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const mobile = effective.find((r) => r.key === mobileRole) ?? effective[0];

  return (
    <>
      <Panel
        title="Permission matrix"
        description="Toggle what each role can do. Changes apply to every member with that role in all workspaces."
        actions={
          <Button size="sm" className="h-8 gap-1.5" onClick={() => setCreateOpen({})}>
            <Plus className="size-3.5" /> New role
          </Button>
        }
        contentClassName="p-0 sm:p-0"
      >
        {/* Desktop / tablet matrix */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="sticky left-0 z-[1] min-w-64 bg-muted/40 px-4 py-3 text-left text-xs font-medium text-muted-foreground backdrop-blur">
                  Permission
                </th>
                {effective.map((r) => (
                  <th key={r.key} className="min-w-32 px-3 py-3 text-center align-top">
                    <div className="flex items-center justify-center gap-1">
                      <span className="max-w-32 truncate text-sm font-semibold">{r.name}</span>
                      {roleMenu(r)}
                    </div>
                    <div className="mt-1 flex items-center justify-center gap-1.5 text-[11px] font-normal text-muted-foreground">
                      <span className="inline-flex items-center gap-0.5">
                        <Users className="size-3" /> {r.members}
                      </span>
                      {r.builtin ? (
                        <Badge variant="outline" className="h-4 px-1 text-[9px]">
                          Built-in
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="h-4 bg-brand-soft px-1 text-[9px] text-brand">
                          Custom
                        </Badge>
                      )}
                      {changed.some((c) => c.key === r.key) && <span className="size-1.5 rounded-full bg-warning" title="Unsaved changes" />}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {GROUPS.map(([group, perms]) => (
                <Fragment key={group}>
                  <tr className="border-b bg-background">
                    <td colSpan={effective.length + 1} className="px-4 pt-4 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                      {group}
                    </td>
                  </tr>
                  {perms.map((perm) => (
                    <tr key={perm} className="border-b transition-colors last:border-0 hover:bg-muted/30">
                      <td className="sticky left-0 z-[1] bg-card px-4 py-2.5">
                        <div className="text-sm">{PERMISSIONS[perm].label}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{perm}</div>
                      </td>
                      {effective.map((r) => (
                        <td key={r.key} className="px-3 py-2.5 text-center">
                          {cell(r, perm)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile: role picker + switches */}
        <div className="space-y-3 p-3 md:hidden">
          <div className="scrollbar-none -mx-3 flex gap-1.5 overflow-x-auto px-3">
            {effective.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setMobileRole(r.key)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium",
                  mobile?.key === r.key ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground",
                )}
              >
                {r.name}
                <span className="opacity-60">{r.members}</span>
              </button>
            ))}
          </div>
          {mobile && (
            <motion.div key={mobile.key} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
              <div className="flex items-start justify-between gap-2 rounded-xl bg-muted/40 p-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{mobile.name}</div>
                  <p className="text-xs text-muted-foreground">{mobile.description || "No description"}</p>
                </div>
                {roleMenu(mobile)}
              </div>
              {GROUPS.map(([group, perms]) => (
                <div key={group}>
                  <div className="px-1 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{group}</div>
                  <ul className="divide-y rounded-xl border">
                    {perms.map((perm) => (
                      <li key={perm} className="flex items-center justify-between gap-3 p-3">
                        <span className="min-w-0 text-sm">
                          {PERMISSIONS[perm].label}
                          {locked(mobile, perm) && <Lock className="ml-1 inline size-3 text-muted-foreground" />}
                        </span>
                        <Switch checked={has(mobile, perm)} disabled={locked(mobile, perm)} onCheckedChange={(v) => toggle(mobile, perm, v)} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </motion.div>
          )}
        </div>
      </Panel>

      <SaveBar dirty={changed.length > 0} saving={saving} onSave={save} onReset={() => setEdits({})} count={changed.length} />

      <CreateRoleDialog
        state={createOpen}
        roles={effective}
        onClose={() => setCreateOpen(null)}
        onCreated={(data) => applyServer(data)}
      />
      <RenameDialog
        role={renameRole}
        onClose={() => setRenameRole(null)}
        onApply={(name, description) => {
          if (renameRole) patch(renameRole.key, { name, description });
          setRenameRole(null);
        }}
      />
      <DeleteRoleDialog
        role={deleteTarget}
        roles={effective}
        onClose={() => setDeleteTarget(null)}
        onDeleted={(data) => applyServer(data, deleteTarget ? [deleteTarget.key] : [])}
      />
    </>
  );
}

function CreateRoleDialog({
  state,
  roles,
  onClose,
  onCreated,
}: {
  state: null | { copyFrom?: RoleItem };
  roles: RoleItem[];
  onClose: () => void;
  onCreated: (roles: RoleItem[]) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [copyFrom, setCopyFrom] = useState<string>("member");
  const [allProjects, setAllProjects] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastState, setLastState] = useState(state);
  if (state !== lastState) {
    setLastState(state);
    if (state) {
      setName(state.copyFrom ? `${state.copyFrom.name} (copy)` : "");
      setDescription(state.copyFrom?.description ?? "");
      setCopyFrom(state.copyFrom?.key ?? "member");
      setAllProjects(state.copyFrom?.allProjects ?? false);
    }
  }
  const source = roles.find((r) => r.key === copyFrom);
  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New role</DialogTitle>
          <DialogDescription>Start from an existing role&apos;s permissions, then fine-tune them in the matrix.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="role-name">Name</Label>
            <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Content editor" maxLength={60} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role-desc">Description</Label>
            <Textarea id="role-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={300} />
          </div>
          <div className="space-y-1.5">
            <Label>Copy permissions from</Label>
            <Select
              value={copyFrom}
              onValueChange={(v) => {
                setCopyFrom(v);
                setAllProjects(roles.find((r) => r.key === v)?.allProjects ?? false);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.key} value={r.key}>
                    {r.name} · {r.permissions.length} permissions
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
            <div>
              <div className="text-sm font-medium">Access all projects</div>
              <div className="text-xs text-muted-foreground">Otherwise members only see projects they are given.</div>
            </div>
            <Switch checked={allProjects} onCheckedChange={setAllProjects} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || busy}
            onClick={async () => {
              setBusy(true);
              const perms = (source?.permissions ?? []).filter((p) => p !== "projects.all" && p !== "admin.access");
              const res = await createRoleAction({
                name,
                description: description || null,
                permissions: allProjects ? [...perms, "projects.all"] : perms,
                allProjects,
              });
              setBusy(false);
              if (!res.ok) return void toast.error(res.error);
              toast.success(`Role “${name}” created`);
              onCreated(res.data.roles);
              onClose();
            }}
          >
            Create role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog({
  role,
  onClose,
  onApply,
}: {
  role: RoleItem | null;
  onClose: () => void;
  onApply: (name: string, description: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [last, setLast] = useState<RoleItem | null>(null);
  if (role !== last) {
    setLast(role);
    if (role) {
      setName(role.name);
      setDescription(role.description ?? "");
    }
  }
  return (
    <Dialog open={!!role} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename role</DialogTitle>
          <DialogDescription>The key “{role?.key}” stays the same, so existing members keep this role.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="rename-name">Name</Label>
            <Input id="rename-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rename-desc">Description</Label>
            <Textarea id="rename-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={300} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!name.trim()} onClick={() => onApply(name.trim(), description.trim() || null)}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteRoleDialog({
  role,
  roles,
  onClose,
  onDeleted,
}: {
  role: RoleItem | null;
  roles: RoleItem[];
  onClose: () => void;
  onDeleted: (roles: RoleItem[]) => void;
}) {
  const [target, setTarget] = useState("member");
  const [busy, setBusy] = useState(false);
  const options = roles.filter((r) => r.key !== role?.key);
  return (
    <Dialog open={!!role} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete “{role?.name}”?</DialogTitle>
          <DialogDescription>
            {role?.members
              ? `${role.members} member${role.members > 1 ? "s" : ""} and pending invitations with this role will be moved to another role.`
              : "Nobody has this role right now."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>Move members to</Label>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((r) => (
                <SelectItem key={r.key} value={r.key}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy || !role}
            onClick={async () => {
              if (!role) return;
              setBusy(true);
              const res = await deleteRoleAction(role.key, target);
              setBusy(false);
              if (!res.ok) return void toast.error(res.error);
              toast.success("Role deleted");
              onDeleted(res.data);
              onClose();
            }}
          >
            Delete role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
