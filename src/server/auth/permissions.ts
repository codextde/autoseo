/**
 * Permission catalogue. Roles (editable in Admin → Roles) are sets of these keys.
 * Kept isomorphic so the UI can render the permission matrix.
 */
export const PERMISSIONS = {
  "project.view": { group: "Projects", label: "View project data (dashboards, reports, tracking)" },
  "prompts.manage": { group: "Projects", label: "Add prompts, run the agent, edit tasks & content" },
  "seo.run": { group: "Projects", label: "Run paid SEO research (keywords, backlinks, rank checks, audits)" },
  "reports.manage": { group: "Projects", label: "Create, edit and share reports" },
  "attribution.manage": { group: "Projects", label: "Configure attribution, forms & webhooks" },
  "projects.all": { group: "Projects", label: "Access all projects (current & future)" },
  "projects.manage": { group: "Projects", label: "Create, configure and delete projects" },
  "team.view": { group: "Workspace", label: "See team members" },
  "members.manage": { group: "Workspace", label: "Invite members and change roles" },
  "settings.manage": { group: "Workspace", label: "Integrations, API keys, model settings" },
  "usage.view": { group: "Workspace", label: "See usage & cost balance" },
  "usage.manage": { group: "Workspace", label: "Manage budgets, view detailed usage" },
  "agents.manage": { group: "Workspace", label: "Install and manage local agents" },
  "workspace.manage": { group: "Workspace", label: "Rename or delete the workspace" },
  "admin.access": { group: "Instance", label: "Access the admin panel (instance-wide settings)" },
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export type BuiltinRole = {
  key: string;
  name: string;
  description: string;
  permissions: Permission[];
  allProjects: boolean;
  sortOrder: number;
};

export const BUILTIN_ROLES: BuiltinRole[] = [
  {
    key: "owner",
    name: "Owner",
    description: "Full access to the workspace including deletion. Instance administration is granted separately.",
    permissions: ALL_PERMISSIONS.filter((p) => p !== "admin.access"),
    allProjects: true,
    sortOrder: 0,
  },
  {
    key: "admin",
    name: "Admin",
    description: "Manages projects, members, integrations and usage.",
    permissions: ALL_PERMISSIONS.filter((p) => p !== "workspace.manage" && p !== "admin.access"),
    allProjects: true,
    sortOrder: 10,
  },
  {
    key: "member",
    name: "Member",
    description: "Works inside the projects they were given access to.",
    permissions: [
      "project.view",
      "prompts.manage",
      "seo.run",
      "reports.manage",
      "attribution.manage",
      "team.view",
      "usage.view",
    ],
    allProjects: false,
    sortOrder: 20,
  },
  {
    key: "client",
    name: "Client",
    description: "Read-only guest access to selected projects.",
    permissions: ["project.view"],
    allProjects: false,
    sortOrder: 30,
  },
];
