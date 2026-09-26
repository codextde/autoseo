import "server-only";
import { httpJson } from "../http";

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export type SheetCell = string | number | boolean | null;

/** Google Sheets limits: 10 M cells per spreadsheet, 50 000 characters per cell. */
export const MAX_SHEET_CELLS = 5_000_000;
export const MAX_SHEET_ROWS = 200_000;
const MAX_CELL_CHARS = 50_000;
const ROWS_PER_REQUEST = 10_000;

export class SheetExportLimitError extends Error {}

/**
 * Normalizes a cell for `valueInputOption=RAW` (values are stored verbatim, never evaluated as
 * formulas). CSV exports prefix risky values with an apostrophe as an injection guard — that
 * prefix is unnecessary with RAW input and is removed again.
 */
export function toSheetValue(cell: SheetCell | undefined): string | number | boolean {
  if (cell == null) return "";
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : "";
  if (typeof cell === "boolean") return cell;
  const s = /^'[=+\-@\t\r\n]/.test(cell) ? cell.slice(1) : cell;
  return s.length > MAX_CELL_CHARS ? s.slice(0, MAX_CELL_CHARS) : s;
}

/** Column letter(s) for a 1-based column index (1 → A, 27 → AA). */
export function columnLetter(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s || "A";
}

export function validateSheetExport(headers: string[], rows: SheetCell[][]) {
  if (!headers.length) throw new SheetExportLimitError("Nothing to export.");
  if (headers.length > 500) throw new SheetExportLimitError("Too many columns (max 500).");
  if (rows.length > MAX_SHEET_ROWS) throw new SheetExportLimitError(`Too many rows for one sheet (max ${MAX_SHEET_ROWS.toLocaleString("en-US")}). Download CSV instead.`);
  if ((rows.length + 1) * headers.length > MAX_SHEET_CELLS) throw new SheetExportLimitError("The table is too large for Google Sheets. Download CSV instead.");
}

type CreateResponse = {
  spreadsheetId: string;
  spreadsheetUrl: string;
  sheets?: { properties?: { sheetId?: number; title?: string } }[];
};

/**
 * Creates a spreadsheet in the account's Drive (scope `drive.file`) with a bold, frozen header row
 * and the given rows. Returns the spreadsheet URL.
 */
export async function createSpreadsheetFromRows(
  accessToken: string,
  input: { title: string; headers: string[]; rows: SheetCell[][]; sheetTitle?: string },
): Promise<{ spreadsheetId: string; url: string; rows: number }> {
  validateSheetExport(input.headers, input.rows);
  const headers = { Authorization: `Bearer ${accessToken}` };
  const sheetTitle = (input.sheetTitle ?? "Data").slice(0, 90);
  const columns = input.headers.length;
  const created = await httpJson<CreateResponse>(SHEETS_BASE, {
    method: "POST",
    headers,
    body: {
      properties: { title: input.title.slice(0, 200) || "AutoSEO export" },
      sheets: [
        {
          properties: {
            title: sheetTitle,
            gridProperties: { rowCount: Math.max(2, input.rows.length + 1), columnCount: Math.max(1, columns), frozenRowCount: 1 },
          },
        },
      ],
    },
    timeoutMs: 30_000,
  });
  const sheetId = created.sheets?.[0]?.properties?.sheetId ?? 0;
  const quotedTitle = `'${sheetTitle.replace(/'/g, "''")}'`;
  const all = [input.headers.map((h) => toSheetValue(h)), ...input.rows.map((r) => Array.from({ length: columns }, (_, i) => toSheetValue(r[i])))];
  for (let start = 0; start < all.length; start += ROWS_PER_REQUEST) {
    const chunk = all.slice(start, start + ROWS_PER_REQUEST);
    const range = `${quotedTitle}!A${start + 1}:${columnLetter(columns)}${start + chunk.length}`;
    await httpJson(`${SHEETS_BASE}/${encodeURIComponent(created.spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
      method: "PUT",
      headers,
      body: { range, majorDimension: "ROWS", values: chunk },
      timeoutMs: 60_000,
    });
  }
  await httpJson(`${SHEETS_BASE}/${encodeURIComponent(created.spreadsheetId)}:batchUpdate`, {
    method: "POST",
    headers,
    body: {
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: "userEnteredFormat.textFormat.bold",
          },
        },
        { autoResizeDimensions: { dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: Math.min(columns, 26) } } },
      ],
    },
    timeoutMs: 30_000,
  });
  return {
    spreadsheetId: created.spreadsheetId,
    url: created.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${created.spreadsheetId}/edit`,
    rows: input.rows.length,
  };
}
