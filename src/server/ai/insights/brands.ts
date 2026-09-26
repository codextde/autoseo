import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { competitors, projects, promptTags } from "@/server/db/schema";
import { ENGINES } from "@/lib/engines";
import { rows } from "./filters";

export const OWN_KEY = "own";

/** A brand as shown in insight views: the own brand (key "own") or a competitor (key = id). */
export type BrandInfo = {
  key: string;
  competitorId: string | null;
  isOwn: boolean;
  name: string;
  domain: string | null;
  aliases: string[];
  color: string;
  tracked: boolean;
  source: "own" | "manual" | "auto" | "import";
  logoUrl: string | null;
};

/** Distinct from the brand green used for "You". */
const PALETTE = [
  "#f97316",
  "#3b82f6",
  "#a855f7",
  "#ef4444",
  "#eab308",
  "#06b6d4",
  "#ec4899",
  "#64748b",
  "#8b5cf6",
  "#14b8a6",
  "#f43f5e",
  "#84cc16",
];
export const OWN_COLOR = "var(--brand)";

type ProjectRow = typeof projects.$inferSelect;

export async function getBrands(project: ProjectRow): Promise<BrandInfo[]> {
  const rowsC = await db
    .select()
    .from(competitors)
    .where(eq(competitors.projectId, project.id))
    .orderBy(asc(competitors.createdAt), asc(competitors.name));
  const own: BrandInfo = {
    key: OWN_KEY,
    competitorId: null,
    isOwn: true,
    name: project.name.replace(/^Demo · /, ""),
    domain: project.domain,
    aliases: project.brand?.aliases ?? [],
    color: OWN_COLOR,
    tracked: true,
    source: "own",
    logoUrl: project.logoUrl,
  };
  return [
    own,
    ...rowsC.map((c, i) => ({
      key: c.id,
      competitorId: c.id,
      isOwn: false,
      name: c.name,
      domain: c.domain,
      aliases: c.aliases ?? [],
      color: c.color && /^#[0-9a-f]{3,8}$/i.test(c.color) ? c.color : PALETTE[i % PALETTE.length]!,
      tracked: c.tracked,
      source: c.source,
      logoUrl: c.logoUrl,
    })),
  ];
}

export function brandMap(brands: BrandInfo[]) {
  return new Map(brands.map((b) => [b.key, b]));
}

export type FilterOptions = {
  engines: { value: string; label: string }[];
  tags: { value: string; label: string; color: string | null }[];
};

/**
 * Options for the model/tag filters: the project's enabled engines plus any engine that has
 * answers (so historical data stays filterable), and all prompt tags.
 */
export async function getFilterOptions(project: ProjectRow): Promise<FilterOptions> {
  const [tagRows, engineRows] = await Promise.all([
    db
      .select({ id: promptTags.id, name: promptTags.name, color: promptTags.color })
      .from(promptTags)
      .where(eq(promptTags.projectId, project.id))
      .orderBy(asc(promptTags.name)),
    rows<{ engine: string }>(sql`select distinct engine from ai_answers where project_id = ${project.id}`),
  ]);
  const ids = new Set<string>([...(project.engines ?? []), ...engineRows.map((r) => r.engine)]);
  const order = ENGINES.map((e) => e.id as string);
  return {
    engines: [...ids]
      .sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
      .map((id) => ({ value: id, label: ENGINES.find((e) => e.id === id)?.name ?? id })),
    tags: tagRows.map((t) => ({ value: t.id, label: t.name, color: t.color })),
  };
}

/** Lower-cased names that identify a brand in answers (name + aliases). */
export function brandNames(b: { name: string; aliases?: string[] | null }): string[] {
  return [...new Set([b.name, ...(b.aliases ?? [])].map((n) => n.trim().toLowerCase()).filter(Boolean))];
}
