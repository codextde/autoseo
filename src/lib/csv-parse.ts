/** Pure CSV helpers used when server-generated CSV exports are also sent to Google Sheets. */

/** Minimal RFC 4180 CSV parser (for server-generated CSV exports that should also go to Sheets). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Converts plain decimal strings to numbers (keeps leading-zero codes like "0123" as text). */
export function parseCsvNumbers(rows: string[][]): (string | number)[][] {
  return rows.map((r) => r.map((v) => (v !== "" && v.length < 16 && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(v) ? Number(v) : v)));
}
