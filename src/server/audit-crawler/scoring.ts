/**
 * Site health score (see registry.ts for the formula). Pure.
 */
import { getIssueDescriptor, RATE_LIMIT_SCORE_PENALTY, SEVERITY_PENALTY, type IssueSeverity } from "./registry";

export type ScorePage = { id: string; statusCode: number | null };
export type ScoreIssue = { pageId: string | null; issueType: string; severity?: IssueSeverity };

export function computePageScores(pages: ScorePage[], issues: ScoreIssue[]): Map<string, { score: number; issueCount: number }> {
  const typesByPage = new Map<string, Map<string, IssueSeverity>>();
  const countByPage = new Map<string, number>();
  for (const issue of issues) {
    if (!issue.pageId) continue;
    countByPage.set(issue.pageId, (countByPage.get(issue.pageId) ?? 0) + 1);
    const severity = issue.severity ?? getIssueDescriptor(issue.issueType)?.severity ?? "info";
    let m = typesByPage.get(issue.pageId);
    if (!m) typesByPage.set(issue.pageId, (m = new Map()));
    m.set(issue.issueType, severity);
  }
  const out = new Map<string, { score: number; issueCount: number }>();
  for (const page of pages) {
    const types = typesByPage.get(page.id);
    let score = 100;
    if (types) for (const sev of types.values()) score -= SEVERITY_PENALTY[sev];
    out.set(page.id, { score: Math.max(0, score), issueCount: countByPage.get(page.id) ?? 0 });
  }
  return out;
}

export function computeHealthScore(
  pages: ScorePage[],
  issues: ScoreIssue[],
  opts: { rateLimited?: boolean } = {},
): { score: number | null; pageScores: Map<string, { score: number; issueCount: number }> } {
  const pageScores = computePageScores(pages, issues);
  const issuePages = new Set(issues.map((i) => i.pageId).filter(Boolean));
  const scored = pages.filter((p) => {
    // Fetch errors (timeouts, DNS failures) say nothing about page quality.
    if (!p.statusCode) return false;
    const isRedirect = p.statusCode >= 300 && p.statusCode < 400;
    return !isRedirect || issuePages.has(p.id);
  });
  if (!scored.length) return { score: null, pageScores };
  const mean = scored.reduce((sum, p) => sum + (pageScores.get(p.id)?.score ?? 100), 0) / scored.length;
  const penalty = opts.rateLimited ? RATE_LIMIT_SCORE_PENALTY : 0;
  return { score: Math.max(0, Math.min(100, Math.round(mean - penalty))), pageScores };
}

export function summarizeIssueCounts(issues: Array<{ issueType: string; severity: IssueSeverity }>) {
  const counts = { critical: 0, warning: 0, info: 0, total: issues.length, types: new Set(issues.map((i) => i.issueType)).size };
  for (const issue of issues) counts[issue.severity] += 1;
  return counts;
}
