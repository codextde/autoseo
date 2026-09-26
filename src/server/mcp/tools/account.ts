import "server-only";
import { z } from "zod";
import { accessibleProjects, credentialKindLabel } from "@/server/api/auth";
import { ApiError } from "@/server/api/errors";
import { projectCounts, projectDto } from "@/server/api/ai-data";
import { createProject } from "@/server/projects";
import { defineTool } from "../types";
import { mdTable, projectIdInput, toolProject } from "../helpers";

/** Account & project tools (open-seo: whoami, list_projects, create_project; finseo: list_projects). */
export const accountTools = [
  defineTool({
    name: "whoami",
    title: "Who am I",
    description: "Shows the authenticated user, workspace, credential type, granted scopes and project access of this connection.",
    input: z.object({}),
    scope: "read",
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(_args, ctx) {
      const p = ctx.principal;
      const projects = await accessibleProjects(p);
      const data = {
        user: p.user,
        workspace: p.workspace,
        role: p.roleKey,
        credential: { kind: credentialKindLabel(p), name: p.name, clientId: p.clientId },
        scopes: [...p.scopes],
        projectAccess: p.restrictedProjectIds ? "selected" : "all",
        projectCount: projects.length,
        baseUrl: ctx.baseUrl,
      };
      return {
        text: [
          `Account: ${p.user.email}${p.user.name ? ` (${p.user.name})` : ""}`,
          `Workspace: ${p.workspace.name} — role ${p.roleKey}`,
          `Credential: ${data.credential.kind} "${p.name}"`,
          `Scopes: ${data.scopes.join(", ")}`,
          `Projects: ${projects.length} (${data.projectAccess === "all" ? "all projects" : "selected projects only"})`,
        ].join("\n"),
        data,
      };
    },
  }),

  defineTool({
    name: "list_projects",
    title: "List projects",
    description:
      "Lists the projects (brands / websites) this connection can access, with market, tracked AI models and prompt counts. Use the returned id as projectId for every other tool.",
    input: z.object({}),
    scope: "read",
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(_args, ctx) {
      const projects = await accessibleProjects(ctx.principal);
      const counts = await projectCounts(projects.map((p) => p.id));
      const items = projects.map((p) => ({ ...projectDto(p, ctx.baseUrl), activePrompts: counts.get(p.id)?.prompts ?? 0, competitors: counts.get(p.id)?.competitors ?? 0 }));
      return {
        text: `${items.length} project(s):\n\n${mdTable(items, [
          ["id", (r) => r.id],
          ["name", (r) => r.name],
          ["domain", (r) => r.domain],
          ["market", (r) => `${r.country}/${r.language}`],
          ["models", (r) => r.engines],
          ["prompts", (r) => r.activePrompts],
          ["competitors", (r) => r.competitors],
        ])}`,
        data: { projects: items },
      };
    },
  }),

  defineTool({
    name: "get_project",
    title: "Get project",
    description: "Returns one project's settings: domain, market, brand aliases, tracked AI models, tracking frequency and counts.",
    input: z.object({ projectId: projectIdInput }),
    scope: "read",
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const counts = (await projectCounts([p.id])).get(p.id);
      const project = { ...projectDto(p, ctx.baseUrl), activePrompts: counts?.prompts ?? 0, competitors: counts?.competitors ?? 0 };
      return {
        text: `**${p.name}** (${p.domain}) — market ${p.country}/${p.language}, models: ${p.engines.join(", ")}, tracking ${p.trackingFrequency}, ${project.activePrompts} active prompts, ${project.competitors} competitors.\n${project.url}`,
        data: { project },
      };
    },
  }),

  defineTool({
    name: "create_project",
    title: "Create project",
    description:
      "Creates a new project (brand / website) in the workspace. Brand profile, competitors and first prompts are generated in the background. Requires the write scope and a role that may create projects.",
    input: z.object({
      name: z.string().trim().min(1).max(120).describe("Project / brand name."),
      domain: z.string().trim().min(3).max(255).describe("Website domain, e.g. example.com."),
      country: z.string().length(2).optional().describe("ISO country code of the tracking market, e.g. DE, US."),
      language: z.string().min(2).max(8).optional().describe("Language code, e.g. de, en."),
    }),
    scope: "write",
    permission: "projects.manage",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    async handler(args, ctx) {
      if (ctx.principal.restrictedProjectIds) {
        throw new ApiError("forbidden", "This credential is restricted to selected projects and cannot create new ones.");
      }
      let project;
      try {
        project = await createProject({
          workspaceId: ctx.principal.workspace.id,
          name: args.name,
          domain: args.domain,
          country: args.country?.toUpperCase(),
          language: args.language?.toLowerCase(),
          createdBy: { id: ctx.principal.user.id, email: ctx.principal.user.email },
        });
      } catch (err) {
        throw new ApiError("validation_error", err instanceof Error ? err.message : "Could not create project.");
      }
      const dto = projectDto(project, ctx.baseUrl);
      return { text: `Created project **${project.name}** (${project.id}). Setup runs in the background.\n${dto.url}`, data: { project: dto } };
    },
  }),
];
