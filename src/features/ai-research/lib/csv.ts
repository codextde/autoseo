/**
 * Tiny RFC 4180 CSV reader/writer (isomorphic). Handles quoted fields, escaped quotes,
 * newlines inside quotes, BOM and auto-detects `,` `;` or tab delimiters.
 */

export function detectDelimiter(text: string): "," | ";" | "\t" {
  const firstLine = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  const counts = { ",": 0, ";": 0, "\t": 0 } as Record<"," | ";" | "\t", number>;
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch as "," | ";" | "\t"]++;
  }
  const best = (Object.entries(counts) as ["," | ";" | "\t", number][]).sort((a, b) => b[1] - a[1])[0]!;
  return best[1] > 0 ? best[0] : ",";
}

export function parseCsv(input: string, opts: { delimiter?: string; maxRows?: number } = {}): string[][] {
  const text = input.replace(/^﻿/, "");
  const delimiter = opts.delimiter ?? detectDelimiter(text);
  const maxRows = opts.maxRows ?? Infinity;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") inQuotes = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      if (rows.length >= maxRows) return rows;
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
  }
  return rows;
}

function escapeCell(v: unknown, delimiter: string): string {
  if (v == null) return "";
  let s = String(v);
  // Neutralize spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return s.includes('"') || s.includes(delimiter) || s.includes("\n") || s.includes("\r") ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][], delimiter = ","): string {
  return [header, ...rows].map((r) => r.map((c) => escapeCell(c, delimiter)).join(delimiter)).join("\r\n") + "\r\n";
}

/** Triggers a CSV download in the browser. */
export function downloadCsv(filename: string, header: string[], rows: unknown[][]) {
  const blob = new Blob(["﻿" + toCsv(header, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "export"
  );
}
