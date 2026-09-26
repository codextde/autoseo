"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { actionAdmin, ActionError, runAction } from "@/server/auth/guards";
import { MemberError } from "@/server/admin/members";
import { createRole, deleteRole, listRolesWithCounts, resetBuiltinRole, updateRoles } from "@/server/admin/roles";

async function guarded<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof MemberError) throw new ActionError(err.message, "invalid");
    throw err;
  }
}

const perms = z.array(z.string().min(1).max(64)).max(100);

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  description: z.string().trim().max(300).nullable().optional(),
  permissions: perms,
  allProjects: z.boolean(),
});

export async function createRoleAction(input: z.input<typeof createSchema>) {
  return runAction(async () => {
    const ctx = await actionAdmin();
    const row = await guarded(() => createRole(createSchema.parse(input), ctx.user));
    refresh();
    return { key: row.key, roles: await listRolesWithCounts() };
  });
}

const updateSchema = z
  .array(
    z.object({
      key: z.string().min(1).max(64),
      name: z.string().trim().min(1).max(60).optional(),
      description: z.string().trim().max(300).nullable().optional(),
      permissions: perms.optional(),
      allProjects: z.boolean().optional(),
    }),
  )
  .max(100);

export async function saveRolesAction(updates: z.input<typeof updateSchema>) {
  return runAction(async () => {
    const ctx = await actionAdmin();
    await guarded(() => updateRoles(updateSchema.parse(updates), ctx.user));
    refresh();
    return listRolesWithCounts();
  });
}

export async function resetRoleAction(key: string) {
  return runAction(async () => {
    const ctx = await actionAdmin();
    await guarded(() => resetBuiltinRole(z.string().min(1).max(64).parse(key), ctx.user));
    refresh();
    return listRolesWithCounts();
  });
}

export async function deleteRoleAction(key: string, reassignTo: string) {
  return runAction(async () => {
    const ctx = await actionAdmin();
    await guarded(() => deleteRole(z.string().min(1).max(64).parse(key), z.string().min(1).max(64).parse(reassignTo), ctx.user));
    refresh();
    return listRolesWithCounts();
  });
}
