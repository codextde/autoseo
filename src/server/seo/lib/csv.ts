/**
 * CSV / TSV export helpers (port of open-seo `client/lib/csv.ts`): every field quoted, numbers rounded to
 * 2 decimals, CSV-injection guard (values starting with = + - @ \t \r \n are prefixed with `'`). Pure.
 */

export type Cell = string | number | boolean | null | undefined;

const INJECTION = /^[=+\-@\t\r\n]/;

export function sanitizeCell(value: Cell): string {
  if (value == null) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return String(Math.round(value * 100) / 100);
  }
  const s = String(value);
  return INJECTION.test(s) ? `'${s}` : s;
}

export function buildCsv(headers: string[], rows: Cell[][]): string {
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [headers.map((h) => q(sanitizeCell(h))).join(",")];
  for (const row of rows) lines.push(row.map((c) => q(sanitizeCell(c))).join(","));
  return lines.join("\n");
}

export function buildTsv(headers: string[], rows: Cell[][]): string {
  const clean = (v: string) => v.replace(/[\t\r\n]+/g, " ");
  return [headers, ...rows].map((r) => r.map((c) => clean(sanitizeCell(c as Cell))).join("\t")).join("\n");
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** HTML table for rich clipboard paste into Google Sheets; http(s) URLs become links. */
export function buildHtmlTable(headers: string[], rows: Cell[][]): string {
  const cell = (c: Cell) => {
    const v = sanitizeCell(c);
    return /^https?:\/\//i.test(v) ? `<a href="${escapeHtml(v)}">${escapeHtml(v)}</a>` : escapeHtml(v);
  };
  const head = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`;
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${cell(c)}</td>`).join("")}</tr>`).join("");
  return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

/** "example.com/blog" → "example.com-blog" (≤80 chars) for export filenames. */
export function fileSafe(value: string, max = 80): string {
  return value
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}
