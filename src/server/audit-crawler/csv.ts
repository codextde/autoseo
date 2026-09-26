/** CSV builder with formula-injection protection (cells starting with = + - @ are prefixed with '). */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n") + "\r\n";
}

/** `key: value · key: value` (arrays joined with " → ") — issue details rendering (open-seo parity). */
export function formatIssueDetails(details: Record<string, unknown> | null | undefined): string {
  if (!details) return "";
  return Object.entries(details)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" → ") : typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}
