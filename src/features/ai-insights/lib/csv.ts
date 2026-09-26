"use client";

/** Builds a CSV (RFC 4180 quoting, formula-injection safe) and triggers a download. */
export function downloadCsv(filename: string, header: string[], data: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    if (v == null) return "";
    let s = typeof v === "number" ? (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : "") : String(v);
    // Neutralise spreadsheet formulas.
    if (/^[=+\-@\t\r]/.test(s) && typeof v !== "number") s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...data].map((r) => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
