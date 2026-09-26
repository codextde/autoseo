import { customAlphabet } from "nanoid";
import type { Paragraph, Run } from "./types";

const nano = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 10);

/** Short random id for slides/elements. */
export function uid(prefix = "el"): string {
  return `${prefix}_${nano()}`;
}

/**
 * Parses a tiny markup into paragraphs:
 * `**bold**`, `*italic*`, `==accent==` (theme accent color), `{{token.key}}` (live data),
 * newline = new paragraph, leading "- " or "• " = bullet.
 */
export function parseMarkup(input: string, accent = "$accent"): Paragraph[] {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  return lines.map((line) => {
    let bullet = false;
    let text = line;
    const m = /^\s*(?:[-•]\s+)/.exec(text);
    if (m) {
      bullet = true;
      text = text.slice(m[0].length);
    }
    const runs: Run[] = [];
    let b = false;
    let i = false;
    let acc = false;
    let buf = "";
    const flush = () => {
      if (!buf) return;
      const run: Run = { text: buf };
      if (b) run.b = true;
      if (i) run.i = true;
      if (acc) run.color = accent;
      runs.push(run);
      buf = "";
    };
    for (let p = 0; p < text.length; p++) {
      const two = text.slice(p, p + 2);
      if (two === "{{") {
        const end = text.indexOf("}}", p + 2);
        const key = end > -1 ? text.slice(p + 2, end).trim() : "";
        if (end > -1 && /^[a-z][a-z0-9_.]*$/.test(key)) {
          flush();
          const run: Run = { text: "", token: key };
          if (b) run.b = true;
          if (i) run.i = true;
          if (acc) run.color = accent;
          runs.push(run);
          p = end + 1;
          continue;
        }
      }
      if (two === "**") {
        flush();
        b = !b;
        p++;
        continue;
      }
      if (two === "==") {
        flush();
        acc = !acc;
        p++;
        continue;
      }
      if (text[p] === "*" && text[p + 1] !== " ") {
        flush();
        i = !i;
        continue;
      }
      if (text[p] === "*" && i) {
        flush();
        i = false;
        continue;
      }
      buf += text[p];
    }
    flush();
    return bullet ? { runs, bullet } : { runs };
  });
}

/** Inverse of parseMarkup (accent = any colored run). */
export function toMarkup(paragraphs: Paragraph[]): string {
  return paragraphs
    .map((p) => {
      const body = p.runs
        .map((r) => {
          let t = r.token ? `{{${r.token}}}` : r.text;
          if (!t) return "";
          if (r.color) t = `==${t}==`;
          if (r.i) t = `*${t}*`;
          if (r.b) t = `**${t}**`;
          return t;
        })
        .join("");
      return (p.bullet ? "- " : "") + body;
    })
    .join("\n");
}

/** Plain text with tokens kept as {{key}} placeholders. */
export function toPlainWithTokens(paragraphs: Paragraph[]): string {
  return paragraphs.map((p) => p.runs.map((r) => (r.token ? `{{${r.token}}}` : r.text)).join("")).join("\n");
}

/** Plain text with tokens resolved by `resolve`. */
export function toPlain(paragraphs: Paragraph[], resolve: (key: string) => string): string {
  return paragraphs.map((p) => p.runs.map((r) => (r.token ? resolve(r.token) : r.text)).join("")).join("\n");
}

/** Merges adjacent runs with identical formatting. */
export function normalizeRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    if (!r.token && !r.text) continue;
    const prev = out[out.length - 1];
    if (prev && !prev.token && !r.token && !!prev.b === !!r.b && !!prev.i === !!r.i && !!prev.u === !!r.u && prev.color === r.color) {
      prev.text += r.text;
    } else out.push({ ...r });
  }
  return out;
}

export function paragraphsFromPlain(text: string): Paragraph[] {
  return text.split("\n").map((line) => ({ runs: line ? [{ text: line }] : [] }));
}

/** Applies a mark to every run (used when a whole text box is selected, not in edit mode). */
export function setMarkOnAll(paragraphs: Paragraph[], patch: Partial<Pick<Run, "b" | "i" | "u" | "color">>): Paragraph[] {
  return paragraphs.map((p) => ({
    ...p,
    runs: p.runs.map((r) => {
      const next: Run = { ...r, ...patch };
      for (const k of ["b", "i", "u", "color"] as const) if (next[k] === undefined || next[k] === false) delete next[k];
      return next;
    }),
  }));
}

export function allRunsHave(paragraphs: Paragraph[], mark: "b" | "i" | "u"): boolean {
  const runs = paragraphs.flatMap((p) => p.runs).filter((r) => r.token || r.text.trim());
  return runs.length > 0 && runs.every((r) => !!r[mark]);
}

export function tokensIn(paragraphs: Paragraph[]): string[] {
  return paragraphs.flatMap((p) => p.runs.filter((r) => r.token).map((r) => r.token!));
}
