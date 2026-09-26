import "server-only";
import { z } from "zod";
import { accessibleProjects, getApiProject, type ApiProject } from "@/server/api/auth";
import { ApiError } from "@/server/api/errors";
import type { McpToolContext } from "./types";

export const projectIdInput = z
  .string()
  .max(64)
  .optional()
  .describe("Project id (from list_projects). Optional when the credential can access exactly one project.");

/** Resolves the project for a tool call (defaults to the only accessible project). */
export async function toolProject(ctx: McpToolContext, projectId: string | undefined): Promise<ApiProject> {
  if (projectId) return getApiProject(ctx.principal, projectId);
  const list = await accessibleProjects(ctx.principal);
  if (list.length === 1) return list[0]!;
  if (!list.length) throw new ApiError("not_found", "This credential cannot access any project.");
  throw new ApiError(
    "validation_error",
    `projectId is required — this credential can access ${list.length} projects: ${list
      .slice(0, 20)
      .map((p) => `${p.id} (${p.name})`)
      .join(", ")}`,
  );
}

function cell(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(1);
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.map(cell).join(", ") || "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v).replace(/\s+/g, " ").replace(/\|/g, "\\|").slice(0, 160);
}

/** Compact markdown table for agent-readable tool output. */
export function mdTable<T>(rows: T[], cols: [header: string, get: (r: T) => unknown][], max = 50): string {
  if (!rows.length) return "_No rows._";
  const head = `| ${cols.map((c) => c[0]).join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows
    .slice(0, max)
    .map((r) => `| ${cols.map((c) => cell(c[1](r))).join(" | ")} |`)
    .join("\n");
  const more = rows.length > max ? `\n_…and ${rows.length - max} more rows (see structured content)._` : "";
  return `${head}\n${body}${more}`;
}

export const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1)}%`);
export const signed = (v: number | null | undefined, suffix = "") => (v == null ? "" : ` (${v >= 0 ? "+" : ""}${v.toFixed(1)}${suffix})`);
