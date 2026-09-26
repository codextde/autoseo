import { deterministicAuditRowId } from "./ids";
import { getIssueDescriptor } from "./registry";
import type { DetectedIssue } from "./types";

/** Maps detected issues to `site_audit_issues` rows with deterministic ids (idempotent inserts). */
export function issueRows(auditId: string, issues: DetectedIssue[]) {
  return issues.map((issue) => {
    const d = getIssueDescriptor(issue.issueType)!;
    return {
      id: deterministicAuditRowId(auditId, issue.pageUrl, issue.issueType, issue.dedupeKey ?? ""),
      auditId,
      pageId: issue.pageId,
      pageUrl: issue.pageUrl,
      issueType: issue.issueType,
      severity: d.severity,
      category: d.category,
      details: issue.details ?? null,
    };
  });
}
