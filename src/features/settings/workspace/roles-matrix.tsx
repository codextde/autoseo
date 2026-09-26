import Link from "next/link";
import { Check, Minus, ShieldCheck } from "lucide-react";
import { Panel } from "@/components/app/page";
import { PERMISSIONS, type Permission } from "@/server/auth/permissions";
import { cn } from "@/lib/utils";
import type { RoleInfo } from "./queries";

/** Read-only Roles & Permissions matrix (finseo Workspace → Roles & Permissions). */
export function RolesMatrix({ roles, currentRoleKey, isAdmin }: { roles: RoleInfo[]; currentRoleKey?: string | null; isAdmin: boolean }) {
  const groups = new Map<string, Permission[]>();
  for (const [key, meta] of Object.entries(PERMISSIONS) as [Permission, (typeof PERMISSIONS)[Permission]][]) {
    groups.set(meta.group, [...(groups.get(meta.group) ?? []), key]);
  }
  return (
    <Panel
      title="Roles & permissions"
      icon={<ShieldCheck className="size-4 text-muted-foreground" />}
      description={
        isAdmin ? (
          <>
            What each role can do. Edit roles in <Link href="/admin/roles" className="underline underline-offset-2">Admin → Roles & Permissions</Link>.
          </>
        ) : (
          "What each role can do. Roles are managed by your instance administrator."
        )
      }
      contentClassName="p-0 sm:p-0"
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
              <th className="sticky left-0 z-[1] bg-muted px-4 py-2.5 text-left font-medium sm:px-5">Permission</th>
              {roles.map((r) => (
                <th key={r.key} className="px-3 py-2.5 text-center font-medium whitespace-nowrap">
                  <span className={cn(r.key === currentRoleKey && "rounded-full bg-foreground px-2 py-0.5 text-background")}>{r.name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...groups.entries()].map(([group, perms]) => (
              <GroupRows key={group} group={group} perms={perms} roles={roles} />
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function GroupRows({ group, perms, roles }: { group: string; perms: Permission[]; roles: RoleInfo[] }) {
  return (
    <>
      <tr className="border-b bg-muted/20">
        <td colSpan={roles.length + 1} className="px-4 pt-3 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase sm:px-5">
          {group}
        </td>
      </tr>
      {perms.map((p) => (
        <tr key={p} className="border-b last:border-0 hover:bg-muted/30">
          <td className="sticky left-0 z-[1] max-w-72 bg-card px-4 py-2.5 sm:px-5">{PERMISSIONS[p].label}</td>
          {roles.map((r) => {
            const has = r.permissions.includes(p) || (p === "projects.all" && r.allProjects);
            const selectedOnly = p === "projects.all" && !has;
            return (
              <td key={r.key} className="px-3 py-2.5 text-center">
                {has ? (
                  <Check className="mx-auto size-4 text-brand" aria-label="Yes" />
                ) : selectedOnly && r.permissions.includes("project.view") ? (
                  <span className="text-xs whitespace-nowrap text-muted-foreground">Selected only</span>
                ) : (
                  <Minus className="mx-auto size-4 text-muted-foreground/40" aria-label="No" />
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
