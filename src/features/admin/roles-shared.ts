import type { Permission } from "@/server/auth/permissions";

/** Permissions the Owner role always keeps, so every workspace stays manageable (isomorphic). */
export const OWNER_LOCKED: Permission[] = ["workspace.manage", "members.manage", "projects.manage", "team.view"];

export type RoleItem = {
  key: string;
  name: string;
  description: string | null;
  permissions: Permission[];
  allProjects: boolean;
  builtin: boolean;
  sortOrder: number;
  members: number;
};
