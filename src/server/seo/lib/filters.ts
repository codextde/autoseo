/**
 * DataForSEO `filters` expression building blocks + research-scope provider filters.
 * Port of open-seo `server/lib/dataforseo/{filters,researchScopeFilters}.ts`. Pure.
 */
import { SeoValidationError } from "./locations";
import { MAX_DATAFORSEO_FILTER_CONDITIONS, type ResearchScope, type ResearchTarget } from "./research-scope";

/** One condition tuple like ["field", "ilike", "%term%"] or a nested group. */
export type FilterClause = unknown[];

export function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Comma/plus separated terms → trimmed lowercase terms. */
export function parseFilterTerms(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .toLowerCase()
    .split(/[,+]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function collectNumericRange(out: FilterClause[], field: string, min: number | undefined | null, max: number | undefined | null) {
  if (typeof min === "number" && Number.isFinite(min)) out.push([field, ">=", min]);
  if (typeof max === "number" && Number.isFinite(max)) out.push([field, "<=", max]);
}

export function joinClauses(clauses: FilterClause[], operator: "and" | "or"): unknown[] {
  const out: unknown[] = [];
  for (const clause of clauses) {
    if (out.length > 0) out.push(operator);
    out.push(clause);
  }
  return out;
}

/** One ilike per include term, OR-joined into one nested group (match-any). */
export function buildIncludeOrGroup(field: string, include: string | undefined | null): { clause: FilterClause; conditionCount: number } | null {
  const conditions = parseFilterTerms(include).map((t) => [field, "ilike", `%${escapeLikeTerm(t)}%`]);
  if (conditions.length === 0) return null;
  if (conditions.length === 1) return { clause: conditions[0]!, conditionCount: 1 };
  return { clause: joinClauses(conditions, "or"), conditionCount: conditions.length };
}

/** DataForSEO accepts up to 8 filter conditions per request — throw instead of silently truncating. */
export function assertFilterConditionBudget(conditionCount: number): void {
  if (conditionCount > MAX_DATAFORSEO_FILTER_CONDITIONS) {
    throw new SeoValidationError(`Too many filter conditions (${conditionCount} of ${MAX_DATAFORSEO_FILTER_CONDITIONS} max).`);
  }
}

/** Leaf conditions in a clause list / joined expression (skips "and"/"or"). */
export function countExpressionConditions(clauses: readonly unknown[]): number {
  let count = 0;
  for (const clause of clauses) {
    if (!Array.isArray(clause)) continue;
    count += Array.isArray(clause[0]) ? countExpressionConditions(clause) : 1;
  }
  return count;
}

/* ───────────────────────────── Scope filters ───────────────────────────── */

export type ScopeFilter = { clauses: FilterClause[]; conditionCount: number };
const NO_FILTER: ScopeFilter = { clauses: [], conditionCount: 0 };

function scopeFilter(clauses: FilterClause[]): ScopeFilter {
  return { clauses, conditionCount: countExpressionConditions(clauses) };
}

function subfolderUrlClauses(field: string, hostname: string, path: string): FilterClause {
  const hosts = [hostname, `www.${hostname}`].map(escapeLikeTerm);
  const escapedPath = escapeLikeTerm(path);
  return joinClauses(
    hosts.flatMap((host) => [
      [field, "like", `%://${host}${escapedPath}`],
      [field, "like", `%://${host}${escapedPath}/%`],
    ]),
    "or",
  );
}

/** Backlinks API: only subfolder needs a filter (`url_to` rows, `url` domain pages). */
export function buildBacklinksScopeFilter(
  field: "url_to" | "url",
  target: { scope: ResearchScope; apiTarget: string; path: string },
): ScopeFilter {
  if (target.scope !== "subfolder") return NO_FILTER;
  return scopeFilter([subfolderUrlClauses(field, target.apiTarget, target.path)]);
}

/** ANDs scope clauses in front of an already-joined flat expression. */
export function prependScopeClauses(scope: ScopeFilter, expression: unknown[]): unknown[] {
  if (scope.clauses.length === 0) return expression;
  const joined = joinClauses(scope.clauses, "and");
  return expression.length === 0 ? joined : [...joined, "and", ...expression];
}

function hostPin(target: ResearchTarget): FilterClause {
  return ["ranked_serp_element.serp_item.domain", "in", [target.hostname, `www.${target.hostname}`]];
}

/** Labs ranked_keywords always rolls up host + subdomains; narrower scopes are expressed as filters. */
export function buildRankedKeywordsScopeFilter(target: ResearchTarget): ScopeFilter {
  const rel = "ranked_serp_element.serp_item.relative_url";
  const path = target.path || "/";
  const escapedPath = escapeLikeTerm(path);
  switch (target.scope) {
    case "subdomains":
      return NO_FILTER;
    case "domain":
      return scopeFilter([hostPin(target)]);
    case "subfolder":
      return scopeFilter([
        hostPin(target),
        joinClauses(
          [
            [rel, "=", path],
            [rel, "like", `${escapedPath}/%`],
            [rel, "like", `${escapedPath}?%`],
          ],
          "or",
        ),
      ]);
    case "exact_url":
      return scopeFilter([
        hostPin(target),
        joinClauses(
          [
            [rel, "in", [path, `${path}/`]],
            [rel, "like", `${escapedPath}?%`],
            [rel, "like", `${escapedPath}/?%`],
          ],
          "or",
        ),
      ]);
  }
}

/** Labs relevant_pages only exposes page_address, so host pin + path ride on `like` patterns. */
export function buildRelevantPagesScopeFilter(target: ResearchTarget): ScopeFilter {
  const hosts = [target.hostname, `www.${target.hostname}`].map(escapeLikeTerm);
  const path = escapeLikeTerm(target.path || "/");
  switch (target.scope) {
    case "subdomains":
      return NO_FILTER;
    case "domain":
      return scopeFilter([joinClauses(hosts.map((h) => ["page_address", "like", `%://${h}/%`]), "or")]);
    case "subfolder":
      return scopeFilter([subfolderUrlClauses("page_address", target.hostname, target.path)]);
    case "exact_url":
      return scopeFilter([
        joinClauses(
          hosts.flatMap((h) => [
            ["page_address", "like", `%://${h}${path}`],
            ["page_address", "like", `%://${h}${path}/`],
          ]),
          "or",
        ),
      ]);
  }
}
