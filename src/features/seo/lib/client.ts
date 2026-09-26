"use client";

import { toast } from "sonner";
import type { ActionResult } from "@/server/auth/guards";
import { buildCsv, buildHtmlTable, buildTsv, type Cell } from "@/server/seo/lib/csv";

/** Unwraps a server-action result or throws its error message. */
export function unwrap<T>(res: ActionResult<T>): T {
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function toastError(err: unknown, fallback = "Something went wrong") {
  toast.error(errorMessage(err) || fallback);
}

export function downloadFile(filename: string, content: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(filename: string, headers: string[], rows: Cell[][]) {
  downloadFile(filename, buildCsv(headers, rows));
}

/** "Export to Sheets": TSV + HTML table on the clipboard, then the user pastes into sheets.new. */
export async function copyTableForSheets(headers: string[], rows: Cell[][]): Promise<boolean> {
  if (rows.length === 0) {
    toast.error("No data to export");
    return false;
  }
  const tsv = buildTsv(headers, rows);
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([tsv], { type: "text/plain" }),
          "text/html": new Blob([buildHtmlTable(headers, rows)], { type: "text/html" }),
        }),
      ]);
    } else {
      await navigator.clipboard.writeText(tsv);
    }
    return true;
  } catch {
    toast.error("Could not copy to the clipboard");
    return false;
  }
}

export async function copyText(text: string, success = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(success);
  } catch {
    toast.error("Could not copy to the clipboard");
  }
}

export function formatDate(value: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", opts);
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function num(v: string | null | undefined): number | undefined {
  if (v == null || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
