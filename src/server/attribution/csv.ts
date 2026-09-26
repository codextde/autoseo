/**
 * Minimal RFC 4180 CSV parser + column auto-detection for survey imports. Pure module.
 */
import { createHash } from "node:crypto";
import { HDYHAU_PATTERN } from "./channels";
import { valueToNumber } from "./mapping";
import type { ResponseInput } from "./types";

export function parseCsv(text: string, maxRows = 50_000): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  // Detect delimiter from the first line (comma, semicolon or tab).
  const firstLine = src.slice(0, src.indexOf("\n") === -1 ? src.length : src.indexOf("\n"));
  const counts = { ",": 0, ";": 0, "\t": 0 } as Record<string, number>;
  for (const ch of firstLine) if (ch in counts) counts[ch]!++;
  const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![1] > 0 ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![0] : ",";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      if (rows.length >= maxRows) return rows;
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export type CsvColumnMap = Partial<Record<"answer" | "other" | "question" | "email" | "transactionId" | "value" | "currency" | "date" | "name" | "externalId" | "formName", number>>;

const HEADER_PATTERNS: Array<[keyof CsvColumnMap, RegExp]> = [
  ["question", /^(question|frage|question_?title|survey_?question)$/i],
  ["other", /other[\s_]*(response|answer)|sonstig|freetext|free[\s_]*text/i],
  ["answer", /^(response|answer|antwort|channel|source|kanal|hdyhau|attribution|how did you hear.*|wie bist du.*|value_?label)$/i],
  ["email", /e-?mail/i],
  ["transactionId", /order[\s_]*(id|number|nr|name)|transaction|bestell|invoice/i],
  ["value", /order[\s_]*total|total|amount|revenue|deal[\s_]*value|umsatz|betrag|order[\s_]*value/i],
  ["currency", /currency|währung|waehrung/i],
  ["date", /date|created|inserted|submitted|provided[\s_]*at|timestamp|datum|zeit/i],
  ["name", /^(name|full[\s_]*name|customer[\s_]*name)$/i],
  ["externalId", /^(id|response[\s_]*id|respondent[\s_]*id|customer[\s_]*id|submission[\s_]*id)$/i],
  ["formName", /^(form|survey|formular|survey[\s_]*name|form[\s_]*name)$/i],
];

export function detectColumns(header: string[]): CsvColumnMap {
  const map: CsvColumnMap = {};
  header.forEach((h, idx) => {
    const name = h.trim();
    for (const [key, re] of HEADER_PATTERNS) {
      if (map[key] === undefined && re.test(name)) {
        map[key] = idx;
        break;
      }
    }
    // A column titled with the question itself ("How did you hear about us?") holds the answer.
    if (map.answer === undefined && HDYHAU_PATTERN.test(name)) map.answer = idx;
  });
  return map;
}

/** Converts CSV rows into response inputs. Rows of other questions are skipped when a question column exists. */
export function csvToResponses(
  rows: string[][],
  columns?: CsvColumnMap,
): { inputs: ResponseInput[]; skipped: number; columns: CsvColumnMap; header: string[] } {
  if (!rows.length) return { inputs: [], skipped: 0, columns: {}, header: [] };
  const header = rows[0]!.map((h) => h.trim());
  const map = columns ?? detectColumns(header);
  const body = rows.slice(1);
  const get = (r: string[], k: keyof CsvColumnMap) => {
    const i = map[k];
    return i === undefined ? "" : (r[i] ?? "").trim();
  };
  const hasQuestion = map.question !== undefined && body.some((r) => HDYHAU_PATTERN.test(get(r, "question")));
  const inputs: ResponseInput[] = [];
  let skipped = 0;
  for (const r of body) {
    if (hasQuestion && !HDYHAU_PATTERN.test(get(r, "question"))) {
      skipped++;
      continue;
    }
    const answer = get(r, "answer");
    const other = get(r, "other");
    if (!answer && !other) {
      skipped++;
      continue;
    }
    const dateRaw = get(r, "date");
    const date = dateRaw ? new Date(dateRaw) : null;
    const value = valueToNumber(get(r, "value"));
    const tx = get(r, "transactionId");
    const ext = get(r, "externalId");
    inputs.push({
      channel: answer || other,
      rawAnswer: answer || other,
      freetext: other || null,
      email: get(r, "email") || null,
      transactionId: tx || null,
      dealValue: value,
      dealCurrency: get(r, "currency") || null,
      occurredAt: date && !Number.isNaN(date.getTime()) ? date : null,
      name: get(r, "name") || null,
      externalId: ext || null,
      formName: get(r, "formName") || null,
      // Re-uploading the same file updates instead of duplicating rows.
      dedupeKey: ext ? null : `csv:${createHash("sha256").update(r.map((c) => c.trim()).join("\u001f")).digest("hex").slice(0, 32)}`,
    });
  }
  return { inputs, skipped, columns: map, header };
}
